import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startPolling } from '../pages/poller.js';
import { useToasts } from '../components/admin/Toasts.jsx';
import { friendlyError } from './errors.js';
import { DEFAULT_PAGE_SIZE } from './query.js';

// Loads data with `loader(signal)` whenever `deps` change; optionally re-loads every `pollMs` (the shared poller pauses
// while the tab is hidden and backs off after failures). Previous data stays on screen while a new page loads or when a
// refresh fails. A newer request aborts the older one, so a slow answer can never overwrite a fresh one.
// Returns { data, error, loading, updatedAt, reload } where `reload()` shows the loading state and `refresh()` does not.
export function useAdminData(loader, deps, { pollMs = 0, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [updatedAt, setUpdatedAt] = useState(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const controllerRef = useRef(null);
  const aliveRef = useRef(true);

  const load = useCallback(async (silent) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (!silent) setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await loaderRef.current(controller.signal);
      if (controller.signal.aborted || !aliveRef.current) return true;
      setState({ data, error: null, loading: false });
      setUpdatedAt(Date.now());
      return true;
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError' || !aliveRef.current) return true;
      setState((prev) => ({ ...prev, error, loading: false }));
      return false;
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) return undefined;
    if (pollMs <= 0) {
      load(false);
      return () => controllerRef.current?.abort();
    }
    let first = true;
    const poller = startPolling(() => {
      const silent = !first;
      first = false;
      return load(silent);
    }, { intervalMs: pollMs });
    return () => {
      poller.stop();
      controllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs, enabled]);

  useEffect(() => () => { aliveRef.current = false; }, []);

  return {
    data: state.data,
    error: state.error ? friendlyError(state.error, 'Could not load this data.') : '',
    rawError: state.error,
    loading: state.loading,
    updatedAt,
    reload: () => load(false),
    refresh: () => load(true),
  };
}

// Same as the JSON signature of the filters, so a changed value (not a changed object identity) triggers a reload.
const signature = (value) => JSON.stringify(value);

// Query state of a paginated list: page, limit, sort, search text and filters. Typing in the search box or a filter
// is debounced (`delay` ms) and resets to page 1; page, size and sort changes apply at once.
// `mapFilters` turns the filter form values into API parameters (for example date fields into ISO instants).
export function useListState({
  sort = '', limit = DEFAULT_PAGE_SIZE, q = '', filters = {}, resetFilters = filters, mapFilters = (values) => values, delay = 300,
} = {}) {
  const initial = useRef({ sort, limit, filters: resetFilters });
  const [state, setState] = useState({ page: 1, limit, q, sort, filters });
  const [committed, setCommitted] = useState({ q, filters });
  const lastSignature = useRef(signature({ q, filters }));

  useEffect(() => {
    const next = signature({ q: state.q, filters: state.filters });
    if (next === lastSignature.current) return undefined;
    const apply = () => { lastSignature.current = next; setCommitted({ q: state.q, filters: state.filters }); };
    const timer = setTimeout(apply, delay);
    return () => clearTimeout(timer);
  }, [state.q, state.filters, delay]);

  const query = useMemo(() => ({
    page: state.page, limit: state.limit, sort: state.sort, q: committed.q, filters: mapFilters(committed.filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state.page, state.limit, state.sort, committed]);

  const api = useMemo(() => ({
    setPage: (page) => setState((prev) => ({ ...prev, page: Math.max(1, page) })),
    setLimit: (next) => setState((prev) => ({ ...prev, limit: next, page: 1 })),
    setSort: (next) => setState((prev) => ({ ...prev, sort: next, page: 1 })),
    setQ: (q) => setState((prev) => ({ ...prev, q, page: 1 })),
    setFilter: (name, value) => setState((prev) => ({ ...prev, page: 1, filters: { ...prev.filters, [name]: value } })),
    setFilters: (next) => setState((prev) => ({ ...prev, page: 1, filters: { ...prev.filters, ...next } })),
    reset: () => setState({ page: 1, limit: state.limit, q: '', sort: initial.current.sort, filters: initial.current.filters }),
  }), [state.limit]);

  // Values for the filter form: the search text plus every filter.
  const values = { q: state.q, ...state.filters };
  const onChange = (name, value) => (name === 'q' ? api.setQ(value) : api.setFilter(name, value));
  return { state, query, values, onChange, ...api };
}

// Runs one admin action at a time with toasts. `run(key, fn, { success, after })` returns { ok, result }.
// A second click while one action is running is ignored, so a double click never sends two writes.
export function useAct() {
  const toasts = useToasts();
  const [pending, setPending] = useState(null);
  const lock = useRef(false);
  const run = useCallback(async (key, fn, { success, after } = {}) => {
    if (lock.current) return { ok: false, busy: true };
    lock.current = true;
    setPending(key);
    try {
      const result = await fn();
      if (success) toasts.success(typeof success === 'function' ? success(result) : success);
      if (after) await after(result);
      return { ok: true, result };
    } catch (error) {
      const message = friendlyError(error);
      if (message) toasts.error(message);
      return { ok: false, error, message };
    } finally {
      lock.current = false;
      setPending(null);
    }
  }, [toasts]);
  return { run, pending, isPending: (key) => pending === key, busy: pending !== null };
}
