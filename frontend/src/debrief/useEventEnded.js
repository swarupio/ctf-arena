import { useEffect, useState } from 'react';
import { isEnded } from './visibility.js';

// Loaded on first use so pure helpers and tests never pull in the auth client.
// Reuses the shared event poller's last response when it is recent (the banner keeps it fresh), otherwise one read.
const defaultFetcher = async () => {
  const { eventStore } = await import('../event/useEventClock.js');
  const { raw, at } = eventStore.getSnapshot();
  if (raw && Date.now() - at < 30_000) { return raw; }
  return (await import('../api/event.js')).getEvent();
};

const TTL_MS = 60_000;
let cached = { at: 0, promise: null };

// One shared /api/event read (a minute of cache) so several mounted debriefs never fan out requests.
export function loadEventEnded(fetcher = defaultFetcher, now = Date.now()) {
  if (cached.promise && now - cached.at < TTL_MS) { return cached.promise; }
  const promise = Promise.resolve()
    .then(() => fetcher())
    .then(isEnded, () => false);
  cached = { at: now, promise };
  return promise;
}

export function resetEventEndedCache() { cached = { at: 0, promise: null }; }

/** true once the event has ended; false while unknown, unreachable or not configured. `enabled: false` skips the read. */
export default function useEventEnded({ enabled = true } = {}) {
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (!enabled) { return undefined; }
    let live = true;
    loadEventEnded().then((value) => { if (live) { setEnded(value); } });
    return () => { live = false; };
  }, [enabled]);
  return enabled && ended;
}
