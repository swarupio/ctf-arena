// Server side of OSINT Trail (docs/OSINT_TRAIL.md). Nothing is kept between requests: the world is generated from
// HMAC(FLAG_SECRET, 'osint:' + teamId + ':' + caseId), progress comes from MongoDB and the attempt limit lives in MongoDB too.
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import OsintHint from '../models/OsintHint.js';
import Solve from '../models/Solve.js';
import Submission from '../models/Submission.js';
import { AppError } from '../utils/AppError.js';
import {
  CASE_CLOSED, TRACKS, TRACK_IDS, answerFormat, answerMatches, buildCase, rightMessage, wrongMessage,
} from '../osint/cases.js';
import { sourceCounts } from '../osint/sources.js';
import { chainProgress } from '../osint/board.js';
import { PREVIEW_TEAM } from '../osint/world.js';
import { getHintCosts } from './adminSettings.js';
import { consumeAttempt } from './attemptLimiter.js';
import { boardUnlocked } from './osintBoardService.js';
import { expectedFlagFor, hashSubmission } from './flagService.js';
import { costOf, firstN, percentOf, pricingFor, spentView } from './hintCost.js';
import { integrityService } from './integrityService.js';
import { recordSolve } from './scoringService.js';

// Wrong guesses are cheap on small answer spaces (a cast of a dozen names), so the budget is per team and per question.
export const LIMITS = {
  normal: [{ limit: 8, windowMs: 60_000 }, { limit: 40, windowMs: 3_600_000 }],
  final: [{ limit: 3, windowMs: 60_000 }, { limit: 8, windowMs: 3_600_000 }],
};

export const notSeeded = () => new AppError(503, 'OSINT_NOT_SEEDED', 'Run npm run seed:osint.');
export const teamKey = (team) => (team ? String(team._id) : PREVIEW_TEAM);

export async function loadRows(trackId) {
  const docs = await Challenge.find({ type: 'osint', 'osint.track': trackId, visible: true }).lean();
  const known = new Set(TRACKS[trackId].stages.map((stage) => stage.n));
  return new Map(docs.filter((doc) => known.has(doc.osint?.stage)).map((doc) => [doc.osint.stage, doc]));
}

