import { useCallback, useEffect, useState } from 'react';
import { getHintCosts } from '../api/hintCosts.js';
import { readOpened, userKey, writeOpened } from './helpers.js';
import { normalizeCosts } from './pricing.js';
import { countToStore, restoreHints } from './restore.js';

const storage = () => { try { return window.localStorage; } catch { return null; } };

// Opened count for hints the server does not track. The caller keys the component by scope, so the lazy read runs once per scope.
export function useStoredCount(user, scope, total) {
  const who = userKey(user);
  const [count, setCount] = useState(() => readOpened(storage(), { email: who }, scope, total));
  const open = useCallback(() => {
    setCount((current) => {
      const next = Math.min(current + 1, total);
      writeOpened(storage(), { email: who }, scope, next);
      return next;
    });
  }, [who, scope, total]);
  return [count, open];
}

// Web Exploit Lab: hints come one request at a time. Restores in order (to `serverCount`, the hints the server says the team
// opened, else to the count kept in this browser), stops at the first failure and only lowers the stored count on a definitive 4xx.
export function useRemoteHints(user, scope, total, fetchHint, serverCount = null) {
  const who = userKey(user);
  const [state, setState] = useState({ texts: [], ready: false });
  useEffect(() => {
    let live = true;
    (async () => {
      const wanted = serverCount !== null ? Math.min(serverCount, total) : readOpened(storage(), { email: who }, scope, total);
      const result = await restoreHints(fetchHint, wanted);
      if (!live) { return; }
      const lowered = countToStore(result, wanted);
      if (lowered !== null && serverCount === null) { writeOpened(storage(), { email: who }, scope, lowered); }
      setState({ texts: result.texts, ready: true });
    })();
    return () => { live = false; };
  }, [who, scope, total, fetchHint, serverCount]);
  const open = useCallback(async () => {
    const level = state.texts.length + 1;
    const text = await fetchHint(level);
    // Never lower what is stored (a transient restore failure can leave fewer texts than were opened).
    writeOpened(storage(), { email: who }, scope, Math.max(level, readOpened(storage(), { email: who }, scope, total)));
    setState((current) => (current.texts.length >= level ? current : { ...current, texts: [...current.texts, text] }));
  }, [state.texts.length, fetchHint, who, scope, total]);
  return { texts: state.texts, ready: state.ready, open };
}

// The platform hint prices, read once per screen when the level view does not carry its own `hintPricing`.
// { costs, failed }: both falsy while loading. A failed read never invents prices.
export function useHintCosts(wanted = true) {
  const [state, setState] = useState({ costs: null, failed: false });
  useEffect(() => {
    if (!wanted) { return undefined; }
    let live = true;
    getHintCosts().then(
      (raw) => { if (live) { setState({ costs: normalizeCosts(raw), failed: false }); } },
      () => { if (live) { setState({ costs: null, failed: true }); } },
    );
    return () => { live = false; };
  }, [wanted]);
  return state;
}
