import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KitListing, KitPanels, useAnalysisKit } from './AnalysisView.jsx';
import { MemoryPanel, Registers, StackPanel } from './Panels.jsx';
import { ChangesPanel, Scrubber, WatchPanel } from './TimeTravel.jsx';
import { keyshortcutsAttr, readShortcuts, shortcutsLabel, writeShortcuts } from './shortcuts.js';
import { SPEEDS, inputProblem, rowsOfMachine, runBatch, runToStop } from './helpers.js';
import {
  createTimeline, decisionMarks, decisionOf, diffMachines, toggleWatch,
} from './timeline.js';
import { createMachine, stepMachine } from './vm.js';

// Keys that must keep working in text fields and drop-downs are never taken over.
const isTyping = (target) => target instanceof HTMLElement
  && (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || (target.tagName === 'INPUT' && target.type !== 'range' && target.type !== 'checkbox'));

// Step-through debugger. It runs the SAME vm.js as the server, locally, so exploring costs no attempts. The live machine is a
// mutable object kept in a ref (the furthest point reached); `tick` forces a re-render after every change. The past is rebuilt on
// demand by a timeline (checkpoints plus replay), so stepping back never stores one copy per step. `cursor` is null while we look
// at the live machine, otherwise the step being replayed.
const browserStorage = () => { try { return window.localStorage; } catch { return null; } };

