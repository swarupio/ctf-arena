import Solve from '../models/Solve.js';
import Team from '../models/Team.js';

export const TIMELINE_TEAMS = 10;

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
function solvedTeams() {
  return Solve.aggregate([
    { $group: { _id: '$teamId', points: { $sum: '$points' }, solves: { $sum: 1 }, lastSolveAt: { $max: '$solvedAt' } } },
    { $sort: { points: -1, lastSolveAt: 1 } },
    { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
    { $unwind: '$team' },
    { $match: { 'team.banned': { $ne: true } } },
    { $project: { points: 1, solves: 1, lastSolveAt: 1, teamName: '$team.name' } },
  ]);
}

// Complete ranking: solved teams first, then every other visible team with 0 points.
// Rank is the position in the list (1-based); ties are broken deterministically.
async function rankTeams() {
  const rows = await solvedTeams();
  const standings = rows.map((row) => ({
    teamId: String(row._id),
    teamName: row.teamName,
    points: row.points,
    solves: row.solves,
    lastSolveAt: row.lastSolveAt ? new Date(row.lastSolveAt).toISOString() : null,
  }));
  const idle = await Team.find({ banned: { $ne: true }, _id: { $nin: rows.map((row) => row._id) } }, 'name');
  for (const team of idle) {
    standings.push({ teamId: String(team._id), teamName: team.name, points: 0, solves: 0, lastSolveAt: null });
  }
  return standings.sort(compareStanding).map((standing, index) => ({ rank: index + 1, ...standing }));
}

export async function getLeaderboard({ limit } = {}) {
  const ranking = await rankTeams();
  return limit ? ranking.slice(0, limit) : ranking;
}

// Cumulative score after each solve for the top teams. Every line starts at 0 at the time of the
// earliest solve shown, so a chart can begin all lines at the same point.
export async function getTimeline({ now = new Date() } = {}) {
  const top = (await rankTeams()).slice(0, TIMELINE_TEAMS);
  const solves = top.length === 0 ? [] : await Solve.find(
    { teamId: { $in: top.map((team) => team.teamId) } }, 'teamId points solvedAt',
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
