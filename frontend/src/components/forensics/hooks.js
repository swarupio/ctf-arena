import { useEffect, useState } from 'react';
import { getArtefact } from '../../api/forensics.js';
import { describeForensicsError } from '../../forensics/caseHelpers.js';

// Loads a paged artefact (log or capture) one page after the other, so the first rows show at once and the viewer can
// search everything locally once the pages have arrived. `pick(page, offset)` turns a response into row objects.
export function usePagedArtefact({ track, artefact, pageSize, pick }) {
  const [state, setState] = useState({ items: [], total: 0, loading: true, error: null });
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      let items = [];
      try {
        let offset = 0;
        let total = Infinity;
        while (offset < total) {
          const page = await getArtefact(track, artefact, { offset, limit: pageSize }, { signal: controller.signal });
          total = page.total;
          const rows = pick(page, offset);
          if (rows.length === 0) { break; }
          items = items.concat(rows);
          offset += pageSize;
          setState({ items, total, loading: offset < total, error: null });
        }
        setState({ items, total: items.length, loading: false, error: null });
      } catch (error) {
        if (!controller.signal.aborted) { setState((prev) => ({ ...prev, loading: false, error: describeForensicsError(error) })); }
      }
    })();
    return () => controller.abort();
    // `pick` is stable per viewer (defined at module level), so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, artefact, pageSize]);
  return state;
}

// One-shot fetch of a small artefact (metadata, disk listing, an image, a few clusters). `params === null` means
// "not wanted yet": nothing is fetched.
export function useArtefact(track, artefact, params) {
  const [state, setState] = useState({ data: null, loading: params !== null, error: null });
  const key = JSON.stringify(params ?? {});
  const skip = params === null;
  useEffect(() => {
    if (skip) { setState({ data: null, loading: false, error: null }); return undefined; }
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    getArtefact(track, artefact, JSON.parse(key), { signal: controller.signal })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((error) => { if (!controller.signal.aborted) { setState({ data: null, loading: false, error: describeForensicsError(error) }); } });
    return () => controller.abort();
  }, [track, artefact, key, skip]);
  return state;
}
