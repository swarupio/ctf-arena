import { startPolling as defaultStartPolling } from '../pages/poller.js';
import { EVENT_POLL_MS, clockOffset } from './logic.js';

const IDLE = Object.freeze({ event: null, offset: 0, raw: null, at: 0 });

// One poller of GET /api/event for the whole page, shared by every subscriber (banner, freeze note, ...).
// Reference counted: starts with the first subscriber, stops with the last. The poller itself pauses while the tab is
// hidden and refreshes at once when it is visible again. Failures are silent and keep the last known state.
export function createEventStore({ fetchEvent, startPolling = defaultStartPolling, intervalMs = EVENT_POLL_MS, now = Date.now } = {}) {
  const listeners = new Set();
  let state = IDLE;
  let poller = null;

  const publish = (next) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const task = async () => {
    try {
      const raw = await fetchEvent();
      const received = now();
      publish({
        event: raw?.phase && raw.phase !== 'none' ? raw : null,
        offset: clockOffset(raw?.serverTime, received),
        raw,
        at: received,
      });
      return true;
    } catch { return false; }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!poller) poller = startPolling(task, { intervalMs });
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        if (listeners.size === 0 && poller) { poller.stop(); poller = null; }
      };
    },
    getSnapshot: () => state,
    subscriberCount: () => listeners.size,
  };
}
