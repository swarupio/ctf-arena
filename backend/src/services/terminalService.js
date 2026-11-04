// Server-side logic of the Arena Terminal game (docs/TERMINAL_GAME.md). Routes stay thin and call these helpers.
// Nothing here keeps state between requests: flags, progress and rate limits come from the secret and MongoDB.
import { createHmac } from 'node:crypto';
import { posix } from 'node:path';
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';
import Submission from '../models/Submission.js';
import { AppError } from '../utils/AppError.js';
import { expectedFlagFor, hashSubmission, matchDynamicFlag } from './flagService.js';
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

export async function teamSolves(team, challenges) {
  if (!team || challenges.length === 0) { return []; }
  return Solve.find(
    { teamId: team._id, challengeId: { $in: challenges.map((challenge) => challenge._id) } },
    'challengeId points firstBlood',
  ).lean();
}

const solvedIds = (solves) => new Set(solves.map((solve) => String(solve.challengeId)));

// Per-team, per-mode seed behind {{seed:...}} tokens (docs/TERMINAL_GAME.md section 16). It only feeds the engine's
// puzzle values: it is never sent to the browser. Admins use the same fixed preview id as their flag set.
export function terminalSeed(teamId, mode) {
  return createHmac('sha256', env.FLAG_SECRET).update(`terminal-seed:${teamId}:${mode}`).digest('hex');
}

// The ctx the shell engine receives (docs/TERMINAL_GAME.md section 5). flag() is synchronous and per team;
// progress() reads the team's solves lazily, once per request, only when a command (hint, status) asks.
export function buildContext({ definition, cwd, challenges, team }) {
  const teamId = team ? String(team._id) : ADMIN_PREVIEW_TEAM;
  const byCode = new Map(challenges.map((challenge) => [challenge.terminal.code, challenge]));
  let progressed;
  return {
    mode: definition,
    cwd: normalizeCwd(cwd, definition.home),
    seed: terminalSeed(teamId, definition.mode),
    flag(n) {
      const challenge = byCode.get(Number(n));
      return challenge ? expectedFlagFor(challenge, { secret: env.FLAG_SECRET, teamId }) : UNAVAILABLE_FLAG;
    },
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
    pointsEarned: sum(solved, (challenge) => mine.get(String(challenge._id)).points),
    lore: [...definition.lore],
  };
}

export function progressView(definition, challenges, solves) {
  const mine = new Map(solves.map((solve) => [String(solve.challengeId), solve]));
  const solved = challenges
    .filter((challenge) => mine.has(String(challenge._id)))
    .map((challenge) => {
      const solve = mine.get(String(challenge._id));
      return { n: challenge.terminal.code, title: codeTitle(definition, challenge), points: solve.points, firstBlood: Boolean(solve.firstBlood) };
    });
  return { mode: definition.mode, total: challenges.length, solved, remaining: challenges.length - solved.length };
}

// Checks one submission against every code of the mode. Never echoes the submitted or an expected flag.
export async function submitFlag({ definition, challenges, team, user, submitted }) {
  // Rate limit is counted in MongoDB (all attempts on any code of this mode) so it holds across every replica.
  const attempts = () => Submission.countDocuments({
    teamId: team._id,
    challengeId: { $in: challenges.map((challenge) => challenge._id) },
    createdAt: { $gte: new Date(Date.now() - SUBMIT_WINDOW_MS) },
  });
  const limited = () => new AppError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.');
  const [solves, recent] = await Promise.all([teamSolves(team, challenges), attempts()]);
  if (recent >= SUBMIT_LIMIT) { throw limited(); }

  const ids = solvedIds(solves);
  const options = { secret: env.FLAG_SECRET, teamId: team._id, submitted };
  const fresh = matchDynamicFlag(challenges.filter((challenge) => !ids.has(String(challenge._id))), options);
  const earlier = matchDynamicFlag(challenges.filter((challenge) => ids.has(String(challenge._id))), options);
  const matched = fresh ?? earlier;

  // Wrong attempts are stored against the mode's first code so the per-mode rate limit can count them.
  await Submission.create({
    teamId: team._id, userId: user._id, challengeId: (matched ?? challenges[0])._id,
    correct: Boolean(matched), submittedHash: hashSubmission(submitted),
  });
  // Count-then-insert alone lets a parallel burst pass the limit together. Recounting after the insert closes that
  // window: the k-th stored attempt sees at least k rows, so at most SUBMIT_LIMIT attempts get an answer. The 429 says
  // nothing about correctness, so a burst cannot be used to test more than SUBMIT_LIMIT guesses.
  if (await attempts() > SUBMIT_LIMIT) { throw limited(); }

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

  const solve = await recordSolve({ challenge: fresh, teamId: team._id, userId: user._id });
  // null: the other half of a double click (or another replica) recorded it first.
  if (!solve) { return already(ids.size + 1); }
  return {
    ...known, pointsAwarded: solve.points, firstBlood: solve.firstBlood,
    message: solve.firstBlood ? 'First blood! Correct flag.' : 'Correct flag!',
    solved: ids.size + 1, total,
  };
}
