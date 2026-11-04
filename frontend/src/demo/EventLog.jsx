import { useEffect, useRef } from 'react';
import './panels.css';

const KIND_LABEL = { req: 'REQ', db: 'DB', docker: 'DOCKER', ok: 'OK', warn: 'WARN', err: 'ERR' };
const MAX_STAGGER = 10;

function stamp(minute) {
  return `[${String(Math.max(0, Math.floor(Number(minute) || 0))).padStart(2, '0')}:00]`;
}

// Dark terminal panel streaming the server side of the demo. Lines of the active step highlight and stagger in.
export default function EventLog({ lines, activeStep }) {
  const list = Array.isArray(lines) ? lines : [];
  const bodyRef = useRef(null);

  // Scroll the log container only (never the page) whenever a line is added.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list.length]);

  // Position of each line inside its own step, used for the animation stagger.
  const perStep = new Map();
  const rows = list.map((line, i) => {
    const seen = perStep.get(line.stepIndex) ?? 0;
    perStep.set(line.stepIndex, seen + 1);
    return { line, i, indexInStep: seen, active: line.stepIndex === activeStep };
  });

  return (
    <section className="demo-pnl demo-log" aria-label="Server log panel">
      <div className="demo-pnl-head">
        <h3 className="demo-pnl-title">Live server log</h3>
      </div>
      <div className="demo-log-body" ref={bodyRef} role="log" aria-live="off" aria-label="Live server log" tabIndex={0}>
        {rows.length === 0 ? (
          <div className="demo-log-line">
            <span className="demo-log-text demo-log-dim"># waiting for the first request</span>
          </div>
        ) : null}
        {rows.map(({ line, i, indexInStep, active }) => (
          <div
            className={active ? 'demo-log-line is-active' : 'demo-log-line'}
            style={active ? { '--demo-log-i': Math.min(indexInStep, MAX_STAGGER) } : undefined}
            key={i}
          >
            <span className="demo-log-time">{stamp(line.minute)}</span>
            <span className={`demo-log-kind demo-log-kind-${line.kind}`}>
              {KIND_LABEL[line.kind] ?? String(line.kind ?? '').toUpperCase()}
            </span>
            <span className="demo-log-text">{line.text}</span>
          </div>
        ))}
        <div className="demo-log-line" aria-hidden="true">
          <span className="demo-log-ps">$</span>
          <span className="demo-log-caret" />
        </div>
      </div>
    </section>
  );
}
