import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { adminService } from '../../services/adminService.js';
import { objectId } from '../challenges.js';

const router = Router();

router.use(auth, requireRole('admin'));

router.get('/', async (req, res) => {
  res.json(await adminService.listActiveInstances());
});

router.post('/:id/kill', async (req, res) => {
  await adminService.killInstance(objectId(req.params.id));
  res.sendStatus(204);
});

export default router;
