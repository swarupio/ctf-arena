export const CATEGORY_ORDER = ['web', 'crypto', 'forensics', 'pwn', 'misc'];

// Groups challenges by category in a stable order, easiest (fewest points) first.
export function groupByCategory(challenges) {
  const groups = new Map();
  for (const challenge of challenges) {
    if (!groups.has(challenge.category)) groups.set(challenge.category, []);
    groups.get(challenge.category).push(challenge);
  }
  const rank = (category) => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([category, items]) => ({ category, items: [...items].sort((a, b) => a.points - b.points) }));
}

// Remaining time as m:ss, never negative.
export function formatCountdown(expiresAt, now = Date.now()) {
  const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
}

export const isExpired = (expiresAt, now = Date.now()) => new Date(expiresAt).getTime() <= now;

const MESSAGES = {
  NO_TEAM: 'Join or create a team first (Team page) to play.',
  TEAM_BANNED: 'Your team has been banned.',
  INSTANCE_LIMIT: 'Your team has reached its instance limit. Stop another instance first.',
  ALREADY_RUNNING: 'Your team already has an instance of this challenge.',
  NO_FREE_PORT: 'No free ports right now. Try again in a moment.',
  RATE_LIMITED: 'Too many attempts. Wait a minute before trying again.',
  CONFLICT: 'This was already done for your team.',
  NOT_FOUND: 'That challenge or instance no longer exists.',
};

export function challengeErrorMessage(error) {
  return MESSAGES[error?.code] ?? error?.message ?? 'Something went wrong. Please try again.';
}
