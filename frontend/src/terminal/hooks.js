import { useEffect, useState } from 'react';

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
