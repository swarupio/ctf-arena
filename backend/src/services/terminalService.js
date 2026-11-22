// Server-side logic of the Arena Terminal game (docs/ARENA_TERMINAL.md). Routes stay thin and call these helpers.
// Nothing here keeps state between requests: flags, progress and rate limits come from the secret and MongoDB.
import { createHmac } from 'node:crypto';
import { posix } from 'node:path';
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';
import Submission from '../models/Submission.js';
import { AppError } from '../utils/AppError.js';
import { getHintCosts } from './adminSettings.js';
import { consumeAttempt } from './attemptLimiter.js';
import { expectedFlagFor, hashSubmission, matchDynamicFlag } from './flagService.js';
import { pricingClosed, spentView } from './hintCost.js';
import { openedEntries, recordHintOpen } from './hintLedger.js';
import { recordSolve } from './scoringService.js';

// Admins explore with flags derived for this fixed id. No team has it, so those flags never validate on submit.
export const ADMIN_PREVIEW_TEAM = 'admin-preview';
// Printed by {{flag:N}} when code N has no visible challenge row. It is not any team's expected flag.
export const UNAVAILABLE_FLAG = 'CTF{this_code_is_not_available}';
export const SUBMIT_LIMIT = 10;
export const SUBMIT_WINDOW_MS = 60_000;
export const MAX_MATCHES = 50;
const EFFECTS = new Set(['clear', 'matrix', 'reboot', 'confetti']);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// Points a solve can count for: never more than the challenge's listed points (guards rows written by older versions).
const capped = (solve, challenge) => Math.min(solve.points, challenge.points);

const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);

export function notSeeded() {
  return new AppError(503, 'TERMINAL_NOT_SEEDED', 'Run npm run seed:terminal.');
}

// Lexical clean-up of the cwd the browser sends. Anything that is not an absolute plain path falls back to home;
// the engine still checks that the directory exists in the virtual filesystem.
export function normalizeCwd(value, home) {
  if (typeof value !== 'string' || !value.startsWith('/') || CONTROL_CHARS.test(value)) { return home; }
  const clean = posix.normalize(value);
  return clean.length > 1 ? clean.replace(/\/+$/, '') || '/' : '/';
}

// The title of a code is only ever shown for codes the team solved; the definition has the canonical text.
export function codeTitle(definition, challenge) {
  return definition.codes.find((code) => code.n === challenge.terminal.code)?.title ?? challenge.title;
}

// Keeps rows of this mode whose code exists in the definition (stray rows are ignored), ordered by code.
function gameCodes(definition, docs) {
  const known = new Set(definition.codes.map((code) => code.n));
  return docs
    .filter((doc) => doc.terminal?.mode === definition.mode && known.has(doc.terminal.code))
    .sort((a, b) => a.terminal.code - b.terminal.code);
}

// A terminal challenge hidden by an admin (visible: false) is switched off: not counted, not accepted.
export async function loadModeChallenges(definition, { required = true } = {}) {
  const docs = await Challenge.find({ type: 'terminal', 'terminal.mode': definition.mode, visible: true }).lean();
  const challenges = gameCodes(definition, docs);
  if (required && challenges.length === 0) { throw notSeeded(); }
  return challenges;
}

// One read for the mode picker: Map of mode name -> that mode's visible challenges (empty array when not seeded).
export async function loadChallengesByMode(definitions) {
  const docs = await Challenge.find({ type: 'terminal', visible: true }).lean();
  return new Map(definitions.map((definition) => [definition.mode, gameCodes(definition, docs)]));
}

// Idempotent repair for rows written when terminal solves still got the first-blood bonus (mode totals were exceeded).
export async function repairTerminalSolves() {
  const challenges = await Challenge.find({ type: 'terminal' }, '_id points').lean();
  const results = await Promise.all(challenges.map((challenge) => Solve.updateMany(
    { challengeId: challenge._id, $or: [{ points: { $ne: challenge.points } }, { firstBlood: true }] },
    { $set: { points: challenge.points, firstBlood: false } },
  )));
  return sum(results, (result) => result.modifiedCount ?? 0);
}

export async function teamSolves(team, challenges) {
  if (!team || challenges.length === 0) { return []; }
  return Solve.find(
    { teamId: team._id, challengeId: { $in: challenges.map((challenge) => challenge._id) } },
    'challengeId points firstBlood',
  ).lean();
}

const solvedIds = (solves) => new Set(solves.map((solve) => String(solve.challengeId)));

