// User management for admins. Roles are NOT managed here: they come from Cognito groups (the `admin` group) and are
// refreshed from the verified token; changing them is done in AWS, never through this API.
import { z } from 'zod';
import Challenge from '../models/Challenge.js';
import CheatSignal from '../models/CheatSignal.js';
import Solve from '../models/Solve.js';
import Team from '../models/Team.js';
import TerminalActivity from '../models/TerminalActivity.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import {
  boolText, envelope, idOf, iso, listQuery, loadMap, searchRegex, skipOf, sortSpec,
} from './adminCommon.js';
import { listSolves, listSubmissions, solvesQuery, submissionsQuery } from './adminSolves.js';

export const usersQuery = listQuery(['createdAt', 'displayName', 'email'], '-createdAt', {
  role: z.enum(['player', 'admin']).optional(),
  banned: boolText.optional(),
  hasTeam: boolText.optional(),
});
export const banBody = z.object({ banned: z.boolean(), reason: z.string().trim().max(200).optional() }).strict();

// Emails are returned here on purpose (admins need them for support); never flags, hashes or invite codes.
export const userSummary = (user, team) => ({
  id: String(user._id),
  displayName: user.displayName,
  email: user.email,
  role: user.role,
  banned: Boolean(user.banned),
  team: user.teamId ? { id: String(user.teamId), name: team?.name ?? null } : null,
  createdAt: iso(user.createdAt),
});

export function userFilter(query) {
  const filter = {};
  if (query.q) { filter.$or = [{ displayName: searchRegex(query.q) }, { email: searchRegex(query.q) }]; }
  if (query.role) { filter.role = query.role; }
  if (query.banned !== undefined) { filter.banned = query.banned ? true : { $ne: true }; }
  if (query.hasTeam !== undefined) { filter.teamId = query.hasTeam ? { $ne: null } : null; }
  return filter;
}

export async function listUsers(query, { forExport = false } = {}) {
  const filter = userFilter(query);
  const find = User.find(filter, 'displayName email role banned teamId createdAt').sort(sortSpec(query.sort));
  const [rows, total] = await Promise.all([
    (forExport ? find.limit(query.limit) : find.skip(skipOf(query)).limit(query.limit)).lean(),
    User.countDocuments(filter),
  ]);
  const teams = await loadMap(Team, rows.map((row) => row.teamId), 'name');
  return envelope(rows.map((row) => userSummary(row, teams.get(String(row.teamId)))), query, total);
}

async function terminalSummary(userId) {
  const codes = await Challenge.find({ type: 'terminal' }, 'terminal').lean();
  const modeOf = new Map(codes.map((code) => [String(code._id), code.terminal?.mode]));
  const [solves, activity] = await Promise.all([
    codes.length ? Solve.find({ userId, adjustment: { $ne: true }, challengeId: { $in: codes.map((code) => code._id) } }, 'challengeId points').lean() : [],
    TerminalActivity.aggregate([
      { $match: { userId } },
      { $group: { _id: null, commands: { $sum: '$count' }, lastCommandAt: { $max: '$lastAt' } } },
    ]),
  ]);
  const byMode = {};
  for (const solve of solves) {
    const mode = modeOf.get(String(solve.challengeId)) ?? 'unknown';
    byMode[mode] = (byMode[mode] ?? 0) + 1;
  }
  return {
    codesSolved: solves.length,
    points: solves.reduce((sum, solve) => sum + solve.points, 0),
    solvedByMode: byMode,
    // Pacing documents live for 2 days (TerminalActivity TTL), so this covers the last 48 hours only.
    commandsLast48h: activity[0]?.commands ?? 0,
    lastCommandAt: iso(activity[0]?.lastCommandAt),
  };
}

async function integritySummary(userId) {
  const [row] = await CheatSignal.aggregate([
    { $match: { userId } },
    { $group: { _id: null, signals: { $sum: 1 }, events: { $sum: '$count' }, maxSeverity: { $max: '$severity' }, lastAt: { $max: '$lastAt' } } },
  ]);
  return { signals: row?.signals ?? 0, events: row?.events ?? 0, maxSeverity: row?.maxSeverity ?? 0, lastAt: iso(row?.lastAt) };
}

export async function getUserDetail(userId) {
  const user = await User.findById(userId, 'displayName email role banned teamId createdAt').lean();
  if (!user) { throw new AppError(404, 'NOT_FOUND', 'User not found.'); }
  const team = user.teamId ? await Team.findById(user.teamId, 'name banned').lean() : null;
  const [solves, submissions, terminal, integrity] = await Promise.all([
    listSolves(solvesQuery.parse({ userId: String(user._id), limit: '20' })),
    listSubmissions(submissionsQuery.parse({ userId: String(user._id), limit: '20' })),
    terminalSummary(user._id),
    integritySummary(user._id),
  ]);
  return {
    ...userSummary(user, team),
    team: team ? { id: String(team._id), name: team.name, banned: Boolean(team.banned) } : (user.teamId ? { id: idOf(user.teamId), name: null, banned: false } : null),
    recentSolves: solves.items.map(({ user: ignored, ...entry }) => entry),
    solveCount: solves.total,
    recentSubmissions: submissions.items.map(({ user: ignored, ...entry }) => entry),
    submissionCount: submissions.total,
    terminal,
    integrity,
  };
}

export async function setUserBanned(userId, banned) {
  const existing = await User.findById(userId, 'displayName role banned').lean();
  if (!existing) { throw new AppError(404, 'NOT_FOUND', 'User not found.'); }
  if (existing.role === 'admin') { throw new AppError(409, 'CANNOT_BAN_ADMIN', 'Administrators cannot be banned.'); }
  await User.updateOne({ _id: existing._id }, { $set: { banned } });
  return { id: String(existing._id), displayName: existing.displayName, before: Boolean(existing.banned), banned };
}
