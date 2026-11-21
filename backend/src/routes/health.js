import os from 'node:os';
import mongoose from 'mongoose';
import { Router } from 'express';
import { indexStatus } from '../services/indexGuard.js';

const router = Router();

// `indexes` is additive: 'ok' or 'missing' (never which ones: see the server log), and absent whenever it cannot be
// determined (database down, check failed or timed out). The check is cached, so this route stays cheap.
router.get('/', async (req, res) => {
  const body = {
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'up' : 'down',
    replica: os.hostname(),
  };
  const indexes = await indexStatus().catch(() => null);
  if (indexes) { body.indexes = indexes; }
  res.json(body);
});

export default router;
