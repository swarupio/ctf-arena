// Solves, submissions and manual score adjustments for the admin API.
//
// Score = sum of solves.points, so removing a solve document corrects the team's score by itself. What has to be kept
// consistent by hand is challenges.solveCount and the first-blood bonus; deleteSolve does both with atomic operations.
// A manual score adjustment is stored as a Solve-like row (`adjustment: true`, a fresh random challengeId, signed
// points, a reason): leaderboardService and teamScore already sum every solve, so they count it without any change.
import mongoose from 'mongoose';
import { z } from 'zod';
import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';
import Submission from '../models/Submission.js';
import Team from '../models/Team.js';
import TerminalActivity from '../models/TerminalActivity.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import {
  boolText, dateText, envelope, idOf, idString, iso, listQuery, loadMap, skipOf, sortSpec,
} from './adminCommon.js';
import { firstBloodBonus, teamScore } from './scoringService.js';

export const ADJUSTMENT_LIMIT = 10000;
export const adjustmentBody = z.object({
  points: z.number().int().min(-ADJUSTMENT_LIMIT).max(ADJUSTMENT_LIMIT).refine((value) => value !== 0, 'must not be 0'),
  reason: z.string().trim().min(3).max(200),
}).strict();

export const solvesQuery = listQuery(['solvedAt', 'points'], '-solvedAt', {
  teamId: idString.optional(),
  challengeId: idString.optional(),
  userId: idString.optional(),
  // include (default), only (manual adjustments) or exclude
  adjustments: z.enum(['include', 'only', 'exclude']).default('include'),
  from: dateText.optional(),
  to: dateText.optional(),
});

export const submissionsQuery = listQuery(['createdAt'], '-createdAt', {
  teamId: idString.optional(),
  challengeId: idString.optional(),
  userId: idString.optional(),
  result: z.enum(['correct', 'wrong']).optional(),
  from: dateText.optional(),
  to: dateText.optional(),
});

export const deleteSolveQuery = z.object({ reason: z.string().trim().max(200).optional() }).strict();
export const confirmBody = z.object({ confirm: z.literal(true) }).strict();
export const confirmQuery = z.object({ confirm: boolText.refine((value) => value === true, 'must be true') }).strict();

function range(field, query) {
  if (!query.from && !query.to) { return {}; }
  return { [field]: { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) } };
}

async function describe(rows) {
  const [teams, users, challenges] = await Promise.all([
    loadMap(Team, rows.map((row) => row.teamId), 'name'),
    loadMap(User, rows.map((row) => row.userId), 'displayName'),
    loadMap(Challenge, rows.map((row) => row.challengeId), 'slug title'),
  ]);
  const team = (id) => ({ id: idOf(id), name: teams.get(String(id))?.name ?? null });
  const user = (id) => ({ id: idOf(id), displayName: users.get(String(id))?.displayName ?? null });
  const challenge = (id) => ({ id: idOf(id), slug: challenges.get(String(id))?.slug ?? null, title: challenges.get(String(id))?.title ?? null });
  return { team, user, challenge };
}

export function solveFilter(query) {
  const filter = { ...range('solvedAt', query) };
  for (const key of ['teamId', 'challengeId', 'userId']) { if (query[key]) { filter[key] = query[key]; } }
  if (query.adjustments === 'only') { filter.adjustment = true; }
  if (query.adjustments === 'exclude') { filter.adjustment = { $ne: true }; }
  return filter;
}

export async function listSolves(query, { forExport = false } = {}) {
  const filter = solveFilter(query);
  const find = Solve.find(filter).sort(sortSpec(query.sort));
  const [rows, total] = await Promise.all([
    (forExport ? find.limit(query.limit) : find.skip(skipOf(query)).limit(query.limit)).lean(),
    Solve.countDocuments(filter),
  ]);
  const { team, user, challenge } = await describe(rows);
  const items = rows.map((row) => ({
    id: String(row._id),
    solvedAt: iso(row.solvedAt),
    points: row.points,
    firstBlood: Boolean(row.firstBlood),
    adjustment: Boolean(row.adjustment),
    reason: row.reason ?? null,
    team: team(row.teamId),
    user: user(row.userId),
    challenge: row.adjustment ? null : challenge(row.challengeId),
  }));
  return envelope(items, query, total);
}

