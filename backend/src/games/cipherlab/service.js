// Database side of Cipher Lab. No state lives in this process: progress comes from Solve, attempts from Submission and
// the Mongo-backed limiter, hints from CipherHint, and every puzzle is recomputed from the secret on each request.
import { env } from '../../config/env.js';
import Challenge from '../../models/Challenge.js';
import CipherHint from '../../models/CipherHint.js';
import Solve from '../../models/Solve.js';
import Submission from '../../models/Submission.js';
import { achievementService } from '../../services/achievementService.js';
import { consumeAttempt } from '../../services/attemptLimiter.js';
import { getHintCosts } from '../../services/adminSettings.js';
import { hashSubmission } from '../../services/flagService.js';
import { costOf, firstN, percentOf, pricingFor, spentView } from '../../services/hintCost.js';
import { integrityService } from '../../services/integrityService.js';
import { recordSolve } from '../../services/scoringService.js';
import { AppError } from '../../utils/AppError.js';
import {
  ADMIN_PREVIEW_TEAM, answerMatches, buildPuzzle, flagFor, hintTexts, levelsForDocs, publicPuzzle,
} from './game.js';
import { TOOLS, TRACKS, sumPoints } from './levels.js';

export const ATTEMPT_LIMIT = 8;
export const ATTEMPT_WINDOW_MS = 60_000;
const STREAK_LOOKBACK = 40;

const WRONG = [
  'Static on the line. That is not it, agent.',
  'The cipher shrugs. Try another angle.',
  'Close enough for a rookie, wrong enough for the Chamber.',
  'Your decoder ring needs a battery. Try again.',
  'Not quite. Even Caesar had bad days.',
  'Access denied. The vault is unimpressed.',
];
const RIGHT = [
  'Decoded! The agency salutes you.',
  'Crack! That cipher never stood a chance.',
  'Clean break. Your streak glows.',
  'Message received, understood and framed.',
  'Another lock falls. Keep going, codebreaker.',
];
const pickMessage = (list, seedHex) => list[parseInt(seedHex.slice(0, 6), 16) % list.length];

export const notSeeded = () => new AppError(503, 'CIPHERLAB_NOT_SEEDED', 'Run npm run seed:cipherlab.');

export async function loadGame({ required = true } = {}) {
  const docs = await Challenge.find({ type: 'game', visible: true }).lean();
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

// Within a track a level opens when the one before it is solved. Admins preview everything.
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

export function speedrunOf(track, trackEntries, solveByDoc) {
  if (trackEntries.length === 0 || !trackEntries.every(({ doc }) => solveByDoc.has(String(doc._id)))) { return null; }
  const times = trackEntries.map(({ doc }) => new Date(solveByDoc.get(String(doc._id)).solvedAt).getTime());
  const ms = Math.max(...times) - Math.min(...times);
  const [gold, silver, bronze] = track.speedrun;
  let badge = null;
  if (ms <= gold) { badge = 'gold'; } else if (ms <= silver) { badge = 'silver'; } else if (ms <= bronze) { badge = 'bronze'; }
  return { ms, badge };
}

// Consecutive correct answers, newest first, counting each level once. Attempts made after a level was already solved
// (resubmissions to read the flag again) are ignored: they neither extend nor break the streak.
// `knownSolves` (rows or a promise of them) spares the second read of the team's solves when the caller already has them.
export async function streakOf(team, entries, knownSolves) {
  if (!team || entries.length === 0) { return 0; }
  const levelOf = new Map(entries.map(({ level, doc }) => [String(doc._id), level.id]));
  const [rows, solves] = await Promise.all([
    Submission.find({ teamId: team._id, challengeId: { $in: [...levelOf.keys()] } })
      .sort({ createdAt: -1 }).limit(STREAK_LOOKBACK).lean(),
    knownSolves ?? teamSolves(team, entries),
  ]);
  const solvedAt = new Map(solves.map((solve) => [String(solve.challengeId), new Date(solve.solvedAt).getTime()]));
  const seen = new Set();
  for (const row of rows) {
    const key = String(row.challengeId);
    const solvedTime = solvedAt.get(key);
    // The first correct answer is stored just before its Solve row, so a later row belongs to a resubmission.
    if (solvedTime !== undefined && row.createdAt && new Date(row.createdAt).getTime() > solvedTime) { continue; }
    if (!row.correct) { break; }
    seen.add(levelOf.get(key));
  }
  return seen.size;
}

const unlockedTools = (entries, solvedIds, admin) => {
  const solvedLevels = new Set(entries.filter(({ doc }) => solvedIds.has(String(doc._id))).map(({ level }) => level.id));
  // Admins preview everything, so every tool is open for them.
  return TOOLS.map((tool) => ({ ...tool, unlocked: admin || tool.unlockedBy === null || solvedLevels.has(tool.unlockedBy) }));
};

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
      speedrun: speedrunOf(track, mine, solveByDoc),
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
    toolbox: unlockedTools(entries, solvedIds, admin),
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
  if (status === 'locked') { throw new AppError(403, 'LEVEL_LOCKED', 'Clear the previous level of this track first.'); }
}

const teamKey = (team) => (team ? String(team._id) : ADMIN_PREVIEW_TEAM);

