import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { adminService } from '../../services/adminService.js';
import { objectId, validate } from '../challenges.js';

const router = Router();
const banSchema = z.object({ banned: z.boolean() }).strict();

router.use(auth, requireRole('admin'));

router.get('/', async (req, res) => {
  res.json(await adminService.listTeams());
});

router.patch('/:id/ban', async (req, res) => {
  const id = objectId(req.params.id);
  const { banned } = validate(banSchema, req.body);
  res.json(await adminService.setTeamBanned(id, banned));
});

export default router;
