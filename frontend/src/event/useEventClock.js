import { useEffect, useState, useSyncExternalStore } from 'react';
import { getEvent } from '../api/event.js';
import { createEventStore } from './store.js';

// The one shared store: both the banner and the freeze note read it, so the page makes a single /api/event request per poll.
export const eventStore = createEventStore({ fetchEvent: () => getEvent() });

// The event schedule from the public GET /api/event (polled every 30 s through the shared store, paused while the tab is
// hidden, failures silent) plus a ticking "server now". `tickMs` is how often the component re-renders; 0 disables ticking.
// Returns { event, nowMs }; event is null when no event is configured or the API is unreachable.
export function useEventClock({ tickMs = 1000 } = {}) {
  const state = useSyncExternalStore(eventStore.subscribe, eventStore.getSnapshot, eventStore.getSnapshot);
  const [now, setNow] = useState(() => Date.now());

  // A fresh response re-reads the client clock so the offset and "now" stay a matched pair.
  useEffect(() => { setNow(Date.now()); }, [state]);

  useEffect(() => {
    if (!state.event || tickMs <= 0) return undefined;
    // No re-render while the tab is hidden; the clock catches up the moment it is visible again.
    let timer = null;
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const start = () => { stop(); timer = setInterval(() => setNow(Date.now()), tickMs); };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { stop(); return; }
      setNow(Date.now());
      start();
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [state.event, tickMs]);

  return { event: state.event, nowMs: now + state.offset };
}
