// A hint request that failed for good (the server says that hint is not available) versus a transient failure
// (network, 5xx, 408, 429) that says nothing about what the player already opened.
export const isDefinitiveFailure = (error) => {
  const status = error?.status;
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429;
};

// Fetches hints 1..wanted in order and stops at the first failure.
// Returns { texts, failure } where failure is null, 'definitive' or 'transient'.
export async function restoreHints(fetchHint, wanted) {
  const texts = [];
  for (let level = 1; level <= wanted; level += 1) {
    try { texts.push(await fetchHint(level)); }
    catch (error) { return { texts, failure: isDefinitiveFailure(error) ? 'definitive' : 'transient' }; }
  }
  return { texts, failure: null };
}

// The opened count to write back after a restore, or null for "leave storage alone". Only a definitive failure may
// lower the stored count; a transient error must never erase progress.
export const countToStore = ({ texts, failure }, wanted) => (failure === 'definitive' && texts.length < wanted ? texts.length : null);

// How many hints to restore in order from the server's list of opened levels (1-based, the lab view's `hintsOpened`): the
// highest valid level, since opening hint N also covers the cheaper ones below it. null when the server sent no list
// (admin previews), so the caller falls back to the count kept in this browser.
export function restoreTarget(levels, total) {
  if (!Array.isArray(levels)) { return null; }
  return levels.reduce((top, level) => (Number.isInteger(level) && level >= 1 && level <= total ? Math.max(top, level) : top), 0);
}
