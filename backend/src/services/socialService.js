import Achievement from '../models/Achievement.js';
import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import { BADGES, publicBadge, streakInfo } from './achievementService.js';

export const FEED_DEFAULT = 20;
export const FEED_MAX = 50;
export const RECENT_SOLVES = 10;
// A profile reads at most this many of a player's newest solves (far above any real count of challenges).
export const PROFILE_SOLVE_CAP = 1000;
const DAY_MS = 86_400_000;

const iso = (value) => new Date(value).toISOString();
const ids = (rows, field) => [...new Set(rows.map((row) => String(row[field])).filter((id) => id !== 'undefined' && id !== 'null'))];

// Public activity feed: team names and challenge titles only. Banned teams and hidden challenges never appear.
// Bounded newest-first reads on indexed fields (solvedAt, awardedAt, _id), merged and cut to `limit`.
// `asOf` (a Date, frozen or ended event view, see viewCutoff.js) hides everything that happened after that instant;
// null is the live view.
export async function getFeed({ limit = FEED_DEFAULT, asOf = null } = {}) {
  const n = Math.min(Math.max(1, limit), FEED_MAX);
  const cut = asOf ? new Date(asOf) : null;
  const [solves, awards, newTeams] = await Promise.all([
    Solve.find({ adjustment: { $ne: true }, ...(cut ? { solvedAt: { $lte: cut } } : {}) }).sort({ solvedAt: -1 }).limit(n).select('teamId challengeId firstBlood solvedAt').lean(),
    Achievement.find(cut ? { awardedAt: { $lte: cut } } : {}).sort({ awardedAt: -1 }).limit(n).select('userId key awardedAt').lean(),
    Team.find({ banned: { $ne: true }, ...(cut ? { createdAt: { $lte: cut } } : {}) }).sort({ _id: -1 }).limit(n).select('name createdAt').lean(),
  ]);
  const users = awards.length ? await User.find({ _id: { $in: ids(awards, 'userId') } }).select('teamId').lean() : [];
  const teamOf = new Map(users.map((user) => [String(user._id), user.teamId ? String(user.teamId) : null]));
  const teamIds = [...new Set([...ids(solves, 'teamId'), ...teamOf.values()].filter(Boolean))];
  const [teams, challenges] = await Promise.all([
    teamIds.length ? Team.find({ _id: { $in: teamIds } }).select('name banned').lean() : [],
    solves.length ? Challenge.find({ _id: { $in: ids(solves, 'challengeId') } }).select('title visible').lean() : [],
  ]);
  const teamName = new Map(teams.filter((team) => !team.banned).map((team) => [String(team._id), team.name]));
  const title = new Map(challenges.filter((challenge) => challenge.visible !== false).map((challenge) => [String(challenge._id), challenge.title]));

  const events = [];
  for (const solve of solves) {
    const team = teamName.get(String(solve.teamId));
    const challenge = title.get(String(solve.challengeId));
    if (team && challenge) { events.push({ type: solve.firstBlood ? 'first_blood' : 'solve', at: iso(solve.solvedAt), team, challenge }); }
  }
  for (const award of awards) {
    const team = teamName.get(teamOf.get(String(award.userId)));
    const badge = publicBadge(award.key);
    if (team && badge) { events.push({ type: 'badge', at: iso(award.awardedAt), team, badge: badge.name }); }
  }
  for (const team of newTeams) {
    const created = team.createdAt ?? new Date(parseInt(String(team._id).slice(0, 8), 16) * 1000);
    if (cut && created > cut) { continue; }
    events.push({ type: 'team', at: iso(created), team: team.name });
  }
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, n);
}

export const dayKey = (date = new Date()) => new Date(date).toISOString().slice(0, 10);

function hash(text) {
  let h = 2166136261;
  for (const char of text) { h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0; }
  return h;
}

// Deterministic pick for a UTC day: the same answer on every replica with no stored state.
export function pickDaily(challenges, date = new Date()) {
  if (!challenges.length) { return null; }
  const sorted = [...challenges].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return sorted[hash(dayKey(date)) % sorted.length];
}

export async function getDaily(now = new Date()) {
  const visible = await Challenge.find({ visible: true }).select('slug title category difficulty points').lean();
  const pick = pickDaily(visible, now);
  const nextAt = (Math.floor(now.getTime() / DAY_MS) + 1) * DAY_MS;
  return {
    date: dayKey(now),
    // Cosmetic only: the points of a challenge stay exactly what scoring awards.
    bonusLabel: 'Daily bonus',
    resetsAt: new Date(nextAt).toISOString(),
    challenge: pick && {
      id: String(pick._id), slug: pick.slug, title: pick.title, category: pick.category, difficulty: pick.difficulty, points: pick.points,
    },
  };
}

// Public-safe player profile: display name, team name, counts, badges and recent solves (category only).
// With `asOf` (frozen or ended event view) only solves and badges up to that instant count, so the profile never shows
// activity the frozen scoreboard hides; the counters and the streak come from those rows only.
export async function getProfile(userId, now = new Date(), asOf = null) {
  const user = await User.findById(userId).select('displayName teamId').lean();
  if (!user) { return null; }
  const cut = asOf ? new Date(asOf) : null;
  const [team, solves, awards] = await Promise.all([
    user.teamId ? Team.findById(user.teamId).select('name banned').lean() : null,
    Solve.find({ userId, adjustment: { $ne: true }, ...(cut ? { solvedAt: { $lte: cut } } : {}) })
      .sort({ solvedAt: -1 }).limit(PROFILE_SOLVE_CAP).select('challengeId solvedAt firstBlood').lean(),
    Achievement.find({ userId, ...(cut ? { awardedAt: { $lte: cut } } : {}) }).select('key awardedAt').lean(),
  ]);
  const recent = solves.slice(0, RECENT_SOLVES);
  const rows = recent.length ? await Challenge.find({ _id: { $in: ids(recent, 'challengeId') } }).select('category difficulty').lean() : [];
  const info = new Map(rows.map((row) => [String(row._id), row]));
  const got = new Map(awards.map((award) => [award.key, award.awardedAt]));
  return {
    id: String(userId),
    displayName: user.displayName,
    team: team && !team.banned ? { name: team.name } : null,
    solves: solves.length,
    firstBloods: solves.filter((solve) => solve.firstBlood).length,
    streak: streakInfo(solves.map((solve) => solve.solvedAt), now),
    badges: BADGES.map((badge) => ({
      key: badge.key, name: badge.name, description: badge.description, icon: badge.icon,
      unlocked: got.has(badge.key), awardedAt: got.has(badge.key) ? iso(got.get(badge.key)) : null,
    })),
    recentSolves: recent.map((solve) => ({
      category: info.get(String(solve.challengeId))?.category ?? 'misc',
      difficulty: info.get(String(solve.challengeId))?.difficulty ?? null,
      firstBlood: Boolean(solve.firstBlood),
      solvedAt: iso(solve.solvedAt),
    })),
  };
}
