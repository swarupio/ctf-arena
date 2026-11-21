import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { actorIdOrFail, recordAudit } from '../../services/adminAudit.js';
import { isPaged } from '../../services/adminCommon.js';
import { adminService } from '../../services/adminService.js';
import { addAdjustment, adjustmentBody, confirmQuery } from '../../services/adminSolves.js';
import {
  deleteTeam, getTeamDetail, listTeamsPaged, regenerateInviteCode, removeMember, renameBody, renameTeam, teamsQuery,
} from '../../services/adminTeams.js';
import { objectId, validate } from '../challenges.js';

const router = Router();
const banSchema = z.object({ banned: z.boolean() }).strict();

router.use(auth, requireRole('admin'));

// Without query parameters: the legacy bare array (highest score first). With any of page, limit, q, sort, banned:
// the paginated envelope.
router.get('/', async (req, res) => {
  const query = isPaged(req.query) ? validate(teamsQuery, req.query) : null;
  if (!query) { return res.json(await adminService.listTeams()); }
  return res.json((await listTeamsPaged(query)).response);
});

router.get('/:id', async (req, res) => {
  res.json(await getTeamDetail(objectId(req.params.id)));
});

router.patch('/:id/ban', async (req, res) => {
  const id = objectId(req.params.id);
  const { banned } = validate(banSchema, req.body);
  const result = await adminService.setTeamBanned(id, banned);
  await recordAudit(req, { action: banned ? 'team.ban' : 'team.unban', targetType: 'team', targetId: id, after: result });
  res.json(result);
});

router.patch('/:id', async (req, res) => {
  const id = objectId(req.params.id);
  const { name } = validate(renameBody, req.body);
  const result = await renameTeam(id, name);
  await recordAudit(req, { action: 'team.rename', targetType: 'team', targetId: id, before: { name: result.before }, after: { name } });
  res.json({ id: result.id, name });
});

// Only empty teams. Needs ?confirm=true. Removes the team's solves (keeping challenge counters right) and stops its instances.
router.delete('/:id', async (req, res) => {
  const id = objectId(req.params.id);
  validate(confirmQuery, req.query);
  const result = await deleteTeam(id);
  await recordAudit(req, { action: 'team.delete', targetType: 'team', targetId: id, before: result });
  res.sendStatus(204);
});

router.delete('/:id/members/:userId', async (req, res) => {
  const result = await removeMember(objectId(req.params.id), objectId(req.params.userId));
  await recordAudit(req, {
    action: 'team.remove-member', targetType: 'team', targetId: result.teamId, after: { userId: result.userId, remaining: result.remaining },
  });
  res.json(result);
});

// The new code is returned once, in this response only (no other admin route exposes invite codes).
router.post('/:id/invite-code/regenerate', async (req, res) => {
  const id = objectId(req.params.id);
  validate(z.object({}).strict(), req.body ?? {});
  const result = await regenerateInviteCode(id);
  await recordAudit(req, { action: 'team.invite-code-regenerate', targetType: 'team', targetId: id });
  res.json(result);
});

// Manual score change: a signed, audited adjustment row that the leaderboard sums like a solve.
router.post('/:id/score-adjustments', async (req, res) => {
  const id = objectId(req.params.id);
  const { points, reason } = validate(adjustmentBody, req.body);
  const result = await addAdjustment({ teamId: id, points, reason, actorId: await actorIdOrFail(req) });
  await recordAudit(req, {
    action: 'team.score-adjust', targetType: 'team', targetId: id, after: { adjustmentId: result.id, points, teamScore: result.teamScore }, note: reason,
  });
  res.status(201).json({ id: result.id, teamId: id, points, reason, teamScore: result.teamScore });
});

export default router;
