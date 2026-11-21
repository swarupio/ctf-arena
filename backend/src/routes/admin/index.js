// Admin API v2 routers that are new (users, solves, submissions, audit, settings, exports). The older admin routers
// (challenges, stats, instances, teams, integrity) are mounted separately in app.js and extended in place.
import { Router } from 'express';
import auditRouter from './audit.js';
import exportsRouter from './exports.js';
import settingsRouter from './settings.js';
import solvesRouter from './solves.js';
import submissionsRouter from './submissions.js';
import usersRouter from './users.js';

const router = Router();

router.use('/users', usersRouter);
router.use('/solves', solvesRouter);
router.use('/submissions', submissionsRouter);
router.use('/audit', auditRouter);
router.use('/settings', settingsRouter);
router.use('/export', exportsRouter);

export default router;
