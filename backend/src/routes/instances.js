import { Router } from 'express';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import Instance, { ACTIVE_STATUSES } from '../models/Instance.js';
import { AppError } from '../utils/AppError.js';
import { instanceService, serializeInstance } from '../services/instanceService.js';
import { getTeamContext } from '../services/teamContext.js';
import { objectId } from './challenges.js';

const router = Router();

router.use(auth, requireRole('player'));

// Instances are only ever visible to the team that owns them.
async function ownInstance(req) {
  const { team } = await getTeamContext(req.user);
  const instance = await Instance.findOne({
    _id: objectId(req.params.id), teamId: team._id, status: { $in: ACTIVE_STATUSES },
  });
  if (!instance) { throw new AppError(404, 'NOT_FOUND', 'Instance not found.'); }
  return { team, instance };
}

router.get('/', async (req, res) => {
  const { team } = await getTeamContext(req.user, { blockBanned: false });
  const instances = await Instance.find({ teamId: team._id, status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: 1 });
  res.json(instances.map(serializeInstance));
});

router.post('/:id/extend', async (req, res) => {
  const { team, instance } = await ownInstance(req);
  const extended = await instanceService.extend({ instanceId: instance._id, teamId: team._id });
  res.json(serializeInstance(extended));
});

router.delete('/:id', async (req, res) => {
  const { instance } = await ownInstance(req);
  await instanceService.stop(instance._id);
  res.sendStatus(204);
});

export default router;
