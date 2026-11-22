import mongoose from 'mongoose';
import Achievement from '../models/Achievement.js';
import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';
import Team from '../models/Team.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export const EVALUATE_TIMEOUT_MS = 1500;
export const CATEGORIES = ['web', 'crypto', 'forensics', 'pwn', 'misc', 'terminal'];
const MODES = ['easy', 'medium', 'hard'];

// Display data only. `icon` is a short pixel-style glyph the frontend draws; nothing here touches scoring.
export const BADGES = [
  { key: 'first-solve', name: 'First Flag', description: 'Capture your first flag.', icon: '01' },
  { key: 'first-blood', name: 'First Blood', description: 'Be the first team to solve a challenge.', icon: 'FB' },
  ...CATEGORIES.map((category) => ({
    key: `category-${category}`,
    name: `${category[0].toUpperCase()}${category.slice(1)} Explorer`,
    description: `Solve a ${category} challenge.`,
    icon: category.slice(0, 2).toUpperCase(),
  })),
  { key: 'solves-3', name: 'Hat Trick', description: 'Solve 3 challenges.', icon: 'x3' },
  { key: 'solves-5', name: 'High Five', description: 'Solve 5 challenges.', icon: 'x5' },
  { key: 'solves-10', name: 'Double Digits', description: 'Solve 10 challenges.', icon: 'XX' },
  { key: 'hard-hitter', name: 'Hard Hitter', description: 'Solve a hard challenge.', icon: 'HH' },
  { key: 'terminal-easy', name: 'Terminal Easy Perfect', description: 'Find every code of Arena Terminal easy mode.', icon: 'T1' },
  { key: 'terminal-medium', name: 'Terminal Medium Perfect', description: 'Find every code of Arena Terminal medium mode.', icon: 'T2' },
  { key: 'terminal-hard', name: 'Terminal Hard Perfect', description: 'Find every code of Arena Terminal hard mode.', icon: 'T3' },
  { key: 'night-owl', name: 'Night Owl', description: 'Solve a challenge between 00:00 and 05:00 UTC.', icon: 'NO' },
  { key: 'speed-runner', name: 'Speed Runner', description: 'Solve 3 challenges within one hour.', icon: 'SR' },
  { key: 'streak-3', name: 'On a Roll', description: 'Solve on 3 UTC days in a row.', icon: 'S3' },
  { key: 'streak-7', name: 'Week Warrior', description: 'Solve on 7 UTC days in a row.', icon: 'S7' },
  { key: 'team-of-three', name: 'Full Squad', description: 'Play in a team of three.', icon: '3P' },
  { key: 'comeback', name: 'Comeback Kid', description: 'Solve again after 3 or more days away.', icon: 'CK' },
];
export const BADGE_KEYS = new Set(BADGES.map((badge) => badge.key));
const badgeByKey = new Map(BADGES.map((badge) => [badge.key, badge]));

export const publicBadge = (key) => {
  const badge = badgeByKey.get(key);
  return badge ? { key: badge.key, name: badge.name, description: badge.description, icon: badge.icon } : null;
};

const dayOf = (value) => Math.floor(new Date(value).getTime() / DAY_MS);

