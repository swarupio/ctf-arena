// Fair-play bait. Deliberately visible clues that point at "forgotten" debug endpoints.
//
// The backend serves these paths as honeypots: no page of this app ever requests them, so anybody who
// does (a person reading the bundle or index.html, or a tool they handed it to) is quietly flagged for
// admin review. For that reason NOTHING in this module may call a honeypot path on its own. Importing the
// module and calling installBait() only publishes the strings; __arenaDebugFetch() is never called by the app.
//
// The path list must match the backend constants exactly (see tests/fairplay.test.js).
export const HONEYPOT_PATHS = Object.freeze([
  '/api/internal/debug/flags',
  '/api/internal/config',
  '/api/v1/flags',
  '/api/debug/teams',
  '/api/legacy/solutions',
]);

export const DEBUG_NOTE = 'debug routes enabled for QA, no auth required';

// Looks like a dev helper somebody forgot to strip. It is attached to window by installBait() so the
// minifier keeps it (and the strings above) in the shipped bundle, and so it is easy to find in the console.
export function __arenaDebugFetch(path = HONEYPOT_PATHS[0], fetchImpl = (...args) => globalThis.fetch(...args)) {
  if (!HONEYPOT_PATHS.includes(path)) throw new TypeError(`unknown debug route: ${path}`);
  return fetchImpl(path);
}

// Publishes the clues. `target` is injectable for tests; in the browser it is window.
// The property is a normal, enumerable one on purpose so devtools and grep find it.
export function installBait(target = globalThis) {
  if (!target) return false;
  target.__ARENA_DEBUG__ = Object.freeze({
    build: 'staging-7f3c',
    api: '/api',
    internal: Object.freeze([...HONEYPOT_PATHS]),
    note: DEBUG_NOTE,
  });
  target.__arenaDebugFetch = __arenaDebugFetch;
  return true;
}
