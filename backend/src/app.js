import express from 'express';
import helmet from 'helmet';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { servedBy } from './middleware/servedBy.js';
import { requestCounter } from './middleware/requestCounter.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import teamsRouter from './routes/teams.js';
import challengesRouter from './routes/challenges.js';
import instancesRouter from './routes/instances.js';
import leaderboardRouter from './routes/leaderboard.js';
import terminalRouter from './routes/terminal.js';
import socialRouter from './routes/social.js';
import cipherlabRouter from './routes/cipherlab.js';
import weblabRouter from './routes/weblab.js';
import forensicsRouter from './routes/forensics.js';
import osintRouter from './routes/osint.js';
import honeypotRouter from './routes/honeypot.js';
import adminChallengesRouter from './routes/admin/challenges.js';
import adminStatsRouter from './routes/admin/stats.js';
import adminInstancesRouter from './routes/admin/instances.js';
import adminTeamsRouter from './routes/admin/teams.js';
import adminIntegrityRouter from './routes/admin/integrity.js';
import adminV2Router from './routes/admin/index.js';
import announcementRouter from './routes/announcement.js';

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
app.use('/api/osint', osintRouter);
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
