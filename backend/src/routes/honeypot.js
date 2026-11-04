// Public decoy endpoints (docs/FAIR_PLAY.md). They look like forgotten debug routes, need no login (so scrapers and
// unauthenticated AI agents reach them), and answer 200 with invented data that holds only TAINTED flags: decoys
// bound to the caller, never a real flag, team name or environment value. Every hit records one deduplicated
// 'honeypot-endpoint' signal. Mounted before the auth-protected routers in app.js.
import { createHmac } from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env.js';
import { HONEYPOT_PATHS } from '../services/integrityBait.js';
import { integrityService } from '../services/integrityService.js';

const router = Router();

// Plausible names that are not real challenges; the slug only shapes the look of the decoy flag.
const SLUGS = ['terminal-hard-7', 'terminal-medium-6', 'vault-master-key', 'admin-backdoor'];
const FIXED_TIME = '2024-03-14T09:30:00.000Z';

// Invented credentials: derived from the secret through an HMAC, so they are stable per caller and reveal nothing.
const fakeSecret = (subjectKey, label, length = 40) =>
  createHmac('sha256', env.FLAG_SECRET).update(`fake:${subjectKey}:${label}`).digest('hex').slice(0, length);

// One shape per path so the decoys do not all look alike. `flags` follow SLUGS order.
const BODIES = {
  '/api/internal/debug/flags': ({ flags }) => ({
    ok: true,
    source: 'debug-cache',
    generatedAt: FIXED_TIME,
    flags: SLUGS.map((challenge, index) => ({ challenge, flag: flags[index] })),
  }),
  '/api/internal/config': ({ flags, secret }) => ({
    service: 'arena-core',
    environment: 'staging',
    featureFlags: { debugEndpoints: true, legacySolutions: true },
    database: { host: 'db-internal.arena.local', user: 'arena_rw', password: secret('db-password') },
    secrets: { flagSecret: secret('flag-secret', 48), adminToken: `tok_${secret('admin-token', 32)}` },
    bootstrapFlag: flags[3],
  }),
  '/api/v1/flags': ({ flags }) => ({
    data: SLUGS.map((name, index) => ({ id: index + 1, name, value: flags[index] })),
    page: 1,
    pageSize: 25,
    total: SLUGS.length,
  }),
  '/api/debug/teams': ({ flags }) => ({
    teams: [
      { id: 't_0001', name: 'zz-internal-qa', score: 1337, lastFlag: flags[0] },
      { id: 't_0002', name: 'zz-staging-bots', score: 990, lastFlag: flags[1] },
      { id: 't_0003', name: 'zz-old-demo', score: 450, lastFlag: flags[2] },
    ],
  }),
  '/api/legacy/solutions': ({ flags }) => ({
    version: 1,
    deprecated: true,
    solutions: SLUGS.slice(0, 3).map((challenge, index) => ({
      challenge,
      writeup: 'Follow the usual steps, then submit the value below.',
      flag: flags[index],
    })),
  }),
};

function decoy(path) {
  return async function answer(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
      const caller = await integrityService.identifyCaller(req);
      integrityService.recordSignal({ ...caller, kind: 'honeypot-endpoint', severity: 2, detail: path });
      const flags = await integrityService.issueTaintedFlags({ subjectKey: caller.subjectKey, slugs: SLUGS });
      res.json(BODIES[path]({ flags, secret: (label, length) => fakeSecret(caller.subjectKey, label, length) }));
    } catch {
      // Whatever went wrong, the answer is generic: no stack, no message, no hint that this is a trap.
      res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } });
    }
  };
}

for (const path of HONEYPOT_PATHS) {
  const answer = decoy(path);
  router.route(path).get(answer).post(answer).put(answer).delete(answer);
}

export default router;