// Per-team, per-mode seed behind {{seed:...}} tokens (docs/ARENA_TERMINAL.md section 16). It only feeds the engine's
// puzzle values: it is never sent to the browser. Admins use the same fixed preview id as their flag set.
export function terminalSeed(teamId, mode) {
  return createHmac('sha256', env.FLAG_SECRET).update(`terminal-seed:${teamId}:${mode}`).digest('hex');
}

// Per-team seed of the story cast (names in the mailbox). It does not depend on the mode, so the same people appear in all
// three modes, and it is a different derivation from the puzzle seed: a name can never reveal a puzzle value. Never sent out.
export function storySeed(teamId) {
  return createHmac('sha256', env.FLAG_SECRET).update(`terminal-story:${teamId}`).digest('hex');
}

// Cosmetic read marker from the browser (bit n = message n was read). Anything else counts as nothing read.
export const MAIL_SEEN_MAX = 0xfff;
export const cleanMailSeen = (value) => (Number.isInteger(value) && value >= 0 && value <= MAIL_SEEN_MAX ? value : 0);

// Hint costs: scope 'terminal', key '<mode>:<code>', index = tier - 1 (tiers are the code's hints, 1-based in the shell).
export const hintKey = (mode, code) => `${mode}:${code}`;

// What the Hints control needs for the code `hint` talks about (the first unsolved code with hints): its prices before
// opening, the opened tiers and the spend. Players with a team only; null when every code is solved or none has hints.
export async function hintInfo({ definition, challenges, solves, team }) {
  if (!team) { return null; }
  const ids = solvedIds(solves);
  const solvedCodes = new Set(challenges.filter((c) => ids.has(String(c._id))).map((c) => c.terminal.code));
  const next = [...definition.codes].sort((x, y) => x.n - y.n).find((code) => !solvedCodes.has(code.n));
  const row = next && challenges.find((c) => c.terminal.code === next.n);
  const total = Array.isArray(next?.hints) ? next.hints.length : 0;
  if (!row || total === 0) { return null; }
  const scope = { teamId: team._id, scope: 'terminal', key: hintKey(definition.mode, next.n) };
  const [opened, costs] = await Promise.all([openedEntries(scope), getHintCosts()]);
  return {
    code: next.n, total, base: row.points,
    opened: opened.filter((entry) => entry.index < total).map((entry) => entry.index + 1),
    pricing: pricingClosed(row.points, total, opened, costs),
    spent: spentView(row.points, opened, costs),
  };
}

// The ctx the shell engine receives (docs/ARENA_TERMINAL.md section 5). flag() is synchronous and per team;
// progress() reads the team's solves lazily, once per request, only when a command (hint, status) asks.
export function buildContext({ definition, cwd, challenges, team, user = null, mailSeen }) {
  const teamId = team ? String(team._id) : ADMIN_PREVIEW_TEAM;
  const byCode = new Map(challenges.map((challenge) => [challenge.terminal.code, challenge]));
  let progressed;
  return {
    mode: definition,
    cwd: normalizeCwd(cwd, definition.home),
    seed: terminalSeed(teamId, definition.mode),
    storySeed: storySeed(teamId),
    mailSeen: cleanMailSeen(mailSeen),
    flag(n) {
      const challenge = byCode.get(Number(n));
      return challenge ? expectedFlagFor(challenge, { secret: env.FLAG_SECRET, teamId }) : UNAVAILABLE_FLAG;
    },
    // Players with a team only (admin previews are free and record nothing). The `hint` command records the opened tier here
    // BEFORE it prints the text; the deduction applies when the code is solved (docs/HINTS.md "Hint costs").
    ...(team ? { recordHint: ({ code, index }) => recordHintOpen({ teamId: team._id, userId: user?._id, scope: 'terminal', key: hintKey(definition.mode, code), index }) } : {}),
    progress() {
      progressed ??= teamSolves(team, challenges).then((solves) => {
        const ids = solvedIds(solves);
        return { solved: challenges.filter((challenge) => ids.has(String(challenge._id))).map((c) => c.terminal.code) };
      });
      return progressed;
    },
  };
}

// Only these fields ever leave the server for an exec call; unknown effects are dropped.
export function execResponse(result, definition) {
  const response = {
    output: typeof result?.output === 'string' ? result.output : '',
    cwd: normalizeCwd(result?.cwd, definition.home),
    exit: Number.isInteger(result?.exit) ? result.exit : 0,
  };
  if (EFFECTS.has(result?.effect)) { response.effect = result.effect; }
  return response;
}

