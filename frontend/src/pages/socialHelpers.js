// Pure helpers for the cosmetic extras: activity ticker, daily spotlight, badges, celebrations and the share card.
export const CELEBRATE_EVENT = 'arena:celebrate';

export function describeEvent(event) {
  switch (event?.type) {
    case 'first_blood': return `${event.team} took first blood on ${event.challenge}`;
    case 'solve': return `${event.team} solved ${event.challenge}`;
    case 'badge': return `${event.team} earned the ${event.badge} badge`;
    case 'team': return `Team ${event.team} joined the arena`;
    default: return '';
  }
}

export const eventTag = (event) => ({ first_blood: 'FIRST BLOOD', solve: 'SOLVE', badge: 'BADGE', team: 'NEW TEAM' })[event?.type] ?? '';

// Events without text are dropped, so the ticker never renders an empty row.
export const visibleEvents = (events, limit = 12) => (Array.isArray(events) ? events : [])
  .filter((event) => describeEvent(event)).slice(0, limit);

export function timeAgo(at, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  const days = Math.round(seconds / 86_400);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function eventKey(event, index) { return `${event.type}-${event.at}-${event.team}-${index}`; }

// What to celebrate after a correct submission. Wrong answers and repeat solves celebrate nothing.
export function celebrationFor(outcome) {
  if (!outcome?.correct || outcome.alreadySolved) return null;
  const badges = Array.isArray(outcome.badges) ? outcome.badges : [];
  const first = badges.some((badge) => badge.key === 'first-solve');
  if (!outcome.firstBlood && badges.length === 0) return null;
  const title = outcome.firstBlood ? 'First blood!' : first ? 'Your first flag!' : badges.length === 1 ? 'New badge!' : `${badges.length} new badges!`;
  return { title, badges: badges.map((badge) => badge.name), confetti: true };
}

export function announce(outcome, target = globalThis.window) {
  const celebration = celebrationFor(outcome);
  if (celebration && target?.dispatchEvent) {
    target.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: celebration }));
  }
  return celebration;
}

export function prefersReducedMotion(win = globalThis.window) {
  return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

const COLORS = ['#b5f23d', '#0a0a0a', '#ffd23f', '#ff6b6b', '#6ea8ff', '#ffffff'];
// Deterministic confetti layout (no randomness): the same index always yields the same piece.
export function confettiPieces(count = 40) {
  return Array.from({ length: count }, (_, i) => {
    const seed = (i * 7919 + 17) % 101;
    return {
      x: (i * 37 + seed) % 100,
      dx: ((seed % 21) - 10) * 9,
      delay: ((i * 53) % 60) * 12,
      duration: 1800 + ((i * 97) % 900),
      rotate: (seed % 2 ? 1 : -1) * (360 + seed * 5),
      color: COLORS[i % COLORS.length],
    };
  });
}

export function streakLabel(streak) {
  const current = Number(streak?.current) || 0;
  if (current <= 0) return 'No streak yet. Solve something today to start one.';
  return `${current}-day streak${current >= Number(streak?.best) ? ' (your best)' : ''}`;
}

export const unlockedBadges = (badges) => (Array.isArray(badges) ? badges : []).filter((badge) => badge.unlocked);

// Unlocked first (newest first), then locked in catalog order.
export function sortBadges(badges) {
  const list = Array.isArray(badges) ? badges : [];
  const open = list.filter((badge) => badge.unlocked)
    .sort((a, b) => String(b.awardedAt).localeCompare(String(a.awardedAt)));
  return [...open, ...list.filter((badge) => !badge.unlocked)];
}

export function shareText(profile) {
  const badges = Array.isArray(profile?.badges) ? profile.badges : [];
  const parts = [
    `${profile?.displayName ?? 'A player'} on CTF Arena`,
    `${profile?.solves ?? 0} ${profile?.solves === 1 ? 'solve' : 'solves'}`,
    `${unlockedBadges(badges).length}/${badges.length} badges`,
  ];
  if (profile?.streak?.current > 0) parts.push(`${profile.streak.current}-day streak`);
  if (profile?.team?.name) parts.push(`team ${profile.team.name}`);
  return parts.join(' | ');
}

export function socialErrorMessage(error) {
  if (error?.status === 401) return 'Please log in again.';
  if (error?.status === 404) return 'That player was not found.';
  if (error?.status === 429) return 'Too many requests. Wait a moment.';
  return 'Something went wrong. Try again.';
}

export const categoryTone = (category) => String(category ?? 'misc').toLowerCase().replace(/[^a-z]/g, '') || 'misc';
