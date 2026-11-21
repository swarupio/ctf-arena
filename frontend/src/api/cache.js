// Tiny request layer for safe GETs: in-flight de-duplication plus an optional stale-while-revalidate cache.
// `request(path)` is injected so the logic can be tested without a browser or the network.
const MAX_ENTRIES = 50;

function abortError() {
  return Object.assign(new Error('The request was aborted.'), { name: 'AbortError' });
}

// Resolves with `promise`, but rejects early if `signal` aborts. The shared request itself keeps running
// for any other caller waiting on it.
function withSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function createApiCache({ request, now = Date.now, maxEntries = MAX_ENTRIES }) {
  const entries = new Map();
  const inflight = new Map();
  let generation = 0;

  function fetchShared(path) {
    let shared = inflight.get(path);
    if (shared) return shared;
    const started = generation;
    shared = request(path).then((data) => {
      if (started === generation) {
        entries.delete(path);
        entries.set(path, { data, at: now() });
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      }
      return data;
    }).finally(() => {
      if (inflight.get(path) === shared) inflight.delete(path);
    });
    inflight.set(path, shared);
    return shared;
  }

  // ttl: ms a cached answer is returned as-is. swr: further ms a stale answer is returned immediately while a
  // refresh runs in the background (reported through onRevalidate). ttl 0 and swr 0 only de-duplicates.
  function get(path, { ttl = 0, swr = 0, signal, onRevalidate } = {}) {
    const entry = entries.get(path);
    const age = entry ? now() - entry.at : Infinity;
    if (entry && age < ttl) return withSignal(Promise.resolve(entry.data), signal);
    if (entry && age < ttl + swr) {
      fetchShared(path).then((data) => {
        if (onRevalidate && !signal?.aborted) onRevalidate(data);
      }, () => {});
      return withSignal(Promise.resolve(entry.data), signal);
    }
    return withSignal(fetchShared(path), signal);
  }

  function clear() {
    generation += 1;
    entries.clear();
    inflight.clear();
  }

  return { get, clear, size: () => entries.size };
}
