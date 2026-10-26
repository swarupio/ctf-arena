import express from 'express';
import helmet from 'helmet';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { servedBy } from './middleware/servedBy.js';
import healthRouter from './routes/health.js';

const app = express();

app.disable('x-powered-by');
app.use(servedBy);
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use('/api/health', healthRouter);
app.use(notFound);
app.use(errorHandler);

export default app;