export async function puzzleView({ entries, entry, team, admin }) {
  const { level } = entry;
  const { status } = await statusFor(entries, entry, team, admin);
  requireOpen(status);
  const built = buildPuzzle(level, { secret: env.FLAG_SECRET, teamId: teamKey(team) });
  const track = TRACKS.find((item) => item.id === level.track);
  const used = track.hints && team ? await CipherHint.countDocuments({ teamId: team._id, levelId: level.id }) : 0;
  const texts = track.hints ? hintTexts(level, built) : [];
  // Prices of the hints still closed (no text) and the spend so far; players only (admin preview is free).
  const costs = track.hints && team ? await getHintCosts() : null;
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
    // Admin preview reads every hint; nothing is logged for them (they have no team).
    hints: admin ? texts : texts.slice(0, used),
    ...(costs ? { hintPricing: pricingFor(level.points, texts.length, used, costs), hintSpent: spentView(level.points, firstN(used), costs) } : {}),
  };
}

export async function openHint({ entries, entry, team, user, admin = false }) {
  const { level } = entry;
  const track = TRACKS.find((item) => item.id === level.track);
  if (!track.hints) { throw new AppError(403, 'NO_HINTS', 'The Black Chamber gives no hints.'); }
  if (admin) {
    // Preview only: reveal every hint of the admin-preview puzzle and write no CipherHint row.
    const texts = hintTexts(level, buildPuzzle(level, { secret: env.FLAG_SECRET, teamId: ADMIN_PREVIEW_TEAM }));
    return { index: texts.length - 1, hint: texts[texts.length - 1], used: texts.length, total: texts.length, hints: texts };
  }
  const { status } = await statusFor(entries, entry, team, false);
  requireOpen(status);
  const texts = hintTexts(level, buildPuzzle(level, { secret: env.FLAG_SECRET, teamId: teamKey(team) }));
  const index = await CipherHint.countDocuments({ teamId: team._id, levelId: level.id });
  if (index >= texts.length) { throw new AppError(409, 'NO_MORE_HINTS', 'No more hints for this level.'); }
  // Idempotent per (team, level, index): a double click or a second replica writes the row once.
  // The price is fixed now and stored on the row (docs/HINTS.md "Hint costs"): a later settings change does not touch it.
  const costs = await getHintCosts();
  await CipherHint.updateOne(
    { teamId: team._id, levelId: level.id, index },
    { $setOnInsert: { userId: user._id, percent: percentOf(index, costs), capPercent: costs.enabled ? costs.maxPercent : 0 } },
    { upsert: true },
  );
  return {
    index, hint: texts[index], used: index + 1, total: texts.length,
    cost: costOf(level.points, index, costs), spent: spentView(level.points, firstN(index + 1), costs),
  };
}

export async function listHintLog(limit = 200) {
  const rows = await CipherHint.find({}, 'teamId levelId index createdAt').sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((row) => ({
    teamId: String(row.teamId), levelId: row.levelId, hint: row.index + 1, at: row.createdAt,
  }));
}

export async function submitAnswer({ entries, entry, team, user, answer }) {
  const { level, doc } = entry;
  const { status, solves } = await statusFor(entries, entry, team, false);
  requireOpen(status);
  // Mongo-backed limiter (all replicas): every attempt counts, whatever its outcome.
  await consumeAttempt(`cipherlab:${team._id}:${level.id}`, {
    limit: ATTEMPT_LIMIT,
    windowMs: ATTEMPT_WINDOW_MS,
    message: 'Too many attempts on this level. Wait a minute and try again.',
  });

  const built = buildPuzzle(level, { secret: env.FLAG_SECRET, teamId: team._id });
  const correct = answerMatches(built, answer);
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
  const solve = alreadySolved ? null : await recordSolve({ challenge, teamId: team._id, userId: user._id, hint: { scope: 'cipherlab', key: level.id } });
  const duplicate = alreadySolved || !solve;
  const badges = solve ? await achievementService.safeEvaluate({ userId: user._id, teamId: team._id, memberCount: team.memberIds?.length }) : []; // cosmetic; never throws
  const solvedNow = new Set([...solves.map((row) => String(row.challengeId)), String(doc._id)]);
  const trackEntries = entriesOf(entries, level.track);
  const next = trackEntries.find((item) => !solvedNow.has(String(item.doc._id)));
  return {
    ...(badges.length ? { badges } : {}),
    correct: true,
    alreadySolved: duplicate,
    pointsAwarded: duplicate ? 0 : solve.points,
    ...(solve?.hintCost ? { hintCost: solve.hintCost } : {}),
    firstBlood: false,
    flag,
    message: duplicate ? 'Your team already cracked this one.' : pickMessage(RIGHT, submittedHash),
    // The solves read for the status check plus the one just recorded: no second read of Solve (the new row's time is now,
    // always later than this attempt's own Submission, exactly like the stored one). A duplicate re-reads, as before.
    streak: await streakOf(team, entries, solve && !alreadySolved ? [...solves, { challengeId: doc._id, solvedAt: new Date() }] : undefined),
    trackComplete: !next,
    nextLevelId: next?.level.id ?? null,
  };
}
