// The save loop of the case board as plain functions: no React, no timers of its own, so every branch can be tested.
// `io` supplies the effects: getOps/getServer (current refs), save(payload), fetchBoard(), commit(server, ops), setStatus(s),
// isAlive(), onUnlocked(), schedule(delayMs) and describe(error). The loop returns what happened.
import { applyOps, toPayload } from './board.js';

export const MAX_ROUNDS = 3;
export const RETRY_DELAY_MS = 5000;
export const SAVE_DELAY_MS = 900;

// conflict: a teammate saved first (reload and replay); drop: the server refused these edits for good; retry: network, 5xx, 429.
export function classifySaveError(error) {
  if (error?.code === 'BOARD_CONFLICT') { return 'conflict'; }
  if (error?.status && error.status < 500 && error.status !== 429) { return 'drop'; }
  return 'retry';
}

export const UNREACHABLE_MESSAGE = 'Could not reach the server, retrying.';
export const NOT_SAVED_MESSAGE = 'Not saved yet, retrying.';

// Returns 'done' | 'saved-all' | 'dropped' | 'retry-scheduled' | 'stopped' | 'idle'.
export async function runFlush(io) {
  if (io.getOps().length === 0) { return 'idle'; }
  for (let round = 0; round < MAX_ROUNDS && io.getOps().length > 0 && io.isAlive(); round += 1) {
    const sent = io.getOps().slice();
    const base = io.getServer();
    io.setStatus({ kind: 'saving', message: '' });
    try {
      const saved = await io.save(toPayload(applyOps(base, sent)));
      if (!io.isAlive()) { return 'stopped'; }
      io.commit(saved, io.getOps().slice(sent.length));
      io.setStatus({ kind: 'saved', message: '' });
      if (saved.unlocked && !base.unlocked) { io.onUnlocked(); }
    } catch (error) {
      if (!io.isAlive()) { return 'stopped'; }
      const kind = classifySaveError(error);
      if (kind === 'conflict') {
        // A teammate saved first: take their board and apply our edits on top of it, then go around again.
        try {
          const fresh = await io.fetchBoard();
          io.commit(fresh, io.getOps());
          io.setStatus({ kind: 'merged', message: io.describe(error) });
        } catch {
          // The reload itself failed: never stay on "Saving...", say so and try again later.
          io.setStatus({ kind: 'error', message: UNREACHABLE_MESSAGE });
          io.schedule(RETRY_DELAY_MS);
          return 'retry-scheduled';
        }
      } else if (kind === 'drop') {
        // The server refused these edits for good (limits, frozen arena): drop them and show the truth again.
        const fresh = await io.fetchBoard().catch(() => io.getServer());
        io.commit(fresh, []);
        io.setStatus({ kind: 'error', message: io.describe(error) });
        return 'dropped';
      } else {
        io.setStatus({ kind: 'error', message: io.describe(error) });
        io.schedule(RETRY_DELAY_MS);
        return 'retry-scheduled';
      }
    }
  }
  // Out of rounds (a teammate kept winning the race) with edits still unsaved: say so and flush again soon.
  if (io.isAlive() && io.getOps().length > 0) {
    io.setStatus({ kind: 'error', message: NOT_SAVED_MESSAGE });
    io.schedule(RETRY_DELAY_MS);
    return 'retry-scheduled';
  }
  return 'saved-all';
}

// The payload to send when the page is being left with unsaved edits, or null when there is nothing to send.
export function leavingPayload(server, ops) {
  if (!server || server.readOnly || ops.length === 0) { return null; }
  return toPayload(applyOps(server, ops));
}
