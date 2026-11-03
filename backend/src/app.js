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
import adminChallengesRouter from './routes/admin/challenges.js';
import adminStatsRouter from './routes/admin/stats.js';
import adminInstancesRouter from './routes/admin/instances.js';
import adminTeamsRouter from './routes/admin/teams.js';

const app = express();

app.disable('x-powered-by');
app.use(servedBy);
app.use(requestCounter);
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use('/api/health', healthRouter);
app.use('/api', authRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/challenges', challengesRouter);
app.use('/api/instances', instancesRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/admin/challenges', adminChallengesRouter);
app.use('/api/admin/stats', adminStatsRouter);
app.use('/api/admin/instances', adminInstancesRouter);
app.use('/api/admin/teams', adminTeamsRouter);
app.use(notFound);
app.use(errorHandler);

export default app;
