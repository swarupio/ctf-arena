import { useEffect, useState } from 'react';
import { clearStart, formatElapsed, readStart, timerBadge, writeStart } from '../../forensics/caseHelpers.js';

const storage = () => { try { return window.localStorage; } catch { return null; } };

// Cosmetic stopwatch: starts when the case is first opened in this browser, stops when the case is closed.
// Nothing about it is sent to the server and it never changes the score.
export default function CaseTimer({ trackId, closed }) {
  const [start, setStart] = useState(() => readStart(storage(), trackId) ?? writeStart(storage(), trackId));
  const [now, setNow] = useState(Date.now());
  const [frozen, setFrozen] = useState(null);
  useEffect(() => {
    if (closed) { setFrozen((value) => value ?? Date.now()); return undefined; }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [closed]);
  const elapsed = (frozen ?? now) - start;
  const badge = closed ? timerBadge(trackId, elapsed) : null;
  return <div className="fx-timer">
    <span aria-hidden="true">{'⏱'}</span>
    <span role="timer" aria-label={`Case time ${formatElapsed(elapsed)}`}>{formatElapsed(elapsed)}</span>
    {badge && <span className={`fx-badge fx-badge-${badge.id}`} title={badge.note}>{badge.label}</span>}
    <button type="button" className="secondary small" onClick={() => { clearStart(storage(), trackId); setStart(writeStart(storage(), trackId)); setFrozen(null); setNow(Date.now()); }} disabled={closed}>Reset clock</button>
  </div>;
}
