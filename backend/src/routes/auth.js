import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';

const router = Router();
const profileSchema = z.object({ displayName: z.string().trim().min(3).max(30) }).strict();

async function profile(user) {
  let team = null;
  // Missing or invalid legacy references are represented as no team.
  if (user.teamId && /^[a-f\d]{24}$/i.test(String(user.teamId))) {
    const { default: Team } = await import('../models/Team.js');
    const currentTeam = await Team.findById(user.teamId);
    if (currentTeam) { team = { id: String(currentTeam._id), name: currentTeam.name }; }
  }
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    team,
  };
}

async function upsertUser({ cognitoSub, email, role }, displayName) {
  const $set = { email, role };
  const $setOnInsert = {};
  if (displayName === undefined) {
    $setOnInsert.displayName = email.split('@')[0];
  } else {
    $set.displayName = displayName;
  }
  return User.findOneAndUpdate(
    { cognitoSub },
    { $set, $setOnInsert },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

router.get('/me', auth, async (req, res) => {
  const user = await upsertUser(req.user);
  res.json(await profile(user));
});

router.patch('/me', auth, async (req, res) => {
  const result = profileSchema.safeParse(req.body);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR',
      result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '));
  }
  const user = await upsertUser(req.user, result.data.displayName);
  res.json(await profile(user));
});

export default router;
