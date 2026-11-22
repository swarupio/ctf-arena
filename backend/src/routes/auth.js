import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';

const router = Router();
const profileSchema = z.object({ displayName: z.string().trim().min(3).max(30) }).strict();

async function profile(user) {
  let team = null;
  let teamBanned = false;
  // Missing or invalid legacy references are represented as no team.
  if (user.teamId && /^[a-f\d]{24}$/i.test(String(user.teamId))) {
    const { default: Team } = await import('../models/Team.js');
    const currentTeam = await Team.findById(user.teamId, 'name banned', { lean: true });
    if (currentTeam) {
      team = { id: String(currentTeam._id), name: currentTeam.name };
      teamBanned = currentTeam.banned === true;
    }
  }
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    team,
    // Additive: true when the user's team is banned (read with the team lookup above), so the UI can say so up front.
    teamBanned,
    // Additive: lets the UI show the ban message (the account can still sign in and read /api/me).
    ...(user.banned ? { banned: true } : {}),
  };
}

// Two first requests of a new user can both pass the upsert filter before either insert lands: MongoDB then answers
// one of them with a duplicate-key error on the unique cognitoSub index. The document exists by now, so one retry
// matches it and updates instead of inserting. Only a cognitoSub conflict is retried; anything else is a real error.
async function upsertWithRetry(run) {
  try {
    return await run();
  } catch (error) {
    if (error?.code === 11000 && (error.keyPattern === undefined || error.keyPattern?.cognitoSub)) { return run(); }
    throw error;
  }
}

async function upsertUser({ cognitoSub, email, role }, displayName) {
  const $set = { email, role };
  const $setOnInsert = {};
  if (displayName === undefined) {
    $setOnInsert.displayName = email.split('@')[0];
  } else {
    $set.displayName = displayName;
  }
  // Reads are far cheaper than writes: only touch the document when something actually changes.
  if (displayName === undefined) {
    const existing = await User.findOne({ cognitoSub }, '_id email role displayName teamId banned', { lean: true });
    if (existing && existing.email === email && existing.role === role) { return existing; }
  }
  const options = { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true, lean: true };
  if (displayName === undefined) {
    return upsertWithRetry(() => User.findOneAndUpdate({ cognitoSub }, { $set, $setOnInsert }, options));
  }
  // A banned account cannot change its public name. The filter costs nothing; the unique cognitoSub index turns the
  // would-be upsert of an existing banned user into a duplicate-key error, which is checked only on that rare path.
  try {
    return await User.findOneAndUpdate({ cognitoSub, banned: { $ne: true } }, { $set, $setOnInsert }, options);
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.cognitoSub) {
      if (await User.exists({ cognitoSub, banned: true })) { throw new AppError(403, 'USER_BANNED', 'Your account has been banned.'); }
      // Not banned: a parallel first request created the account between our filter and our insert. Retry once.
      return User.findOneAndUpdate({ cognitoSub, banned: { $ne: true } }, { $set, $setOnInsert }, options);
    }
    throw error;
  }
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
