// Injection and parsing review: NoSQL operators through JSON bodies and Express 5 query parsing, arrays and objects
// where strings are expected, prototype-pollution keys, malformed and oversized bodies, odd content types,
// invalid ids and pagination limits. The fake database evaluates operators for real, so an operator that slipped
// through validation would change data or crash (an unsupported operator throws) and fail these tests.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import { models } from './helpers/fakeDb.js';
import { call, getApp, seedWorld, terminalFlagOf, verify, world } from './helpers/harness.js';

// These tests drive the whole app; stay robust when the full suite runs in parallel on a busy machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

vi.mock('../../src/config/cognito.js', async () => (await import('./helpers/harness.js')).cognitoModule());
vi.mock('../../src/terminal/shell.js', async () => (await import('./helpers/harness.js')).shellModule());
vi.mock('../../src/services/dockerService.js', async () => (await import('./helpers/fakeDb.js')).fakeDockerModule());
vi.mock('../../src/models/User.js', async () => (await import('./helpers/fakeDb.js')).modelModule('User'));
vi.mock('../../src/models/Team.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Team'));
vi.mock('../../src/models/Challenge.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Challenge'));
vi.mock('../../src/models/Instance.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Instance'));
vi.mock('../../src/models/Solve.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Solve'));
vi.mock('../../src/models/Submission.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Submission'));
vi.mock('../../src/models/ReplicaStat.js', async () => (await import('./helpers/fakeDb.js')).modelModule('ReplicaStat'));
vi.mock('../../src/models/AttemptCounter.js', async () => (await import('./helpers/fakeDb.js')).modelModule('AttemptCounter'));
vi.mock('../../src/models/CheatSignal.js', async () => (await import('./helpers/fakeDb.js')).modelModule('CheatSignal'));
vi.mock('../../src/models/TaintedFlag.js', async () => (await import('./helpers/fakeDb.js')).modelModule('TaintedFlag'));
vi.mock('../../src/models/TerminalActivity.js', async () => (await import('./helpers/fakeDb.js')).modelModule('TerminalActivity'));

seedWorld(); // ids are deterministic, so the it.each tables below can use them while the file is collected

let app;
beforeAll(async () => { app = await getApp(); });
afterAll(() => replicaCounter.stop());
beforeEach(() => {
  seedWorld();
  verify.mockClear();
});

// The request counter writes its own collection on a timer; it is not part of what a request may change.
const snapshot = () => JSON.stringify(Object.entries(models).filter(([name]) => name !== 'ReplicaStat').map(([, model]) => model.all()));
const oid = () => String(world.challenges.static._id);
const validChallenge = {
  slug: 'new-one', title: 'New One', category: 'misc', difficulty: 'easy', points: 10, type: 'static', flag: 'CTF{admin_chosen_flag}',
};
const raw = (method, path, token, body, type = 'application/json') => {
  let req = request(app)[method](path);
  if (token) { req = req.set('Authorization', `Bearer ${token}`); }
  return body === undefined ? req : req.set('Content-Type', type).send(body);
};

