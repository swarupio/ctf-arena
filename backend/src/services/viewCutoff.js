// Which moment of an event's data a request may see. Players see the standings and activity as of the freeze while the
// scoreboard is frozen and as of the end once it is over (a request admitted just before the end may be stored a moment
// after it, and that must not count); admins always see live data. The read of the event must not fail open (that would
// show live data during a freeze), so a read failure is an error. Roles come from the verified token.
import { getEventConfig } from './adminSettings.js';
import { eventPhase } from './eventPhase.js';

export async function resolveView(user, now = new Date()) {
  const event = await getEventConfig({ failOpen: false });
  if (!event || user?.role === 'admin') { return { asOf: null, frozen: false }; }
  const phase = eventPhase(event, now);
  if (phase === 'frozen') { return { asOf: event.freezeAt, frozen: true }; }
  if (phase === 'ended') { return { asOf: event.endsAt, frozen: false }; }
  return { asOf: null, frozen: false };
}
