import { Router } from 'express';
import { getPublicStatus } from '../services/adminSettings.js';

const router = Router();

// Public and tiny: { announcement: { text, level }, registrationOpen, submissionsFrozen }. No auth, no user data.
router.get('/', async (req, res) => {
  res.json(await getPublicStatus());
});

export default router;