// Every body field of the API with a function that builds a body around a hostile value.
const BODY_FIELDS = () => [
  ['PATCH /api/me displayName', 'patch', '/api/me', 'alice', (v) => ({ displayName: v })],
  ['POST /api/teams name', 'post', '/api/teams', 'carol', (v) => ({ name: v })],
  ['POST /api/teams/join inviteCode', 'post', '/api/teams/join', 'carol', (v) => ({ inviteCode: v })],
  ['POST /api/challenges/:id/submit flag', 'post', `/api/challenges/${oid()}/submit`, 'alice', (v) => ({ flag: v })],
  ['POST /api/terminal/easy/submit flag', 'post', '/api/terminal/easy/submit', 'alice', (v) => ({ flag: v })],
  ['POST /api/terminal/easy/exec command', 'post', '/api/terminal/easy/exec', 'alice', (v) => ({ command: v })],
  ['POST /api/terminal/easy/exec cwd', 'post', '/api/terminal/easy/exec', 'alice', (v) => ({ command: 'ls', cwd: v })],
  ['POST /api/terminal/easy/complete partial', 'post', '/api/terminal/easy/complete', 'alice', (v) => ({ partial: v })],
  ['POST /api/terminal/easy/complete cwd', 'post', '/api/terminal/easy/complete', 'alice', (v) => ({ partial: 'l', cwd: v })],
  ['PATCH /api/admin/teams/:id/ban banned', 'patch', `/api/admin/teams/${world.teams.B._id}/ban`, 'admin', (v) => ({ banned: v })],
  ['POST /api/admin/challenges slug', 'post', '/api/admin/challenges', 'admin', (v) => ({ ...validChallenge, slug: v })],
  ['POST /api/admin/challenges title', 'post', '/api/admin/challenges', 'admin', (v) => ({ ...validChallenge, title: v })],
  ['POST /api/admin/challenges points', 'post', '/api/admin/challenges', 'admin', (v) => ({ ...validChallenge, points: v })],
  ['POST /api/admin/challenges flag', 'post', '/api/admin/challenges', 'admin', (v) => ({ ...validChallenge, flag: v })],
  ['POST /api/admin/challenges visible', 'post', '/api/admin/challenges', 'admin', (v) => ({ ...validChallenge, visible: v })],
  ['POST /api/admin/challenges attachments', 'post', '/api/admin/challenges', 'admin', (v) => ({ ...validChallenge, attachments: v })],
  ['POST /api/admin/challenges type', 'post', '/api/admin/challenges', 'admin', (v) => ({ ...validChallenge, type: v })],
  ['PUT /api/admin/challenges/:id category', 'put', `/api/admin/challenges/${oid()}`, 'admin', (v) => ({ ...validChallenge, category: v })],
];
const HOSTILE = [
  ['$ne operator', { $ne: null }], ['$gt operator', { $gt: '' }], ['$regex operator', { $regex: '.*' }],
  ['$where operator', { $where: 'sleep(1000)' }], ['$in operator', { $in: ['a', 'b'] }], ['$exists operator', { $exists: true }],
  ['array of strings', ['a', 'b']], ['array with operator', [{ $ne: 1 }]], ['empty array', []], ['empty object', {}],
  ['nested object', { a: { b: { c: 1 } } }], ['number', 123], ['boolean', true], ['null', null],
  ['object with toString', { toString: 'x', valueOf: 'y' }],
];

describe('NoSQL operators and wrong types in JSON bodies', () => {
  it.each(BODY_FIELDS())('%s: every hostile value is a 400 and nothing is written', async (label, method, path, token, build) => {
    const before = snapshot();
    for (const [name, value] of HOSTILE) {
      // `banned` and `visible` legitimately take booleans, `points` numbers: skip the one value that is valid there.
      if ((/banned|visible/.test(label) && value === true) || (/points/.test(label) && value === 123)
        || (/attachments/.test(label) && Array.isArray(value) && value.length === 0)) { continue; }
      const response = await call(method, path, token, build(value));
      expect(response.status, `${label} <- ${name}`).toBe(400);
      expect(response.body.error.code, `${label} <- ${name}`).toBe('VALIDATION_ERROR');
    }
    expect(snapshot()).toBe(before);
  });

  it('cannot log in as somebody else or join an arbitrary team with {"inviteCode":{"$ne":null}}', async () => {
    const response = await call('post', '/api/teams/join', 'carol', { inviteCode: { $ne: null } });
    expect(response.status).toBe(400);
    expect(models.User.docs.get(world.users.carol._id).teamId).toBeNull();
  });

  it('cannot read or solve a challenge with an operator in place of the flag', async () => {
    const response = await call('post', `/api/challenges/${world.challenges.static._id}/submit`, 'alice', { flag: { $ne: 'x' } });
    expect(response.status).toBe(400);
    expect(models.Solve.all().filter((solve) => solve.teamId === world.teams.A._id && solve.challengeId === world.challenges.static._id)).toHaveLength(1); // the seeded one only
  });

  it('rejects unknown keys everywhere (strict schemas), including operator-looking and dotted keys', async () => {
    const extras = [{ $set: { role: 'admin' } }, { 'role.admin': true }, { $where: '1' }, { extra: 1 }];
    for (const [label, method, path, token, build] of BODY_FIELDS()) {
      for (const extra of extras) {
        const valid = build(label.includes('banned') ? true : label.includes('points') ? 10 : label.includes('visible') ? true
          : label.includes('attachments') ? [] : label.includes('type') ? 'static' : label.includes('category') ? 'misc'
            : label.includes('inviteCode') ? 'ZZZZZZ' : 'abcdefgh');
        const response = await call(method, path, token, { ...valid, ...extra });
        expect(response.status, `${label} + ${JSON.stringify(extra)}`).toBe(400);
      }
    }
  });
});

