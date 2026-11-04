import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { completePath, execCommand, submitCode } from '../api/terminal.js';
import { describeError } from './adapters.js';
import { stripAnsi } from './ansi.js';
import { FIRST_BLOOD_BANNER } from './banner.js';
import {
  DEFAULT_HOME, MAX_COMMAND_LENGTH, classifyCommand, formatPrompt, submitErrorMessage,
} from './commandLine.js';
import {
  applyCompletion, completeCommands, mergeCompletions, splitCompletion, unquoteWord,
} from './completion.js';
import { QUICK_CHIPS } from './data.js';
import {
  formatHistory, freshNav, loadHistory, pushHistory, saveHistory, stepHistory,
} from './history.js';
import { useMediaQuery, useReducedMotion } from './hooks.js';
import { bootLength, bootLines, revealLines } from './viewModel.js';
import Confetti from './Confetti.jsx';
import Entry from './Entry.jsx';
import MatrixRain from './MatrixRain.jsx';

/*
 * The Arena Terminal window: title strip, scrollback (role="log"), a sticky prompt line and quick-command chips.
 * The server is stateless, so the cwd of the previous reply travels with every command. Everything the server prints
 * is rendered as React text nodes (see AnsiText); nothing is ever injected as HTML.
 */

const MAX_ENTRIES = 600; // scrollback cap, oldest entries drop off
const BOOT_MS = 2600; // the whole boot text types in about this long
const BOOT_TICK = 24;
const SPINNER = ['|', '/', '-', '\\'];

const browserStorage = () => {
  try { return window.localStorage; } catch { return null; }
};

function useSpinnerFrame(active, reduced) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active || reduced) return undefined;
    const timer = setInterval(() => setIndex((value) => (value + 1) % SPINNER.length), 90);
    return () => clearInterval(timer);
  }, [active, reduced]);
  return reduced ? '…' : SPINNER[index];
}

