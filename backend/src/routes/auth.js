import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';

const router = Router();
const profileSchema = z.object({ displayName: z.string().trim().min(3).max(30) }).strict();

function profile(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    team: null,
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
  res.json(profile(user));
});

router.patch('/me', auth, async (req, res) => {
  const result = profileSchema.safeParse(req.body);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR',
      result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '));
  }
  const user = await upsertUser(req.user, result.data.displayName);
  res.json(profile(user));
});

export default router;