describe('prototype pollution', () => {
  const payloads = [
    '{"displayName":"Valid Name","__proto__":{"polluted":true,"role":"admin"}}',
    '{"displayName":"Valid Name","constructor":{"prototype":{"polluted":true}}}',
    '{"__proto__":{"polluted":true}}',
    '{"name":"Team Zed","__proto__":{"isAdmin":true}}',
    '{"flag":"CTF{x}","__proto__":{"correct":true}}',
    '{"command":"ls","__proto__":{"polluted":true}}',
    '{"banned":true,"__proto__":{"polluted":true}}',
  ];
  const targets = [
    ['patch', '/api/me', 'alice'], ['post', '/api/teams', 'carol'], ['post', '/api/teams/join', 'carol'],
    ['post', `/api/challenges/${'0'.repeat(24)}/submit`, 'alice'], ['post', '/api/terminal/easy/exec', 'alice'],
    ['post', '/api/terminal/easy/submit', 'alice'], ['post', '/api/admin/challenges', 'admin'],
    ['patch', `/api/admin/teams/${'0'.repeat(24)}/ban`, 'admin'],
  ];

  it('treats __proto__ / constructor keys as unknown keys (400) and never touches Object.prototype', async () => {
    const before = snapshot();
    for (const [method, path, token] of targets) {
      for (const payload of payloads) {
        const response = await raw(method, path, token, payload);
        expect(response.status, `${method} ${path} ${payload}`).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      }
    }
    expect(({}).polluted).toBeUndefined();
    expect(({}).isAdmin).toBeUndefined();
    expect(({}).role).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(snapshot()).toBe(before);
  });

  it('does not pollute through query strings either', async () => {
    for (const query of ['__proto__[polluted]=1', 'constructor[prototype][polluted]=1', '__proto__.polluted=1', 'limit=1&__proto__=x']) {
      const response = await call('get', `/api/leaderboard?${query}`, 'alice');
      expect([200, 400], query).toContain(response.status);
    }
    expect(({}).polluted).toBeUndefined();
  });
});