export function completeResponse(matches) {
  const list = Array.isArray(matches) ? matches.filter((match) => typeof match === 'string') : [];
  return { matches: list.slice(0, MAX_MATCHES) };
}

// One card per mode. A mode without rows (not seeded yet) still shows its definition so the page can render;
// opening it then returns TERMINAL_NOT_SEEDED. No flags and no titles of unsolved codes.
export function summarizeMode(definition, challenges, solves) {
  const seeded = challenges.length > 0;
  const mine = new Map(solves.map((solve) => [String(solve.challengeId), solve]));
  const solved = challenges.filter((challenge) => mine.has(String(challenge._id)));
  return {
    mode: definition.mode,
    title: definition.title,
    tagline: definition.tagline,
    difficulty: definition.difficulty,
    codes: seeded ? challenges.length : definition.codes.length,
    solved: solved.length,
    points: seeded ? sum(challenges, (c) => c.points) : sum(definition.codes, (c) => c.points),
    pointsEarned: sum(solved, (challenge) => capped(mine.get(String(challenge._id)), challenge)),
    lore: [...definition.lore],
  };
}

export function progressView(definition, challenges, solves) {
  const mine = new Map(solves.map((solve) => [String(solve.challengeId), solve]));
  const solved = challenges
    .filter((challenge) => mine.has(String(challenge._id)))
    .map((challenge) => {
      const solve = mine.get(String(challenge._id));
      return { n: challenge.terminal.code, title: codeTitle(definition, challenge), points: capped(solve, challenge), firstBlood: false };
    });
  return { mode: definition.mode, total: challenges.length, solved, remaining: challenges.length - solved.length };
}

// Checks one submission against every code of the mode. Never echoes the submitted or an expected flag.
export async function submitFlag({ definition, challenges, team, user, submitted }) {
  const solves = await teamSolves(team, challenges);
  const ids = solvedIds(solves);
  const options = { secret: env.FLAG_SECRET, teamId: team._id, submitted };
  const fresh = matchDynamicFlag(challenges.filter((challenge) => !ids.has(String(challenge._id))), options);
  const earlier = matchDynamicFlag(challenges.filter((challenge) => ids.has(String(challenge._id))), options);
  const matched = fresh ?? earlier;

  // Rate limit (per team and mode, all replicas): the attempt is consumed atomically in MongoDB BEFORE the answer is
  // revealed, so over the limit every outcome is 429, a correct flag included (a 429 never tells whether a guess was
  // right, and a parallel burst can test at most SUBMIT_LIMIT guesses). Re-submitting a code the team already found
  // is not a guess (the team already has that flag), so it stays idempotent and is never limited.
  if (fresh || !matched) {
    await consumeAttempt(`terminal:${team._id}:${definition.mode}`, {
      limit: SUBMIT_LIMIT, windowMs: SUBMIT_WINDOW_MS, message: 'Too many attempts. Wait a minute and try again.',
    });
  }

  // Wrong attempts are stored against the mode's first code (an audit trail of what was submitted).
  await Submission.create({
    teamId: team._id, userId: user._id, challengeId: (matched ?? challenges[0])._id,
    correct: Boolean(matched), submittedHash: hashSubmission(submitted),
  });

  const total = challenges.length;
  if (!matched) {
    return { correct: false, pointsAwarded: 0, firstBlood: false, message: 'Incorrect flag. Keep digging!', solved: ids.size, total };
  }
  const known = { correct: true, code: matched.terminal.code, title: codeTitle(definition, matched) };
  const already = (solvedCount) => ({
    ...known, alreadySolved: true, pointsAwarded: 0, firstBlood: false,
    message: 'Your team already found this code.', solved: solvedCount, total,
  });
  if (!fresh) { return already(ids.size); }

  const solve = await recordSolve({
    challenge: fresh, teamId: team._id, userId: user._id, hint: { scope: 'terminal', key: hintKey(definition.mode, matched.terminal.code) },
  });
  // null: the other half of a double click (or another replica) recorded it first.
  if (!solve) { return already(ids.size + 1); }
  return {
    ...known, pointsAwarded: solve.points, ...(solve.hintCost ? { hintCost: solve.hintCost } : {}), firstBlood: solve.firstBlood,
    message: solve.firstBlood ? 'First blood! Correct flag.' : 'Correct flag!',
    solved: ids.size + 1, total,
  };
}
