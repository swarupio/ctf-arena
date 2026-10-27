import os from 'node:os';
import mongoose from 'mongoose';
import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'up' : 'down',
    replica: os.hostname(),
  });
});

export default router;
