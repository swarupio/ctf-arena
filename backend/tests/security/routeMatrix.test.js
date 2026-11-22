// Route inventory + authentication/authorization matrix.
//
// 1. Introspects the REAL Express app (router stacks) and lists every route that exists.
// 2. Fails when a route exists that is not in TABLE below (or the other way round), so a new endpoint cannot be added
//    without somebody deciding, in this file, who may call it.
// 3. Derives the access level of every route from its middleware chain (auth + requireRole) and compares it to TABLE.
// 4. Calls every protected route with no token, bad tokens, malformed headers, odd claim sets and the wrong role, and
//    proves the answer is 401/403 and that no data was touched before the decision.
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import { auth } from '../../src/middleware/auth.js';
import { HONEYPOT_PATHS } from '../../src/services/integrityBait.js';
import { database, models } from './helpers/fakeDb.js';
import { call, getApp, getServer, seedWorld, verify } from './helpers/harness.js';

// These tests drive the whole app; stay robust when the full suite runs in parallel on a busy machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

vi.mock('../../src/config/cognito.js', async () => (await import('./helpers/harness.js')).cognitoModule());
vi.mock('../../src/terminal/shell.js', async () => (await import('./helpers/harness.js')).shellModule());
vi.mock('../../src/services/dockerService.js', async () => (await import('./helpers/fakeDb.js')).fakeDockerModule());
vi.mock('../../src/models/User.js', async () => (await import('./helpers/fakeDb.js')).modelModule('User'));
vi.mock('../../src/models/Team.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Team'));
vi.mock('../../src/models/Challenge.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Challenge'));
vi.mock('../../src/models/Instance.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Instance'));
vi.mock('../../src/models/Achievement.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Achievement'));
vi.mock('../../src/models/Solve.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Solve'));
vi.mock('../../src/models/Submission.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Submission'));
vi.mock('../../src/models/ReplicaStat.js', async () => (await import('./helpers/fakeDb.js')).modelModule('ReplicaStat'));
vi.mock('../../src/models/AttemptCounter.js', async () => (await import('./helpers/fakeDb.js')).modelModule('AttemptCounter'));
vi.mock('../../src/models/CheatSignal.js', async () => (await import('./helpers/fakeDb.js')).modelModule('CheatSignal'));
vi.mock('../../src/models/TaintedFlag.js', async () => (await import('./helpers/fakeDb.js')).modelModule('TaintedFlag'));
vi.mock('../../src/models/TerminalActivity.js', async () => (await import('./helpers/fakeDb.js')).modelModule('TerminalActivity'));
vi.mock('../../src/models/AuditLog.js', async () => (await import('./helpers/fakeDb.js')).emptyModelModule());
vi.mock('../../src/models/AppSetting.js', async () => (await import('./helpers/fakeDb.js')).emptyModelModule({ ANNOUNCEMENT_LEVELS: ['info', 'warning', 'critical'] }));
vi.mock('../../src/models/CipherHint.js', async () => (await import('./helpers/fakeDb.js')).modelModule('CipherHint'));
vi.mock('../../src/models/CrackmeHint.js', async () => (await import('./helpers/fakeDb.js')).modelModule('CrackmeHint'));
vi.mock('../../src/models/CrackmePatch.js', async () => (await import('./helpers/fakeDb.js')).modelModule('CrackmePatch'));
vi.mock('../../src/models/OsintHint.js', async () => (await import('./helpers/fakeDb.js')).modelModule('OsintHint'));
vi.mock('../../src/models/HintOpen.js', async () => (await import('./helpers/fakeDb.js')).modelModule('HintOpen'));
// Tag every requireRole() guard with the roles it was built with, so the access level can be read off the chain.
vi.mock('../../src/middleware/requireRole.js', async (importOriginal) => {
  const original = await importOriginal();
  return { requireRole: (...roles) => Object.assign(original.requireRole(...roles), { roles }) };
});

