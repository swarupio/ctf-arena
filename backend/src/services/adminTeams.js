// Team management for admins: paginated list, detail with solve timeline, rename, delete (empty teams), member removal,
// invite code regeneration. Scores come from solves (including manual adjustments).
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import Instance, { ACTIVE_STATUSES } from '../models/Instance.js';
import Solve from '../models/Solve.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import {
  boolText, envelope, idOf, iso, listQuery, paginate, searchRegex,
} from './adminCommon.js';
import { deleteSolve, listSolves, solvesQuery } from './adminSolves.js';
import { instanceService as defaultInstances } from './instanceService.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const teamsQuery = listQuery(['name', 'score', 'createdAt', 'members'], '-score', {
  banned: boolText.optional(),
});
export const renameBody = z.object({ name: z.string().trim().min(3).max(24) }).strict();

async function totalsByTeam() {
  const rows = await Solve.aggregate([
    { $group: { _id: '$teamId', score: { $sum: '$points' }, solves: { $sum: { $cond: ['$adjustment', 0, 1] } }, lastSolveAt: { $max: '$solvedAt' } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row]));
}

// Teams are few (hundreds): filter in the database, aggregate scores once, sort and slice here so `score` is sortable.
export async function listTeamsPaged(query) {
  const filter = {};
  if (query.q) { filter.name = searchRegex(query.q); }
  if (query.banned !== undefined) { filter.banned = query.banned ? true : { $ne: true }; }
  const [teams, totals] = await Promise.all([
    Team.find(filter, 'name memberIds banned captainId createdAt').lean(),
    totalsByTeam(),
  ]);
  const rows = teams.map((team) => {
    const total = totals.get(String(team._id));
    return {
      id: String(team._id),
      name: team.name,
      members: team.memberIds?.length ?? 0,
      score: total?.score ?? 0,
      solves: total?.solves ?? 0,
      banned: Boolean(team.banned),
      captainId: idOf(team.captainId),
      createdAt: iso(team.createdAt),
      lastSolveAt: iso(total?.lastSolveAt),
    };
  });
  const field = query.sort.replace(/^-/, '');
  const direction = query.sort.startsWith('-') ? -1 : 1;
  rows.sort((a, b) => {
    const left = a[field];
    const right = b[field];
    const order = left < right ? -1 : left > right ? 1 : 0;
    return (order * direction) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return { rows, response: envelope(paginate(rows, query), query, rows.length) };
}

export async function getTeamDetail(teamId) {
  const team = await Team.findById(teamId, 'name memberIds banned captainId createdAt').lean();
  if (!team) { throw new AppError(404, 'NOT_FOUND', 'Team not found.'); }
  const [members, solves, activeInstances] = await Promise.all([
    User.find({ _id: { $in: team.memberIds ?? [] } }, 'displayName email banned').lean(),
    listSolves(solvesQuery.parse({ teamId: String(team._id), sort: 'solvedAt', limit: '100' })),
    Instance.countDocuments({ teamId: team._id, status: { $in: ACTIVE_STATUSES } }),
  ]);
  const totals = await totalsByTeam();
  const total = totals.get(String(team._id));
  const adjustments = solves.items.filter((item) => item.adjustment).reduce((sum, item) => sum + item.points, 0);
  return {
    id: String(team._id),
    name: team.name,
    banned: Boolean(team.banned),
    createdAt: iso(team.createdAt),
    captainId: idOf(team.captainId),
    score: total?.score ?? 0,
    solves: total?.solves ?? 0,
    adjustmentsTotal: adjustments,
    activeInstances,
    members: members.map((member) => ({
      id: String(member._id),
      displayName: member.displayName,
      email: member.email,
      banned: Boolean(member.banned),
      isCaptain: String(member._id) === String(team.captainId),
    })),
    // Oldest first, at most 100 entries (solves and manual adjustments).
    timeline: solves.items.map(({ team: ignored, ...entry }) => entry),
  };
}

export async function renameTeam(teamId, name) {
  try {
    const before = await Team.findOneAndUpdate({ _id: teamId }, { $set: { name } }, { new: false, runValidators: true, collation: { locale: 'en', strength: 2 } }).lean();
    if (!before) { throw new AppError(404, 'NOT_FOUND', 'Team not found.'); }
    return { id: String(before._id), before: before.name, name };
  } catch (error) {
    if (error.code === 11000) { throw new AppError(409, 'CONFLICT', 'A team with this name already exists.'); }
    throw error;
  }
}

// Removes a member. Idempotent order: leave the team document first, then clear the user, so a repeat finishes the job.
export async function removeMember(teamId, userId) {
  const [team, user] = await Promise.all([
    Team.findById(teamId, 'name memberIds captainId').lean(),
    User.findById(userId, 'displayName teamId').lean(),
  ]);
  if (!team) { throw new AppError(404, 'NOT_FOUND', 'Team not found.'); }
  if (!user) { throw new AppError(404, 'NOT_FOUND', 'User not found.'); }
  const isMember = (team.memberIds ?? []).some((id) => String(id) === String(user._id));
  if (!isMember && String(user.teamId) !== String(team._id)) {
    throw new AppError(409, 'NOT_A_MEMBER', 'This user is not a member of the team.');
  }
  const updated = await Team.findOneAndUpdate({ _id: team._id }, { $pull: { memberIds: user._id } }, { new: true }).lean();
  // Captain left: the longest-standing remaining member takes over.
  let captainId = idOf(updated?.captainId);
  if (updated && String(updated.captainId) === String(user._id) && updated.memberIds.length > 0) {
    await Team.updateOne({ _id: team._id, captainId: user._id }, { $set: { captainId: updated.memberIds[0] } });
    captainId = String(updated.memberIds[0]);
  }
  await User.updateOne({ _id: user._id, teamId: team._id }, { $set: { teamId: null } });
  return { teamId: String(team._id), teamName: team.name, userId: String(user._id), displayName: user.displayName, remaining: updated?.memberIds?.length ?? 0, captainId };
}

export async function regenerateInviteCode(teamId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    try {
      const team = await Team.findOneAndUpdate({ _id: teamId }, { $set: { inviteCode } }, { new: true, runValidators: true }).lean();
      if (!team) { throw new AppError(404, 'NOT_FOUND', 'Team not found.'); }
      return { id: String(team._id), name: team.name, inviteCode };
    } catch (error) {
      if (error.code !== 11000) { throw error; }
    }
  }
  throw new AppError(500, 'SERVER_ERROR', 'Could not generate a unique invite code. Try again.');
}

// Only teams without members can be deleted. Their instances are stopped and their solves removed through deleteSolve
// so every challenge's solveCount and first-blood bonus stay correct.
export async function deleteTeam(teamId, { instances = defaultInstances } = {}) {
  const team = await Team.findById(teamId, 'name memberIds').lean();
  if (!team) { throw new AppError(404, 'NOT_FOUND', 'Team not found.'); }
  if ((team.memberIds ?? []).length > 0) {
    throw new AppError(409, 'TEAM_NOT_EMPTY', 'Remove every member before deleting the team.');
  }
  await instances.stopTeamInstances(team._id);
  const solves = await Solve.find({ teamId: team._id }, '_id').lean();
  for (const solve of solves) {
    try { await deleteSolve(solve._id); } catch (error) { if (error.status !== 404) { throw error; } }
  }
  const deleted = await Team.findOneAndDelete({ _id: team._id, 'memberIds.0': { $exists: false } }).lean();
  if (!deleted) { throw new AppError(409, 'TEAM_NOT_EMPTY', 'Someone joined the team meanwhile.'); }
  return { id: String(team._id), name: team.name, solvesRemoved: solves.length };
}
