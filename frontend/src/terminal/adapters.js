// Adapters between the HTTP contract (docs/TERMINAL_GAME.md section 8) and what the UI uses. api/terminal.js
// calls these on every response, so a change in a response shape is fixed here and nowhere else.

import { EFFECTS, MODES } from './data.js';

const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback);
const count = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const modeRank = (mode) => {
  const index = MODES.indexOf(mode);
  return index === -1 ? MODES.length : index;
};

/** GET /modes -> [{ mode, title, tagline, difficulty, codes, solved, points, pointsEarned, lore }] easy..hard. */
export function normalizeModes(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.modes) ? data.modes : [];
  return list
    .filter((item) => item && typeof item.mode === 'string')
    .map((item) => ({
      mode: item.mode,
      title: text(item.title, item.mode),
      tagline: text(item.tagline),
      difficulty: text(item.difficulty, item.mode),
      codes: count(item.codes),
      solved: count(item.solved),
      points: count(item.points),
      pointsEarned: count(item.pointsEarned),
      lore: Array.isArray(item.lore)
        ? item.lore.filter((line) => typeof line === 'string')
        : typeof item.lore === 'string' ? item.lore.split('\n') : [],
    }))
    .sort((a, b) => modeRank(a.mode) - modeRank(b.mode));
}

/**
 * GET /:mode/progress -> { mode, total, solved: [{ n, title, points, firstBlood }], remaining }.
 * `remaining` may be a number or a list; a list of { n, points } is kept as `remainingItems` for point hints.
 */
export function normalizeProgress(data, mode = '') {
  const solved = (Array.isArray(data?.solved) ? data.solved : [])
    .filter((item) => item && Number.isFinite(Number(item.n)))
    .map((item) => ({
      n: Number(item.n),
      title: text(item.title, '???'),
      points: count(item.points),
      firstBlood: Boolean(item.firstBlood),
    }))
    .sort((a, b) => a.n - b.n);
  const remainingItems = Array.isArray(data?.remaining)
    ? data.remaining.filter((item) => item && Number.isFinite(Number(item.n)))
      .map((item) => ({ n: Number(item.n), points: Number.isFinite(Number(item.points)) ? Number(item.points) : null }))
    : null;
  const total = count(data?.total, solved.length + (Array.isArray(data?.remaining) ? data.remaining.length : count(data?.remaining)));
  return {
    mode: text(data?.mode, mode),
    total,
    solved,
    remaining: Array.isArray(data?.remaining) ? data.remaining.length : count(data?.remaining, Math.max(0, total - solved.length)),
    remainingItems,
  };
}

/** POST /:mode/exec -> { output, cwd, exit, effect? }. Unknown effects are dropped. */
export function normalizeExec(data) {
  return {
    output: text(data?.output),
    cwd: typeof data?.cwd === 'string' && data.cwd !== '' ? data.cwd : null,
    exit: count(data?.exit),
    effect: EFFECTS.includes(data?.effect) ? data.effect : null,
  };
}

/** POST /:mode/complete -> { matches: string[] }. */
export function normalizeComplete(data) {
  return (Array.isArray(data?.matches) ? data.matches : []).filter((match) => typeof match === 'string' && match !== '').slice(0, 50);
}

/** POST /:mode/submit -> { correct, code?, title?, pointsAwarded, firstBlood, message, solved, total, alreadySolved? }. */
export function normalizeSubmit(data) {
  return {
    correct: data?.correct === true,
    alreadySolved: data?.alreadySolved === true,
    code: Number.isFinite(Number(data?.code)) && data?.code !== null ? Number(data.code) : null,
    title: text(data?.title),
    pointsAwarded: count(data?.pointsAwarded),
    firstBlood: data?.firstBlood === true,
    message: text(data?.message),
    solved: Number.isFinite(Number(data?.solved)) && data?.solved !== null ? Number(data.solved) : null,
    total: Number.isFinite(Number(data?.total)) && data?.total !== null ? Number(data.total) : null,
  };
}

/**
 * Turn a failed request into something the terminal can say.
 * Returns { kind, message, link? } where kind is one of
 * network | auth | no-team | banned | not-seeded | rate | forbidden | not-found | invalid | server.
 * `context` is 'submit' or anything else; it only changes the rate-limit wording.
 */
export function describeError(error, context = 'exec') {
  const status = Number(error?.status);
  const code = text(error?.code);
  if (code === 'NO_TEAM') {
    return { kind: 'no-team', message: 'no team yet - join or create a team first, codes are scored per team.', link: { to: '/team', label: 'open the Team page' } };
  }
  if (code === 'TEAM_BANNED') {
    return { kind: 'banned', message: 'your team has been banned from the arena.', link: { to: '/team', label: 'open the Team page' } };
  }
  if (code === 'TERMINAL_NOT_SEEDED') {
    return { kind: 'not-seeded', message: 'this terminal is not set up yet - ask an admin to run the terminal seed (npm run seed:terminal).' };
  }
  if (status === 401) return { kind: 'auth', message: 'session expired - signing you out, please log in again.' };
  if (code === 'SLOW_DOWN') {
    return { kind: 'rate', message: 'easy there, speed typist - give each command a moment, then try again.' };
  }
  if (status === 429 || code === 'RATE_LIMITED' || code === 'TOO_MANY_REQUESTS') {
    return {
      kind: 'rate',
      message: context === 'submit'
        ? 'too many attempts - wait a minute before submitting again.'
        : 'slow down - too many requests. Wait a few seconds and try again.',
    };
  }
  if (status === 403) return { kind: 'forbidden', message: text(error?.message, 'that action is not allowed here.') };
  if (status === 404) return { kind: 'not-found', message: 'unknown terminal mode.' };
  if (status === 400 || code === 'VALIDATION_ERROR') {
    return { kind: 'invalid', message: 'that input was rejected (too long or not valid). Shorten it and try again.' };
  }
  // No HTTP status at all (fetch failed, or a proxy answered with something that is not JSON) or a gateway error.
  if (!Number.isFinite(status) || status === 0 || status === 502 || status === 503 || status === 504) {
    return {
      kind: 'network',
      message: 'connection lost - could not reach the arena. Check your network, then press the up arrow and Enter to retry.',
    };
  }
  return { kind: 'server', message: `the arena returned an error (${text(error?.message, `HTTP ${status}`)}). Try again in a moment.` };
}
