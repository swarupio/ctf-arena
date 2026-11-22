import { useMemo } from 'react';
import { bannerState } from '../event/logic.js';
import { useEventClock } from '../event/useEventClock.js';
import { useBannerSlot } from './useBannerSlot.js';
import './EventBanner.css';

// Presentation only. The visible countdown ticks every second but is hidden from assistive technology; a separate
// polite status line carries the spoken text, which only changes when the phase or the minute changes.
export function EventBannerView({ state }) {
  if (!state) return null;
  return <div className={`event-banner event-${state.phase}`}>
    <p className="event-text" aria-hidden="true"><strong className="event-label">Arena</strong> {state.text}</p>
    <p className="event-sr" role="status">{state.announce}</p>
  </div>;
}

// Slim bar under the announcement banner: "Event name — starts in 02:13:05", live, frozen or ended. Hidden when no event is scheduled.
export default function EventBanner() {
  const { event, nowMs, answeredAt } = useEventClock();
  const state = useMemo(() => (event ? bannerState(event, nowMs) : null), [event, nowMs]);
  // A failed fetch never answers; the slot gives up on its own after a few seconds.
  const slot = useBannerSlot('event', { present: Boolean(state), answered: answeredAt > 0 });
  return <div ref={slot.ref} style={slot.style}><EventBannerView state={state} /></div>;
}
