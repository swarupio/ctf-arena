// Server-side logic of the Web Exploit Lab (docs/WEB_EXPLOIT_LAB.md). Routes stay thin and call these helpers.
// Nothing here keeps state between requests: worlds derive from the secret, progress and rate limits live in MongoDB.
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';
import Submission from '../models/Submission.js';
import {
  LABS, TRACKS, TRACK_MAX, WEBLAB_MAX_POINTS, inspectorFor, labSlug, labTemplate, lockedReason, runLab,
} from '../games/weblab/index.js';
import { AppError } from '../utils/AppError.js';
import { achievementService } from './achievementService.js';
import { consumeAttempt } from './attemptLimiter.js';
import { expectedFlagFor, hashSubmission, verifyFlag } from './flagService.js';
import { recordSolve } from './scoringService.js';

// Admins explore with flags derived for this fixed id. No team has it, so those flags never validate on submit.
export const ADMIN_PREVIEW_TEAM = 'admin-preview';
export const REQUEST_LIMIT = 90;
export const REQUEST_WINDOW_MS = 60_000;
export const SUBMIT_LIMIT = 8;
export const SUBMIT_WINDOW_MS = 60_000;

const WRONG_QUIPS = [
  'Nope. The bug is real, the flag is not that one.',
  'Close, but the server is not impressed.',
  'Wrong flag. Re-read the response, character by character.',
  'The bounty committee frowns at that one.',
  'Not the flag. Have you tried actually exploiting something?',
];

export function notSeeded() {
  return new AppError(503, 'WEBLAB_NOT_SEEDED', 'Run npm run seed:weblab.');
}

export async function loadRows() {
  const docs = await Challenge.find({ type: 'weblab', visible: true }).lean();
  return new Map(docs.map((doc) => [doc.slug, doc]));
}

// Map of lab id -> { points } for the labs this team solved.
export async function teamProgress(team, rows) {
  const solved = new Map();
  if (!team || rows.size === 0) { return solved; }
  const byId = new Map([...rows.values()].map((row) => [String(row._id), row]));
  const solves = await Solve.find({ teamId: team._id, challengeId: { $in: [...byId.keys()] } }, 'challengeId points').lean();
  for (const solve of solves) {
    const row = byId.get(String(solve.challengeId));
    const lab = row && LABS.find((candidate) => labSlug(candidate.id) === row.slug);
    if (lab) { solved.set(lab.id, { points: solve.points }); }
  }
  return solved;
}

const cosmetics = (lab) => ({ severity: lab.severity, bountyUsd: lab.bountyUsd });

export function summarizeLab(lab, rows, progress, { preview = false } = {}) {
  const solved = progress.get(lab.id);
  const reason = preview ? null : lockedReason(lab, new Set(progress.keys()));
  return {
    id: lab.id,
    slug: labSlug(lab.id),
    title: lab.title,
    summary: lab.summary,
    track: lab.track,
    boss: Boolean(lab.boss),
    points: lab.points,
    hintCount: lab.hints.length,
    available: rows.has(labSlug(lab.id)),
    solved: Boolean(solved),
    pointsEarned: solved?.points ?? 0,
    locked: Boolean(reason),
    lockedReason: reason,
    // The severity badge is a reward: it stays hidden until the team solved the lab.
    ...(solved ? cosmetics(lab) : { severity: null, bountyUsd: null }),
  };
}

export function overview(rows, progress, { preview = false } = {}) {
  const tracks = TRACKS.map((track) => {
    const labs = track.labs.map((lab) => summarizeLab(LABS.find((l) => l.id === lab.id), rows, progress, { preview }));
    const solved = labs.filter((lab) => lab.solved);
    return {
      id: track.id,
      title: track.title,
      difficulty: track.difficulty,
      theme: track.theme,
      company: track.company,
      labs,
      solved: solved.length,
      total: labs.length,
      points: TRACK_MAX[track.id],
      pointsEarned: solved.reduce((sum, lab) => sum + lab.pointsEarned, 0),
      cleared: solved.length === labs.length,
    };
  });
  const bounty = tracks.flatMap((track) => track.labs).filter((lab) => lab.solved).reduce((sum, lab) => sum + lab.bountyUsd, 0);
  return {
    tracks,
    totals: {
      labs: LABS.length,
      solved: progress.size,
      points: WEBLAB_MAX_POINTS,
      pointsEarned: tracks.reduce((sum, track) => sum + track.pointsEarned, 0),
      bountyUsd: bounty,
    },
    inspector: inspectorFor(progress.size),
  };
}