describe('malformed and oversized bodies', () => {
  it('rejects invalid JSON with 400 and a fixed message', async () => {
    for (const body of ['{', '{"displayName":', 'not json', '{"a":1,}', "{'displayName':'x'}", '\u0000', '{"a":1}{"b":2}']) {
      const response = await raw('patch', '/api/me', 'alice', body);
      expect(response.status, body).toBe(400);
      expect(response.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' } });
    }
  });

  it('rejects a body above 100 KB with 413, also when it is otherwise valid JSON', async () => {
    const big = JSON.stringify({ displayName: 'a'.repeat(120 * 1024) });
    const response = await raw('patch', '/api/me', 'alice', big);
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    // Without a token the body is still parsed first, so the limit protects every route, not only protected ones.
    expect((await raw('post', '/api/teams', undefined, big, 'application/json')).status).toBe(413);
    // A body just under the limit reaches validation (and fails there on the field length, not on size).
    const under = JSON.stringify({ displayName: 'a'.repeat(90 * 1024) });
    expect((await raw('patch', '/api/me', 'alice', under)).status).toBe(400);
  });

  it('does not parse other content types as JSON (400 from validation, never a crash)', async () => {
    const attempts = [
      ['text/plain', '{"displayName":"Valid Name"}'], ['application/x-www-form-urlencoded', 'displayName=Valid+Name'],
      ['application/xml', '<displayName>Valid Name</displayName>'], ['application/octet-stream', 'displayName'],
    ];
    for (const [type, body] of attempts) {
      const response = await raw('patch', '/api/me', 'alice', body, type);
      expect(response.status, type).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    const multipart = await request(app).patch('/api/me').set('Authorization', 'Bearer alice').field('displayName', 'Valid Name');
    expect(multipart.status).toBe(400);
    expect(models.User.docs.get(world.users.alice._id).displayName).toBe('alice');
  });

  it('answers unsupported charsets and encodings with a 4xx JSON error, not a 500', async () => {
    const charset = await raw('patch', '/api/me', 'alice', '{"displayName":"Valid Name"}', 'application/json; charset=iso-8859-1');
    expect(charset.status).toBe(415);
    expect(charset.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'The request could not be processed.' } });
    const encoded = await request(app).patch('/api/me').set('Authorization', 'Bearer alice')
      .set('Content-Type', 'application/json').set('Content-Encoding', 'br').send('{"displayName":"Valid Name"}');
    expect([400, 415]).toContain(encoded.status);
    const brokenGzip = await request(app).patch('/api/me').set('Authorization', 'Bearer alice')
      .set('Content-Type', 'application/json').set('Content-Encoding', 'gzip').send('{"displayName":"Valid Name"}');
    expect(brokenGzip.status).toBeGreaterThanOrEqual(400);
    expect(brokenGzip.status).toBeLessThan(500);
  });

  it('survives hostile structure: deep nesting and thousands of keys are rejected quickly', async () => {
    const started = Date.now();
    const deep = `${'['.repeat(30000)}${']'.repeat(30000)}`;
    expect((await raw('patch', '/api/me', 'alice', deep)).status).toBe(400);
    expect((await raw('patch', '/api/me', 'alice', `{"displayName":"Valid Name","x":${'{"a":'.repeat(5000)}1${'}'.repeat(5000)}}`)).status).toBe(400);
    const wide = JSON.stringify(Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [`k${i}`, i])));
    expect((await raw('post', '/api/teams/join', 'carol', wide)).status).toBe(400);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('ignores HTTP method override headers', async () => {
    const response = await request(app).post('/api/admin/stats').set('Authorization', 'Bearer admin').set('X-HTTP-Method-Override', 'GET');
    expect(response.status).toBe(404);
    const second = await request(app).post(`/api/instances/${'0'.repeat(24)}`).set('Authorization', 'Bearer alice').set('X-HTTP-Method-Override', 'DELETE');
    expect(second.status).toBe(404);
  });
});

describe('path parameters', () => {
  const BAD_IDS = [
    'not-an-id', 'z'.repeat(24), 'a'.repeat(12), '0'.repeat(23), '0'.repeat(25), 'a'.repeat(1000), '__proto__', 'constructor', 'toString',
    '%00', ['..%2f..%2fetc%2f', 'pass', 'wd'].join(''), '%7B%22%24ne%22%3A1%7D', '%24ne', '1e5', '-1', '0x1', '%20', 'null', 'undefined', '[object%20Object]',
  ];
  const targets = (id) => [
    ['get', `/api/challenges/${id}`, 'alice'], ['post', `/api/challenges/${id}/instance`, 'alice'],
    ['post', `/api/challenges/${id}/submit`, 'alice', { flag: 'CTF{x}' }], ['post', `/api/instances/${id}/extend`, 'alice'],
    ['delete', `/api/instances/${id}`, 'alice'], ['put', `/api/admin/challenges/${id}`, 'admin', validChallenge],
    ['delete', `/api/admin/challenges/${id}`, 'admin'], ['post', `/api/admin/instances/${id}/kill`, 'admin'],
    ['patch', `/api/admin/teams/${id}/ban`, 'admin', { banned: true }], ['delete', `/api/admin/integrity/${id}`, 'admin'],
  ];

  it.each(BAD_IDS)('answers malformed id %s with 404 on every id route', async (id) => {
    const before = snapshot();
    for (const [method, path, token, body] of targets(id)) {
      const response = await call(method, path, token, body);
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect(snapshot()).toBe(before);
  });
});

describe('query strings (Express 5 simple parser)', () => {
  it('never turns bracket syntax into operators or arrays: ?limit[$gt]=1 is just an unknown key', async () => {
    const all = (await call('get', '/api/leaderboard', 'alice')).body;
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const query of ['limit[$gt]=1', 'limit[$ne]=', 'limit[]=1', 'limit[0]=1', '$where=1', 'limit.$gt=1']) {
      const response = await call('get', `/api/leaderboard?${query}`, 'alice');
      expect([200, 400], query).toContain(response.status);
      if (response.status === 200) { expect(response.body, query).toEqual(all); } // nothing was limited or filtered
    }
  });

  it.each([
    ['1', 200], ['2', 200], ['500', 200], ['0x2', 200], [' 2', 200],
    ['0', 400], ['-1', 400], ['501', 400], ['1000000000', 400], ['1e9', 400], ['1.5', 400], ['abc', 400], ['', 400], ['Infinity', 400],
    ['NaN', 400], ['1,2', 400], ['%00', 400], ['true', 400],
  ])('GET /api/leaderboard?limit=%j -> %i', async (value, status) => {
    const response = await call('get', `/api/leaderboard?limit=${encodeURIComponent(value)}`, 'alice');
    expect(response.status).toBe(status);
    if (status === 200) { expect(response.body.length).toBeLessThanOrEqual(Number(value)); }
  });

  it('rejects repeated limit parameters (an array) and caps the admin integrity limit at 200', async () => {
    expect((await call('get', '/api/leaderboard?limit=1&limit=2', 'alice')).status).toBe(400);
    expect((await call('get', '/api/admin/integrity?limit=200', 'admin')).status).toBe(200);
    expect((await call('get', '/api/admin/integrity?limit=201', 'admin')).status).toBe(400);
    expect((await call('get', '/api/admin/integrity?limit[$gt]=1', 'admin')).status).toBe(200);
    expect((await call('get', '/api/admin/integrity?limit=1&limit=2', 'admin')).status).toBe(400);
  });

  it('survives a query string with thousands of parameters', async () => {
    const query = Array.from({ length: 3000 }, (_, i) => `a${i}=1`).join('&');
    const response = await call('get', `/api/leaderboard?${query}`, 'alice');
    expect(response.status).toBeLessThan(500);
  });
});

