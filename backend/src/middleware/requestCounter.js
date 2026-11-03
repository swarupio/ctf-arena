import os from 'node:os';
import ReplicaStat from '../models/ReplicaStat.js';

const FLUSH_INTERVAL_MS = 5000;
const SHUTDOWN_TIMEOUT_MS = 2000;

// Health checks (Docker, Nginx, load tests) would drown out real traffic, so they are not counted.
const isCounted = (path) => {
  const lower = path.toLowerCase();
  return lower.startsWith('/api/') && !/^\/api\/health\/?$/.test(lower);
};

// Counts /api requests per replica. The buffer only batches writes: every ~5 s (and on SIGTERM)
// the pending count is added to this replica's document in MongoDB with one atomic $inc upsert,
// so the totals live in the database and replicas stay stateless. Counting never breaks a request.
export function createRequestCounter({
  model = ReplicaStat,
  replica = os.hostname(), // same source as middleware/servedBy.js
  intervalMs = FLUSH_INTERVAL_MS,
  onStart = () => {},
  log = (message) => process.stderr.write(`[requestCounter] ${message}\n`),
} = {}) {
  let pending = 0;
  let timer = null;
  let flushing = null;
  let failing = false;

  async function flush() {
    if (flushing) { await flushing; }
    const count = pending;
    if (count === 0) { return; }
    pending = 0;
    flushing = Promise.resolve()
      .then(() => model.updateOne({ replica }, { $inc: { requests: count } }, { upsert: true }))
      .then(() => { failing = false; })
      .catch(() => {
        // Keep the counts for the next attempt; only log the first failure of a streak.
        pending += count;
        if (!failing) { failing = true; log('could not save request counts; will retry'); }
      })
      .finally(() => { flushing = null; });
    await flushing;
  }

  function ensureTimer() {
    if (timer) { return; }
    timer = setInterval(() => { flush().catch(() => {}); }, intervalMs);
    timer.unref?.();
    onStart();
  }

  function middleware(req, res, next) {
    try {
      if (isCounted(req.path)) {
        pending += 1;
        ensureTimer();
      }
    } catch {
      // Counting is best effort and must never fail the request.
    }
    next();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { middleware, flush, stop, pending: () => pending };
}

// On SIGTERM (docker stop, deploys) save what is buffered, then let Node exit as it would have.
export function installShutdownFlush(counter, { proc = process, timeoutMs = SHUTDOWN_TIMEOUT_MS } = {}) {
  proc.once('SIGTERM', async () => {
    let timeout;
    const expired = new Promise((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
      timeout.unref?.();
    });
    await Promise.race([counter.flush().catch(() => {}), expired]);
    clearTimeout(timeout);
    // `once` already removed this listener; re-raise to restore the default exit unless something else handles it.
    if (proc.listenerCount('SIGTERM') === 0) { proc.kill(proc.pid, 'SIGTERM'); }
  });
}

export const replicaCounter = createRequestCounter({ onStart: () => installShutdownFlush(replicaCounter) });
export const requestCounter = replicaCounter.middleware;