// ---- THE TABLE: every route of the API and who may call it ------------------------------------------------------
//   none  = public, no token needed (health, documented honeypot decoys)
//   any   = any authenticated user (player or admin)
//   player / admin = exactly that role (roles are exact: an admin is not a player and vice versa)
const TABLE = [
  ['GET', '/api/health', 'none'],
  ...HONEYPOT_PATHS.flatMap((path) => ['GET', 'POST', 'PUT', 'DELETE'].map((method) => [method, path, 'none'])),

  ['GET', '/api/me', 'any'],
  ['PATCH', '/api/me', 'any'],

  ['POST', '/api/teams', 'player'],
  ['POST', '/api/teams/join', 'player'],
  ['GET', '/api/teams/me', 'player'],
  ['POST', '/api/teams/me/leave', 'player'],

  ['GET', '/api/challenges', 'any'],
  ['GET', '/api/challenges/:id', 'any'],
  ['POST', '/api/challenges/:id/instance', 'player'],
  ['POST', '/api/challenges/:id/submit', 'player'],

  ['GET', '/api/instances', 'player'],
  ['POST', '/api/instances/:id/extend', 'player'],
  ['DELETE', '/api/instances/:id', 'player'],

  ['GET', '/api/leaderboard', 'any'],
  ['GET', '/api/leaderboard/timeline', 'any'],
  ['GET', '/api/leaderboard/me', 'any'],

  ['GET', '/api/feed', 'any'],
  ['GET', '/api/daily', 'any'],
  ['GET', '/api/players/:id/profile', 'any'],
  ['GET', '/api/me/achievements', 'any'],

  ['GET', '/api/terminal/modes', 'any'],
  ['GET', '/api/terminal/:mode/progress', 'any'],
  ['POST', '/api/terminal/:mode/exec', 'any'],
  ['POST', '/api/terminal/:mode/complete', 'any'],
  ['POST', '/api/terminal/:mode/submit', 'player'],
  ['GET', '/api/forensics/tracks', 'any'],
  ['GET', '/api/forensics/tracks/:track', 'any'],
  ['GET', '/api/forensics/tracks/:track/artefacts/:artefact', 'any'],
  ['GET', '/api/forensics/tracks/:track/interviews', 'any'],
  ['POST', '/api/forensics/tracks/:track/interviews', 'any'],
  ['POST', '/api/forensics/tracks/:track/stages/:n/hint', 'any'],
  ['POST', '/api/forensics/tracks/:track/stages/:n/answer', 'player'],

  ['GET', '/api/osint/cases', 'any'],
  ['GET', '/api/osint/cases/:track', 'any'],
  ['GET', '/api/osint/cases/:track/sources/:source', 'any'],
  ['GET', '/api/osint/cases/:track/search', 'any'],
  ['GET', '/api/osint/cases/:track/board', 'any'],
  ['GET', '/api/osint/cases/:track/board/evidence', 'any'],
  ['PUT', '/api/osint/cases/:track/board', 'player'],
  ['POST', '/api/osint/cases/:track/board/check', 'any'],
  ['POST', '/api/osint/cases/:track/questions/:n/answer', 'player'],
  ['POST', '/api/osint/cases/:track/questions/:n/hints', 'player'],
  ['GET', '/api/osint/admin/hints', 'admin'],

  ['GET', '/api/cipherlab/overview', 'any'],
  ['GET', '/api/cipherlab/levels/:id', 'any'],
  ['POST', '/api/cipherlab/levels/:id/hints', 'any'], // admins preview hints; nothing is stored for them
  ['POST', '/api/cipherlab/levels/:id/answer', 'player'],
  ['GET', '/api/cipherlab/admin/hints', 'admin'],
  ['GET', '/api/crackme/overview', 'any'],
  ['GET', '/api/crackme/levels/:id', 'any'],
  ['POST', '/api/crackme/levels/:id/hints', 'player'],
  ['POST', '/api/crackme/levels/:id/answer', 'player'],
  ['POST', '/api/crackme/levels/:id/patch', 'player'],
  ['GET', '/api/crackme/admin/hints', 'admin'],
  ['GET', '/api/weblab/labs', 'any'],
  ['GET', '/api/weblab/labs/:slug', 'any'],
  ['POST', '/api/weblab/labs/:slug/hints/:level', 'any'],
  ['POST', '/api/weblab/labs/:slug/request', 'any'],
  ['POST', '/api/weblab/labs/:slug/submit', 'player'],

  ['GET', '/api/admin/challenges', 'admin'],
  ['POST', '/api/admin/challenges', 'admin'],
  ['PUT', '/api/admin/challenges/:id', 'admin'],
  ['DELETE', '/api/admin/challenges/:id', 'admin'],
  ['GET', '/api/admin/stats', 'admin'],
  ['GET', '/api/admin/instances', 'admin'],
  ['POST', '/api/admin/instances/:id/kill', 'admin'],
  ['GET', '/api/admin/teams', 'admin'],
  ['PATCH', '/api/admin/teams/:id/ban', 'admin'],
  ['GET', '/api/admin/integrity', 'admin'],
  ['DELETE', '/api/admin/integrity/:userId', 'admin'],

  // Admin API v2 (docs/API_SPEC.md "Admin API v2"); GET /api/announcement is public on purpose (banner text only).
  ['GET', '/api/announcement', 'none'],
  // GET /api/event is public on purpose too (scheduled-event name, phase and times only; docs/EVENT_MODE.md).
  ['GET', '/api/event', 'none'],
  // GET /api/hint-costs is public too (the five hint-cost numbers; docs/HINTS.md "Hint costs").
  ['GET', '/api/hint-costs', 'none'],
  ...[
    ['GET', '/challenges/export'], ['POST', '/challenges/import'], ['PATCH', '/challenges/:id/visibility'],
    ['POST', '/challenges/:id/duplicate'], ['GET', '/challenges/:id/stats'], ['POST', '/challenges/:id/reset-solves'],
    ['GET', '/stats/overview'], ['GET', '/stats/timeseries'],
    ['GET', '/teams/:id'], ['PATCH', '/teams/:id'], ['DELETE', '/teams/:id'], ['DELETE', '/teams/:id/members/:userId'],
    ['POST', '/teams/:id/invite-code/regenerate'], ['POST', '/teams/:id/score-adjustments'],
    ['GET', '/integrity/summary'], ['GET', '/integrity/users'], ['POST', '/integrity/:userId/resolve'],
    ['GET', '/users'], ['GET', '/users/:id'], ['PATCH', '/users/:id/ban'], ['POST', '/users/:id/remove-from-team'],
    ['POST', '/users/:id/reset-terminal'],
    ['GET', '/solves'], ['DELETE', '/solves/:id'], ['GET', '/submissions'], ['GET', '/audit'],
    ['GET', '/settings'], ['PUT', '/settings'],
    ['GET', '/export/users.csv'], ['GET', '/export/teams.csv'], ['GET', '/export/submissions.csv'], ['GET', '/export/leaderboard.csv'],
  ].map(([method, path]) => [method, `/api/admin${path}`, 'admin']),
];
const keyOf = (method, path) => `${method} ${path}`;
const accessByKey = new Map(TABLE.map(([method, path, access]) => [keyOf(method, path), access]));
const PUBLIC_KEYS = TABLE.filter(([, , access]) => access === 'none').map(([method, path]) => keyOf(method, path));

