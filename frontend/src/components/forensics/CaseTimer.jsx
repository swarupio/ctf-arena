import { useEffect, useState } from 'react';
import Info from '../Info.jsx';
import { clearStart, earnedBadge, formatElapsed, readStart, writeStart } from '../../forensics/caseHelpers.js';

const storage = () => { try { return window.localStorage; } catch { return null; } };

// Cosmetic stopwatch: starts when the case is first opened in this browser, stops when the case is closed.
// Nothing about it is sent to the server and it never changes the score. A case that was already closed when this page
// loaded (reviewing it) has no honest time, so it shows no clock and no rank.
export default function CaseTimer({ trackId, closed, email }) {
  const [reviewed] = useState(closed);
  const [start, setStart] = useState(() => readStart(storage(), email, trackId) ?? (closed ? null : writeStart(storage(), email, trackId)));
  const [now, setNow] = useState(Date.now());
  const [frozen, setFrozen] = useState(null);
  useEffect(() => {
    if (closed) { setFrozen((value) => value ?? Date.now()); return undefined; }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [closed]);
  if (reviewed || start === null) {
    return <div className="fx-timer"><span aria-hidden="true">{'⏱'}</span><span>{closed ? 'Case closed' : 'Clock not started'}</span></div>;
  }
  const elapsed = (frozen ?? now) - start;
  const badge = earnedBadge({ trackId, closed, reviewed, hasStart: true, elapsed });
  return <div className="fx-timer">
    <span aria-hidden="true">{'⏱'}</span>
    <span role="timer" aria-label={`Case time ${formatElapsed(elapsed)}`}>{formatElapsed(elapsed)}</span>
    {badge && <><span className={`fx-badge fx-badge-${badge.id}`} title={badge.note}>{badge.label}</span><Info label={`the ${badge.label} badge`}>{badge.note}</Info></>}
    <button type="button" className="secondary small" onClick={() => { clearStart(storage(), email, trackId); setStart(writeStart(storage(), email, trackId)); setFrozen(null); setNow(Date.now()); }} disabled={closed}>Reset clock</button>
  </div>;
}
