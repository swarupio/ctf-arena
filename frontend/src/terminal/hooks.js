import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMailSeen, markRead as markMailRead, saveMailSeen } from './mail.js';

/** Subscribe to a CSS media query. */
export function useMediaQuery(query, initial = false) {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches : initial;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

const browserStorage = () => {
  try { return window.localStorage; } catch { return null; }
};

/**
 * Which mails this browser has read in this mode (a bit mask kept in localStorage, never stored on the server).
 * `markRead(ids)` updates the state and the storage; `seenRef` always holds the latest mask for async callbacks.
 */
export function useMailSeen(email, mode) {
  const [seen, setSeen] = useState(() => loadMailSeen(browserStorage(), email, mode));
  const seenRef = useRef(seen);
  const markRead = useCallback((ids) => {
    const next = markMailRead(seenRef.current, ids);
    if (next === seenRef.current) return;
    seenRef.current = next;
    setSeen(next);
    saveMailSeen(browserStorage(), email, mode, next);
  }, [email, mode]);
  return { seen, seenRef, markRead };
}
