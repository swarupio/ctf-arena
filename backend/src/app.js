import express from 'express';
import helmet from 'helmet';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { servedBy } from './middleware/servedBy.js';
import { requestCounter } from './middleware/requestCounter.js';
import { mountable } from './middleware/lazyRouter.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import teamsRouter from './routes/teams.js';
import challengesRouter from './routes/challenges.js';
import instancesRouter from './routes/instances.js';
import leaderboardRouter from './routes/leaderboard.js';
import honeypotRouter from './routes/honeypot.js';
import announcementRouter from './routes/announcement.js';

// Terminal, game and admin routers load on their first request (middleware/lazyRouter.js), so a cold start only
// pays for what it serves. They stay mounted at the same places, in the same order.
const terminalRouter = await mountable(() => import('./routes/terminal.js'));
// Mounted on the broad /api prefix with per-route auth: only paths that can belong to it load the module.
const socialRouter = await mountable(() => import('./routes/social.js'), {
  match: (req) => /^\/+(feed|daily|players|me\/+achievements)/i.test(req.path),
});
const cipherlabRouter = await mountable(() => import('./routes/cipherlab.js'));
const weblabRouter = await mountable(() => import('./routes/weblab.js'));
const forensicsRouter = await mountable(() => import('./routes/forensics.js'));
const adminChallengesRouter = await mountable(() => import('./routes/admin/challenges.js'));
const adminStatsRouter = await mountable(() => import('./routes/admin/stats.js'));
const adminInstancesRouter = await mountable(() => import('./routes/admin/instances.js'));
const adminTeamsRouter = await mountable(() => import('./routes/admin/teams.js'));
const adminIntegrityRouter = await mountable(() => import('./routes/admin/integrity.js'));
const adminV2Router = await mountable(() => import('./routes/admin/index.js'));

const app = express();

app.disable('x-powered-by');
app.use(servedBy);
app.use(requestCounter);
app.use(helmet());
// API answers carry per-team data (invite codes, flags printed by the terminal): never let a browser or proxy store them.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
// Public decoy routes (docs/FAIR_PLAY.md): before body parsing and before every auth-protected router, so scrapers
// and unauthenticated agents reach them and a malformed body cannot dodge them.
app.use(honeypotRouter);
app.use(express.json({ limit: '100kb' }));
app.use('/api/health', healthRouter);
app.use('/api', authRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/challenges', challengesRouter);
app.use('/api/instances', instancesRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/terminal', terminalRouter);
app.use('/api', socialRouter);
app.use('/api/cipherlab', cipherlabRouter);
app.use('/api/weblab', weblabRouter);
app.use('/api/forensics', forensicsRouter);
app.use('/api/admin/challenges', adminChallengesRouter);
app.use('/api/admin/stats', adminStatsRouter);
app.use('/api/admin/instances', adminInstancesRouter);
app.use('/api/admin/teams', adminTeamsRouter);
app.use('/api/admin/integrity', adminIntegrityRouter);
app.use('/api/admin', adminV2Router);
app.use('/api/announcement', announcementRouter);
app.use(notFound);
app.use(errorHandler);

export default app;
