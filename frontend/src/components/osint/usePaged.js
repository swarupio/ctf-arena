import { useCallback, useEffect, useRef, useState } from 'react';
import { getSource } from '../../api/osint.js';
import { describeOsintError } from '../../osint/helpers.js';

// Loads one source of the case file a page at a time. Pages are small and bounded by the server; "more" appends the next one.
export function usePaged(track, source, params = {}, pageSize = undefined) {
  const key = JSON.stringify([track, source, params, pageSize]);
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: '' });
  const abort = useRef(null);
  const load = useCallback(async (offset, replace) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const page = await getSource(track, source, { ...params, offset, limit: pageSize }, { signal: controller.signal });
      setState((s) => ({ items: replace ? page.items : [...s.items, ...page.items], total: page.total, loading: false, error: '' }));
    } catch (error) {
      if (error?.name !== 'AbortError') { setState((s) => ({ ...s, loading: false, error: describeOsintError(error) })); }
    }
    // `key` stands for track, source, params and pageSize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    setState({ items: [], total: 0, loading: true, error: '' });
    void load(0, true);
    return () => abort.current?.abort();
  }, [load]);
  const count = state.items.length;
  return {
    ...state,
    hasMore: count < state.total,
    more: useCallback(() => load(count, false), [load, count]),
    reload: useCallback(() => load(0, true), [load]),
  };
}
