import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { listSubmissions, submissionsQuery } from '../../services/adminSolves.js';
import { validate } from '../challenges.js';

const router = Router();

router.use(auth, requireRole('admin'));

// Attempts only record who, what challenge, when and whether it was right. The submitted text and its hash are never shown.
router.get('/', async (req, res) => {
  res.json(await listSubmissions(validate(submissionsQuery, req.query)));
});

export default router;
