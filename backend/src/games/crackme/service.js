// Database side of Crackme Arcade. No state lives in this process: progress comes from Solve, attempts from Submission and
// the Mongo-backed limiter, hints from CrackmeHint, and every cabinet is rebuilt from the secret on each request.
import { env } from '../../config/env.js';
import Challenge from '../../models/Challenge.js';
import CrackmeHint from '../../models/CrackmeHint.js';
import Solve from '../../models/Solve.js';
import Submission from '../../models/Submission.js';
import { consumeAttempt } from '../../services/attemptLimiter.js';
import { hashSubmission } from '../../services/flagService.js';
import { integrityService } from '../../services/integrityService.js';
import { recordSolve } from '../../services/scoringService.js';
import { AppError } from '../../utils/AppError.js';
import {
  ADMIN_PREVIEW_TEAM, buildPuzzle, flagFor, hintTexts, inputAccepted, levelsForDocs, publicPuzzle,
} from './game.js';
import { TRACKS, sumPoints } from './levels.js';

export const ATTEMPT_LIMIT = 8;
export const ATTEMPT_WINDOW_MS = 60_000;
const STREAK_LOOKBACK = 40;

const WRONG = [
  'GAME OVER. The cabinet blinks and asks for another coin.',
  'ACCESS DENIED. The attract screen resumes.',
  'Wrong code. The high score table stays empty.',
  'The cabinet buzzes. Re-read the listing.',
  'Not accepted. Check the registers once more.',
];
const RIGHT = [
  'CREDIT ACCEPTED! The cabinet lights up.',
  'You cracked it. New high score!',
  'Free play unlocked. Nice reversing.',
  'The ROM gives up its secret. Level cleared.',
  'Insert coin: not needed, you are in.',
];
const pickMessage = (list, seedHex) => list[parseInt(seedHex.slice(0, 6), 16) % list.length];

export const notSeeded = () => new AppError(503, 'CRACKME_NOT_SEEDED', 'Run npm run seed:crackme.');

export async function loadGame({ required = true } = {}) {
  const docs = await Challenge.find({ type: 'reversing', visible: true }).lean();
  const entries = levelsForDocs(docs);
  if (required && entries.length === 0) { throw notSeeded(); }
  return entries;
}

export async function teamSolves(team, entries) {
  if (!team || entries.length === 0) { return []; }
  return Solve.find(
    { teamId: team._id, challengeId: { $in: entries.map(({ doc }) => doc._id) } },
    'challengeId points solvedAt',
  ).lean();
}

const entriesOf = (entries, trackId) => entries.filter(({ level }) => level.track === trackId);

// Within a track a cabinet opens when the one before it is solved. Admins preview everything.
function statusOf(entries, solvedIds, admin) {
  const status = new Map();
  for (const track of TRACKS) {
    let previousSolved = true;
    for (const { level, doc } of entriesOf(entries, track.id)) {
      const solved = solvedIds.has(String(doc._id));
      status.set(level.id, solved ? 'solved' : (previousSolved || admin ? 'open' : 'locked'));
      previousSolved = solved;
    }
  }
  return status;
}

// Consecutive correct answers, newest first, counting each level once.
export async function streakOf(team, entries) {
  if (!team || entries.length === 0) { return 0; }
  const levelOf = new Map(entries.map(({ level, doc }) => [String(doc._id), level.id]));
  const rows = await Submission.find({ teamId: team._id, challengeId: { $in: [...levelOf.keys()] } })
    .sort({ createdAt: -1 }).limit(STREAK_LOOKBACK).lean();
  const seen = new Set();
  for (const row of rows) {
    if (!row.correct) { break; }
    seen.add(levelOf.get(String(row.challengeId)));
  }
  return seen.size;
}

export function overviewView({ entries, solves, streak, admin }) {
  const solveByDoc = new Map(solves.map((solve) => [String(solve.challengeId), solve]));
  const solvedIds = new Set(solveByDoc.keys());
  const status = statusOf(entries, solvedIds, admin);
  const tracks = TRACKS.map((track) => {
    const mine = entriesOf(entries, track.id);
    const solved = mine.filter(({ doc }) => solvedIds.has(String(doc._id)));
    return {
      id: track.id,
      title: track.title,
      difficulty: track.difficulty,
      story: track.story,
      hintsAllowed: track.hints,
      total: mine.length,
      solved: solved.length,
      maxPoints: sumPoints(mine.map(({ level }) => level)),
      pointsEarned: sumPoints(solved.map(({ level }) => level)),
      complete: mine.length > 0 && solved.length === mine.length,
      levels: mine.map(({ level, doc }) => ({
        id: level.id,
        n: level.n,
        title: level.title,
        points: level.points,
        boss: Boolean(level.boss),
        status: status.get(level.id),
        solvedAt: solveByDoc.get(String(doc._id))?.solvedAt ?? null,
        hintsTotal: track.hints ? level.hints.length : 0,
      })),
    };
  }).filter((track) => track.total > 0);
  const levels = entries.map(({ level }) => level);
  return {
    maxPoints: sumPoints(levels),
    pointsEarned: sumPoints(entries.filter(({ doc }) => solvedIds.has(String(doc._id))).map(({ level }) => level)),
    solved: solvedIds.size,
    total: entries.length,
    streak,
    tracks,
  };
}

