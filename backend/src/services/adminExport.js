// CSV exports (users, teams, submissions, leaderboard). Capped at EXPORT_CAP rows so one request stays small enough for a
// serverless function; every cell goes through csvCell (formula-injection safe). No flags, hashes or invite codes.
import { toCsv } from './adminCommon.js';
import { listSubmissions } from './adminSolves.js';
import { listTeamsPaged } from './adminTeams.js';
import { listUsers } from './adminUsers.js';
import { getLeaderboard } from './leaderboardService.js';

export const EXPORT_CAP = 10000;
const capped = (query) => ({ ...query, page: 1, limit: EXPORT_CAP });

export async function usersCsv(query) {
  const { items } = await listUsers(capped(query), { forExport: true });
  return toCsv(
    ['id', 'displayName', 'email', 'role', 'banned', 'teamId', 'teamName', 'createdAt'],
    items.map((user) => [user.id, user.displayName, user.email, user.role, user.banned, user.team?.id, user.team?.name, user.createdAt]),
  );
}

export async function teamsCsv(query) {
  const { rows } = await listTeamsPaged(query);
  return toCsv(
    ['id', 'name', 'members', 'score', 'solves', 'banned', 'createdAt', 'lastSolveAt'],
    rows.slice(0, EXPORT_CAP).map((team) => [team.id, team.name, team.members, team.score, team.solves, team.banned, team.createdAt, team.lastSolveAt]),
  );
}

export async function submissionsCsv(query) {
  const { items } = await listSubmissions(capped(query), { forExport: true });
  return toCsv(
    ['id', 'createdAt', 'correct', 'teamId', 'teamName', 'userId', 'userName', 'challengeId', 'challengeSlug'],
    items.map((row) => [row.id, row.createdAt, row.correct, row.team.id, row.team.name, row.user.id, row.user.displayName, row.challenge.id, row.challenge.slug]),
  );
}

export async function leaderboardCsv() {
  const ranking = await getLeaderboard({ limit: EXPORT_CAP });
  return toCsv(
    ['rank', 'teamId', 'teamName', 'points', 'solves', 'lastSolveAt'],
    ranking.map((row) => [row.rank, row.teamId, row.teamName, row.points, row.solves, row.lastSolveAt]),
  );
}
