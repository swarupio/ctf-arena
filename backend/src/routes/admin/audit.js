import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { auditQuery, listAudit } from '../../services/adminAudit.js';
import { validate } from '../challenges.js';

const router = Router();

router.use(auth, requireRole('admin'));

router.get('/', async (req, res) => {
  res.json(await listAudit(validate(auditQuery, req.query)));
});

export default router;
