// Admin user management. Roles are NOT changed here: they come from Cognito groups (the `admin` group) and are
// managed in AWS, outside this API.
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import User from '../../models/User.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../services/adminAudit.js';
import { confirmBody, resetUserTerminal } from '../../services/adminSolves.js';
import { removeMember } from '../../services/adminTeams.js';
import {
  banBody, getUserDetail, listUsers, setUserBanned, usersQuery,
} from '../../services/adminUsers.js';
import { objectId, validate } from '../challenges.js';

const router = Router();

router.use(auth, requireRole('admin'));

router.get('/', async (req, res) => {
  res.json(await listUsers(validate(usersQuery, req.query)));
});

router.get('/:id', async (req, res) => {
  res.json(await getUserDetail(objectId(req.params.id)));
});

// A banned user gets 403 USER_BANNED on submit, instance and terminal routes (the team is untouched).
router.patch('/:id/ban', async (req, res) => {
  const id = objectId(req.params.id);
  const { banned, reason } = validate(banBody, req.body);
  const result = await setUserBanned(id, banned);
  await recordAudit(req, {
    action: banned ? 'user.ban' : 'user.unban', targetType: 'user', targetId: id,
    before: { banned: result.before }, after: { banned }, note: reason ?? '',
  });
  res.json({ id: result.id, displayName: result.displayName, banned });
});

router.post('/:id/remove-from-team', async (req, res) => {
  const id = objectId(req.params.id);
  validate(confirmBody.partial(), req.body ?? {});
  const user = await User.findById(id, 'teamId').lean();
  if (!user) { throw new AppError(404, 'NOT_FOUND', 'User not found.'); }
  if (!user.teamId) { throw new AppError(409, 'NOT_A_MEMBER', 'This user has no team.'); }
  const result = await removeMember(user.teamId, id);
  await recordAudit(req, {
    action: 'user.remove-from-team', targetType: 'user', targetId: id, before: { teamId: result.teamId, teamName: result.teamName },
  });
  res.json(result);
});

// Deletes the terminal solves this user submitted (their team's score drops with them) and the pacing records.
// Needs { "confirm": true }.
router.post('/:id/reset-terminal', async (req, res) => {
  const id = objectId(req.params.id);
  validate(confirmBody, req.body);
  if (!await User.exists({ _id: id })) { throw new AppError(404, 'NOT_FOUND', 'User not found.'); }
  const result = await resetUserTerminal(id);
  await recordAudit(req, { action: 'user.reset-terminal', targetType: 'user', targetId: id, after: result });
  res.json(result);
});

export default router;
