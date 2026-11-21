import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { adminService } from '../../services/adminService.js';
import { getOverview, getTimeSeries } from '../../services/adminStats.js';
import { validate } from '../challenges.js';

const router = Router();
const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }).strict();

router.use(auth, requireRole('admin'));

// Unchanged legacy shape: { users, teams, solves, submissions, wrongRate, activeInstances, requestsByReplica }.
router.get('/', async (req, res) => {
  res.json(await adminService.getStats());
});

router.get('/overview', async (req, res) => {
  const { days } = validate(daysQuery, req.query);
  res.json(await getOverview({ days }));
});

router.get('/timeseries', async (req, res) => {
  const { days } = validate(daysQuery, req.query);
  res.json(await getTimeSeries({ days }));
});

export default router;
