import os from 'node:os';
import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', replica: os.hostname() });
});

export default router;
