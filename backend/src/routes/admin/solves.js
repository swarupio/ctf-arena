import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { recordAudit } from '../../services/adminAudit.js';
import {
  deleteSolve, deleteSolveQuery, listSolves, solvesQuery,
} from '../../services/adminSolves.js';
import { objectId, validate } from '../challenges.js';

const router = Router();

router.use(auth, requireRole('admin'));

router.get('/', async (req, res) => {
  res.json(await listSolves(validate(solvesQuery, req.query)));
});

// Removes a bogus solve (or a manual adjustment). The team's score follows, challenge solveCount is decremented and the
// first-blood bonus passes to the next earliest solver. Optional ?reason= goes into the audit entry.
router.delete('/:id', async (req, res) => {
  const id = objectId(req.params.id);
  const { reason } = validate(deleteSolveQuery, req.query);
  const { solve, teamScore } = await deleteSolve(id);
  await recordAudit(req, {
    action: solve.adjustment ? 'solve.delete-adjustment' : 'solve.delete', targetType: 'solve', targetId: id,
    before: {
      teamId: String(solve.teamId), challengeId: solve.adjustment ? null : String(solve.challengeId), points: solve.points,
      firstBlood: Boolean(solve.firstBlood), solvedAt: solve.solvedAt,
    },
    after: { teamScore },
    note: reason ?? '',
  });
  res.json({ id: String(solve._id), teamId: String(solve.teamId), pointsRemoved: solve.points, teamScore });
});

export default router;
