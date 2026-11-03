import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import Team from '../../models/Team.js';
import User from '../../models/User.js';
import Solve from '../../models/Solve.js';
import { instanceService } from '../../services/instanceService.js';
import { AppError } from '../../utils/AppError.js';

const router = Router();

const banSchema = z.object({
  banned: z.boolean({ required_error: 'banned is required' }),
}).strict();

function validate(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '));
  }
  return result.data;
}

// All admin routes require admin role
router.use(auth, requireRole('admin'));

/**
 * GET /api/admin/teams
 * Returns all teams with score and ban state
 */
router.get('/', async (req, res) => {
  const teams = await Team.find({}).sort({ createdAt: -1 });

  // Load scores directly from Solve collection
  let scoreMap = new Map();
  try {
    const solves = await Solve.aggregate([
      { $group: { _id: '$teamId', totalScore: { $sum: '$points' } } },
    ]);
    scoreMap = new Map(solves.map((s) => [String(s._id), s.totalScore]));
  } catch {
    scoreMap = new Map();
  }

  const userIds = [...new Set(teams.flatMap((t) => t.memberIds || []))];
  const users = await User.find({ _id: { $in: userIds } }, 'displayName email');
  const userMap = new Map(users.map((u) => [String(u._id), u.displayName || u.email]));

  const result = teams.map((team) => ({
    id: String(team._id),
    name: team.name,
    inviteCode: team.inviteCode,
    captainId: String(team.captainId),
    members: (team.memberIds || []).map((id) => ({
      id: String(id),
      displayName: userMap.get(String(id)) || 'Unknown',
    })),
    banned: Boolean(team.banned),
    score: scoreMap.get(String(team._id)) || 0,
    createdAt: team.createdAt,
  }));

  res.json(result);
});

/**
 * PATCH /api/admin/teams/:id/ban
 * Ban or unban a team; if banned, stop all of that team's running instances
 */
router.patch('/:id/ban', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid team ID format.');
  }

  const { banned } = validate(banSchema, req.body);

  const team = await Team.findByIdAndUpdate(
    id,
    { $set: { banned } },
    { new: true, runValidators: true }
  );

  if (!team) {
    throw new AppError(404, 'NOT_FOUND', 'Team not found.');
  }

  // When banning a team, stop all of their running instances immediately
  if (banned && instanceService?.stopTeamInstances) {
    try {
      await instanceService.stopTeamInstances(team._id);
    } catch {
      // Best-effort instance termination
    }
  }

  res.json({
    id: String(team._id),
    name: team.name,
    banned: team.banned,
  });
});

export default router;
