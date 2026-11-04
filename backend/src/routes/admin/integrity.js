// Admin review of fair-play signals (docs/FAIR_PLAY.md). Evidence only: admins read, then dismiss or act elsewhere
// (for example by banning a team); nothing here bans anyone.
import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { integrityService } from '../../services/integrityService.js';
import { objectId, validate } from '../challenges.js';

const router = Router();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

router.use(auth, requireRole('admin'));

router.get('/', async (req, res) => {
  const { limit } = validate(listQuery, req.query);
  res.json(await integrityService.listRisk({ limit: limit ?? 50 }));
});

router.delete('/:userId', async (req, res) => {
  await integrityService.dismiss(objectId(req.params.userId));
  res.status(204).end();
});

export default router;
