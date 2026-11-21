// CSV downloads. Capped at 10,000 rows; cells are formula-injection safe. Each export is audited (it can contain emails).
import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit } from '../../services/adminAudit.js';
import {
  leaderboardCsv, submissionsCsv, teamsCsv, usersCsv,
} from '../../services/adminExport.js';
import { submissionsQuery } from '../../services/adminSolves.js';
import { teamsQuery } from '../../services/adminTeams.js';
import { usersQuery } from '../../services/adminUsers.js';
import { validate } from '../challenges.js';

const router = Router();

router.use(auth, requireRole('admin'));

async function send(req, res, name, csv) {
  await recordAudit(req, { action: `export.${name}`, targetType: 'export', targetId: name });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.send(csv);
}

// The same filters as the list endpoints; page and limit are ignored.
router.get('/users.csv', async (req, res) => {
  await send(req, res, 'users', await usersCsv(validate(usersQuery, req.query)));
});

router.get('/teams.csv', async (req, res) => {
  await send(req, res, 'teams', await teamsCsv(validate(teamsQuery, req.query)));
});

router.get('/submissions.csv', async (req, res) => {
  await send(req, res, 'submissions', await submissionsCsv(validate(submissionsQuery, req.query)));
});

router.get('/leaderboard.csv', async (req, res) => {
  validate(z.object({}).strict(), req.query);
  await send(req, res, 'leaderboard', await leaderboardCsv());
});

export default router;
