// Cipher Lab game API (docs/CIPHER_LAB.md, docs/API_SPEC.md "Cipher Lab"). Thin routes: validate, call the service.
import { Router } from 'express';
import { z } from 'zod';
import {
  findEntry, listHintLog, loadGame, openHint, overviewView, puzzleView, streakOf, submitAnswer, teamSolves,
} from '../games/cipherlab/service.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { getTeamContext } from '../services/teamContext.js';
import { AppError } from '../utils/AppError.js';
import { validate } from './challenges.js';

const router = Router();

const levelParams = z.object({ id: z.string().regex(/^[a-z][0-9]{1,2}$/) }).strict();
const answerBody = z.object({ answer: z.string().trim().min(1).max(300) }).strict();
const emptyBody = z.object({}).strict();

// Unknown ids are 404 (never 400), so the path says nothing about which ids exist.
function levelId(params) {
  const parsed = levelParams.safeParse(params);
  if (!parsed.success) { throw new AppError(404, 'NOT_FOUND', 'Level not found.'); }
  return parsed.data.id;
}

const anyRole = requireRole('player', 'admin');
const playerOnly = requireRole('player');
router.use(auth);

// Read-only overview works without a team (the page still renders) and for banned teams.
router.get('/overview', anyRole, async (req, res) => {
  const admin = req.user.role === 'admin';
  const { team } = admin ? { team: null } : await getTeamContext(req.user, { requireTeam: false, blockBanned: false });
  const entries = await loadGame();
  const [solves, streak] = await Promise.all([teamSolves(team, entries), streakOf(team, entries)]);
  res.json(overviewView({ entries, solves, streak, admin }));
});

router.get('/levels/:id', anyRole, async (req, res) => {
  const id = levelId(req.params);
  const admin = req.user.role === 'admin';
  const { team } = admin ? { team: null } : await getTeamContext(req.user);
  const entries = await loadGame();
  res.json(await puzzleView({ entries, entry: findEntry(entries, id), team, admin }));
});

router.post('/levels/:id/hints', playerOnly, async (req, res) => {
  const id = levelId(req.params);
  validate(emptyBody, req.body ?? {});
  const { user, team } = await getTeamContext(req.user);
  const entries = await loadGame();
  res.json(await openHint({ entries, entry: findEntry(entries, id), team, user }));
});

router.post('/levels/:id/answer', playerOnly, async (req, res) => {
  const id = levelId(req.params);
  const { answer } = validate(answerBody, req.body);
  const { user, team } = await getTeamContext(req.user);
  const entries = await loadGame();
  res.json(await submitAnswer({ entries, entry: findEntry(entries, id), team, user, answer }));
});

router.get('/admin/hints', requireRole('admin'), async (req, res) => {
  res.json(await listHintLog());
});

export default router;