// Never includes the submitted text or its hash: an admin sees who tried what and when, not what was typed.
export function submissionFilter(query) {
  const filter = { ...range('createdAt', query) };
  for (const key of ['teamId', 'challengeId', 'userId']) { if (query[key]) { filter[key] = query[key]; } }
  if (query.result) { filter.correct = query.result === 'correct'; }
  return filter;
}

export async function listSubmissions(query, { forExport = false } = {}) {
  const filter = submissionFilter(query);
  const find = Submission.find(filter, 'teamId userId challengeId correct createdAt').sort(sortSpec(query.sort));
  const [rows, total] = await Promise.all([
    (forExport ? find.limit(query.limit) : find.skip(skipOf(query)).limit(query.limit)).lean(),
    Submission.countDocuments(filter),
  ]);
  const { team, user, challenge } = await describe(rows);
  const items = rows.map((row) => ({
    id: String(row._id),
    createdAt: iso(row.createdAt),
    correct: Boolean(row.correct),
    team: team(row.teamId),
    user: user(row.userId),
    challenge: challenge(row.challengeId),
  }));
  return envelope(items, query, total);
}

// After the first-blood solve disappeared, the earliest remaining solve inherits the bonus (once, atomically).
async function promoteFirstBlood(challengeId, basePoints) {
  const earliest = await Solve.findOne({ challengeId, adjustment: { $ne: true } }).sort({ solvedAt: 1, _id: 1 }).lean();
  if (!earliest || earliest.firstBlood) { return; }
  await Solve.updateOne(
    { _id: earliest._id, firstBlood: { $ne: true } },
    { $set: { firstBlood: true }, $inc: { points: firstBloodBonus(basePoints) } },
  );
}

// Deletes one solve (or adjustment). Returns what was removed plus the team's new score.
export async function deleteSolve(solveId) {
  // The delete is the atomic claim: of two concurrent calls only one gets the document back.
  const solve = await Solve.findOneAndDelete({ _id: solveId }).lean();
  if (!solve) { throw new AppError(404, 'NOT_FOUND', 'Solve not found.'); }
  if (!solve.adjustment) {
    const challenge = await Challenge.findOneAndUpdate(
      { _id: solve.challengeId, solveCount: { $gt: 0 } }, { $inc: { solveCount: -1 } }, { new: true },
    ).lean();
    if (solve.firstBlood && challenge) { await promoteFirstBlood(solve.challengeId, challenge.points); }
  }
  return { solve, teamScore: await teamScore(solve.teamId) };
}

export async function resetChallengeSolves(challengeId, { clearSubmissions = false } = {}) {
  const solves = await Solve.deleteMany({ challengeId, adjustment: { $ne: true } });
  await Challenge.updateOne({ _id: challengeId }, { $set: { solveCount: 0 } });
  const submissions = clearSubmissions ? await Submission.deleteMany({ challengeId }) : null;
  return { solvesRemoved: solves.deletedCount ?? 0, submissionsRemoved: submissions?.deletedCount ?? 0 };
}

// Terminal progress lives in the team's solves of terminal challenges; a user's progress is the ones that user submitted.
export async function resetUserTerminal(userId) {
  const codes = await Challenge.find({ type: 'terminal' }, '_id').lean();
  const solves = codes.length
    ? await Solve.find({ userId, adjustment: { $ne: true }, challengeId: { $in: codes.map((code) => code._id) } }, '_id').lean()
    : [];
  let removed = 0;
  for (const solve of solves) {
    try {
      await deleteSolve(solve._id);
      removed += 1;
    } catch (error) {
      if (error.status !== 404) { throw error; }
    }
  }
  const activity = await TerminalActivity.deleteMany({ userId });
  return { solvesRemoved: removed, activityRemoved: activity.deletedCount ?? 0 };
}

export async function addAdjustment({ teamId, points, reason, actorId }) {
  const team = await Team.findById(teamId, 'name').lean();
  if (!team) { throw new AppError(404, 'NOT_FOUND', 'Team not found.'); }
  const row = await Solve.create({
    teamId: team._id,
    challengeId: new mongoose.Types.ObjectId(),
    userId: actorId,
    points,
    firstBlood: false,
    adjustment: true,
    reason,
    solvedAt: new Date(),
  });
  return { id: String(row._id), points, reason, teamScore: await teamScore(team._id), teamName: team.name };
}
