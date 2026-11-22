// Pure: is this error a lazy chunk that failed to load (usually a new deploy replaced the old files)?
const CHUNK_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk [\w-]+ failed/i,
  /loading css chunk [\w-]+ failed/i,
];

export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  const message = typeof error === 'string' ? error : String(error.message ?? '');
  return CHUNK_PATTERNS.some((pattern) => pattern.test(message));
}

// Copy for the fallback. Never includes the error message or stack.
export function fallbackCopy(error) {
  return isChunkLoadError(error)
    ? { title: 'This page could not be loaded', body: 'A new version may have been released. Reload the page to get it.', action: 'Reload the page', reload: true }
    : { title: 'Something went wrong on this page', body: 'The rest of the site still works. Try again, or head back to The Range.', action: 'Try again', reload: false };
}
