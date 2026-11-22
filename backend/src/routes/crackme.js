// Crackme Arcade game API (docs/CRACKME_ARCADE.md, docs/API_SPEC.md "Crackme Arcade"). Thin routes: validate, call the service.
import { Router } from 'express';
import { z } from 'zod';
import { INPUT_LIMIT } from '../games/crackme/levels.js';
import { PATCH_MAX_EDITS } from '../games/crackme/patch.js';
import {
  findEntry, listHintLog, loadGame, openHint, overviewView, puzzleView, streakOf, submitAnswer, submitPatch, teamPatches, teamSolves,
} from '../games/crackme/service.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { achievementService } from '../services/achievementService.js';
import { assertSubmissionsOpen } from '../services/adminSettings.js';
import { getTeamContext } from '../services/teamContext.js';
import { AppError } from '../utils/AppError.js';
import { both, validate } from './challenges.js';

const router = Router();

const levelParams = z.object({ id: z.string().regex(/^[a-z][0-9]{1,2}$/) }).strict();
// Printable ASCII only, exactly as typed (no trimming: spaces may matter to a program).
const answerBody = z.object({ answer: z.string().min(1).max(INPUT_LIMIT).regex(/^[\x20-\x7e]+$/) }).strict();
const emptyBody = z.object({}).strict();
// The opcode names are checked per instruction by the service (the whitelist depends on the original opcode); here only the
// shape and the size are bounded.
const patchBody = z.object({
  edits: z.array(z.object({
    index: z.number().int().min(0).max(255),
    op: z.string().min(1).max(8).regex(/^[A-Z]+$/),
  }).strict()).min(1).max(PATCH_MAX_EDITS),
}).strict();

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
  const [solves, streak, patched] = await Promise.all([teamSolves(team, entries), streakOf(team, entries), teamPatches(team)]);
  res.json(overviewView({ entries, solves, streak, admin, patched }));
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
  await assertSubmissionsOpen();
  const [{ user, team }, entries] = await both(getTeamContext(req.user), loadGame()); // independent reads, one round trip
  const result = await submitAnswer({ entries, entry: findEntry(entries, id), team, user, answer });
  // Only a NEW solve can unlock a badge; cosmetic and never throws.
  const badges = result.pointsAwarded > 0 ? await achievementService.safeEvaluate({ userId: user._id, teamId: team._id, memberCount: team.memberIds?.length }) : [];
  res.json(badges.length ? { ...result, badges } : result);
});

router.post('/levels/:id/patch', playerOnly, async (req, res) => {
  const id = levelId(req.params);
  const { edits } = validate(patchBody, req.body);
  await assertSubmissionsOpen();
  const { user, team } = await getTeamContext(req.user);
  const entries = await loadGame();
  res.json(await submitPatch({ entries, entry: findEntry(entries, id), team, user, edits }));
});

router.get('/admin/hints', requireRole('admin'), async (req, res) => {
  res.json(await listHintLog());
});

export default router;
