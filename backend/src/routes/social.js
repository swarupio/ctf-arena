import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { AppError } from '../utils/AppError.js';
import { getTeamContext } from '../services/teamContext.js';
import { FEED_DEFAULT, FEED_MAX, getDaily, getFeed, getProfile } from '../services/socialService.js';
import { objectId, validate } from './challenges.js';

// Cosmetic, public-safe extras (docs/ACHIEVEMENTS.md). Mounted on /api, so auth is applied per route.
const router = Router();
const readers = [auth, requireRole('player', 'admin')];
const feedQuery = z.object({ limit: z.coerce.number().int().min(1).max(FEED_MAX).default(FEED_DEFAULT) });

router.get('/feed', ...readers, async (req, res) => {
  const { limit } = validate(feedQuery, req.query);
  res.set('Cache-Control', 'private, max-age=5');
  res.json(await getFeed({ limit }));
});

router.get('/daily', ...readers, async (req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json(await getDaily());
});

router.get('/players/:id/profile', ...readers, async (req, res) => {
  const profile = await getProfile(objectId(req.params.id));
  if (!profile) { throw new AppError(404, 'NOT_FOUND', 'Player not found.'); }
  res.json(profile);
});

router.get('/me/achievements', ...readers, async (req, res) => {
  const { user } = await getTeamContext(req.user, { requireTeam: false, blockBanned: false });
  if (!user) { throw new AppError(404, 'NOT_FOUND', 'Player not found.'); }
  const { id, badges, streak } = await getProfile(user._id);
  res.json({ id, unlocked: badges.filter((badge) => badge.unlocked).length, total: badges.length, streak, badges });
});

export default router;
