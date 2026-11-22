import { useEffect, useRef, useState } from 'react';

// Pure: how long to wait before a value may be announced again, given the time of the last announcement.
export const throttleDelay = (now, last, ms) => (last === null ? 0 : Math.max(0, last + ms - now));

/**
 * `value`, but it changes at most once per `ms` (the newest value always arrives, never an in-between one).
 * Used for live regions so a screen reader is not flooded while something updates on every step.
 */
export function useThrottledValue(value, ms) {
  const [shown, setShown] = useState(value);
  const last = useRef(null);
  useEffect(() => {
    const timer = setTimeout(() => { last.current = Date.now(); setShown(value); }, throttleDelay(Date.now(), last.current, ms));
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}

/** `value` once it has stopped changing for `ms`. Used for a status line that reports the result of typing. */
export function useDebouncedValue(value, ms) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}
