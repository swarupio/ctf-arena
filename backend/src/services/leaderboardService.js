import Solve from '../models/Solve.js';
import Team from '../models/Team.js';

export const TIMELINE_TEAMS = 10;

// Short-lived in-process memo of the full ranking, one entry per view: the live ranking, and (only while an event's
// scoreboard is frozen) the ranking at the freeze time. The key includes the cutoff, so live data can never be served
// to a request that asked for the frozen view, or the other way round. Entries are pruned on insert (bounded size). Every replica recomputes at
// most once per TTL, so the answer is at most TTL old on any replica (the contract allows a few seconds of lag).
// Concurrent callers share one in-flight computation. It holds only public data (team names, points), never per-user data.
// Disabled under NODE_ENV=test unless a test calls configureRankingCache.
let cacheTtlMs = process.env.NODE_ENV === 'test' ? 0 : 5000;
const cached = new Map();
export function configureRankingCache({ ttlMs }) { cacheTtlMs = ttlMs; cached.clear(); }
const MAX_CACHED_VIEWS = 4;
const viewKey = (asOf) => (asOf ? `asOf:${new Date(asOf).getTime()}` : 'live');

// Manual score adjustments (Solve rows with adjustment: true) add to points but are not solves.
const REAL_SOLVE_COUNT = { $sum: { $cond: [{ $eq: ['$adjustment', true] }, 0, 1] } };

const time = (value) => new Date(value).getTime();
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Points desc, then the team that reached its score first, then team name, then id.
// Every remaining tie is broken so the order is identical on every replica and every poll.
export function compareStanding(a, b) {
  if (a.points !== b.points) { return b.points - a.points; }
  const aTime = a.lastSolveAt ? time(a.lastSolveAt) : Infinity;
  const bTime = b.lastSolveAt ? time(b.lastSolveAt) : Infinity;
  if (aTime !== bTime) { return aTime < bTime ? -1 : 1; }
  const byName = a.teamName.localeCompare(b.teamName, 'en', { sensitivity: 'base' });
  return byName || compareText(a.teamId, b.teamId);
}

// Teams with solves, aggregated as in DATABASE_SCHEMA.md "Leaderboard query".
// $project keeps only the team name, so invite codes and member lists never leave the database layer.
// `asOf` (a Date) keeps only solves at or before that instant: the frozen scoreboard of an event.
function solvedTeams(asOf) {
  return Solve.aggregate([
    ...(asOf ? [{ $match: { solvedAt: { $lte: new Date(asOf) } } }] : []),
    { $group: { _id: '$teamId', points: { $sum: '$points' }, solves: REAL_SOLVE_COUNT, lastSolveAt: { $max: '$solvedAt' } } },
    { $sort: { points: -1, lastSolveAt: 1 } },
    { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
    { $unwind: '$team' },
    { $match: { 'team.banned': { $ne: true } } },
    { $project: { points: 1, solves: 1, lastSolveAt: 1, teamName: '$team.name' } },
  ]);
}

// Complete ranking: solved teams first, then every other visible team with 0 points.
// Rank is the position in the list (1-based); ties are broken deterministically.
async function computeRanking(asOf) {
  // The idle teams do not depend on the aggregation (teams that solved something are removed here), so both reads run at once.
  const [rows, visibleTeams] = await Promise.all([solvedTeams(asOf), Team.find({ banned: { $ne: true } }, 'name', { lean: true })]);
  const standings = rows.map((row) => ({
    teamId: String(row._id),
    teamName: row.teamName,
    points: row.points,
    solves: row.solves,
    lastSolveAt: row.lastSolveAt ? new Date(row.lastSolveAt).toISOString() : null,
  }));
  const solvedIds = new Set(rows.map((row) => String(row._id)));
  for (const team of visibleTeams) {
    if (solvedIds.has(String(team._id))) { continue; }
    standings.push({ teamId: String(team._id), teamName: team.name, points: 0, solves: 0, lastSolveAt: null });
  }
  return standings.sort(compareStanding).map((standing, index) => ({ rank: index + 1, ...standing }));
}

async function rankTeams(asOf = null) {
  if (cacheTtlMs <= 0) { return computeRanking(asOf); }
  const key = viewKey(asOf);
  const hit = cached.get(key);
  if (hit && hit.expires > Date.now()) { return hit.promise; }
  for (const [other, entry] of cached) { if (entry.expires <= Date.now()) { cached.delete(other); } }
  while (cached.size >= MAX_CACHED_VIEWS) { cached.delete(cached.keys().next().value); }
  const entry = { expires: Date.now() + cacheTtlMs, promise: null };
  entry.promise = computeRanking(asOf).catch((error) => {
    if (cached.get(key) === entry) { cached.delete(key); }
    throw error;
  });
  cached.set(key, entry);
  return entry.promise;
}

export async function getLeaderboard({ limit, asOf = null } = {}) {
  const ranking = await rankTeams(asOf);
  return limit ? ranking.slice(0, limit) : ranking;
}

// One team's own live totals (used by the frozen scoreboard so a team still sees its own score). Never ranks it:
// a live rank would reveal how other teams are doing. Not cached: one indexed aggregation for one team.
export async function getTeamScore(teamId) {
  const [row] = await Solve.aggregate([
    { $match: { teamId } },
    { $group: { _id: '$teamId', points: { $sum: '$points' }, solves: REAL_SOLVE_COUNT } },
  ]);
  return { points: row?.points ?? 0, solves: row?.solves ?? 0 };
}

// Cumulative score after each solve for the top teams. Every line starts at 0 at the time of the
// earliest solve shown, so a chart can begin all lines at the same point.
// With `asOf` (frozen scoreboard) the top teams and every line only use solves at or before that instant.
export async function getTimeline({ now = new Date(), asOf = null } = {}) {
  const top = (await rankTeams(asOf)).slice(0, TIMELINE_TEAMS);
  const solves = top.length === 0 ? [] : await Solve.find(
    { teamId: { $in: top.map((team) => team.teamId) }, ...(asOf ? { solvedAt: { $lte: new Date(asOf) } } : {}) },
    'teamId points solvedAt', { lean: true },
  ).sort({ solvedAt: 1, _id: 1 });

  const start = new Date(solves.length ? solves[0].solvedAt : now).toISOString();
  const lines = new Map(top.map((team) => [team.teamId, { score: 0, points: [{ t: start, score: 0 }] }]));
  for (const solve of solves) {
    const line = lines.get(String(solve.teamId));
    if (!line) { continue; }
    line.score += solve.points;
    line.points.push({ t: new Date(solve.solvedAt).toISOString(), score: line.score });
  }
  return {
    teams: top.map((team) => ({ teamId: team.teamId, teamName: team.teamName, points: lines.get(team.teamId).points })),
  };
}
