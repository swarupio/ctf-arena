import { Router } from 'express';
import { getHintCosts } from '../services/adminSettings.js';

const router = Router();

// Public, read-only and tiny: { enabled, nudge, approach, walkthrough, maxPercent } (docs/HINTS.md "Hint costs"), so the
// play screens can show what a hint costs before it is opened. No auth, no user data. Cached for 10 s at most; the values
// are read from MongoDB on every uncached request, so every replica answers the same.
router.get('/', async (req, res) => {
  const costs = await getHintCosts();
  res.set('Cache-Control', 'public, max-age=10');
  res.json(costs);
});

export default router;
