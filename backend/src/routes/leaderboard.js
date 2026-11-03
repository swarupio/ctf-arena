import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { getLeaderboard, getTimeline } from '../services/leaderboardService.js';
import { validate } from './challenges.js';

const router = Router();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });

// Read-only and contains no secrets, so admins (who run the demo) may view it too.
router.use(auth, requireRole('player', 'admin'));

router.get('/', async (req, res) => {
  const { limit } = validate(listQuery, req.query);
  res.json(await getLeaderboard({ limit }));
});

router.get('/timeline', async (req, res) => {
  res.json(await getTimeline());
});

export default router;
