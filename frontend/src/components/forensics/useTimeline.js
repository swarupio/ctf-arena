import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addPin, dropPin, findContradictions, movePin, readTimeline, removePin, resortByTime, timelineKey, writeTimeline,
} from '../../forensics/timeline.js';

const storage = () => { try { return window.localStorage; } catch { return null; } };

// Timeline board state for one player and one case. It lives in this browser only (localStorage, keyed by user and case):
// nothing is sent to the server and nothing about it reaches the score.
export function useTimeline(email, trackId) {
  const key = timelineKey(email, trackId);
  const [state, setState] = useState(() => readTimeline(storage(), key));
  useEffect(() => { setState(readTimeline(storage(), key)); }, [key]);
  const update = useCallback((change) => setState((prev) => {
    const next = change(prev);
    if (next !== prev) { writeTimeline(storage(), key, next); }
    return next;
  }), [key]);
  const findings = useMemo(() => findContradictions(state.pins), [state.pins]);
  // The badge is cosmetic and sticks once earned on this browser.
  useEffect(() => {
    if (findings.length > 0 && !state.hunter) { update((prev) => ({ ...prev, hunter: true })); }
  }, [findings, state.hunter, update]);
  const ids = useMemo(() => new Set(state.pins.map((p) => p.id)), [state.pins]);
  return {
    state, findings, has: (id) => ids.has(id),
    pin: (pin) => update((prev) => addPin(prev, pin)),
    unpin: (id) => update((prev) => removePin(prev, id)),
    move: (id, delta) => update((prev) => movePin(prev, id, delta)),
    drop: (id, targetId) => update((prev) => dropPin(prev, id, targetId)),
    sort: () => update(resortByTime),
    clear: () => update((prev) => ({ ...prev, pins: [], manual: false })),
  };
}
