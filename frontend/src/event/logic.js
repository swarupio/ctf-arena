// Pure logic of the event countdown banner and the frozen-scoreboard note. No DOM, no clock of its own: callers pass
// "now" in milliseconds, already corrected by the server clock offset.
export const EVENT_POLL_MS = 30_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const ms = (iso) => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
};

// Server clock minus client clock, taken when the response arrived. Adding it to Date.now() gives the server's time.
export function clockOffset(serverTime, receivedAt = Date.now()) {
  const server = ms(serverTime);
  return server === null ? 0 : server - receivedAt;
}

// The same rules as the server (services/eventPhase.js), evaluated locally so a transition shows without waiting for a poll.
export function phaseAt(event, nowMs) {
  const start = ms(event?.startsAt);
  const end = ms(event?.endsAt);
  if (start === null || end === null || end <= start) return 'none';
  if (nowMs < start) return 'upcoming';
  if (nowMs >= end) return 'ended';
  const freeze = ms(event?.freezeAt);
  if (freeze !== null && freeze > start && freeze < end && nowMs >= freeze) return 'frozen';
  return 'live';
}

const pad = (n) => String(n).padStart(2, '0');

// 02:13:05, or 3d 02:13:05 from a day up. Never negative.
export function formatRemaining(remainingMs) {
  const total = Math.max(0, Math.floor(remainingMs / SECOND));
  const days = Math.floor(total / 86400);
  const clock = `${pad(Math.floor((total % 86400) / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

// Spoken form for screen readers, refreshed only when the minute changes: "2 hours 13 minutes".
export function spokenRemaining(remainingMs) {
  const minutes = Math.max(0, Math.floor(remainingMs / MINUTE));
  if (minutes < 1) return 'less than a minute';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const part = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [days ? part(days, 'day') : '', hours ? part(hours, 'hour') : '', rest ? part(rest, 'minute') : ''].filter(Boolean).join(' ');
}

const nameOf = (event) => (String(event?.name ?? '').trim() || 'Arena event');

// What the banner shows at `nowMs`: { phase, text, announce, countdown } or null when no event is configured.
// `text` changes every second (visible); `announce` only when the phase or the minute changes (screen readers).
export function bannerState(event, nowMs) {
  const phase = phaseAt(event, nowMs);
  if (phase === 'none') return null;
  const name = nameOf(event);
  const start = ms(event.startsAt);
  const end = ms(event.endsAt);
  if (phase === 'ended') {
    return { phase, name, countdown: null, text: `${name} — ended`, announce: `${name} has ended. Submissions are closed.` };
  }
  const label = phase === 'upcoming' ? 'starts in' : 'ends in';
  const remaining = (phase === 'upcoming' ? start : end) - nowMs;
  const status = { upcoming: '', live: ' — live', frozen: ' — scoreboard frozen' }[phase];
  const spoken = spokenRemaining(remaining);
  const announce = {
    upcoming: `${name}: starts in ${spoken}.`,
    live: `${name} is live: ends in ${spoken}.`,
    frozen: `${name}: scoreboard frozen, ends in ${spoken}.`,
  }[phase];
  return { phase, name, countdown: formatRemaining(remaining), text: `${name}${status} — ${label} ${formatRemaining(remaining)}`, announce };
}

// 'HH:MM' in the viewer's time zone for "Scoreboard frozen at 21:00".
export function clockText(iso, { locale, timeZone } = {}) {
  const value = ms(iso);
  if (value === null) return '';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(value));
}
