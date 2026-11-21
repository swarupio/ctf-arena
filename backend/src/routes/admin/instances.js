import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit } from '../../services/adminAudit.js';
import { idString, isPaged, listQuery } from '../../services/adminCommon.js';
import { adminService } from '../../services/adminService.js';
import { objectId, validate } from '../challenges.js';

const router = Router();
const pagedQuery = listQuery(['createdAt', 'expiresAt'], 'createdAt', {
  status: z.enum(['active', 'all', 'starting', 'running', 'stopping', 'stopped', 'failed']).default('active'),
  teamId: idString.optional(),
  challengeId: idString.optional(),
});

router.use(auth, requireRole('admin'));

// Without query parameters: the legacy bare array of active instances. With any parameter: the paginated envelope
// (plus `dockerEnabled`).
router.get('/', async (req, res) => {
  const query = isPaged(req.query) ? validate(pagedQuery, req.query) : null;
  if (!query) { return res.json(await adminService.listActiveInstances()); }
  return res.json(await adminService.listInstancesPaged(query));
});

router.post('/:id/kill', async (req, res) => {
  const id = objectId(req.params.id);
  await adminService.killInstance(id);
  await recordAudit(req, { action: 'instance.kill', targetType: 'instance', targetId: id });
  res.sendStatus(204);
});

export default router;
