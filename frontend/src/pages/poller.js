export const POLL_INTERVAL_MS = 10_000;

// Runs `task` now and then every `intervalMs` after the previous run finishes (so requests never
// overlap). Polling pauses while the tab is hidden and refreshes right away when it is visible again.
// `doc`, `schedule` and `cancel` are injectable so the behaviour can be tested without a browser.
export function startPolling(task, {
  intervalMs = POLL_INTERVAL_MS, doc = document, schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  let timer = null;
  let stopped = false;
  let running = false;
  const hidden = () => doc.visibilityState === 'hidden';

  function clear() {
    if (timer !== null) { cancel(timer); timer = null; }
  }

  async function run() {
    clear();
    if (stopped || running) return;
    running = true;
    try { await task(); }
    catch { /* the task reports its own failures */ }
    finally { running = false; }
    if (!stopped && !hidden() && timer === null) timer = schedule(run, intervalMs);
  }

  function onVisibilityChange() {
    if (stopped) return;
    if (hidden()) clear();
    else if (timer === null && !running) void run();
  }

  doc.addEventListener('visibilitychange', onVisibilityChange);
  void run();

  return {
    refresh: () => run(),
    stop() {
      stopped = true;
      clear();
      doc.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