export async function loadAllRows() {
  const docs = await Challenge.find({ type: 'osint', visible: true }).lean();
  const byTrack = new Map(TRACK_IDS.map((id) => [id, new Map()]));
  for (const doc of docs) {
    if (byTrack.has(doc.osint?.track)) { byTrack.get(doc.osint.track).set(doc.osint.stage, doc); }
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

// One read for every track (the picker lists them all): Map of track id -> Map(stage -> solve). Replaces one read per track.
export async function teamSolvesByTrack(team, byTrack) {
  const result = new Map([...byTrack.keys()].map((id) => [id, new Map()]));
  const all = [...byTrack.values()].flatMap((rows) => [...rows.values()]);
  if (!team || all.length === 0) { return result; }
  const solves = await Solve.find({ teamId: team._id, challengeId: { $in: all.map((row) => row._id) } }, 'challengeId points').lean();
  const byRow = new Map(solves.map((solve) => [String(solve.challengeId), solve]));
  for (const [id, rows] of byTrack) {
    for (const [n, row] of rows) {
      if (byRow.has(String(row._id))) { result.get(id).set(n, byRow.get(String(row._id))); }
    }
  }
  return result;
}

const earned = (solved) => [...solved.values()].reduce((total, solve) => total + solve.points, 0);
const othersSolved = (track, solved) => track.stages.filter((stage) => !stage.final).every((stage) => solved.has(stage.n));

// The final question opens when the other questions are solved AND the team's board has held the hidden chain.
export const BOARD_LOCKED_MESSAGE = 'Pin the evidence and connect a valid chain on the case board before the final question.';
async function assertFinalOpen({ track, team, solved, others = 'Answer the other questions of this case before the final one.' }) {
  if (!othersSolved(track, solved)) { throw new AppError(403, 'STAGE_LOCKED', others); }
  if (!(await boardUnlocked(team, track.id))) { throw new AppError(403, 'BOARD_LOCKED', BOARD_LOCKED_MESSAGE); }
}

export function summarizeTrack(track, rows, solved) {
  return {
    id: track.id, title: track.title, caseTitle: track.caseTitle, difficulty: track.difficulty, tagline: track.tagline,
    questions: track.stages.length, solved: solved.size, seeded: rows.size > 0, hints: track.hintsAllowed,
    maxPoints: track.maxPoints, pointsEarned: earned(solved),
  };
}

const hintKey = (track, n) => `${track.id}:${n}`;

async function openedHints(team, track) {
  if (!team || !track.hintsAllowed) { return new Map(); }
  const rows = await OsintHint.find({ teamId: team._id, key: { $in: track.stages.map((s) => hintKey(track, s.n)) } }, 'key index').lean();
  const used = new Map();
  for (const row of rows) { used.set(row.key, (used.get(row.key) ?? 0) + 1); }
  return used;
}

// Everything the case page needs. Unsolved questions carry no answer and no flag; hints only as far as the team opened them.
export async function caseView({ track, rows, solved, team }) {
  const { world, pub, ans, chain } = buildCase(env.FLAG_SECRET, teamKey(team), track.id);
  const boardOpen = await boardUnlocked(team, track.id);
  const questionsDone = othersSolved(track, solved);
  const unlocked = questionsDone && boardOpen;
  const used = await openedHints(team, track);
  // Prices of the hints still closed (no text) and the spend so far; players only.
  const costs = team && track.hintsAllowed ? await getHintCosts() : null;
  const questions = track.stages.map((stage) => {
    const done = solved.has(stage.n);
    const opened = used.get(hintKey(track, stage.n)) ?? 0;
    const view = {
      n: stage.n, title: stage.title, prompt: stage.prompt(pub), points: stage.points, format: answerFormat(stage), kind: stage.kind,
      final: stage.final, solved: done, locked: stage.final && !unlocked, available: rows.has(stage.n),
      ...(stage.final && !unlocked && !done ? { lockedBy: questionsDone ? 'board' : 'questions' } : {}),
      hintsTotal: track.hintsAllowed ? stage.hints.length : 0,
      hints: track.hintsAllowed ? stage.hints.slice(0, opened) : [],
      ...(costs ? { hintPricing: pricingFor(stage.points, stage.hints.length, opened, costs), hintSpent: spentView(stage.points, firstN(opened), costs) } : {}),
    };
    if (done) {
      view.pointsEarned = solved.get(stage.n).points;
      view.confirmed = ans[stage.n];
      if (team && rows.has(stage.n)) { view.flag = expectedFlagFor(rows.get(stage.n), { secret: env.FLAG_SECRET, teamId: team._id }); }
    }
    return view;
  });
  return {
    id: track.id, title: track.title, caseTitle: track.caseTitle, difficulty: track.difficulty, tagline: track.tagline,
    story: track.story(pub), hintsAllowed: track.hintsAllowed, maxPoints: track.maxPoints, questions,
    sources: sourceCounts(world).map(({ id, label, total, max, fallback }) => ({ id, label, total, max, fallback })),
    town: world.meta.town, company: world.meta.company.name,
    solved: solved.size, total: track.stages.length, pointsEarned: earned(solved),
    caseClosed: track.stages.every((stage) => solved.has(stage.n)),
    board: { required: chainProgress(chain, []).total, unlocked: boardOpen },
  };
}

export async function submitAnswer({ track, rows, team, user, stageNo, answer }) {
  const stage = track.stages.find((s) => s.n === stageNo);
  const row = rows.get(stageNo);
  if (!stage) { throw new AppError(404, 'NOT_FOUND', 'Question not found.'); }
  if (!row) { throw notSeeded(); }
  const solved = await teamSolves(team, rows);
  const total = track.stages.length;
  const already = (count) => ({
    correct: true, alreadySolved: true, pointsAwarded: 0, firstBlood: false, solved: count, total,
    message: 'Your team already closed this question.',
  });
  if (solved.has(stageNo)) { return already(solved.size); }
  if (stage.final) { await assertFinalOpen({ track, team, solved }); }

  const budgets = stage.final ? LIMITS.final : LIMITS.normal;
  const message = 'Too many attempts on this question. Take a break and think it over.';
  for (const [index, budget] of budgets.entries()) {
    await consumeAttempt(`osint:${team._id}:${track.id}:${stageNo}:${index}`, { ...budget, message });
  }

  const { ans } = buildCase(env.FLAG_SECRET, team._id, track.id);
  const correct = answerMatches(stage.kind, answer, ans[stageNo]);
  const submittedHash = hashSubmission(answer);
  await Submission.create({ teamId: team._id, userId: user._id, challengeId: row._id, correct, submittedHash });
  if (!correct) {
    // A pasted decoy flag (docs/FAIR_PLAY.md) leaves a signal; the reply is identical either way.
    await integrityService.checkSubmittedFlag({ flag: answer, user });
    return { correct: false, pointsAwarded: 0, firstBlood: false, message: wrongMessage(submittedHash), solved: solved.size, total };
  }
  // Fixed points straight from the definition: a stored row can never raise the documented maximum.
  const solve = await recordSolve({ challenge: { ...row, points: stage.points, type: 'osint' }, teamId: team._id, userId: user._id, hint: { scope: 'osint', key: hintKey(track, stageNo) } });
  if (!solve) { return already(solved.size + 1); }
  const closed = solved.size + 1 === total;
  return {
    correct: true, pointsAwarded: solve.points, ...(solve.hintCost ? { hintCost: solve.hintCost } : {}), firstBlood: false, solved: solved.size + 1, total,
    flag: expectedFlagFor(row, { secret: env.FLAG_SECRET, teamId: team._id }),
    message: closed ? CASE_CLOSED : rightMessage(submittedHash), caseClosed: closed,
  };
}

export async function openHint({ track, rows, team, user, stageNo }) {
  const stage = track.stages.find((s) => s.n === stageNo);
  if (!stage) { throw new AppError(404, 'NOT_FOUND', 'Question not found.'); }
  if (!track.hintsAllowed) { throw new AppError(403, 'NO_HINTS', 'This case gives no hints.'); }
  if (!rows.has(stageNo)) { throw notSeeded(); }
  const solved = await teamSolves(team, rows);
  if (solved.has(stageNo)) { throw new AppError(409, 'NO_MORE_HINTS', 'This question is already solved.'); }
  if (stage.final) { await assertFinalOpen({ track, team, solved, others: 'Answer the other questions of this case first.' }); }
  const key = hintKey(track, stageNo);
  const index = await OsintHint.countDocuments({ teamId: team._id, key });
  if (index >= stage.hints.length) { throw new AppError(409, 'NO_MORE_HINTS', 'No more hints for this question.'); }
  // Idempotent per (team, question, index): a double click or a second replica writes the row once.
  // The price is fixed now and stored on the row (docs/HINTS.md "Hint costs"): a later settings change does not touch it.
  const costs = await getHintCosts();
  await OsintHint.updateOne(
    { teamId: team._id, key, index },
    { $setOnInsert: { userId: user._id, percent: percentOf(index, costs), capPercent: costs.enabled ? costs.maxPercent : 0 } },
    { upsert: true },
  );
  return {
    index, hint: stage.hints[index], used: index + 1, total: stage.hints.length,
    cost: costOf(stage.points, index, costs), spent: spentView(stage.points, firstN(index + 1), costs),
  };
}

export async function listHintLog(limit = 200) {
  const rows = await OsintHint.find({}, 'teamId key index createdAt').sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((row) => ({ teamId: String(row.teamId), key: row.key, hint: row.index + 1, at: row.createdAt }));
}
