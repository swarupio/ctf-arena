import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { AppError } from '../utils/AppError.js';
import { getTeamContext } from '../services/teamContext.js';
import { FEED_DEFAULT, FEED_MAX, getDaily, getFeed, getProfile } from '../services/socialService.js';
import { resolveView } from '../services/viewCutoff.js';
import { objectId, validate } from './challenges.js';

// Cosmetic, public-safe extras (docs/ACHIEVEMENTS.md). Mounted on /api, so auth is applied per route.
const router = Router();
const readers = [auth, requireRole('player', 'admin')];
const feedQuery = z.object({ limit: z.coerce.number().int().min(1).max(FEED_MAX).default(FEED_DEFAULT) });

router.get('/feed', ...readers, async (req, res) => {
  const { limit } = validate(feedQuery, req.query);
  // Same view as the scoreboard: players see activity up to the freeze (or the end), admins live. Never shared between views.
  const { asOf } = await resolveView(req.user);
  res.set({ 'Cache-Control': 'private, max-age=5', Vary: 'Authorization' });
  res.json(await getFeed({ limit, asOf }));
});

router.get('/daily', ...readers, async (req, res) => {
  res.set('Cache-Control', 'private, max-age=60');
  res.json(await getDaily());
});

router.get('/players/:id/profile', ...readers, async (req, res) => {
  const { asOf } = await resolveView(req.user);
  const profile = await getProfile(objectId(req.params.id), new Date(), asOf);
  if (!profile) { throw new AppError(404, 'NOT_FOUND', 'Player not found.'); }
  res.set({ 'Cache-Control': 'private, no-store', Vary: 'Authorization' });
  res.json(profile);
});

router.get('/me/achievements', ...readers, async (req, res) => {
  const { user } = await getTeamContext(req.user, { requireTeam: false, blockBanned: false });
  if (!user) { throw new AppError(404, 'NOT_FOUND', 'Player not found.'); }
  // The caller's OWN badges and streak: always live (like the caller's own totals on the frozen scoreboard).
  const { id, badges, streak } = await getProfile(user._id);
  res.json({ id, unlocked: badges.filter((badge) => badge.unlocked).length, total: badges.length, streak, badges });
});

export default router;