describe('admin challenge input', () => {
  const create = (patch) => call('post', '/api/admin/challenges', 'admin', { ...validChallenge, ...patch });

  it.each([
    ['javascript: URL', 'javascript:alert(document.cookie)'], ['data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['protocol-relative URL', '//evil.example/x'], ['file: URL', 'file:///etc/passwd'], ['vbscript: URL', 'vbscript:msgbox(1)'],
    ['relative path without slash', 'files/a.txt'], ['whitespace inside', '/files/a b.txt'], ['mixed-case javascript:', 'JaVaScRiPt:alert(1)'],
    ['leading space then javascript:', ' javascript:alert(1)'], ['control character', '/files/a\u0000.txt'],
  ])('refuses an attachment link with a %s', async (label, url) => {
    const response = await create({ attachments: [{ name: 'x', url }] });
    expect(response.status, label).toBe(400);
    expect(models.Challenge.all().some((challenge) => challenge.slug === 'new-one')).toBe(false);
  });

  it.each(['/files/cipher.txt', 'https://example.com/files/a.zip', 'http://files.example.org/a.txt'])('accepts the attachment link %s', async (url) => {
    const response = await create({ attachments: [{ name: 'file', url }] });
    expect(response.status).toBe(201);
    expect(response.body.attachments).toEqual([{ name: 'file', url }]);
    expect(JSON.stringify(response.body)).not.toMatch(/flagHash|flagSalt|CTF\{admin_chosen_flag\}/);
  });

  it.each([
    ['image outside ctf/', { type: 'docker', image: 'nginx', internalPort: 80 }],
    ['image with a registry host', { type: 'docker', image: 'evil.example/ctf/x', internalPort: 80 }],
    ['image path traversal', { type: 'docker', image: 'ctf/../../root', internalPort: 80 }],
    ['image with a shell metacharacter', { type: 'docker', image: 'ctf/x;id', internalPort: 80 }],
    ['image digest pin', { type: 'docker', image: 'ctf/x@sha256:abc', internalPort: 80 }],
    ['image with uppercase', { type: 'docker', image: 'ctf/X', internalPort: 80 }],
    ['port 0', { type: 'docker', image: 'ctf/x', internalPort: 0 }], ['port above 65535', { type: 'docker', image: 'ctf/x', internalPort: 65536 }],
    ['port as string', { type: 'docker', image: 'ctf/x', internalPort: '80' }], ['fractional port', { type: 'docker', image: 'ctf/x', internalPort: 80.5 }],
    ['negative points', { points: -5 }], ['zero points', { points: 0 }], ['points above the cap', { points: 10001 }],
    ['points as string', { points: '10' }], ['fractional points', { points: 10.5 }], ['huge points', { points: 1e308 }],
    ['uppercase slug', { slug: 'New-One' }], ['slug with underscore', { slug: 'new_one' }], ['slug with slash', { slug: '../new' }],
    ['empty slug', { slug: '' }], ['empty title', { title: '' }], ['oversized title', { title: 'x'.repeat(101) }],
    ['oversized description', { description: 'x'.repeat(20001) }], ['unknown category', { category: 'rce' }], ['unknown type', { type: 'script' }],
    ['terminal type on create', { type: 'terminal', category: 'terminal' }], ['too many attachments', { attachments: Array.from({ length: 11 }, () => ({ name: 'a', url: '/a' })) }],
    ['a stored flag smuggled in (flagHash)', { flagHash: 'x'.repeat(64) }], ['a stored flag smuggled in (flagSalt)', { flagSalt: 'x' }],
    ['solveCount set by hand', { solveCount: 99 }], ['id set by hand', { _id: '0'.repeat(24) }], ['createdAt set by hand', { createdAt: '2020-01-01' }],
  ])('refuses %s', async (label, patch) => {
    const response = await create(patch);
    expect(response.status, label).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(models.Challenge.all().some((challenge) => challenge.slug === 'new-one')).toBe(false);
  });

  it('never stores a plain flag and never returns the flag or its hash', async () => {
    const response = await create({});
    expect(response.status).toBe(201);
    const stored = models.Challenge.all().find((challenge) => challenge.slug === 'new-one');
    expect(stored.flag).toBeUndefined();
    expect(stored.flagHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('admin_chosen_flag');
    expect(response.body.hasFlag).toBe(true);
  });
});

// ---- every request schema is strict ---------------------------------------------------------------------------------
describe('static audit: zod schemas', () => {
  const routesDir = fileURLToPath(new URL('../../src/routes', import.meta.url));
  const listFiles = (dir) => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  }).filter((file) => file.endsWith('.js'));

  // Query-string schemas are deliberately lenient: the Express 5 simple parser only yields flat strings, and the
  // documented contract says other parameters are ignored. Request BODY and PATH schemas must all be strict.
  const QUERY_ONLY = { 'leaderboard.js': 1, 'admin/integrity.js': 1 };

  it('makes every z.object in the route files strict, except the documented query schemas', () => {
    const problems = [];
    for (const file of listFiles(routesDir)) {
      const source = readFileSync(file, 'utf8');
      const relative = file.slice(routesDir.length + 1).replaceAll('\\', '/');
      const objects = (source.match(/z\.object\(/g) ?? []).length;
      const strict = (source.match(/\.strict\(\)/g) ?? []).length;
      const allowed = QUERY_ONLY[relative] ?? 0;
      if (objects - strict !== allowed) { problems.push(`${relative}: ${objects} z.object, ${strict} .strict(), ${allowed} allowed lenient`); }
    }
    expect(problems).toEqual([]);
  });

  it('validates every route body, path id and query through zod or objectId() (no raw req.body / req.params use)', () => {
    const offenders = [];
    for (const file of listFiles(routesDir)) {
      const source = readFileSync(file, 'utf8');
      const relative = file.slice(routesDir.length + 1).replaceAll('\\', '/');
      for (const [index, line] of source.split('\n').entries()) {
        const usesBody = /req\.body/.test(line) && !/validate\(|safeParse\(|parse\(|req\.body \?\? \{\}/.test(line);
        const usesQuery = /req\.query/.test(line) && !/validate\(/.test(line);
        const usesParam = /req\.params\.\w+/.test(line) && !/objectId\(|modeFrom\(|visibleChallenge\(|req\.params\)/.test(line);
        if (usesBody || usesQuery || usesParam) { offenders.push(`${relative}:${index + 1}: ${line.trim()}`); }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads terminal flags through the team context only (terminal request bodies carry no team)', async () => {
    const response = await call('post', '/api/terminal/easy/exec', 'alice', { command: 'cat flag', team: world.teams.B._id });
    expect(response.status).toBe(400);
    const ok = await call('post', '/api/terminal/easy/exec', 'alice', { command: 'cat flag' });
    expect(ok.body.output).toContain(terminalFlagOf('easy', 1, 'A'));
  });
});
