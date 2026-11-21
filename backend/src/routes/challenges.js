import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import Challenge from '../models/Challenge.js';
import Instance, { ACTIVE_STATUSES } from '../models/Instance.js';
import Solve from '../models/Solve.js';
import Submission from '../models/Submission.js';
import { AppError } from '../utils/AppError.js';
import { hashSubmission, verifyFlag } from '../services/flagService.js';
import { instanceService, serializeInstance } from '../services/instanceService.js';
import { integrityService } from '../services/integrityService.js';
import { recordSolve } from '../services/scoringService.js';
import { getTeamContext } from '../services/teamContext.js';

const router = Router();
const submitSchema = z.object({ flag: z.string().trim().min(1).max(200) }).strict();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

export function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '));
  }
  return result.data;
}

export function objectId(value) {
  if (!mongoose.isValidObjectId(value) || String(value).length !== 24) {
    throw new AppError(404, 'NOT_FOUND', 'Not found.');
  }
  return value;
}

const SUMMARY_FIELDS = 'slug title category difficulty points type solveCount';
const DETAIL_FIELDS = `${SUMMARY_FIELDS} description attachments`;

// Explicit allow-list: flag, flagHash and flagSalt can never leak through this shape.
export function playerSummary(challenge, solvedIds, ) {
  return {
    id: String(challenge._id),
    slug: challenge.slug,
    title: challenge.title,
    category: challenge.category,
    difficulty: challenge.difficulty,
    points: challenge.points,
    type: challenge.type,
    solveCount: challenge.solveCount ?? 0,
    solvedByMyTeam: solvedIds.has(String(challenge._id)),
  };
}

// `fields` limits what is read; the default (everything) is only for flows that verify flags or start containers.
async function visibleChallenge(id, fields = null) {
  const challenge = await Challenge.findOne({ _id: objectId(id), visible: true }, fields, { lean: true });
  if (!challenge) { throw new AppError(404, 'NOT_FOUND', 'Challenge not found.'); }
  return challenge;
}

// Runs two independent reads concurrently but reports the first one's error first, like sequential awaits would.
async function both(first, second) {
  const [a, b] = await Promise.allSettled([first, second]);
  if (a.status === 'rejected') { throw a.reason; }
  if (b.status === 'rejected') { throw b.reason; }
  return [a.value, b.value];
}

// Browsing is read-only, so admins can view challenges; starting instances and submitting need a player team.
const playerOnly = requireRole('player');
router.use(auth);

router.get('/', requireRole('player', 'admin'), async (req, res) => {
  // The challenge list does not depend on the team, so both reads run at the same time.
  const [challenges, solves] = await Promise.all([
    Challenge.find({ visible: true }, SUMMARY_FIELDS, { lean: true }).sort({ points: 1, title: 1 }),
    getTeamContext(req.user, { requireTeam: false, blockBanned: false })
      .then(({ team }) => (team ? Solve.find({ teamId: team._id }, 'challengeId -_id', { lean: true }) : [])),
  ]);
  const solvedIds = new Set(solves.map((solve) => String(solve.challengeId)));
  res.json(challenges.map((challenge) => playerSummary(challenge, solvedIds)));
});

router.get('/:id', requireRole('player', 'admin'), async (req, res) => {
  const [challenge, { team }] = await both(
    visibleChallenge(req.params.id, DETAIL_FIELDS),
    getTeamContext(req.user, { requireTeam: false, blockBanned: false }),
  );
  const [solved, instance] = team ? await Promise.all([
    Solve.exists({ teamId: team._id, challengeId: challenge._id }),
    challenge.type === 'docker'
      ? Instance.findOne({ teamId: team._id, challengeId: challenge._id, status: { $in: ACTIVE_STATUSES } }, null, { lean: true })
      : null,
  ]) : [null, null];
  res.json({
    ...playerSummary(challenge, new Set(solved ? [String(challenge._id)] : [])),
    description: challenge.description,
    attachments: (challenge.attachments ?? []).map(({ name, url }) => ({ name, url })),
    hasInstance: Boolean(instance),
    myInstance: instance ? serializeInstance(instance) : null,
  });
});

router.post('/:id/instance', playerOnly, async (req, res) => {
  const [challenge, { user, team }] = await both(visibleChallenge(req.params.id), getTeamContext(req.user));
  const instance = await instanceService.start({ challenge, team, user });
  res.status(201).json(serializeInstance(instance));
});

router.post('/:id/submit', playerOnly, async (req, res) => {
  const { flag } = validate(submitSchema, req.body);
  const [challenge, { user, team }] = await both(visibleChallenge(req.params.id), getTeamContext(req.user));

  // Rate limit is counted in MongoDB so it holds across every backend replica.
  const attempts = () => Submission.countDocuments({
    teamId: team._id, challengeId: challenge._id, createdAt: { $gte: new Date(Date.now() - RATE_WINDOW_MS) },
  });
  const limited = () => new AppError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.');
  const [alreadySolved, recent] = await Promise.all([
    Solve.exists({ teamId: team._id, challengeId: challenge._id }),
    attempts(),
  ]);
  if (alreadySolved) { throw new AppError(409, 'CONFLICT', 'Your team has already solved this challenge.'); }
  if (recent >= RATE_LIMIT) { throw limited(); }

  const correct = verifyFlag(challenge, { secret: env.FLAG_SECRET, teamId: team._id, submitted: flag });
  await Submission.create({
    teamId: team._id, userId: user._id, challengeId: challenge._id,
    correct, submittedHash: hashSubmission(flag),
  });
  // Parallel requests can all pass the check above before any of them is stored. Counting again after our own
  // insert closes that window: the k-th stored attempt sees at least k rows, so at most RATE_LIMIT get an answer.
  // The 429 says nothing about correctness, so a burst cannot be used to test more than RATE_LIMIT guesses.
  if (await attempts() > RATE_LIMIT) { throw limited(); }
  if (!correct) {
    await integrityService.checkSubmittedFlag({ flag, user }); // copied decoy flags leave a signal (docs/FAIR_PLAY.md)
    return res.json({ correct: false, pointsAwarded: 0, firstBlood: false, message: 'Incorrect flag. Keep trying!' });
  }

  const solve = await recordSolve({ challenge, teamId: team._id, userId: user._id });
  if (!solve) {
    throw new AppError(409, 'CONFLICT', 'Your team has already solved this challenge.');
  }
  await instanceService.stopTeamChallenge(team._id, challenge._id).catch(() => {});
  return res.json({
    correct: true,
    pointsAwarded: solve.points,
    firstBlood: solve.firstBlood,
    message: solve.firstBlood ? 'First blood! Correct flag.' : 'Correct flag!',
  });
});

export default router;
