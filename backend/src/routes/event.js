import { Router } from 'express';
import { getEventConfig } from '../services/adminSettings.js';
import { eventView } from '../services/eventPhase.js';

const router = Router();

// Public, read-only and tiny, like /api/announcement: { name, phase, startsAt, endsAt, freezeAt, serverTime }.
// `serverTime` lets the client show a countdown from the server's clock. The phase is derived from the stored
// schedule on every request (no timers), so every replica answers the same. Cached for 3 s at most.
router.get('/', async (req, res) => {
  const event = await getEventConfig({ failOpen: false });
  res.set('Cache-Control', 'public, max-age=3');
  res.json(eventView(event, new Date()));
});

export default router;
