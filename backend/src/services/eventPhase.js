// Scheduled Arena event ("match"): the phase is DERIVED from stored timestamps and the current time, never from a
// timer, so every replica and every serverless invocation agrees. Pure functions: no database, no clock of their own.
//
//   none      no event is configured (the platform behaves exactly as without this feature)
//   upcoming  now < startsAt
//   live      startsAt <= now < freezeAt (or endsAt when there is no freeze)
//   frozen    freezeAt <= now < endsAt (submissions open, public scoreboard frozen)
//   ended     now >= endsAt (submissions closed, scoreboard shows the final standings)
export const EVENT_NAME_MAX = 80;

const toDate = (value) => {
  if (value === null || value === undefined || value === '') { return null; }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Stored document part (or anything) -> { name, startsAt, endsAt, freezeAt } with Dates, or null when it is not a
// usable schedule. An event needs both a start and an end; a half-configured one is treated as no event.
export function normalizeEvent(raw) {
  const startsAt = toDate(raw?.startsAt);
  const endsAt = toDate(raw?.endsAt);
  if (!startsAt || !endsAt || endsAt <= startsAt) { return null; }
  let freezeAt = toDate(raw?.freezeAt);
  if (freezeAt && (freezeAt <= startsAt || freezeAt >= endsAt)) { freezeAt = null; }
  return { name: typeof raw?.name === 'string' ? raw.name.trim() : '', startsAt, endsAt, freezeAt };
}

export function eventPhase(event, now = new Date()) {
  const schedule = normalizeEvent(event);
  if (!schedule) { return 'none'; }
  const time = toDate(now)?.getTime() ?? Date.now();
  if (time < schedule.startsAt.getTime()) { return 'upcoming'; }
  if (time >= schedule.endsAt.getTime()) { return 'ended'; }
  if (schedule.freezeAt && time >= schedule.freezeAt.getTime()) { return 'frozen'; }
  return 'live';
}

// Public shape of GET /api/event. `serverTime` lets a client show a countdown without trusting its own clock.
export function eventView(event, now = new Date()) {
  const schedule = normalizeEvent(event);
  const iso = (date) => (date ? date.toISOString() : null);
  return {
    name: schedule?.name ?? '',
    phase: eventPhase(schedule, now),
    startsAt: iso(schedule?.startsAt),
    endsAt: iso(schedule?.endsAt),
    freezeAt: iso(schedule?.freezeAt),
    serverTime: new Date(now).toISOString(),
  };
}

// The cutoff players' standings are computed at, or null when the scoreboard is live for everybody.
export function scoreboardCutoff(event, now = new Date()) {
  const schedule = normalizeEvent(event);
  return schedule && eventPhase(schedule, now) === 'frozen' ? schedule.freezeAt : null;
}

// Why a submission is refused right now, or null when the event allows it (no event, live or frozen).
export function submissionBlock(event, now = new Date()) {
  const phase = eventPhase(event, now);
  if (phase === 'upcoming') { return { code: 'EVENT_NOT_STARTED', message: 'The event has not started yet. Submissions open when it begins.' }; }
  if (phase === 'ended') { return { code: 'EVENT_ENDED', message: 'The event has ended. Submissions are closed.' }; }
  return null;
}

// Validation of an admin-supplied schedule. Returns { field: message } (empty = valid). Input values are Dates or null.
export function validateSchedule({ startsAt, endsAt, freezeAt }) {
  const errors = {};
  if (!startsAt) { errors.startsAt = 'Set a start time.'; }
  if (!endsAt) { errors.endsAt = 'Set an end time.'; }
  if (startsAt && endsAt && endsAt <= startsAt) { errors.endsAt = 'The end must be after the start.'; }
  if (freezeAt) {
    if (!startsAt || !endsAt) { errors.freezeAt = 'Set the start and end before the freeze time.'; }
    else if (freezeAt <= startsAt || freezeAt >= endsAt) { errors.freezeAt = 'The freeze must be between the start and the end.'; }
  }
  return errors;
}
