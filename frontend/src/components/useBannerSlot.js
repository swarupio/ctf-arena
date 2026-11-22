import { useEffect, useRef, useState } from 'react';
import { readBannerHint, writeBannerHint } from './bannerHint.js';

// A bar that never shows is not worth waiting for: when the answer is slower than this the reserved space is released.
export const BANNER_SLOT_GIVE_UP_MS = 3000;

/**
 * Space for a bar that is fetched after the first paint.
 *   kind      'announcement' or 'event'
 *   present   the bar is rendered now
 *   answered  the first answer (or failure) arrived
 * Returns { ref, style }: put both on the wrapper element around the bar. Until the first answer the wrapper keeps the
 * height the bar had last time (0 when there was none), so a bar that comes back does not push the page; afterwards the
 * bar's own height rules and the new height is remembered for the next load.
 */
export function useBannerSlot(kind, { present, answered }) {
  const ref = useRef(null);
  const [hint] = useState(() => readBannerHint(kind));
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!hint || answered) return undefined;
    const timer = setTimeout(() => setGaveUp(true), BANNER_SLOT_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [hint, answered]);

  useEffect(() => {
    if (!answered) return;
    writeBannerHint(kind, present && ref.current ? ref.current.offsetHeight : 0);
  }, [kind, answered, present]);

  const reserve = hint > 0 && !answered && !gaveUp;
  return { ref, style: reserve ? { minHeight: `${hint}px` } : undefined };
}
