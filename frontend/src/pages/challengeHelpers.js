import { EVENT_MESSAGES } from '../event/messages.js';
// "N solves", or a neutral dash while the scoreboard is frozen (the server sends solveCount: null to players then).
export function solveCountLabel(count) {
  if (typeof count !== 'number' || !Number.isFinite(count)) { return '-'; }
  return `${count} ${count === 1 ? 'solve' : 'solves'}`;
}

export const CATEGORY_ORDER = ['web', 'crypto', 'forensics', 'pwn', 'misc', 'terminal'];

// Arena Terminal codes are challenges too (docs/ARENA_TERMINAL.md section 9), but they are played inside the terminal,
// so the card grid hides them and shows one promo card. `regular` are the cards; the rest feeds the promo.
export const isTerminalChallenge = (challenge) => challenge?.type === 'terminal';

// The other categories (Cipher Lab, Web Lab, Forensics, Crackme, OSINT) also store their levels as challenges and are
// played on their own pages, so the card grid hides them too; The Range lists them.
const GAME_TYPES = ['game', 'weblab', 'forensics', 'reversing', 'osint'];
export const isGameChallenge = (challenge) => GAME_TYPES.includes(challenge?.type);

export function splitTerminalChallenges(challenges) {
  const terminal = challenges.filter(isTerminalChallenge);
  return {
    regular: challenges.filter((challenge) => !isTerminalChallenge(challenge) && !isGameChallenge(challenge)),
    terminal: {
      count: terminal.length,
      solved: terminal.filter((challenge) => challenge.solvedByMyTeam).length,
      points: terminal.reduce((sum, challenge) => sum + (Number(challenge.points) || 0), 0),
    },
  };
}

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
  ...EVENT_MESSAGES,
  FORBIDDEN: 'Admins can preview only.',
  NO_TEAM: 'Join or create a team first (Team page) to play.',
  TEAM_BANNED: 'Your team has been banned.',
  INSTANCE_LIMIT: 'Your team has reached its instance limit. Stop another instance first.',
  ALREADY_RUNNING: 'Your team already has an instance of this challenge.',
  DOCKER_DISABLED: 'Docker challenges are only available when the platform is run locally.',
  NO_FREE_PORT: 'No free ports right now. Try again in a moment.',
  RATE_LIMITED: 'Too many attempts. Wait a minute before trying again.',
};

export function challengeErrorMessage(error) {
  return MESSAGES[error?.code] ?? error?.message ?? 'Something went wrong. Please try again.';
}

// Which panels the challenge page shows, decided in one place (pure, so every branch is tested).
//  gate: a situation that replaces BOTH the instance and the submit panel with one explanation card:
//        'admin-preview' (admins have no team), 'banned', 'no-team'; otherwise null.
//  instance: null (static challenge, or already captured with nothing running) | 'running' | 'ready' | 'no-docker'.
//  submit: 'form' | 'event-not-started' | 'event-ended' | 'hidden' ('hidden' = the instance panel explains why: the flag
//          of a docker challenge cannot be found without its container, so a Submit box would be a dead end).
// hasTeam / banned / teamBanned (the account flag and the team flag of /me) are undefined until /me has loaded: unknown counts as "fine", the server still refuses and the page
// then switches to the right card from the error code.
export function challengePanels({
  role, type, dockerAvailable, hasTeam, banned, teamBanned, solved = false, hasInstance = false, eventPhase = 'none',
} = {}) {
  const gate = role === 'admin' ? 'admin-preview' : banned === true || teamBanned === true ? 'banned' : hasTeam === false ? 'no-team' : null;
  if (gate) { return { gate, instance: null, submit: 'hidden' }; }
  const docker = type === 'docker';
  let instance = null;
  if (docker && hasInstance) { instance = 'running'; }
  else if (docker && !solved) { instance = dockerAvailable === false ? 'no-docker' : 'ready'; }
  let submit = 'form';
  if (instance === 'no-docker') { submit = 'hidden'; }
  else if (eventPhase === 'upcoming') { submit = 'event-not-started'; }
  else if (eventPhase === 'ended') { submit = 'event-ended'; }
  else if (solved) { submit = 'hidden'; }
  return { gate: null, instance, submit };
}

// The server's refusal codes that mean the page should show the team / ban card instead of the controls.
export const gateFromError = (error) => (error?.code === 'NO_TEAM' ? 'no-team' : error?.code === 'TEAM_BANNED' ? 'banned' : null);
