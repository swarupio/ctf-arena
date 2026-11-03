import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { getLeaderboard, getTimeline } from '../services/leaderboardService.js';
import { validate } from './challenges.js';

const router = Router();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });

router.use(auth, requireRole('player'));

router.get('/', async (req, res) => {
  const { limit } = validate(listQuery, req.query);
  res.json(await getLeaderboard({ limit }));
});

router.get('/timeline', async (req, res) => {
  res.json(await getTimeline());
});

export default router;
