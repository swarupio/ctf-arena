// Admin review of fair-play signals (docs/FAIR_PLAY.md). Evidence only: admins read, then resolve with a note or act
// elsewhere (for example by banning a user or a team); nothing here bans anyone.
import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit } from '../../services/adminAudit.js';
import {
  integritySummary, resolveBody, resolveUser, reviewQuery, reviewUsers,
} from '../../services/adminIntegrity.js';
import { integrityService } from '../../services/integrityService.js';
import { objectId, validate } from '../challenges.js';

const router = Router();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

router.use(auth, requireRole('admin'));

// Legacy list (bare array, highest risk first).
router.get('/', async (req, res) => {
  const { limit } = validate(listQuery, req.query);
  res.json(await integrityService.listRisk({ limit: limit ?? 50 }));
});

router.get('/summary', async (req, res) => {
  res.json(await integritySummary());
});

// Filtered, paginated review list: q, kind, minRisk, sort (risk | lastSignalAt).
router.get('/users', async (req, res) => {
  res.json(await reviewUsers(validate(reviewQuery, req.query)));
});

// Resolve with a note: deletes the user's signals and records the note and a summary in the audit log.
router.post('/:userId/resolve', async (req, res) => {
  const userId = objectId(req.params.userId);
  const { note } = validate(resolveBody, req.body);
  const summary = await resolveUser(userId);
  await recordAudit(req, { action: 'integrity.resolve', targetType: 'user', targetId: userId, before: summary, note });
  res.json({ userId: String(userId), resolved: summary });
});

router.delete('/:userId', async (req, res) => {
  const userId = objectId(req.params.userId);
  await integrityService.dismiss(userId);
  await recordAudit(req, { action: 'integrity.dismiss', targetType: 'user', targetId: userId });
  res.status(204).end();
});

export default router;
