import { useEffect, useRef, useState } from 'react';
import './StepTerminal.css';

/*
 * Per-step shell terminal of the "Demo playoff" page.
 *   <who>@arena:~$ <command>      typed with a typewriter effect when the step changes
 *   [REQ] ...                     output of hop 0..hop (step.hops[k].lines index step.log); current hop highlighted
 *   <who>@arena:~$ _              fresh prompt with a blinking caret once the last hop has played
 * It never shows lines from another step: everything is keyed by step.id and starts empty.
 *
 * Props
 *   step     demoScript step ({ id, title, cmd: { who, line }, log, hops }) or null (idle prompt)
 *   hop      0-based index of the current hop; undefined/null = all hops are shown (last one is current),
 *            a negative number = command only, no output yet
 *   running  false = paused: the command is shown in full instead of being typed
 */

const TYPE_MS = 18; // typewriter speed per character
const MAX_STAGGER = 10;
const KIND_LABEL = { req: 'REQ', db: 'DB', docker: 'DOCKER', ok: 'OK', warn: 'WARN', err: 'ERR' };

// who -> [shell prompt, status label]
const WHO = {
  alpha: ['alpha@arena:~$', 'ALPHA'],
  beta: ['beta@arena:~$', 'BETA'],
  admin: ['admin@arena:~#', 'ADMIN'],
  system: ['root@vm:~#', 'ROOT@VM'],
};
const GUEST = ['guest@arena:~$', 'GUEST'];

function whoInfo(who) {
  if (!who) return GUEST;
  const key = String(who).toLowerCase();
  return WHO[key] || [`${key}@arena:~$`, key.toUpperCase()];
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// Output rows for hops 0..current: [{ line, hopIndex, current, first }] (each log index shown once).
function outputRows(step, hopIndex) {
  const log = Array.isArray(step.log) ? step.log : [];
  const hops = Array.isArray(step.hops) ? step.hops : [];
  if (hops.length === 0) {
    // no hop data: show the whole log as one hop
    return log.map((line, i) => ({ line, key: i, hopIndex: 0, current: true, first: i === 0, order: i }));
  }
  const seen = new Set();
  const rows = [];
  for (let k = 0; k <= hopIndex && k < hops.length; k += 1) {
    const indices = Array.isArray(hops[k] && hops[k].lines) ? hops[k].lines : [];
    let order = 0;
    indices.forEach((idx) => {
      if (!Number.isInteger(idx) || !log[idx] || seen.has(idx)) return;
      seen.add(idx);
      rows.push({
        line: log[idx],
        key: idx,
        hopIndex: k,
        current: k === hopIndex,
        first: order === 0,
        order,
      });
      order += 1;
    });
  }
  return rows;
}

export default function StepTerminal({ step = null, hop = null, running = false }) {
  const reducedMotion = useReducedMotion();
  const bodyRef = useRef(null);
  const typedRef = useRef(null); // step key whose command is already fully shown (no retyping after pause/resume)
  const [typing, setTyping] = useState({ key: null, count: 0 });

  const key = step ? String(step.id) : null;
  const cmd = step && step.cmd ? step.cmd : null;
  const cmdLine = cmd && typeof cmd.line === 'string' ? cmd.line : '';
  const [prompt, whoLabel] = step ? whoInfo(cmd && cmd.who) : GUEST;
  const isComment = cmdLine.startsWith('# ');
  const instant = reducedMotion || !running;

  // Typewriter: restarts when the step changes, never when merely paused/resumed.
  useEffect(() => {
    if (key === null) {
      typedRef.current = null;
      setTyping({ key: null, count: 0 });
      return undefined;
    }
    if (instant || cmdLine.length === 0) {
      typedRef.current = key;
      return undefined;
    }
    if (typedRef.current === key) return undefined;
    let count = 0;
    setTyping({ key, count: 0 });
    const timer = setInterval(() => {
      count += 1;
      setTyping({ key, count });
      if (count >= cmdLine.length) {
        typedRef.current = key;
        clearInterval(timer);
      }
    }, TYPE_MS);
    return () => clearInterval(timer);
  }, [key, cmdLine, instant]);

  const typedCount = typing.key === key ? Math.min(typing.count, cmdLine.length) : 0;
  const finished = instant || typedRef.current === key || typedCount >= cmdLine.length;
  const shown = finished ? cmdLine : cmdLine.slice(0, typedCount);

  const hops = step && Array.isArray(step.hops) ? step.hops : [];
  const lastHop = Math.max(hops.length - 1, 0);
  const hopIndex = Number.isInteger(hop) ? Math.min(hop, lastHop) : lastHop;
  const rows = step && finished ? outputRows(step, hopIndex) : [];
  const atEnd = Boolean(step) && finished && hopIndex >= lastHop;

  // Keep the newest output in view: scroll the terminal container only, never the page.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [key, rows.length, shown.length, atEnd]);

  return (
    <section className="demo-term" aria-label="Step terminal">
      <div className="demo-term__bar">
        <span className="demo-term__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="demo-term__title">CTF Arena · Live Terminal</span>
        <span className="demo-term__status">
          <span className="demo-term__dot" aria-hidden="true">●</span> ONLINE · {whoLabel}
        </span>
      </div>
      <div
        className="demo-term__body"
        ref={bodyRef}
        role="log"
        aria-live="off"
        aria-label={step && step.title ? `Terminal output: ${step.title}` : 'Terminal output'}
        tabIndex={0}
      >
        {step ? (
          <div className="demo-term__session" key={key}>
            <div className="demo-term__line demo-term__cmd">
              {isComment ? (
                <span className="demo-term__comment">{shown}</span>
              ) : (
                <>
                  <span className="demo-term__prompt">{prompt}</span>{' '}
                  <span className="demo-term__typed">{shown}</span>
                </>
              )}
              {!finished ? <span className="demo-term__caret is-typing" aria-hidden="true" /> : null}
            </div>
            {rows.map((row) => (
              <div
                className={`demo-term__row ${row.current ? 'is-current' : 'is-past'}`}
                style={row.current ? { '--demo-term-i': Math.min(row.order, MAX_STAGGER) } : undefined}
                key={row.key}
              >
                <span className="demo-term__gut" aria-hidden="true">
                  {row.first ? row.hopIndex + 1 : ''}
                </span>
                <span className={`demo-term__kind demo-term__kind--${row.line.kind}`}>
                  {KIND_LABEL[row.line.kind] ?? String(row.line.kind ?? '').toUpperCase()}
                </span>
                <span className="demo-term__text">{row.line.text}</span>
              </div>
            ))}
            {atEnd ? (
              <div className="demo-term__line demo-term__fresh">
                <span className="demo-term__prompt">{prompt}</span>{' '}
                <span className="demo-term__caret" aria-hidden="true" />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="demo-term__session">
            <div className="demo-term__line">
              <span className="demo-term__comment"># press Play demo to start the match</span>
            </div>
            <div className="demo-term__line demo-term__fresh">
              <span className="demo-term__prompt">{GUEST[0]}</span>{' '}
              <span className="demo-term__caret" aria-hidden="true" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
