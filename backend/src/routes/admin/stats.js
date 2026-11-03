import os from 'node:os';
import { Router } from 'express';
import mongoose from 'mongoose';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import User from '../../models/User.js';
import Team from '../../models/Team.js';
import Solve from '../../models/Solve.js';
import Submission from '../../models/Submission.js';
import Instance, { ACTIVE_STATUSES } from '../../models/Instance.js';
import { flushReplicaCount } from '../../utils/replicaTracker.js';

const router = Router();

router.use(auth, requireRole('admin'));

/**
 * GET /api/admin/stats
 * Returns system-wide statistics for the admin dashboard:
 * { users, teams, solves, submissions, wrongRate, activeInstances, requestsByReplica }
 */
router.get('/', async (req, res) => {
  const [usersCount, teamsCount, solvesCount, submissionsCount, activeInstancesCount] = await Promise.all([
    User.countDocuments({}),
    Team.countDocuments({}),
    Solve.countDocuments({}),
    Submission.countDocuments({}),
    Instance.countDocuments({ status: { $in: ACTIVE_STATUSES } }),
  ]);

  let wrongRate = 0;
  if (submissionsCount > 0) {
    const wrongCount = await Submission.countDocuments({ correct: false });
    wrongRate = Number((wrongCount / submissionsCount).toFixed(4));
  }

  // Retrieve per-replica request counters from Mongo
  let requestsByReplica = {};
  try {
    await flushReplicaCount();
    const db = mongoose.connection?.db;
    if (db) {
      const replicaDocs = await db.collection('replica_stats').find({}).toArray();
      if (replicaDocs.length > 0) {
        requestsByReplica = Object.fromEntries(
          replicaDocs.map((doc) => [doc._id || doc.replica, doc.requests || 0])
        );
      }
    }
  } catch {
    requestsByReplica = {};
  }

  // Fallback to current host if no distributed counters exist yet
  if (Object.keys(requestsByReplica).length === 0) {
    requestsByReplica[os.hostname()] = 1;
  }

  res.json({
    users: usersCount,
    teams: teamsCount,
    solves: solvesCount,
    submissions: submissionsCount,
    wrongRate,
    activeInstances: activeInstancesCount,
    requestsByReplica,
  });
});

export default router;
