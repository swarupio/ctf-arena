// Server side of Forensics Desk (docs/FORENSICS_DESK.md). Nothing is kept between requests: artefacts are generated from
// HMAC(FLAG_SECRET, teamId + trackId), progress comes from MongoDB and the rate limit lives in MongoDB too.
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';
import Submission from '../models/Submission.js';
import { AppError } from '../utils/AppError.js';
import { PREVIEW_TEAM } from '../forensics/core.js';
import {
  CASE_CLOSED, TRACK_IDS, TRACKS, answerFormat, answerOf, makeContext, normalizeAnswer, rightMessage,
  suspectsFor, wrongMessage,
} from '../forensics/tracks.js';
import { consumeAttempt } from './attemptLimiter.js';
import { expectedFlagFor, hashSubmission } from './flagService.js';
import { integrityService } from './integrityService.js';
import { recordSolve } from './scoringService.js';
import { safeEqualText } from '../forensics/core.js';

// Wrong guesses are cheap to try on small answer spaces, so the budget is per team and per stage, in two windows.
export const LIMITS = {
  normal: [{ limit: 8, windowMs: 60_000 }, { limit: 40, windowMs: 3_600_000 }],
  whodunit: [{ limit: 3, windowMs: 60_000 }, { limit: 8, windowMs: 3_600_000 }],
};

export const notSeeded = () => new AppError(503, 'FORENSICS_NOT_SEEDED', 'Run npm run seed:forensics.');

export const teamKey = (team) => (team ? String(team._id) : PREVIEW_TEAM);

// Visible rows of one track, by stage number. A row an admin hid switches that stage off.
export async function loadRows(trackId) {
  const docs = await Challenge.find({ type: 'forensics', 'forensics.track': trackId, visible: true }).lean();
  const known = new Set(TRACKS[trackId].stages.map((stage) => stage.n));
  return new Map(docs.filter((doc) => known.has(doc.forensics?.stage)).map((doc) => [doc.forensics.stage, doc]));
}

export async function loadAllRows() {
  const docs = await Challenge.find({ type: 'forensics', visible: true }).lean();
  const byTrack = new Map(TRACK_IDS.map((id) => [id, new Map()]));
  for (const doc of docs) {
    if (byTrack.has(doc.forensics?.track)) { byTrack.get(doc.forensics.track).set(doc.forensics.stage, doc); }
  }
  return byTrack;
}

export async function teamSolves(team, rows) {
  const list = [...rows.values()];
  if (!team || list.length === 0) { return new Map(); }
  const solves = await Solve.find({ teamId: team._id, challengeId: { $in: list.map((row) => row._id) } }, 'challengeId points').lean();
  const byRow = new Map(solves.map((solve) => [String(solve.challengeId), solve]));
  const result = new Map();
  for (const [n, row] of rows) {
    if (byRow.has(String(row._id))) { result.set(n, byRow.get(String(row._id))); }
  }
  return result;
}

export function summarizeTrack(track, rows, solved) {
  const seeded = rows.size > 0;
  return {
    id: track.id, title: track.title, caseTitle: track.caseTitle, difficulty: track.difficulty, tagline: track.tagline,
    stages: track.stages.length, solved: solved.size, seeded,
    maxPoints: track.maxPoints,
    pointsEarned: [...solved.values()].reduce((total, solve) => total + solve.points, 0),
  };
}

const othersSolved = (track, solved) => track.stages.filter((stage) => !stage.whodunit).every((stage) => solved.has(stage.n));

