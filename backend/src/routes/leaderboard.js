import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { getLeaderboard, getTeamScore, getTimeline } from '../services/leaderboardService.js';
import { getTeamContext } from '../services/teamContext.js';
import { resolveView } from '../services/viewCutoff.js';
import { validate } from './challenges.js';

const router = Router();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });

// Read-only and contains no secrets, so admins (who run the demo) may view it too.
router.use(auth, requireRole('player', 'admin'));

// Same few seconds of staleness as the server-side memo; Express adds an ETag so polls can get a cheap 304.
const cacheable = (res) => res.set({ 'Cache-Control': 'private, max-age=5', Vary: 'Authorization' });

// While an event's scoreboard is frozen, players get the standings as of the freeze time; once it has ended, as of the
// end (a solve stored just after it never counts); admins always get live data (services/viewCutoff.js).
// Returns the instant to compute at (null = live) and whether the view is the frozen one.
const viewCutoff = (req) => resolveView(req.user);

const emptyQuery = z.object({}).strict();

router.get('/', async (req, res) => {
  const { limit } = validate(listQuery, req.query);
  const { asOf, frozen } = await viewCutoff(req);
  cacheable(res);
  // The body stays a plain array (contract); the frozen view is flagged in headers.
  if (frozen) { res.set({ 'X-Scoreboard-Frozen': 'true', 'X-Scoreboard-As-Of': asOf.toISOString() }); }
  res.json(await getLeaderboard({ limit, asOf }));
});

router.get('/timeline', async (req, res) => {
  const { asOf, frozen } = await viewCutoff(req);
  cacheable(res);
  const timeline = await getTimeline({ asOf });
  res.json(frozen ? { ...timeline, frozen: true, asOf: asOf.toISOString() } : timeline);
});

// Frozen scoreboard only: the caller's OWN live totals (never other teams, never a live rank), so a team can see how it
// is doing while the public board is frozen. Outside a freeze (or for admins) there is nothing extra to show.
router.get('/me', async (req, res) => {
  validate(emptyQuery, req.query);
  const { asOf, frozen } = await viewCutoff(req);
  res.set('Cache-Control', 'private, no-store');
  if (!frozen) { return res.json({ frozen: false, asOf: null, team: null }); }
  const { team } = await getTeamContext(req.user, { requireTeam: false, blockBanned: false });
  if (!team || team.banned) { return res.json({ frozen: true, asOf: asOf.toISOString(), team: null }); }
  const { points, solves } = await getTeamScore(team._id);
  res.json({ frozen: true, asOf: asOf.toISOString(), team: { teamId: String(team._id), teamName: team.name, points, solves } });
});

export default router;