export function findEntry(entries, levelId) {
  const entry = entries.find(({ level }) => level.id === levelId);
  if (!entry) { throw new AppError(404, 'NOT_FOUND', 'Level not found.'); }
  return entry;
}

async function statusFor(entries, entry, team, admin) {
  const solves = await teamSolves(team, entries);
  const status = statusOf(entries, new Set(solves.map((solve) => String(solve.challengeId))), admin);
  return { status: status.get(entry.level.id), solves };
}

function requireOpen(status) {
  if (status === 'locked') { throw new AppError(403, 'LEVEL_LOCKED', 'Clear the previous cabinet of this track first.'); }
}

const teamKey = (team) => (team ? String(team._id) : ADMIN_PREVIEW_TEAM);

export async function puzzleView({ entries, entry, team, admin }) {
  const { level } = entry;
  const { status } = await statusFor(entries, entry, team, admin);
  requireOpen(status);
  const built = buildPuzzle(level, { secret: env.FLAG_SECRET, teamId: teamKey(team) });
  const track = TRACKS.find((item) => item.id === level.track);
  const used = track.hints && team ? await CrackmeHint.countDocuments({ teamId: team._id, levelId: level.id }) : 0;
  const texts = track.hints ? hintTexts(level, built) : [];
  return {
    id: level.id,
    track: level.track,
    n: level.n,
    title: level.title,
    briefing: level.briefing,
    points: level.points,
    boss: Boolean(level.boss),
    status,
    ...publicPuzzle(built),
    hintsAllowed: track.hints,
    hintsTotal: texts.length,
    hints: texts.slice(0, used),
  };
}

export async function openHint({ entries, entry, team, user }) {
  const { level } = entry;
  const track = TRACKS.find((item) => item.id === level.track);
  if (!track.hints) { throw new AppError(403, 'NO_HINTS', 'The Warehouse of Lost ROMs gives no hints.'); }
  const { status } = await statusFor(entries, entry, team, false);
  requireOpen(status);
  const texts = hintTexts(level, buildPuzzle(level, { secret: env.FLAG_SECRET, teamId: teamKey(team) }));
  const index = await CrackmeHint.countDocuments({ teamId: team._id, levelId: level.id });
  if (index >= texts.length) { throw new AppError(409, 'NO_MORE_HINTS', 'No more hints for this level.'); }
  // Idempotent per (team, level, index): a double click or a second replica writes the row once.
  await CrackmeHint.updateOne(
    { teamId: team._id, levelId: level.id, index }, { $setOnInsert: { userId: user._id } }, { upsert: true },
  );
  return { index, hint: texts[index], used: index + 1, total: texts.length };
}

export async function listHintLog(limit = 200) {
  const rows = await CrackmeHint.find({}, 'teamId levelId index createdAt').sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((row) => ({
    teamId: String(row.teamId), levelId: row.levelId, hint: row.index + 1, at: row.createdAt,
  }));
}

export async function submitAnswer({ entries, entry, team, user, answer }) {
  const { level, doc } = entry;
  const { status, solves } = await statusFor(entries, entry, team, false);
  requireOpen(status);
  // Mongo-backed limiter (all replicas): every attempt counts, whatever its outcome.
  await consumeAttempt(`crackme:${team._id}:${level.id}`, {
    limit: ATTEMPT_LIMIT,
    windowMs: ATTEMPT_WINDOW_MS,
    message: 'Too many attempts on this cabinet. Wait a minute and try again.',
  });

  // The verdict is the VM running this team's own program on the input; nothing the client says is trusted.
  const built = buildPuzzle(level, { secret: env.FLAG_SECRET, teamId: team._id });
  const correct = inputAccepted(built, answer);
  const submittedHash = hashSubmission(answer);
  await Submission.create({ teamId: team._id, userId: user._id, challengeId: doc._id, correct, submittedHash });

  if (!correct) {
    // A pasted decoy flag (docs/FAIR_PLAY.md) leaves a signal; the reply is identical either way.
    await integrityService.checkSubmittedFlag({ flag: answer, user });
    return {
      correct: false, pointsAwarded: 0, firstBlood: false, message: pickMessage(WRONG, submittedHash), streak: 0,
    };
  }

  // Points come from the definition, never from the database row, so an edited row cannot raise the maximum.
  const challenge = { ...doc, points: level.points };
  const flag = flagFor(doc, { secret: env.FLAG_SECRET, teamId: team._id });
  const alreadySolved = status === 'solved';
  const solve = alreadySolved ? null : await recordSolve({ challenge, teamId: team._id, userId: user._id });
  const duplicate = alreadySolved || !solve;
  const solvedNow = new Set([...solves.map((row) => String(row.challengeId)), String(doc._id)]);
  const next = entriesOf(entries, level.track).find((item) => !solvedNow.has(String(item.doc._id)));
  return {
    correct: true,
    alreadySolved: duplicate,
    pointsAwarded: duplicate ? 0 : solve.points,
    firstBlood: false,
    flag,
    message: duplicate ? 'Your team already cracked this one.' : pickMessage(RIGHT, submittedHash),
    streak: await streakOf(team, entries),
    trackComplete: !next,
    nextLevelId: next?.level.id ?? null,
  };
}
