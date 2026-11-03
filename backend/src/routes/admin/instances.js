import { Router } from 'express';
import mongoose from 'mongoose';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import Instance, { ACTIVE_STATUSES } from '../../models/Instance.js';
import Challenge from '../../models/Challenge.js';
import Team from '../../models/Team.js';
import { instanceService } from '../../services/instanceService.js';
import { AppError } from '../../utils/AppError.js';

const router = Router();

router.use(auth, requireRole('admin'));

/**
 * GET /api/admin/instances
 * Returns all active instances with team and challenge names
 */
router.get('/', async (req, res) => {
  const activeInstances = await Instance.find({
    status: { $in: ACTIVE_STATUSES },
  }).sort({ createdAt: -1 });

  if (activeInstances.length === 0) {
    return res.json([]);
  }

  // Load team names
  const teamIds = [...new Set(activeInstances.map((i) => i.teamId))];
  const teams = await Team.find({ _id: { $in: teamIds } }, 'name');
  const teamMap = new Map(teams.map((t) => [String(t._id), t.name]));

  // Load challenge titles
  const challengeIds = [...new Set(activeInstances.map((i) => i.challengeId))];
  const challenges = await Challenge.find({ _id: { $in: challengeIds } }, 'title');
  const challengeMap = new Map(challenges.map((c) => [String(c._id), c.title]));

  const result = activeInstances.map((inst) => ({
    id: String(inst._id),
    teamId: String(inst.teamId),
    teamName: teamMap.get(String(inst.teamId)) || 'Unknown Team',
    challengeId: String(inst.challengeId),
    challengeTitle: challengeMap.get(String(inst.challengeId)) || 'Challenge',
    containerId: inst.containerId || null,
    port: inst.port,
    status: inst.status,
    expiresAt: inst.expiresAt,
    createdAt: inst.createdAt,
  }));

  res.json(result);
});

/**
 * POST /api/admin/instances/:id/kill
 * Force stop and remove a running challenge instance
 */
router.post('/:id/kill', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid instance ID format.');
  }

  const instance = await Instance.findById(id);
  if (!instance) {
    throw new AppError(404, 'NOT_FOUND', 'Instance not found.');
  }

  // Force stop through instanceService
  if (instanceService?.stop) {
    await instanceService.stop(instance._id);
  } else {
    await Instance.updateOne(
      { _id: instance._id },
      { $set: { status: 'stopped', stoppedAt: new Date() } }
    );
  }

  res.json({
    id: String(instance._id),
    status: 'stopped',
    message: 'Instance terminated successfully.',
  });
});

export default router;
