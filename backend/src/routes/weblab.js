// Web Exploit Lab API (docs/WEB_EXPLOIT_LAB.md, docs/API_SPEC.md "Web Exploit Lab"). Every target is a pure-function
// simulation: no player value ever reaches the database, the filesystem, the network or an interpreter.
import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { labBySlug } from '../games/weblab/index.js';
import { integrityService } from '../services/integrityService.js';
import { assertSubmissionsOpen } from '../services/adminSettings.js';
import { getTeamContext } from '../services/teamContext.js';
import {
  hintFor, labDetail, loadRows, overview, requireOpen, sendRequest, submitFlag, teamIdOf, teamProgress,
} from '../services/weblabService.js';
import { AppError } from '../utils/AppError.js';
import { both, validate } from './challenges.js';

const router = Router();

const slugParam = z.string().regex(/^weblab-[a-z0-9-]{1,40}$/);
const strMap = (keyMax, valueMax, count) => z.record(z.string().min(1).max(keyMax), z.string().max(valueMax))
  .refine((map) => Object.keys(map).length <= count, { message: `at most ${count} entries` });
const requestBody = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  path: z.string().min(1).max(300).startsWith('/'),
  headers: strMap(40, 500, 20).default({}),
  cookies: strMap(40, 500, 10).default({}),
  body: z.string().max(2000).default(''),
}).strict();
const submitBody = z.object({ flag: z.string().trim().min(1).max(200) }).strict();
const levelParam = z.coerce.number().int().min(1).max(10);

// Unknown or malformed slugs are 404 (never 400): the path tells nothing about valid names.
function labFrom(params) {
  const parsed = slugParam.safeParse(params.slug);
  const lab = parsed.success ? labBySlug(parsed.data) : null;
  if (!lab) { throw new AppError(404, 'NOT_FOUND', 'Lab not found.'); }
  return lab;
}

const hintLevel = (params) => levelParam.safeParse(params.level);

// Players need a team (flags are per team); admins preview with a flag set no team can submit.
async function playingTeam(req) {
  if (req.user.role === 'admin') { return { user: null, team: null }; }
  return getTeamContext(req.user);
}

async function viewingTeam(req) {
  if (req.user.role === 'admin') { return null; }
  const { team } = await getTeamContext(req.user, { requireTeam: false, blockBanned: false });
  return team;
}

const anyRole = requireRole('player', 'admin');
const playerOnly = requireRole('player');
router.use(auth);

router.get('/labs', anyRole, async (req, res) => {
  const team = await viewingTeam(req);
  const rows = await loadRows();
  res.json(overview(rows, await teamProgress(team, rows), { preview: req.user.role === 'admin' }));
});

router.get('/labs/:slug', anyRole, async (req, res) => {
  const lab = labFrom(req.params);
  const team = await viewingTeam(req);
  const rows = await loadRows();
  const progress = await teamProgress(team, rows);
  res.json(labDetail(lab, rows, progress, { teamId: teamIdOf(team), preview: req.user.role === 'admin' }));
});

router.get('/labs/:slug/hints/:level', anyRole, async (req, res) => {
  const lab = labFrom(req.params);
  const level = hintLevel(req.params);
  if (!level.success) { throw new AppError(404, 'NOT_FOUND', 'No such hint.'); }
  const team = await viewingTeam(req);
  const rows = await loadRows();
  requireOpen(lab, rows, await teamProgress(team, rows), { preview: req.user.role === 'admin' });
  res.json(hintFor(lab, level.data));
});

router.post('/labs/:slug/request', anyRole, async (req, res) => {
  const lab = labFrom(req.params);
  const request = validate(requestBody, req.body);
  const { team } = await playingTeam(req);
  const rows = await loadRows();
  const preview = req.user.role === 'admin';
  const row = requireOpen(lab, rows, await teamProgress(team, rows), { preview });
  res.json(await sendRequest({ lab, row, team, rateKey: team ? String(team._id) : `admin:${req.user.cognitoSub}`, request }));
});

router.post('/labs/:slug/submit', playerOnly, async (req, res) => {
  const lab = labFrom(req.params);
  const { flag } = validate(submitBody, req.body);
  await assertSubmissionsOpen();
  const [{ user, team }, rows] = await both(getTeamContext(req.user), loadRows()); // independent reads, one round trip
  const row = requireOpen(lab, rows, await teamProgress(team, rows), { preview: false });
  const result = await submitFlag({ lab, row, team, user, submitted: flag });
  // A wrong flag may be a copied decoy: one indexed lookup, a signal if so, and the same answer either way.
  if (result.correct === false) { await integrityService.checkSubmittedFlag({ flag, user }); }
  res.json(result);
});

export default router;