// Streak over UTC days with at least one solve. `current` counts back from today or yesterday (so a streak
// is still alive until the end of the next day); `best` is the longest run ever.
export function streakInfo(dates, now = new Date()) {
  const days = [...new Set(dates.map(dayOf))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  days.forEach((day, index) => {
    run = index > 0 && day === days[index - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  let current = 0;
  const today = dayOf(now);
  const set = new Set(days);
  let cursor = set.has(today) ? today : today - 1;
  while (set.has(cursor)) { current += 1; cursor -= 1; }
  return { current, best };
}

// Pure rule engine. Facts:
//   userSolves   [{ challengeId, solvedAt, firstBlood }]  solves this user submitted
//   teamSolves   [{ challengeId }]                         solves of the user's team (for terminal completion)
//   challenges   { [id]: { category, difficulty, type, mode } }
//   terminalTotals { easy, medium, hard }                  visible terminal codes per mode
//   memberCount  number of members of the user's team
// Returns the keys of every badge earned so far. Unknown challenges are ignored, never guessed.
export function computeEarned({ userSolves = [], teamSolves = [], challenges = {}, terminalTotals = {}, memberCount = 0 }) {
  const earned = new Set();
  const count = userSolves.length;
  if (count >= 1) { earned.add('first-solve'); }
  if (count >= 3) { earned.add('solves-3'); }
  if (count >= 5) { earned.add('solves-5'); }
  if (count >= 10) { earned.add('solves-10'); }
  if (userSolves.some((solve) => solve.firstBlood)) { earned.add('first-blood'); }
  for (const solve of userSolves) {
    const challenge = challenges[String(solve.challengeId)];
    if (!challenge) { continue; }
    if (CATEGORIES.includes(challenge.category)) { earned.add(`category-${challenge.category}`); }
    if (challenge.difficulty === 'hard') { earned.add('hard-hitter'); }
  }
  const times = userSolves.map((solve) => new Date(solve.solvedAt).getTime()).sort((a, b) => a - b);
  if (times.some((t) => new Date(t).getUTCHours() < 5)) { earned.add('night-owl'); }
  if (times.some((t, i) => i + 2 < times.length && times[i + 2] - t <= HOUR_MS)) { earned.add('speed-runner'); }
  if (times.some((t, i) => i > 0 && t - times[i - 1] >= 3 * DAY_MS)) { earned.add('comeback'); }
  const { best } = streakInfo(times);
  if (best >= 3) { earned.add('streak-3'); }
  if (best >= 7) { earned.add('streak-7'); }
  if (memberCount >= 3) { earned.add('team-of-three'); }
  const solvedByMode = {};
  for (const solve of teamSolves) {
    const challenge = challenges[String(solve.challengeId)];
    if (challenge?.type === 'terminal' && challenge.mode) { solvedByMode[challenge.mode] = (solvedByMode[challenge.mode] ?? 0) + 1; }
  }
  for (const mode of MODES) {
    if (terminalTotals[mode] > 0 && (solvedByMode[mode] ?? 0) >= terminalTotals[mode]) { earned.add(`terminal-${mode}`); }
  }
  return [...earned];
}

export const toFact = (challenge) => ({
  category: challenge.category, difficulty: challenge.difficulty, type: challenge.type, mode: challenge.terminal?.mode,
});

// Reads the facts with a few small lean queries, all on indexed fields. The user's and the team's solves come from ONE
// query ($or over the {userId, solvedAt} and {teamId, challengeId} indexes) and are split here, and the team document
// is only read when the caller did not pass `memberCount` (the submit routes already hold the team from the request).
export async function loadFacts({ userId, teamId, memberCount }) {
  const filter = teamId ? { $or: [{ userId }, { teamId }], adjustment: { $ne: true } } : { userId, adjustment: { $ne: true } };
  const [rows, team] = await Promise.all([
    Solve.find(filter).select('userId teamId challengeId solvedAt firstBlood').lean(),
    teamId && typeof memberCount !== 'number' ? Team.findById(teamId).select('memberIds').lean() : null,
  ]);
  const userSolves = rows.filter((solve) => String(solve.userId) === String(userId));
  const teamSolves = teamId ? rows.filter((solve) => String(solve.teamId) === String(teamId)) : [];
  const ids = [...new Set(rows.map((solve) => String(solve.challengeId)))];
  const challengeRows = ids.length ? await Challenge.find({ _id: { $in: ids } }).select('category difficulty type terminal.mode').lean() : [];
  const challenges = Object.fromEntries(challengeRows.map((row) => [String(row._id), toFact(row)]));
  const terminalTotals = {};
  if (challengeRows.some((row) => row.type === 'terminal')) {
    const totals = await Challenge.aggregate([
      { $match: { type: 'terminal', visible: true } }, { $group: { _id: '$terminal.mode', n: { $sum: 1 } } },
    ]);
    for (const row of totals) { terminalTotals[row._id] = row.n; }
  }
  return {
    userSolves, teamSolves, challenges, terminalTotals,
    memberCount: typeof memberCount === 'number' ? memberCount : team?.memberIds?.length ?? 0,
  };
}

// Awards every newly earned badge. The badges the user already holds are read in the same round trip as the facts and
// skipped, so a solve only writes the badges that are really new (not one upsert per earned badge). The unique
// {userId,key} index plus an upsert still makes the write idempotent and safe across replicas: only the call that
// really inserted a row reports the badge as new.
export async function evaluate({ userId, teamId = null, memberCount }) {
  const [facts, held] = await Promise.all([
    loadFacts({ userId, teamId, memberCount }),
    Achievement.find({ userId }).select('key').lean(),
  ]);
  const have = new Set(held.map((row) => row.key));
  const missing = computeEarned(facts).filter((key) => !have.has(key));
  const awarded = await Promise.all(missing.map(async (key) => {
    try {
      const result = await Achievement.updateOne({ userId, key }, { $setOnInsert: { awardedAt: new Date() } }, { upsert: true });
      return result?.upsertedCount === 1 ? publicBadge(key) : null;
    } catch (error) {
      if (error?.code !== 11000) { throw error; }
      return null;
    }
  }));
  return awarded.filter(Boolean);
}

// The hook used by the submit routes. It never throws, never waits longer than EVALUATE_TIMEOUT_MS and does nothing
// without a database connection, so a badge problem can never break or noticeably slow a solve.
export async function safeEvaluate(args, { timeoutMs = EVALUATE_TIMEOUT_MS, run = evaluate, connected = () => mongoose.connection.readyState === 1 } = {}) {
  if (!connected()) { return []; }
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve([]), timeoutMs); });
  try {
    return await Promise.race([Promise.resolve().then(() => run(args)).catch(() => []), timeout]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const achievementService = { evaluate, safeEvaluate };