export default function TerminalWindow({
  mode, info, statusLabel, isAdmin = false, home = DEFAULT_HOME, onFirstCommand, onSolved, onUnauthorized,
}) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const coarsePointer = useMediaQuery('(pointer: coarse)');

  const [entries, setEntries] = useState([]);
  const [value, setValue] = useState('');
  const [cwd, setCwd] = useState(home);
  const [busy, setBusy] = useState(false);
  const [boot, setBoot] = useState({ run: 0, chars: 0, visible: true });
  const [matrixRun, setMatrixRun] = useState(0);
  const [confettiRun, setConfettiRun] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [history, setHistory] = useState(() => loadHistory(browserStorage(), mode));

  // Mirrors of state for the key handlers and async callbacks (always the latest value, never a stale closure).
  const windowRef = useRef(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const valueRef = useRef('');
  const cwdRef = useRef(home);
  const busyRef = useRef(false);
  const historyRef = useRef(history);
  const navRef = useRef(freshNav(history));
  const controllerRef = useRef(null);
  const lastTabRef = useRef(null);
  const tabEscapeRef = useRef(false);
  const completingRef = useRef(false);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  const caretRef = useRef(null);
  const seqRef = useRef(0);
  const timersRef = useRef(new Set());
  const handlersRef = useRef({});
  handlersRef.current = { onFirstCommand, onSolved, onUnauthorized };

  // ----- boot text -----
  const lines = useMemo(() => bootLines((info?.lore ?? []).map(stripAnsi)), [info]);
  const total = useMemo(() => bootLength(lines), [lines]);
  const shownChars = reducedMotion ? total : Math.min(boot.chars, total);
  const bootDone = shownChars >= total;

  useEffect(() => {
    if (!boot.visible || reducedMotion) return undefined;
    const run = boot.run;
    const step = Math.max(1, Math.ceil(total / (BOOT_MS / BOOT_TICK)));
    let chars = 0;
    const timer = setInterval(() => {
      chars = Math.min(total, chars + step);
      setBoot((current) => (current.run === run ? { ...current, chars: Math.max(current.chars, chars) } : current));
      if (chars >= total) clearInterval(timer);
    }, BOOT_TICK);
    return () => clearInterval(timer);
  }, [boot.run, boot.visible, reducedMotion, total]);

  const skipBoot = useCallback(() => setBoot((current) => (current.chars >= total ? current : { ...current, chars: total })), [total]);
  const startBoot = useCallback(() => setBoot((current) => ({ run: current.run + 1, chars: 0, visible: true })), []);

  // ----- lifecycle -----
  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      if (controllerRef.current) controllerRef.current.abort();
      timers.forEach(clearTimeout);
    };
  }, []);

  // Focus once on mount. Touch screens keep the keyboard closed and instead bring the window to the top of the screen,
  // because the site header and heading would otherwise push the prompt below the fold.
  useEffect(() => {
    if (!coarsePointer && inputRef.current) inputRef.current.focus({ preventScroll: true });
    if (coarsePointer && windowRef.current && windowRef.current.scrollIntoView) windowRef.current.scrollIntoView({ block: 'start' });
  }, []);

  // Keep the newest output (and the prompt under it) in view: scroll the terminal only, never the page.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries, shownChars, busy, boot.visible]);

  // Apply a caret position requested by Tab completion or a chip after React has written the new value.
  useLayoutEffect(() => {
    if (caretRef.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  }, [value]);

  useEffect(() => { saveHistory(browserStorage(), mode, history); }, [history, mode]);

  // ----- small helpers -----
  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => { timersRef.current.delete(id); if (mountedRef.current) fn(); }, ms);
    timersRef.current.add(id);
  }, []);

  const focusInput = useCallback(() => {
    if (inputRef.current) inputRef.current.focus({ preventScroll: true });
  }, []);

  const append = useCallback((...items) => {
    setEntries((list) => {
      const next = [...list, ...items.map((item) => ({ ...item, id: ++seqRef.current }))];
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
  }, []);

  const say = useCallback((tone, text, link) => append({ kind: 'sys', tone, text, link }), [append]);

  const promptFor = useCallback((path) => formatPrompt({ cwd: path, home }), [home]);

  const echo = useCallback((text, path = cwdRef.current) => append({ kind: 'cmd', prompt: promptFor(path), text }), [append, promptFor]);

  const announce = useCallback((text) => {
    setAnnouncement('');
    later(() => setAnnouncement(text), 60);
  }, [later]);

  const setInput = useCallback((next, caret = null) => {
    valueRef.current = next;
    caretRef.current = caret;
    setValue(next);
  }, []);

  const clearScreen = useCallback(() => {
    setEntries([]);
    setBoot((current) => ({ ...current, visible: false }));
  }, []);

  const applyEffect = useCallback((effect) => {
    if (effect === 'matrix' && !reducedMotion) setMatrixRun((run) => run + 1);
    else if (effect === 'confetti' && !reducedMotion) setConfettiRun((run) => run + 1);
    else if (effect === 'reboot') {
      later(() => {
        setEntries([]);
        cwdRef.current = home;
        setCwd(home);
        startBoot();
      }, reducedMotion ? 0 : 1100);
    }
  }, [reducedMotion, later, home, startBoot]);

  // ----- requests -----
  const begin = useCallback(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    busyRef.current = true;
    setBusy(true);
    return controller;
  }, []);

  const end = useCallback((controller) => {
    if (controllerRef.current !== controller) return; // Ctrl+C already released it (or a newer request owns it)
    controllerRef.current = null;
    busyRef.current = false;
    if (!mountedRef.current) return;
    setBusy(false);
    const active = document.activeElement;
    if (!active || active === document.body || active === inputRef.current) focusInput();
  }, [focusInput]);

  const fail = useCallback((error, context, retryText) => {
    const problem = describeError(error, context);
    say(problem.kind === 'rate' ? 'warn' : 'error', problem.message, problem.link);
    if (context === 'submit') announce(problem.message);
    if (problem.kind === 'auth' && handlersRef.current.onUnauthorized) handlersRef.current.onUnauthorized();
    // After a dropped connection put the line back so Enter retries it.
    if (problem.kind === 'network' && retryText && valueRef.current === '') setInput(retryText, retryText.length);
  }, [say, announce, setInput]);

  const runExec = useCallback(async (line) => {
    const controller = begin();
    try {
      const result = await execCommand(mode, { command: line, cwd: cwdRef.current }, { signal: controller.signal });
      if (controller.signal.aborted || !mountedRef.current) return;
      if (result.cwd) { cwdRef.current = result.cwd; setCwd(result.cwd); }
      if (result.effect === 'clear') clearScreen();
      if (result.output !== '') append({ kind: 'out', text: result.output.replace(/\n$/, '') });
      if (result.effect && result.effect !== 'clear') applyEffect(result.effect);
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      fail(error, 'exec', line);
    } finally {
      end(controller);
    }
  }, [mode, begin, end, append, fail, clearScreen, applyEffect]);

  const showSubmitResult = useCallback((result) => {
    if (result.correct && !result.alreadySolved) {
      const which = result.code === null ? 'Code' : `Code ${result.code}`;
      const name = result.title ? ` "${result.title}"` : '';
      const progress = result.solved !== null && result.total !== null ? `codes found ${result.solved}/${result.total}` : '';
      const cleared = result.solved !== null && result.total !== null && result.total > 0 && result.solved >= result.total;
      const extra = [];
      if (cleared) extra.push('All codes found - mode cleared!');
      append(
        {
          kind: 'result', tone: 'ok', tag: 'CORRECT', headline: `${which}${name} captured  +${result.pointsAwarded} pts`,
          lines: [...(result.message ? [result.message] : []), ...extra, ...(progress ? [progress] : [])],
        },
        ...(result.firstBlood ? [{ kind: 'banner', lines: FIRST_BLOOD_BANNER, label: 'First blood!' }] : []),
      );
      if ((result.firstBlood || cleared) && !reducedMotion) setConfettiRun((run) => run + 1);
      announce(`Correct. ${which}${name ? `, ${result.title}` : ''}, ${result.pointsAwarded} points.${result.firstBlood ? ' First blood!' : ''}${progress ? ` ${progress.replace('codes found ', '')} codes found.` : ''}`);
      if (handlersRef.current.onSolved) handlersRef.current.onSolved(result);
    } else if (result.correct) {
      append({
        kind: 'result', tone: 'info', tag: 'ALREADY SOLVED', headline: result.message || 'Your team already has that code.', lines: [],
      });
      announce('That code was already solved by your team.');
    } else {
      append({
        kind: 'result', tone: 'bad', tag: 'INCORRECT', headline: result.message || 'That is not a valid code for this mode.', lines: [],
      });
      announce('Incorrect code.');
    }
  }, [append, announce, reducedMotion]);

  const runSubmit = useCallback(async (flag) => {
    if (isAdmin) {
      say('info', 'admin preview: you can explore every mode, but codes can only be submitted by players.');
      return;
    }
    const controller = begin();
    try {
      const result = await submitCode(mode, flag, { signal: controller.signal });
      if (controller.signal.aborted || !mountedRef.current) return;
      showSubmitResult(result);
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      fail(error, 'submit', null);
    } finally {
      end(controller);
    }
  }, [isAdmin, mode, say, begin, end, showSubmitResult, fail]);

  const runLine = useCallback(async (raw) => {
    if (busyRef.current) return; // a command is already running: Enter is ignored, the typed text stays
    const command = classifyCommand(raw);
    setInput('');
    skipBoot();
    if (command.kind === 'empty') { echo(''); return; }

    const nextHistory = pushHistory(historyRef.current, command.line);
    historyRef.current = nextHistory;
    navRef.current = freshNav(nextHistory);
    setHistory(nextHistory);
    if (!startedRef.current) {
      startedRef.current = true;
      if (handlersRef.current.onFirstCommand) handlersRef.current.onFirstCommand();
    }

    if (command.kind === 'clear') { clearScreen(); return; }
    echo(command.line);
    if (command.kind === 'history') {
      if (command.wipe) {
        historyRef.current = [];
        navRef.current = freshNav([]);
        setHistory([]);
        say('info', 'history cleared');
      } else {
        append({ kind: 'out', text: formatHistory(historyRef.current) });
      }
    } else if (command.kind === 'exit') {
      say('info', 'logout');
      navigate('/terminal');
    } else if (command.kind === 'submit') {
      if (command.ok) await runSubmit(command.flag);
      else say('error', submitErrorMessage(command.error));
    } else {
      await runExec(command.line);
    }
  }, [setInput, skipBoot, echo, clearScreen, say, append, navigate, runSubmit, runExec]);

  // ----- keyboard -----
  const completeLine = useCallback(async () => {
    if (completingRef.current) return;
    const text = valueRef.current;
    const input = inputRef.current;
    const caret = input && typeof input.selectionStart === 'number' ? input.selectionStart : text.length;
    const ctx = splitCompletion(text, caret);
    const nameOnly = ctx.commandPosition && !ctx.word.includes('/');
    const local = nameOnly ? completeCommands(ctx.word) : [];
    // Command names are instant and local; the server is asked for paths (and for names we do not know).
    const needServer = !(nameOnly && (local.length > 0 || ctx.word === ''));
    let remote = [];
    if (needServer) {
      completingRef.current = true;
      try {
        // The engine needs the whole line before the cursor (to know command vs path position) and answers with full,
        // shell-escaped replacements for the last word; strip that escaping so the merge works on plain words.
        const answer = await completePath(mode, { partial: text.slice(Math.max(0, caret - 190), caret), cwd: cwdRef.current });
        remote = (Array.isArray(answer) ? answer : []).map((match) => (typeof match === 'string' ? unquoteWord(match).text : ''));
      } catch (error) {
        if (error && error.status === 401 && handlersRef.current.onUnauthorized) handlersRef.current.onUnauthorized();
      } finally {
        completingRef.current = false;
      }
      if (!mountedRef.current || valueRef.current !== text) return; // the user kept typing: drop the stale answer
    }
    const candidates = mergeCompletions(ctx.word, local, remote);
    const twice = lastTabRef.current === `${text}\u0000${caret}`;
    const result = applyCompletion(ctx, candidates, { twice });
    if (result.changed) setInput(result.value, result.caret);
    if (result.list && result.list.length > 0) {
      append({ kind: 'cmd', prompt: promptFor(cwdRef.current), text }, { kind: 'matches', items: result.list });
    }
    lastTabRef.current = candidates.length > 1
      ? `${result.changed ? result.value : text}\u0000${result.changed ? result.caret : caret}` : null;
  }, [mode, setInput, append, promptFor]);

  const abortLine = useCallback(() => {
    if (busyRef.current && controllerRef.current) {
      // Ctrl+C while a request is running: cancel it and give the prompt back at once.
      const controller = controllerRef.current;
      controllerRef.current = null;
      busyRef.current = false;
      setBusy(false);
      controller.abort();
      say('info', '^C');
      return;
    }
    echo(`${valueRef.current}^C`);
    setInput('');
    navRef.current = freshNav(historyRef.current);
  }, [say, echo, setInput]);

  const scrollPage = (direction) => {
    const element = scrollRef.current;
    if (element) element.scrollBy({ top: direction * element.clientHeight * 0.85, behavior: 'auto' });
  };

  function onKeyDown(event) {
    if (event.nativeEvent.isComposing) return;
    const key = event.key;
    if (!bootDone) skipBoot();

    if (key === 'Tab') {
      // Shift+Tab, or Tab right after Esc, leaves the terminal so keyboard users are never trapped in it.
      if (event.shiftKey || tabEscapeRef.current) { tabEscapeRef.current = false; return; }
      event.preventDefault();
      void completeLine();
      return;
    }
    tabEscapeRef.current = key === 'Escape';

    if (key === 'Enter') {
      event.preventDefault();
      if (!busyRef.current) void runLine(valueRef.current);
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      const step = stepHistory(historyRef.current, navRef.current, key === 'ArrowUp' ? 'up' : 'down', valueRef.current);
      navRef.current = step.nav;
      if (step.value !== null) setInput(step.value, step.value.length);
    } else if (key === 'PageUp' || key === 'PageDown') {
      event.preventDefault();
      scrollPage(key === 'PageUp' ? -1 : 1);
    } else if (event.ctrlKey && !event.metaKey && !event.altKey) {
      const lower = key.toLowerCase();
      if (lower === 'l') {
        event.preventDefault();
        clearScreen();
      } else if (lower === 'c') {
        const input = event.currentTarget;
        const selected = input.selectionStart !== input.selectionEnd || (window.getSelection && window.getSelection().toString() !== '');
        if (selected) return; // let the browser copy the selection
        event.preventDefault();
        abortLine();
      } else if (lower === 'u') {
        event.preventDefault();
        setInput('');
      }
    }
  }

  function onChange(event) {
    const next = event.target.value;
    valueRef.current = next;
    setValue(next);
    navRef.current = freshNav(historyRef.current);
    lastTabRef.current = null;
  }

  function onBodyClick(event) {
    if (event.target.closest('a, button, summary, input, [role="button"]')) return;
    const selection = window.getSelection && window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString() !== '') return; // the user is selecting output to copy
    focusInput();
  }

  function insertChip(text) {
    const current = valueRef.current;
    const next = current.trim() === '' ? text : `${current}${current.endsWith(' ') ? '' : ' '}${text}`;
    setInput(next, next.length);
    focusInput();
  }

  const spinner = useSpinnerFrame(busy, reducedMotion);
  const prompt = promptFor(cwd);
  const shortPrompt = prompt.slice(0, -1);
  const bootRows = boot.visible ? revealLines(lines, shownChars) : [];

  return <section className="tm-window" aria-label="Arena Terminal" ref={windowRef}>
    <div className="tm-bar">
      <span className="tm-dots" aria-hidden="true"><span /><span /><span /></span>
      <span className="tm-title">CTF Arena · Terminal{info?.title ? <span className="tm-title-sub"> · {info.title}</span> : null}</span>
      <span className="tm-status" title={statusLabel}><span className="tm-dot" aria-hidden="true">●</span> ONLINE · {statusLabel}</span>
    </div>

    <div className="tm-body">
      <div className="tm-scroll" ref={scrollRef} onClick={onBodyClick}>
        <div className="tm-log" role="log" aria-live="off" aria-label="Terminal output" aria-busy={busy}>
          {bootRows.map((row, index) => (
            <div className="tm-line tm-out" key={`boot-${boot.run}-${index}`}>
              {row}
              {!bootDone && index === bootRows.length - 1 ? <span className="tm-typing" aria-hidden="true" /> : null}
            </div>
          ))}
          {entries.map((entry) => <Entry key={entry.id} entry={entry} onCopied={focusInput} />)}
        </div>
        <div className="tm-input-row">
          <label className="tm-prompt" htmlFor="tm-input" aria-hidden="true">
            {shortPrompt}<span className={`tm-prompt-end${busy ? ' is-busy' : ''}`}>{busy ? spinner : '$'}</span>
          </label>
          <input
            id="tm-input"
            ref={inputRef}
            className="tm-input"
            type="text"
            name="command"
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            maxLength={MAX_COMMAND_LENGTH}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="send"
            data-1p-ignore="true"
            data-lpignore="true"
            aria-label={`Terminal command line, ${prompt}`}
            aria-describedby="tm-input-help"
          />
          <span id="tm-input-help" className="tm-sr">
            Type help to begin. Tab completes, the up and down arrows walk through history, Control L clears the screen,
            Control C cancels the line. Press Escape then Tab to leave the terminal.
          </span>
        </div>
      </div>
      {matrixRun > 0 && !reducedMotion ? <MatrixRain key={matrixRun} onDone={() => setMatrixRun(0)} /> : null}
    </div>

    <div className="tm-chips" role="group" aria-label="Quick commands">
      {QUICK_CHIPS.map((chip) => (
        <button type="button" className="tm-chip" key={chip.label} onClick={() => insertChip(chip.text)}>{chip.label}</button>
      ))}
      <button type="button" className="tm-chip tm-chip--run" onClick={() => { void runLine(valueRef.current); focusInput(); }} aria-label="Run the command">{'↵'} run</button>
    </div>

    <div className="tm-sr" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    {confettiRun > 0 && !reducedMotion ? <Confetti key={confettiRun} onDone={() => setConfettiRun(0)} /> : null}
  </section>;
}