export default function Debugger({ puzzle, input, onInput, onSubmit, canSubmit = false, email }) {
  // WCAG 2.1.4: the single-key shortcuts can be turned off; the choice is remembered per user in this browser.
  const [shortcuts, setShortcuts] = useState(() => readShortcuts(browserStorage(), email));
  const toggleShortcuts = () => { const next = !shortcuts; setShortcuts(next); writeShortcuts(browserStorage(), email, next); };
  const [hideDebugger, setHideDebugger] = useState(false);
  const [speed, setSpeed] = useState('fast');
  const [breakpoints, setBreakpoints] = useState(() => new Set());
  const [watch, setWatch] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const machineRef = useRef(null);
  const timelineRef = useRef(null);
  const actionsRef = useRef({});
  const bump = useCallback(() => setTick((value) => value + 1), []);

  // Opening a hint reloads the puzzle (a new object); the machine must only restart when the program really changes.
  const signature = useMemo(() => JSON.stringify(puzzle.program), [puzzle.program]);
  const maxSteps = puzzle.vm.maxSteps;
  const fresh = useCallback(
    () => createMachine(JSON.parse(signature), input, { debugger: !hideDebugger, maxSteps }),
    [signature, maxSteps, input, hideDebugger],
  );
  if (machineRef.current === null) { machineRef.current = fresh(); timelineRef.current = createTimeline(fresh); }

  // A new program, input or debugger setting always starts from a clean machine and an empty history.
  useEffect(() => {
    machineRef.current = fresh();
    timelineRef.current = createTimeline(fresh);
    setRunning(false);
    setCursor(null);
    bump();
  }, [fresh, bump]);

  // Breakpoints and pinned cells belong to one cabinet.
  useEffect(() => { setBreakpoints(new Set()); setWatch([]); }, [puzzle.id]);

  useEffect(() => {
    if (!running) { return undefined; }
    const { interval, batch } = SPEEDS.find((item) => item.id === speed) ?? SPEEDS[0];
    const timer = setInterval(() => {
      const machine = machineRef.current;
      const { hit } = runBatch(machine, batch, breakpoints);
      bump();
      if (hit || machine.status !== 'running') { setRunning(false); }
    }, interval);
    return () => clearInterval(timer);
  }, [running, speed, breakpoints, bump]);

  const head = machineRef.current;
  const timeline = timelineRef.current;
  const headStopped = head.status !== 'running';
  const replaying = cursor !== null && cursor < head.steps;
  const machine = replaying ? timeline.viewAt(cursor) : head;
  const stopped = machine.status !== 'running';
  const before = !running && machine.steps > 0 ? timeline.viewAt(machine.steps - 1) : null;
  const diff = before ? diffMachines(before, machine) : null;
  const decision = useMemo(
    () => (headStopped ? decisionOf(fresh, head.steps) : null),
    // The head is a mutable ref: its step count and status identify the finished run.
    [headStopped, head.steps, fresh],
  );
  const rows = rowsOfMachine(puzzle.program, machine);
  const kit = useAnalysisKit(machine, puzzle.id);
  const problem = input ? inputProblem(input) : '';

  const toggle = (address) => setBreakpoints((current) => {
    const next = new Set(current);
    if (next.has(address)) { next.delete(address); } else { next.add(address); }
    return next;
  });
  const seek = (step) => { setRunning(false); setCursor(step >= head.steps ? null : Math.max(0, step)); };
  const stepBack = () => { setRunning(false); if (machine.steps > 0) { setCursor(machine.steps - 1); } };
  const step = () => {
    setRunning(false);
    if (replaying) { seek(cursor + 1); return; }
    stepMachine(head);
    bump();
  };
  const play = () => {
    // Leave a breakpoint we are standing on, then let the timer carry on. From the past, continue at the furthest step.
    setCursor(null);
    if (!headStopped) { stepMachine(head); bump(); setRunning(true); }
  };
  const toEnd = () => { setRunning(false); setCursor(null); runToStop(head, breakpoints); bump(); };
  const reset = () => {
    setRunning(false);
    setCursor(null);
    machineRef.current = fresh();
    timelineRef.current = createTimeline(fresh);
    bump();
  };
  const focusWatch = () => document.getElementById('cm-watch-input')?.focus();

  // The keyboard handler is registered once and always calls the newest actions.
  actionsRef.current = {
    b: stepBack, s: step, r: () => (running ? setRunning(false) : play()), e: toEnd, x: reset, w: focusWatch,
  };
  useEffect(() => {
    if (!shortcuts) { return undefined; }
    const onKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || isTyping(event.target)) { return; }
      const action = actionsRef.current[event.key.toLowerCase()];
      if (action) { event.preventDefault(); action(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcuts]);

  const forwardDisabled = !replaying && headStopped;
  return <section className="cm-debugger" aria-labelledby="cm-debug-title">
    <h2 id="cm-debug-title">Debugger</h2>
    <div className="cm-toolbar">
      <label className="cm-input">
        Input to test
        <input
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); if (canSubmit && !problem) { onSubmit?.(); } }
          }}
          maxLength={puzzle.inputMax}
          aria-invalid={problem ? 'true' : undefined}
          autoComplete="off"
          spellCheck="false"
          autoCapitalize="off"
          aria-describedby="cm-input-help"
        />
      </label>
      <button type="button" onClick={() => onSubmit?.()} disabled={!canSubmit || !input || Boolean(problem)}>Submit this input</button>
      <div className="cm-buttons" role="group" aria-label="Debugger controls">
        <button type="button" className="secondary" onClick={step} disabled={forwardDisabled} aria-keyshortcuts={keyshortcutsAttr(shortcuts, 'S')}>Step {shortcuts && <kbd aria-hidden="true">S</kbd>}</button>
        {running
          ? <button type="button" onClick={() => setRunning(false)} aria-keyshortcuts={keyshortcutsAttr(shortcuts, 'R')}>Pause {shortcuts && <kbd aria-hidden="true">R</kbd>}</button>
          : <button type="button" onClick={play} disabled={headStopped} aria-keyshortcuts={keyshortcutsAttr(shortcuts, 'R')}>Run {shortcuts && <kbd aria-hidden="true">R</kbd>}</button>}
        <button type="button" className="secondary" onClick={toEnd} disabled={headStopped} aria-keyshortcuts={keyshortcutsAttr(shortcuts, 'E')}>Run to end {shortcuts && <kbd aria-hidden="true">E</kbd>}</button>
        <button type="button" className="secondary" onClick={reset} aria-keyshortcuts={keyshortcutsAttr(shortcuts, 'X')}>Reset {shortcuts && <kbd aria-hidden="true">X</kbd>}</button>
      </div>
      <label className="cm-speed">
        Speed
        <select value={speed} onChange={(event) => setSpeed(event.target.value)}>
          {SPEEDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="cm-check">
        <input type="checkbox" checked={hideDebugger} onChange={(event) => setHideDebugger(event.target.checked)} />
        Hide debugger (DBG pushes 0)
      </label>
    </div>
    {problem && <p role="alert" className="error">{problem}</p>}
    <Scrubber
      view={machine}
      furthest={head.steps}
      onSeek={seek}
      onBack={stepBack}
      onForward={step}
      forwardDisabled={forwardDisabled}
      replaying={replaying}
      shortcuts={shortcuts}
    />
    <p id="cm-input-help" className="cm-note">
      Press Enter in the input field to submit it to the real cabinet (it counts as an attempt). Tap or click an instruction to set a breakpoint. Changing the input or the debugger setting resets the machine. The real
      cabinet runs with no debugger attached, and only the server&apos;s own run counts.
    </p>
    <p className="cm-note cm-keys">
      <button type="button" className="secondary small" aria-pressed={shortcuts} onClick={toggleShortcuts}>{shortcutsLabel(shortcuts)}</button>
      {shortcuts && <> Keys (when no text box is focused): <kbd>S</kbd> step forward, <kbd>B</kbd> step back, <kbd>R</kbd> run or pause, <kbd>E</kbd> run to end, <kbd>X</kbd> reset, <kbd>W</kbd> pin a cell.</>}
      Move the slider (drag it, or use the arrow keys) to travel through the steps you have already run.
    </p>
    <div className="cm-grid">
      <KitListing kit={kit} machine={machine} listing={{ rows, pc: machine.pc, stopped, breakpoints, onToggle: toggle, marks: decisionMarks(decision) }} />
      <div className="cm-side">
        <Registers machine={machine} />
        <ChangesPanel diff={diff} running={running} decision={decision} onShowDecision={() => seek(decision.branch.step)} />
        <StackPanel machine={machine} limit={puzzle.vm.stackMax} />
        <WatchPanel
          list={watch}
          before={before}
          after={machine}
          vm={puzzle.vm}
          programLength={puzzle.program.length}
          shortcuts={shortcuts}
          onAdd={(address) => setWatch((current) => (current.includes(address) ? current : toggleWatch(current, address)))}
          onRemove={(address) => setWatch((current) => current.filter((item) => item !== address))}
        />
        <MemoryPanel machine={machine} vm={puzzle.vm} watched={watch} onToggleWatch={(address) => setWatch((current) => toggleWatch(current, address))} />
      </div>
    </div>
    <KitPanels kit={kit} machine={machine} />
  </section>;
}
