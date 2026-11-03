export const REFRESH_MS = 10_000;

// Endpoint paths (relative to /api). Kept here so they can be unit tested without the auth stack.
export const ADMIN_PATHS = {
  stats: '/admin/stats',
  instances: '/admin/instances',
  kill: (instanceId) => `/admin/instances/${encodeURIComponent(instanceId)}/kill`,
  teams: '/admin/teams',
  ban: (teamId) => `/admin/teams/${encodeURIComponent(teamId)}/ban`,
};

// Fraction (0..1) as a short percentage: 0 -> "0%", 0.25 -> "25%", 1/3 -> "33.3%".
export function formatPercent(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${Math.round(Math.min(value, 1) * 1000) / 10}%`;
}

export function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '0';
}

// requestsByReplica ({ name: count }) to rows sorted by traffic, with each replica's share of the total.
export function replicaRows(requestsByReplica) {
  const entries = Object.entries(requestsByReplica ?? {})
    .map(([replica, requests]) => ({ replica, requests: Math.max(0, Number(requests) || 0) }));
  const total = entries.reduce((sum, row) => sum + row.requests, 0);
  return entries
    .map((row) => ({ ...row, share: total === 0 ? 0 : row.requests / total }))
    .sort((a, b) => b.requests - a.requests || a.replica.localeCompare(b.replica));
}

export const requestTotal = (rows) => rows.reduce((sum, row) => sum + row.requests, 0);

// Time left until an instance expires, coarse on purpose (the table refreshes every 10 s).
export function formatTimeLeft(expiresAt, now = Date.now()) {
  const remaining = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(remaining) || remaining <= 0) return 'expired';
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

// Names are null when the team or challenge was deleted after the instance started.
export const nameOrDeleted = (name) => (name ? name : '(deleted)');

export const challengeLabel = (challenge) => nameOrDeleted(challenge?.title ?? challenge?.slug);

export const killPrompt = (instance) => `Kill the ${challengeLabel(instance.challenge)} instance of team `
  + `"${nameOrDeleted(instance.team?.name)}"? The container is removed immediately.`;

export const banPrompt = (team) => `Ban team "${team.name}"? Its running instances are stopped and `
  + 'it cannot submit flags or start instances until you unban it.';

const MESSAGES = {
  UNAUTHENTICATED: 'Your session has expired. Sign in again.',
  FORBIDDEN: 'Only admins can use this page.',
};

export function adminErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (MESSAGES[error?.code]) return MESSAGES[error.code];
  if (error?.name === 'TypeError') return 'Cannot reach the server. Check your connection and try again.';
  return error?.message || fallback;
}

// Runs `tick` every `intervalMs` while the page is visible. A hidden tab stops polling; coming back
// refreshes immediately and resumes. Returns a function that stops everything (call it on unmount).
export function startPolling(tick, {
  intervalMs = REFRESH_MS,
  doc = globalThis.document,
  setTimer = setInterval,
  clearTimer = clearInterval,
} = {}) {
  let timer = null;
  const visible = () => !doc || doc.visibilityState !== 'hidden';
  const start = () => { if (timer === null) timer = setTimer(tick, intervalMs); };
  const stop = () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
  };
  const onVisibilityChange = () => {
    if (visible()) { tick(); start(); } else { stop(); }
  };
  if (visible()) start();
  doc?.addEventListener?.('visibilitychange', onVisibilityChange);
  return () => {
    stop();
    doc?.removeEventListener?.('visibilitychange', onVisibilityChange);
  };
}