// ---- introspection of the real app --------------------------------------------------------------------------------
const mounts = new Map(); // router/middleware function -> the path it was mounted at
const realUse = express.Router.prototype.use;
express.Router.prototype.use = function recordMountPath(...args) {
  const path = typeof args[0] === 'string' ? args[0] : '/';
  for (const fn of args.flat(Infinity)) { if (typeof fn === 'function') { mounts.set(fn, path); } }
  return realUse.apply(this, args);
};

const joinPath = (prefix, path) => {
  const joined = `${prefix}/${path}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
};

function walk(router, prefix, inherited) {
  const found = [];
  const chain = [...inherited];
  for (const layer of router.stack) {
    if (layer.route) {
      const path = joinPath(prefix, layer.route.path);
      const methods = Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]);
      for (const method of methods) {
        const applicable = chain.filter((entry) => entry.scope === '/' || path.startsWith(entry.scope)).map((entry) => entry.handle);
        found.push({
          method: method === '_all' ? 'ALL' : method.toUpperCase(),
          path,
          chain: [...applicable, ...layer.route.stack.map((item) => item.handle)],
        });
      }
    } else if (Array.isArray(layer.handle.stack)) {
      found.push(...walk(layer.handle, joinPath(prefix, mounts.get(layer.handle) ?? '/'), chain.filter((entry) => {
        const mount = joinPath(prefix, mounts.get(layer.handle) ?? '/');
        return entry.scope === '/' || mount.startsWith(entry.scope);
      })));
    } else {
      chain.push({ handle: layer.handle, scope: joinPath('/', mounts.get(layer.handle) ?? '/') });
    }
  }
  return found;
}

// 'none' when auth is not in the chain; otherwise the roles that survive every requireRole guard.
function accessOf(chain) {
  const authAt = chain.indexOf(auth);
  if (authAt === -1) { return 'none'; }
  const guards = chain.filter((handler) => Array.isArray(handler.roles));
  if (guards.some((guard) => chain.indexOf(guard) < authAt)) { return 'role-check-before-auth'; }
  const allowed = ['player', 'admin'].filter((role) => guards.every((guard) => guard.roles.includes(role)));
  if (allowed.length === 2) { return 'any'; }
  return allowed[0] ?? 'nobody';
}

let routes;
let app;
let server;
beforeAll(async () => {
  app = await getApp();
  server = await getServer();
  express.Router.prototype.use = realUse;
  routes = walk(app.router, '/', []);
});
afterAll(() => replicaCounter.stop());
beforeEach(() => {
  seedWorld();
  verify.mockClear();
});

const sample = (path) => path.replace(':mode', 'easy').replace(/:\w+/g, '0'.repeat(24));
const requestFor = (method, path, token, rawHeader) => {
  let req = request(server)[method.toLowerCase()](sample(path));
  if (rawHeader !== undefined) { req = req.set('Authorization', rawHeader); }
  else if (token !== undefined && token !== null) { req = req.set('Authorization', `Bearer ${token}`); }
  return ['POST', 'PUT', 'PATCH'].includes(method) ? req.send({}) : req;
};
const protectedRoutes = TABLE.filter(([, , access]) => access !== 'none');
const rejected = (status) => status === 401 || status === 403;

describe('route inventory', () => {
  it('finds the routes (sanity check of the introspection itself)', () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.map((route) => keyOf(route.method, route.path))).toContain('GET /api/health');
  });

  it('self-test: the detector reports an unguarded route as public and a guarded one with its role', () => {
    const router = express.Router();
    router.get('/open', () => {});
    router.use(auth, Object.assign(() => {}, { roles: ['admin'] }));
    router.get('/closed', () => {});
    router.post('/own-guard', Object.assign(() => {}, { roles: ['player'] }), () => {});
    const found = walk(router, '/t', []).map((route) => [route.path, accessOf(route.chain)]);
    // Without auth in the chain a role guard alone is not protection: the route still counts as public.
    expect(found).toEqual([['/t/open', 'none'], ['/t/closed', 'admin'], ['/t/own-guard', 'nobody']]);
    const bare = express.Router();
    bare.post('/guard-only', Object.assign(() => {}, { roles: ['player'] }), () => {});
    expect(walk(bare, '/b', []).map((route) => accessOf(route.chain))).toEqual(['none']);
  });

  it('has no route that is missing from the table, and no table row without a route', () => {
    const discovered = new Set(routes.map((route) => keyOf(route.method, route.path)));
    const missingFromTable = [...discovered].filter((key) => !accessByKey.has(key));
    const missingRoute = [...accessByKey.keys()].filter((key) => !discovered.has(key));
    // A new endpoint must be added to TABLE (with its required access) before it can ship.
    expect(missingFromTable, 'routes that exist but are not in TABLE (decide who may call them)').toEqual([]);
    expect(missingRoute, 'TABLE rows with no route (stale entries)').toEqual([]);
  });

  it('only exposes health, the announcement banner, the event schedule, the hint costs and the documented honeypot decoys without authentication', () => {
    const open = routes.filter((route) => accessOf(route.chain) === 'none').map((route) => keyOf(route.method, route.path));
    expect(open.sort()).toEqual([...PUBLIC_KEYS].sort());
    expect(PUBLIC_KEYS.filter((key) => !key.includes('/api/health') && !key.endsWith(' /api/announcement') && !key.endsWith(' /api/event') && !key.endsWith(' /api/hint-costs') && !HONEYPOT_PATHS.some((path) => key.endsWith(` ${path}`)))).toEqual([]);
  });

  it('wires the required access into each route chain, with auth before any role check', () => {
    const wrong = routes
      .map((route) => ({ key: keyOf(route.method, route.path), derived: accessOf(route.chain), expected: accessByKey.get(keyOf(route.method, route.path)) }))
      .filter(({ derived, expected }) => expected !== undefined && derived !== expected);
    expect(wrong).toEqual([]);
  });

  it('has a Router-level auth guard on every sub-router, so an unmatched sub-path also needs a token', async () => {
    for (const path of ['/api/teams/zzz', '/api/instances/zzz/zzz', '/api/admin/stats/zzz', '/api/admin/integrity/a/b']) {
      const response = await request(server).get(path);
      expect(response.status, path).toBe(401);
    }
  });
});

describe('authentication and authorization of every protected route', () => {
  it.each(protectedRoutes)('%s %s rejects a missing token and bad tokens with 401', async (method, path) => {
    const before = database.operations;
    const attempts = [
      requestFor(method, path),
      requestFor(method, path, 'garbage'),
      requestFor(method, path, 'expired-token'),
      requestFor(method, path, 'wrong-audience-token'),
      requestFor(method, path, undefined, 'Basic YWxpY2U6c2VjcmV0'),
      requestFor(method, path, undefined, 'Bearer'),
      requestFor(method, path, undefined, 'Bearer '),
      requestFor(method, path, undefined, 'bearer alice extra'),
      requestFor(method, path, undefined, 'Bearer alice,bob'),
      requestFor(method, path, undefined, 'alice'),
      requestFor(method, path, undefined, ''),
    ];
    for (const attempt of attempts) {
      const response = await attempt;
      expect(response.status, `${method} ${path} ${response.request?.header?.Authorization}`).toBe(401);
      expect(response.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
    }
    expect(database.operations, 'data was touched before authentication').toBe(before);
  });

  it.each(protectedRoutes)('%s %s rejects valid tokens with malformed claims (401)', async (method, path) => {
    const before = database.operations;
    for (const token of ['no-email', 'bad-email', 'no-sub', 'empty-sub', 'groups-as-string', 'groups-with-objects']) {
      const response = await requestFor(method, path, token);
      expect(response.status, `${method} ${path} with ${token}`).toBe(401);
    }
    expect(database.operations).toBe(before);
  });

  it.each(protectedRoutes.filter(([, , access]) => access === 'admin'))('%s %s: only the exact admin group passes', async (method, path) => {
    const before = database.operations;
    const notAdmins = [
      'alice', 'bob', 'carol', 'eve', 'groups-none', 'groups-empty', 'groups-admin-upper', 'groups-admin-padded',
      'groups-admin-suffix', 'groups-admin-prefix', 'groups-admin-substring', 'mallory',
    ];
    for (const token of notAdmins) {
      const response = await requestFor(method, path, token);
      expect(response.status, `${method} ${path} with ${token}`).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
    expect(database.operations, 'data was touched before the role check').toBe(before);
    for (const token of ['admin', 'groups-player-and-admin']) {
      const response = await requestFor(method, path, token);
      expect(rejected(response.status), `${method} ${path} with ${token} -> ${response.status}`).toBe(false);
    }
  });

  it.each(protectedRoutes.filter(([, , access]) => access === 'player'))('%s %s: admins get 403, players pass the guard', async (method, path) => {
    const before = database.operations;
    for (const token of ['admin', 'groups-player-and-admin']) {
      // An account that is in both groups is an admin, and admins are not players on player-only routes.
      const response = await requestFor(method, path, token);
      expect(response.status, `${method} ${path} with ${token}`).toBe(403);
    }
    expect(database.operations, 'data was touched before the role check').toBe(before);
    for (const token of ['alice', 'carol', 'groups-none', 'groups-admin-upper']) {
      const response = await requestFor(method, path, token);
      expect(rejected(response.status), `${method} ${path} with ${token} -> ${response.status}`).toBe(false);
    }
  });

  it.each(protectedRoutes.filter(([, , access]) => access === 'any'))('%s %s: any authenticated role passes', async (method, path) => {
    for (const token of ['alice', 'carol', 'admin', 'groups-none']) {
      const response = await requestFor(method, path, token);
      expect(rejected(response.status), `${method} ${path} with ${token} -> ${response.status}`).toBe(false);
    }
  });

  it('never calls the verifier for a missing or malformed Authorization header', async () => {
    await request(server).get('/api/me');
    await request(server).get('/api/me').set('Authorization', 'Basic abc');
    await request(server).get('/api/me').set('Authorization', 'Bearer a b');
    expect(verify).not.toHaveBeenCalled();
  });

  it('treats the same e-mail address in another case as a different person (identity is the Cognito sub)', async () => {
    const response = await call('get', '/api/teams/me', 'mallory');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NO_TEAM');
    const me = await call('get', '/api/me', 'mallory');
    expect(me.status).toBe(200);
    expect(me.body.team).toBeNull();
    expect(me.body.id).not.toBe(seedUserId('alice'));
  });

  it('derives the role from the token on every request, never from the stored row', async () => {
    // The database says admin has role admin and alice player; flip alice's row to admin: the token still decides.
    models.User.docs.get(seedUserId('alice')).role = 'admin';
    expect((await call('get', '/api/admin/stats', 'alice')).status).toBe(403);
    expect((await call('get', '/api/me', 'alice')).body.role).toBe('player');
    // And the stored role follows the token, not the other way round.
    expect(models.User.docs.get(seedUserId('alice')).role).toBe('player');
  });
});

const seedUserId = (key) => models.User.all().find((user) => user.cognitoSub === key)._id;

describe('methods and paths that are not in the table', () => {
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  it('never answers 2xx/5xx for an undocumented method on a documented path, even to an admin', async () => {
    const paths = [...new Set(TABLE.map(([, path]) => path))];
    for (const path of paths) {
      for (const method of methods.filter((candidate) => !accessByKey.has(keyOf(candidate, path)))) {
        const response = await requestFor(method, path, 'admin');
        expect(response.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
        expect(response.status, `${method} ${path}`).toBeLessThan(500);
      }
    }
  });

  it.each(['/nope', '/api', '/api/', '/api/nope', '/api/admin', '/api/admin/nope', '/api/terminal/easy/nope', '/.env', '/api/../.env'])(
    'answers %s with a JSON 4xx and nothing else', async (path) => {
      for (const token of [null, 'alice', 'admin']) {
        const response = await call('get', path, token);
        expect([401, 403, 404], `${path} with ${token}`).toContain(response.status);
        expect(response.headers['content-type']).toMatch(/json/);
      }
    },
  );

  it('answers unknown public paths with the standard NOT_FOUND body', async () => {
    const response = await request(server).get('/api/definitely-not-here');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
});

describe('transport headers and CORS', () => {
  it('hides the framework, disables caching of API answers and sets security headers', async () => {
    for (const [path, token] of [['/api/health', null], ['/api/me', 'alice'], ['/api/nope', null], ['/api/teams/me', null]]) {
      const response = await call('get', path, token);
      expect(response.headers['x-powered-by'], path).toBeUndefined();
      expect(response.headers['cache-control'], path).toBe('no-store');
      expect(response.headers['x-content-type-options'], path).toBe('nosniff');
      expect(response.headers['x-served-by'], path).toBeTruthy();
    }
  });

  it('sends no CORS headers, also not for a preflight from a foreign origin', async () => {
    const preflight = await request(server).options('/api/me')
      .set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    const simple = await call('get', '/api/me', 'alice', undefined, { Origin: 'https://evil.example' });
    for (const response of [preflight, simple]) {
      expect(Object.keys(response.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
    }
  });
});

// ---- malformed input on every route --------------------------------------------------------------------------------
// Whatever a client sends (broken JSON, operators in place of strings, odd path ids, hostile query strings), every route
// must answer with a non-5xx status, and any 4xx must use the standard { error: { code, message } } shape: never HTML,
// never a stack trace, never a driver message.
describe('malformed input on every route keeps the standard error shape', () => {
  const tokenFor = (access) => (access === 'none' ? null : access === 'admin' ? 'admin' : 'alice');
  const HONEYPOT_KEYS = new Set(TABLE.filter(([, path]) => HONEYPOT_PATHS.includes(path)).map(([method, path]) => keyOf(method, path)));
  const LEAK = /node_modules|\bat \S+ \(|MongoServerError|MongooseError|CastError|ValidationError|ObjectId|E11000|<html|<!doctype|stack/i;
  const BAD_IDS = ['%7B%22%24gt%22%3A%22%22%7D', '..%2F..%2Fetc%2Fpasswd', 'x'.repeat(300), '%00', '507f1f77bcf86cd79943901', '-1', 'null'];
  const QUERIES = [
    '?q[$gt]=&limit[$ne]=1', '?page=-1&limit=1e9', '?sort=-password&q=%7B%22%24gt%22%3A%22%22%7D', '?limit=abc&page=NaN', '?limit=1&limit=2',
    `?q=${'a'.repeat(5000)}`, '?q=(a%2B)%2B%24&track[$ne]=x',
  ];
  const BODIES = [
    '{"$gt":""}', '{"flag":{"$gt":""},"name":{"$ne":null},"inviteCode":{"$ne":null},"q":{"$gt":""},"displayName":{"$regex":".*"}}',
    '[]', '"text"', 'null', '123', '{"__proto__":{"admin":true},"constructor":{"prototype":{"x":1}}}',
  ];

  function expectSafe(response, label) {
    // 503 is allowed only for the documented "game not seeded yet" answer of a fresh database.
    const notSeeded = response.status === 503 && /NOT_SEEDED$/.test(response.body?.error?.code ?? '');
    if (!notSeeded) { expect(response.status, label).toBeLessThan(500); }
    if (response.status >= 400) {
      expect(response.headers['content-type'], label).toMatch(/application\/json/);
      expect(Object.keys(response.body), label).toEqual(['error']);
      expect(typeof response.body.error.code, label).toBe('string');
      expect(response.body.error.code, label).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(typeof response.body.error.message, label).toBe('string');
      expect(response.text, label).not.toMatch(LEAK);
    }
  }

  const send = (method, path, token, { body, contentType = 'application/json' } = {}) => {
    let req = request(server)[method.toLowerCase()](path);
    if (token) { req = req.set('Authorization', `Bearer ${token}`); }
    return body === undefined ? req : req.set('Content-Type', contentType).send(body);
  };
  const withParams = (path, value) => path.replace(/:\w+/g, value);
  const hasBody = (method) => ['POST', 'PUT', 'PATCH'].includes(method);

  it('answers broken JSON with 400 VALIDATION_ERROR on every route that sits behind the body parser', async () => {
    const targets = TABLE.filter(([method, path]) => hasBody(method) && !HONEYPOT_KEYS.has(keyOf(method, path)));
    expect(targets.length).toBeGreaterThan(30);
    for (const [method, path, access] of targets) {
      for (const body of ['{"a":', '{bad json}', '\u0000\u0001']) {
        const response = await send(method, sample(path), tokenFor(access), { body });
        expect(response.status, `${method} ${path}`).toBe(400);
        expect(response.body, `${method} ${path}`).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' } });
      }
    }
  });

  it('survives operators, arrays and prototype keys in the body of every write route', async () => {
    for (const [method, path, access] of TABLE.filter(([method]) => hasBody(method))) {
      for (const body of BODIES) {
        expectSafe(await send(method, sample(path), tokenFor(access), { body }), `${method} ${path} ${body.slice(0, 30)}`);
      }
      expectSafe(await send(method, sample(path), tokenFor(access), { body: 'a=1&b[$gt]=', contentType: 'application/x-www-form-urlencoded' }), `${method} ${path} form`);
      expectSafe(await send(method, sample(path), tokenFor(access), { body: '{"a":1}', contentType: 'text/plain' }), `${method} ${path} text`);
    }
  });

  it('survives hostile ids and slugs in every path parameter', async () => {
    for (const [method, path, access] of TABLE.filter(([, path]) => path.includes(':'))) {
      for (const id of BAD_IDS) {
        const body = hasBody(method) ? { body: '{}' } : {};
        expectSafe(await send(method, withParams(path, id), tokenFor(access), body), `${method} ${path} <- ${id.slice(0, 20)}`);
      }
    }
  });

  it('survives hostile query strings on every route', async () => {
    for (const [method, path, access] of TABLE) {
      for (const query of QUERIES) {
        const body = hasBody(method) ? { body: '{}' } : {};
        expectSafe(await send(method, `${sample(path)}${query}`, tokenFor(access), body), `${method} ${path}${query.slice(0, 30)}`);
      }
    }
  });

  it('never returns a stack trace or driver text in production mode, whatever fails underneath', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const marker = 'at secretFunction (/srv/app/node_modules/mongoose/lib/connection.js:99:9)';
    const failure = new Error(`connect ECONNREFUSED mongodb+srv://u:hunter2@cluster/db ${marker}`);
    failure.stack = `Error: boom\n    ${marker}`;
    const writes = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    database.failure = failure;
    try {
      let failures = 0;
      for (const [method, path, access] of TABLE.filter(([, path]) => !HONEYPOT_PATHS.includes(path))) {
        const response = await send(method, sample(path), tokenFor(access), hasBody(method) ? { body: '{}' } : {});
        if (response.status >= 500) {
          failures += 1;
          expect(response.body, `${method} ${path}`).toEqual({ error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } });
        }
        expect(`${response.text} ${JSON.stringify(response.headers)}`, `${method} ${path}`).not.toMatch(/secretFunction|node_modules|hunter2|ECONNREFUSED|mongodb|\bat \S+ \(/);
      }
      expect(failures).toBeGreaterThan(20);
    } finally {
      database.failure = null;
      spy.mockRestore();
      vi.unstubAllEnvs();
    }
    expect(writes.join('')).not.toMatch(/secretFunction|node_modules|hunter2|ECONNREFUSED|mongodb/);
  });

  it('sends HSTS, CSP, no cookies and a request id on API answers, including errors', async () => {
    for (const [path, token] of [['/api/health', null], ['/api/me', 'alice'], ['/api/nope', null], ['/api/teams/me', null]]) {
      const response = await call('get', path, token);
      expect(response.headers['strict-transport-security'], path).toMatch(/max-age=\d+/);
      expect(response.headers['content-security-policy'], path).toContain("default-src 'self'");
      expect(response.headers['x-frame-options'], path).toBeTruthy();
      expect(response.headers['set-cookie'], path).toBeUndefined();
      expect(response.headers['x-request-id'], path).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
