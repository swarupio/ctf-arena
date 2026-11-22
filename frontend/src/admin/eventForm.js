// Form logic of the scheduled-event panel in admin Settings. Pure functions. The inputs are <input type="datetime-local">
// values ("2030-12-05T18:00", the browser's local time); the API receives and stores UTC ISO strings.
export const EVENT_NAME_MAX = 80;

const pad = (n) => String(n).padStart(2, '0');

// ISO instant -> "YYYY-MM-DDTHH:mm" in local time ('' for empty or invalid input).
export function toLocalInput(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "YYYY-MM-DDTHH:mm" (local) -> UTC ISO string, or null when empty or not a real date/time.
export function fromLocalInput(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  const exact = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hour && date.getMinutes() === minute;
  return exact ? date.toISOString() : null;
}

export const eventToDraft = (event) => ({
  name: event?.name ?? '',
  startsAt: toLocalInput(event?.startsAt),
  endsAt: toLocalInput(event?.endsAt),
  freezeAt: toLocalInput(event?.freezeAt),
});

export const isBlankDraft = (draft) => !draft.name.trim() && !draft.startsAt && !draft.endsAt && !draft.freezeAt;

// { field: message }. A completely blank draft is valid: it means "no event" (the Clear button's state).
export function validateEventDraft(draft) {
  if (isBlankDraft(draft)) return {};
  const errors = {};
  if (draft.name.trim().length > EVENT_NAME_MAX) errors.name = `Keep the name under ${EVENT_NAME_MAX} characters.`;
  const start = fromLocalInput(draft.startsAt);
  const end = fromLocalInput(draft.endsAt);
  const freeze = fromLocalInput(draft.freezeAt);
  if (!draft.startsAt) errors.startsAt = 'Set a start time.';
  else if (!start) errors.startsAt = 'Enter a valid start date and time.';
  if (!draft.endsAt) errors.endsAt = 'Set an end time.';
  else if (!end) errors.endsAt = 'Enter a valid end date and time.';
  if (start && end && Date.parse(end) <= Date.parse(start)) errors.endsAt = 'The end must be after the start.';
  if (draft.freezeAt) {
    if (!freeze) errors.freezeAt = 'Enter a valid freeze date and time.';
    else if (start && end && (Date.parse(freeze) <= Date.parse(start) || Date.parse(freeze) >= Date.parse(end))) {
      errors.freezeAt = 'The freeze must be between the start and the end.';
    }
  }
  return errors;
}

// PUT body for a valid, non-blank draft.
export function eventBody(draft) {
  return {
    event: {
      name: draft.name.trim(),
      startsAt: fromLocalInput(draft.startsAt),
      endsAt: fromLocalInput(draft.endsAt),
      freezeAt: fromLocalInput(draft.freezeAt),
    },
  };
}

export const CLEAR_EVENT_BODY = Object.freeze({ event: null });

// True when the draft differs from what is saved (the saved ISO values are rendered to the same local text first,
// so showing a saved schedule is never "dirty").
export function eventDirty(saved, draft) {
  const base = eventToDraft(saved);
  return base.name.trim() !== draft.name.trim()
    || ['startsAt', 'endsAt', 'freezeAt'].some((key) => base[key] !== draft[key]);
}

export const PHASE_LABELS = {
  none: 'No event scheduled',
  upcoming: 'Upcoming: submissions are closed until the start',
  live: 'Live: submissions are open',
  frozen: 'Live, scoreboard frozen for players: submissions are open',
  ended: 'Ended: submissions are closed, final scoreboard shown',
};