// Everything the case page needs. Unsolved stages carry no answer, no flag and no suspect fact.
export function trackView({ track, ctx, rows, solved, team }) {
  const unlocked = othersSolved(track, solved);
  const stages = track.stages.map((stage) => {
    const done = solved.has(stage.n);
    const view = {
      n: stage.n, title: stage.title, prompt: stage.prompt, points: stage.points, format: answerFormat(stage),
      hint: stage.hint, whodunit: Boolean(stage.whodunit), solved: done,
      locked: Boolean(stage.whodunit) && !unlocked, available: rows.has(stage.n),
    };
    if (done) {
      view.pointsEarned = solved.get(stage.n).points;
      if (team && rows.has(stage.n)) { view.flag = expectedFlagFor(rows.get(stage.n), { secret: env.FLAG_SECRET, teamId: team._id }); }
    }
    return view;
  });
  const evidence = track.stages.filter((stage) => !stage.whodunit && solved.has(stage.n))
    .map((stage) => ({ n: stage.n, title: stage.title, value: answerOf(ctx, stage.n) }));
  const suspects = suspectsFor(ctx).suspects.map((suspect) => ({
    id: suspect.id, name: suspect.name, role: suspect.role,
    facts: suspect.facts.map((fact) => ({ label: fact.label, stage: fact.stage, value: solved.has(fact.stage) ? fact.value : null })),
  }));
  return {
    id: track.id, title: track.title, caseTitle: track.caseTitle, difficulty: track.difficulty, tagline: track.tagline,
    briefing: [...track.briefing], artefacts: track.artefacts.map((a) => ({ ...a })),
    maxPoints: track.maxPoints, stages, evidence, suspects,
    solved: solved.size, total: track.stages.length,
    pointsEarned: [...solved.values()].reduce((total, solve) => total + solve.points, 0),
    caseClosed: track.stages.every((stage) => solved.has(stage.n)),
  };
}

export async function submitAnswer({ track, rows, team, user, stageNo, answer }) {
  const stage = track.stages.find((s) => s.n === stageNo);
  const row = rows.get(stageNo);
  if (!stage) { throw new AppError(404, 'NOT_FOUND', 'Stage not found.'); }
  if (!row) { throw notSeeded(); }
  const solved = await teamSolves(team, rows);
  const total = track.stages.length;
  const already = (count) => ({
    correct: true, alreadySolved: true, pointsAwarded: 0, firstBlood: false, solved: count, total,
    message: 'Your team already closed this stage.',
  });
  if (solved.has(stageNo)) { return already(solved.size); }
  if (stage.whodunit && !othersSolved(track, solved)) {
    throw new AppError(403, 'STAGE_LOCKED', 'Confirm the evidence of the other stages before naming the culprit.');
  }

  const budgets = stage.whodunit ? LIMITS.whodunit : LIMITS.normal;
  const message = 'Too many attempts on this stage. Take a break and think it over.';
  for (const [index, budget] of budgets.entries()) {
    await consumeAttempt(`forensics:${team._id}:${track.id}:${stageNo}:${index}`, { ...budget, message });
  }

  const ctx = makeContext(track.id, env.FLAG_SECRET, team._id);
  const submitted = normalizeAnswer(stage.kind, answer);
  const correct = safeEqualText(submitted, normalizeAnswer(stage.kind, answerOf(ctx, stageNo)));
  await Submission.create({
    teamId: team._id, userId: user._id, challengeId: row._id, correct, submittedHash: hashSubmission(submitted),
  });
  if (!correct) {
    // A pasted decoy flag (docs/FAIR_PLAY.md) leaves a signal; the reply is identical either way.
    await integrityService.checkSubmittedFlag({ flag: answer, user });
    return { correct: false, pointsAwarded: 0, firstBlood: false, message: wrongMessage(submitted), solved: solved.size, total };
  }
  // Fixed points straight from the definition: a stored row can never raise the documented maximum.
  const solve = await recordSolve({ challenge: { ...row, points: stage.points, type: 'forensics' }, teamId: team._id, userId: user._id });
  if (!solve) { return already(solved.size + 1); }
  const closed = solved.size + 1 === total;
  return {
    correct: true, pointsAwarded: solve.points, firstBlood: false, solved: solved.size + 1, total,
    flag: expectedFlagFor(row, { secret: env.FLAG_SECRET, teamId: team._id }),
    message: closed ? CASE_CLOSED : rightMessage(submitted), caseClosed: closed,
  };
}
