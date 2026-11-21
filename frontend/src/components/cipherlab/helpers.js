// Pure view helpers for the Cipher Lab pages (tested in tests/cipherlab.test.js).

export const TRACK_ORDER = ['easy', 'medium', 'hard', 'insane'];
export const TRACK_BLURB = { easy: 'Warm up', medium: 'Keys and maths', hard: 'Stacked puzzles', insane: 'No hints' };

export const percent = (done, total) => (total > 0 ? Math.round((Math.min(done, total) * 100) / total) : 0);

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) { return '0s'; }
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) { return `${hours}h ${String(minutes).padStart(2, '0')}m`; }
  if (minutes > 0) { return `${minutes}m ${String(seconds).padStart(2, '0')}s`; }
  return `${seconds}s`;
}

export const BADGE_LABEL = { gold: 'Gold speed-run', silver: 'Silver speed-run', bronze: 'Bronze speed-run' };

export function speedrunText(speedrun) {
  if (!speedrun) { return null; }
  const time = formatDuration(speedrun.ms);
  return speedrun.badge ? `${BADGE_LABEL[speedrun.badge]} · ${time}` : `Cleared in ${time}`;
}

export const STATUS_LABEL = { solved: 'Solved', open: 'Open', locked: 'Locked' };

// First level a player can work on: the earliest open level of the easiest track that is not complete.
export function nextLevel(overview) {
  for (const track of overview?.tracks ?? []) {
    const open = track.levels.find((level) => level.status === 'open');
    if (open) { return open; }
  }
  return null;
}

export function streakText(streak) {
  if (!streak || streak < 1) { return 'No streak yet'; }
  if (streak === 1) { return '1 in a row'; }
  return `${streak} in a row`;
}

const MESSAGES = {
  NO_TEAM: 'Join or create a team first. Your puzzles are unique to your team.',
  TEAM_BANNED: 'Your team has been banned from the arena.',
  LEVEL_LOCKED: 'Clear the previous level of this track to unlock this one.',
  RATE_LIMITED: 'Too many attempts on this level. Wait a minute, then think again.',
  CIPHERLAB_NOT_SEEDED: 'Cipher Lab is not set up yet. Ask an admin to run npm run seed:cipherlab.',
  NO_HINTS: 'The Black Chamber gives no hints.',
  NO_MORE_HINTS: 'No more hints on this level.',
  NOT_FOUND: 'That level does not exist.',
  FORBIDDEN: 'Only players can do that. Admins can preview puzzles only.',
};

export function cipherErrorMessage(error) {
  if (error?.code && MESSAGES[error.code]) { return MESSAGES[error.code]; }
  return error?.message || 'Something went wrong. Please try again.';
}

// 5-letter blocks for display of long letter strings.
export function blocks(text, size = 5) {
  const clean = String(text).replace(/\s+/g, '');
  return clean.match(new RegExp(`.{1,${size}}`, 'g'))?.join(' ') ?? '';
}

// Short deterministic confetti layout (no Math.random, so renders are stable and testable).
export function confettiPieces(count = 18) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: (i * 37) % 100,
    delay: ((i * 53) % 40) / 100,
    hue: (i * 47) % 3,
  }));
}