export function labDetail(lab, rows, progress, { teamId, preview = false }) {
  const track = TRACKS.find((candidate) => candidate.id === lab.track);
  const summary = summarizeLab(lab, rows, progress, { preview });
  return {
    ...summary,
    objective: lab.objective,
    story: lab.story,
    company: track.company,
    theme: track.theme,
    site: lab.site,
    form: lab.form ?? null,
    // The starting request holds this team's own values (cookie, ids): nothing here is a flag.
    request: summary.locked ? null : labTemplate(lab, { secret: env.FLAG_SECRET, teamId }),
    inspector: inspectorFor(progress.size),
  };
}

export const teamIdOf = (team) => (team ? String(team._id) : ADMIN_PREVIEW_TEAM);

export function requireOpen(lab, rows, progress, { preview }) {
  const row = rows.get(labSlug(lab.id));
  if (!row) { throw notSeeded(); }
  const reason = preview ? null : lockedReason(lab, new Set(progress.keys()));
  if (reason) { throw new AppError(403, 'LAB_LOCKED', reason); }
  return row;
}

// Runs one simulated request against the lab. The flag only appears in the output when the lab's own exploit logic
// reveals it, and `exploited` tells the UI to celebrate.
export async function sendRequest({ lab, row, team, rateKey, request }) {
  await consumeAttempt(`weblab-req:${rateKey}`, {
    limit: REQUEST_LIMIT, windowMs: REQUEST_WINDOW_MS, message: 'Easy there, hacker. Too many requests, wait a minute.',
  });
  const teamId = teamIdOf(team);
  const flag = expectedFlagFor(row, { secret: env.FLAG_SECRET, teamId });
  const result = runLab(lab, { secret: env.FLAG_SECRET, teamId, flag, request });
  return { ...result, hint: result.exploited ? 'EXPLOIT LANDED. Copy the flag from the response and submit it.' : null };
}

export function hintFor(lab, level) {
  const text = lab.hints[level - 1];
  if (!text) { throw new AppError(404, 'NOT_FOUND', 'No such hint.'); }
  return { level, count: lab.hints.length, text };
}

const quipFor = (submitted) => WRONG_QUIPS[parseInt(hashSubmission(submitted).slice(0, 6), 16) % WRONG_QUIPS.length];

export async function submitFlag({ lab, row, team, user, submitted }) {
  await consumeAttempt(`weblab-submit:${team._id}:${lab.id}`, {
    limit: SUBMIT_LIMIT, windowMs: SUBMIT_WINDOW_MS, message: 'Too many attempts. Wait a minute and try again.',
  });
  const correct = verifyFlag(row, { secret: env.FLAG_SECRET, teamId: team._id, submitted });
  await Submission.create({
    teamId: team._id, userId: user._id, challengeId: row._id, correct, submittedHash: hashSubmission(submitted),
  });
  if (!correct) {
    return { correct: false, pointsAwarded: 0, firstBlood: false, message: quipFor(submitted) };
  }
  const solve = await recordSolve({ challenge: { ...row, points: lab.points }, teamId: team._id, userId: user._id });
  // null: the team already had this lab (double click or another replica). Not an error, and worth no points.
  if (!solve) {
    return { correct: true, alreadySolved: true, pointsAwarded: 0, firstBlood: false, message: 'Your team already cashed this bounty.', ...cosmetics(lab) };
  }
  const badges = await achievementService.safeEvaluate({ userId: user._id, teamId: team._id, memberCount: team.memberIds?.length }); // cosmetic; never throws
  return {
    ...(badges.length ? { badges } : {}),
    correct: true, pointsAwarded: solve.points, firstBlood: false, ...cosmetics(lab),
    message: `BOUNTY PAID: ${lab.severity.toUpperCase()} severity, $${lab.bountyUsd.toLocaleString('en-US')}.`,
  };
}
