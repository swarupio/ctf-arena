import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';

const router = Router();
const nameSchema = z.object({ name: z.string().trim().min(3).max(24) }).strict();
const inviteSchema = z.object({ inviteCode: z.string().trim().regex(/^[A-HJ-NP-Z2-9]{6}$/) }).strict();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const conflict = () => new AppError(409, 'CONFLICT', 'You already belong to a team.');
const noTeam = () => new AppError(404, 'NO_TEAM', 'You do not belong to a team.');

function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '));
  }
  return result.data;
}

// Load the team model only when a team operation needs it.
async function teamModel() {
  return (await import('../models/Team.js')).default;
}

async function transaction(work) {
  const Team = await teamModel();
  // Collections and unique indexes must exist before membership transactions begin.
  await Promise.all([User.init(), Team.init()]);
  // Atlas transactions roll back both documents, including on process failure.
  // The driver retries write conflicts; no replica-local membership locks are used.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await User.db.transaction((session) => work(Team, session));
    } catch (error) {
      // Concurrent first requests can race to insert the same Cognito identity.
      // Unlike write conflicts, duplicate upserts may need an explicit fresh transaction.
      if (attempt >= 2 || error.code !== 11000 || !error.keyPattern?.cognitoSub) { throw error; }
    }
  }
}

async function currentUser({ cognitoSub, email, role }, session) {
  return User.findOneAndUpdate({ cognitoSub }, {
    $set: { email, role }, $setOnInsert: { displayName: email.split('@')[0] },
  }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true, session });
}

async function claimTeam(user, team, session) {
  const claimed = await User.findOneAndUpdate({ _id: user._id, teamId: null }, {
    $set: { teamId: team._id },
  }, { new: true, runValidators: true, session });
  if (!claimed) { throw conflict(); }
}

async function teamProfile(team, session) {
  const members = await User.find({ _id: { $in: team.memberIds } }, 'displayName', { session });
  const names = new Map(members.map((member) => [String(member._id), member.displayName]));
  return {
    id: String(team._id), name: team.name, inviteCode: team.inviteCode,
    members: team.memberIds.map((id) => ({ id: String(id), displayName: names.get(String(id)) })),
    score: 0,
    ...(team.banned ? { banned: true } : {}),
  };
}

router.use(auth, requireRole('player'));

router.post('/', async (req, res) => {
  const { name } = validate(nameSchema, req.body);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
    try {
      const result = await transaction(async (Team, session) => {
        const user = await currentUser(req.user, session);
        if (user.teamId) { throw conflict(); }
        const [team] = await Team.create([{
          name, inviteCode, captainId: user._id, memberIds: [user._id],
        }], { session });
        await claimTeam(user, team, session);
        return teamProfile(team, session);
      });
      return res.status(201).json(result);
    } catch (error) {
      if (error.code === 11000 && error.keyPattern?.name) {
        throw new AppError(409, 'CONFLICT', 'A team with this name already exists.');
      }
      // Duplicate keys abort the transaction; retry invite collisions in a fresh one.
      if (error.code !== 11000 || !error.keyPattern?.inviteCode) { throw error; }
    }
  }
  throw new AppError(500, 'SERVER_ERROR', 'Could not generate a unique invite code. Try again.');
});

router.post('/join', async (req, res) => {
  const { inviteCode } = validate(inviteSchema, req.body);
  const result = await transaction(async (Team, session) => {
    const user = await currentUser(req.user, session);
    if (user.teamId) { throw conflict(); }
    const team = await Team.findOneAndUpdate({
      inviteCode, 'memberIds.2': { $exists: false }, memberIds: { $ne: user._id },
    }, { $push: { memberIds: user._id } }, { new: true, runValidators: true, session });
    if (!team) {
      const existing = await Team.findOne({ inviteCode }, null, { session });
      if (!existing) { throw new AppError(404, 'NOT_FOUND', 'Invite code not found.'); }
      if (existing.memberIds.some((id) => String(id) === String(user._id))) { throw conflict(); }
      throw new AppError(409, 'TEAM_FULL', 'This team already has 3 members.');
    }
    await claimTeam(user, team, session);
    return teamProfile(team, session);
  });
  res.json(result);
});

router.get('/me', async (req, res) => {
  const user = await User.findOne({ cognitoSub: req.user.cognitoSub });
  if (!user?.teamId) { throw noTeam(); }
  const Team = await teamModel();
  const team = await Team.findById(user.teamId);
  if (!team || !team.memberIds.some((id) => String(id) === String(user._id))) { throw noTeam(); }
  res.json(await teamProfile(team));
});

router.post('/me/leave', async (req, res) => {
  validate(z.object({}).strict(), req.body ?? {});
  await transaction(async (Team, session) => {
    const user = await User.findOne({ cognitoSub: req.user.cognitoSub }, null, { session });
    if (!user?.teamId) { throw noTeam(); }
    const team = await Team.findById(user.teamId, null, { session });
    if (!team || !team.memberIds.some((id) => String(id) === String(user._id))) { throw noTeam(); }
    const remaining = team.memberIds.filter((id) => String(id) !== String(user._id));
    if (remaining.length === 0) {
      await Team.deleteOne({ _id: team._id }, { session });
    } else {
      await Team.updateOne({ _id: team._id }, { $set: {
        memberIds: remaining,
        captainId: String(team.captainId) === String(user._id) ? remaining[0] : team.captainId,
      } }, { runValidators: true, session });
    }
    const cleared = await User.findOneAndUpdate({ _id: user._id, teamId: team._id }, {
      $set: { teamId: null },
    }, { new: true, runValidators: true, session });
    if (!cleared) { throw new AppError(409, 'CONFLICT', 'Your team membership changed. Try again.'); }
    // TODO: P2: stop this team's running instances here
  });
  res.sendStatus(204);
});

export default router;
