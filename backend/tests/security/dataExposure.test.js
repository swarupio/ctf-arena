// Data-exposure tests: deep-scan the JSON of every GET (as several different callers) and of the sensitive POSTs for
// keys and values that must never leave the server: flags, flag hashes and salts, the FLAG_SECRET, other teams'
// invite codes, other players' e-mails, Mongo internals, stack traces and connection strings.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import { HONEYPOT_PATHS } from '../../src/services/integrityBait.js';
import { database } from './helpers/fakeDb.js';
import {
  HIDDEN_FLAG, STATIC_FLAG, call, flagOf, getApp, seedWorld, terminalFlagOf, verify, world,
} from './helpers/harness.js';

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

afterAll(() => replicaCounter.stop());

// ---- the scanner ------------------------------------------------------------------------------------------------
const FORBIDDEN_KEYS = new Set([
  'flag', 'flagHash', 'flagSalt', 'flagSecret', 'FLAG_SECRET', 'secret', 'secrets', 'password', 'containerId', 'cognitoSub',
  '__v', 'submittedHash', 'token', 'accessToken', 'idToken', 'refreshToken', 'stack', 'stackTrace', 'memberIds', 'captainId',
  'email', 'inviteCode', 'userId',
]);
const STACK_FRAME = /\n\s+at\s+\S+.*\(?.*:\d+:\d+\)?|node_modules|[A-Za-z]:\\Users\\|\/app\/(?:src|node_modules)/;
const URI = /mongodb(?:\+srv)?:\/\//i;
const FLAG_LITERAL = /CTF\{[A-Za-z0-9_-]{4,}\}/;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function walkJson(value, visit, path = '$') {
  visit(value, path);
  if (Array.isArray(value)) { value.forEach((item, index) => walkJson(item, visit, `${path}[${index}]`)); }
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) { walkJson(child, visit, `${path}.${key}`); }
  }
}

// Returns a list of human-readable violations (empty = clean).
function scan(body, { path, viewer, allowKeys = [], allowFlags = false, ownEmail = null }) {
  const violations = [];
  const allowed = new Set(allowKeys);
  const otherInvites = Object.values(world.teams).map((team) => team.inviteCode);
  const mine = world.users[viewer] ? world.teams[Object.keys(world.teams).find((key) => world.teams[key].memberIds.includes(world.users[viewer]._id))] : null;
  const secretStrings = [
    env.FLAG_SECRET, env.MONGODB_URI, STATIC_FLAG, HIDDEN_FLAG, 'welcome_to_the_arena',
    world.challenges.static.flagHash, world.challenges.static.flagSalt, world.challenges.hidden.flagHash, world.challenges.hidden.flagSalt,
  ];
  walkJson(body, (value, where) => {
    const key = where.split('.').at(-1).replace(/\[\d+\]$/, '');
    if (FORBIDDEN_KEYS.has(key) && !allowed.has(key)) { violations.push(`${path}: forbidden key ${where}`); }
    if (typeof value !== 'string') { return; }
    for (const text of secretStrings) { if (text && value.includes(text)) { violations.push(`${path}: secret value in ${where}`); } }
    for (const code of otherInvites) {
      if (value.includes(code) && !(allowed.has('inviteCode') && mine?.inviteCode === code)) { violations.push(`${path}: invite code ${code} in ${where}`); }
    }
    if (STACK_FRAME.test(value)) { violations.push(`${path}: stack/path leak in ${where}`); }
    if (URI.test(value)) { violations.push(`${path}: connection string in ${where}`); }
    if (!allowFlags && FLAG_LITERAL.test(value)) { violations.push(`${path}: flag-like value in ${where}`); }
    for (const email of value.match(EMAIL) ?? []) {
      if (email !== ownEmail) { violations.push(`${path}: e-mail ${email} in ${where}`); }
    }
  });
  return violations;
}

// Every team's expected flag for every dynamic challenge: none may ever show up in a GET answer.
const everyExpectedFlag = () => Object.keys(world.teams).flatMap((team) => [
  ...['docker1', 'docker2', 'docker3', 'docker4', 'docker5'].map((key) => flagOf(world.challenges[key], team)),
  ...Object.entries(world.terminal).flatMap(([mode, list]) => list.map((challenge, index) => terminalFlagOf(mode, index + 1, team))),
]);

beforeAll(async () => { await getApp(); });
beforeEach(async () => {
  seedWorld();
  verify.mockClear();
  // Give the world some activity so the answers are not empty: instances, a terminal solve, wrong submissions.
  await call('post', `/api/challenges/${world.challenges.docker1._id}/instance`, 'alice');
  await call('post', `/api/challenges/${world.challenges.docker2._id}/instance`, 'bob');
  await call('post', '/api/terminal/easy/submit', 'alice', { flag: terminalFlagOf('easy', 1, 'A') });
  await call('post', '/api/terminal/easy/submit', 'bob', { flag: 'CTF{not_a_real_one_000000000000}' });
  await call('post', `/api/challenges/${world.challenges.static._id}/submit`, 'bob', { flag: 'CTF{wrong_guess}' });
});

describe('scanner self-test (the scans below are not vacuous)', () => {
  const opts = { path: 'probe', viewer: 'alice' };

  it('flags forbidden keys, secret values, foreign invite codes, flags, stack frames, URIs and foreign e-mails', () => {
    expect(scan({ nested: [{ flagHash: 'x' }] }, opts)).toHaveLength(1);
    expect(scan({ m: `x ${env.FLAG_SECRET}` }, opts).length).toBeGreaterThan(0);
    expect(scan({ note: world.teams.B.inviteCode }, opts)).toHaveLength(1);
    expect(scan({ note: world.teams.A.inviteCode }, { ...opts, allowKeys: ['inviteCode'] })).toHaveLength(0);
    expect(scan({ note: 'CTF{abcd_efgh}' }, opts)).toHaveLength(1);
    expect(scan({ note: 'CTF{abcd_efgh}' }, { ...opts, allowFlags: true })).toHaveLength(0);
    expect(scan({ note: 'Error\n    at run (/srv/x.js:1:2)' }, opts).length).toBeGreaterThan(0);
    expect(scan({ note: 'mongodb://u:p@h/db' }, opts).length).toBeGreaterThan(0);
    expect(scan({ note: 'bob@example.com' }, { ...opts, ownEmail: 'alice@example.com' })).toHaveLength(1);
    expect(scan({ note: 'alice@example.com' }, { ...opts, ownEmail: 'alice@example.com', allowKeys: ['email'] })).toHaveLength(0);
    expect(scan({ ok: 'nothing to see', n: 3 }, opts)).toEqual([]);
  });
});

describe('GET answers never contain secrets, other teams\' data or internals', () => {
  const getPaths = () => [
    '/api/me', '/api/teams/me', '/api/challenges', `/api/challenges/${world.challenges.static._id}`,
    `/api/challenges/${world.challenges.docker1._id}`, `/api/challenges/${world.terminal.easy[0]._id}`,
    `/api/challenges/${world.challenges.hidden._id}`, '/api/instances', '/api/leaderboard', '/api/leaderboard?limit=2',
    '/api/leaderboard/timeline', '/api/terminal/modes', '/api/terminal/easy/progress', '/api/terminal/medium/progress',
    '/api/terminal/hard/progress', '/api/admin/challenges', '/api/admin/stats', '/api/admin/instances', '/api/admin/teams',
    '/api/admin/integrity', '/api/health',
  ];

  it.each(['alice', 'alice2', 'bob', 'carol', 'eve', 'admin'])('as %s', async (viewer) => {
    const violations = [];
    const flags = everyExpectedFlag();
    let checked = 0;
    for (const path of getPaths()) {
      const response = await call('get', path, viewer);
      checked += 1;
      const clean = path.split('?')[0];
      const allowKeys = [];
      if (clean === '/api/me') { allowKeys.push('email'); }
      if (clean === '/api/teams/me') { allowKeys.push('inviteCode'); }
      if (clean.startsWith('/api/admin/integrity')) { allowKeys.push('userId'); }
      violations.push(...scan(response.body, { path: `${viewer} ${path}`, viewer, allowKeys, ownEmail: clean === '/api/me' ? `${viewer}@example.com` : null }));
      const text = JSON.stringify(response.body);
      for (const flag of flags) { if (text.includes(flag)) { violations.push(`${viewer} ${path}: contains a team flag`); } }
      expect(response.status, `${viewer} ${path}`).toBeLessThan(500);
    }
    expect(checked).toBeGreaterThan(15);
    expect(violations).toEqual([]);
  });

  it('keeps hidden challenges out of every player and admin view of the challenge API', async () => {
    for (const viewer of ['alice', 'bob', 'carol', 'admin']) {
      expect((await call('get', `/api/challenges/${world.challenges.hidden._id}`, viewer)).status).toBe(404);
      const list = await call('get', '/api/challenges', viewer);
      expect(JSON.stringify(list.body)).not.toContain('hidden-trap');
    }
  });

  it('pins the exact fields of the main player payloads (a new field must be a conscious decision)', async () => {
    const keys = (value) => Object.keys(value).sort();
    const challenges = (await call('get', '/api/challenges', 'alice')).body;
    expect(keys(challenges[0])).toEqual(['category', 'difficulty', 'id', 'points', 'slug', 'solveCount', 'solvedByMyTeam', 'title', 'type']);
    const detail = (await call('get', `/api/challenges/${world.challenges.docker1._id}`, 'alice')).body;
    expect(keys(detail)).toEqual([
      'attachments', 'category', 'description', 'difficulty', 'hasInstance', 'id', 'myInstance', 'points', 'slug', 'solveCount',
      'solvedByMyTeam', 'title', 'type',
    ]);
    expect(keys(detail.myInstance)).toEqual(['challengeId', 'expiresAt', 'extended', 'id', 'status', 'url']);
    const board = (await call('get', '/api/leaderboard', 'alice')).body;
    expect(board.length).toBeGreaterThanOrEqual(3);
    for (const row of board) { expect(keys(row)).toEqual(['lastSolveAt', 'points', 'rank', 'solves', 'teamId', 'teamName']); }
    const timeline = (await call('get', '/api/leaderboard/timeline', 'alice')).body;
    expect(Object.keys(timeline)).toEqual(['teams']);
    for (const team of timeline.teams) { expect(keys(team)).toEqual(['points', 'teamId', 'teamName']); }
    const me = (await call('get', '/api/me', 'alice')).body;
    expect(keys(me)).toEqual(['displayName', 'email', 'id', 'role', 'team']);
    expect(keys(me.team)).toEqual(['id', 'name']); // never the invite code or the member list
    const team = (await call('get', '/api/teams/me', 'alice')).body;
    expect(keys(team)).toEqual(['id', 'inviteCode', 'members', 'name', 'score']);
    for (const member of team.members) { expect(keys(member)).toEqual(['displayName', 'id']); }
    const modes = (await call('get', '/api/terminal/modes', 'alice')).body;
    for (const mode of modes) {
      expect(keys(mode)).toEqual(['codes', 'difficulty', 'lore', 'mode', 'points', 'pointsEarned', 'solved', 'tagline', 'title']);
    }
  });

  it('pins the admin payloads: hasFlag instead of the hash, no invite codes, no e-mails, no container ids', async () => {
    const keys = (value) => Object.keys(value).sort();
    const list = (await call('get', '/api/admin/challenges', 'admin')).body;
    expect(list.length).toBeGreaterThan(5);
    for (const challenge of list) {
      expect(keys(challenge)).toEqual([
        'attachments', 'category', 'createdAt', 'description', 'difficulty', 'hasFlag', 'id', 'image', 'internalPort', 'points',
        'slug', 'solveCount', 'terminal', 'title', 'type', 'visible',
      ]);
    }
    const instances = (await call('get', '/api/admin/instances', 'admin')).body;
    expect(instances.length).toBe(2);
    for (const instance of instances) { expect(keys(instance)).toEqual(['challenge', 'expiresAt', 'extended', 'id', 'port', 'status', 'team', 'url']); }
    const teams = (await call('get', '/api/admin/teams', 'admin')).body;
    for (const team of teams) { expect(keys(team)).toEqual(['banned', 'id', 'members', 'name', 'score', 'solves']); }
  });
});

describe('POST answers', () => {
  it('never echo the submitted flag and never reveal an expected one', async () => {
    const own = flagOf(world.challenges.docker1, 'A');
    const other = flagOf(world.challenges.docker1, 'B');
    const probes = [
      ['/api/challenges/' + world.challenges.docker1._id + '/submit', 'alice', other],
      ['/api/challenges/' + world.challenges.docker1._id + '/submit', 'alice', own],
      ['/api/challenges/' + world.challenges.static._id + '/submit', 'alice', 'CTF{some_probe_value}'],
      ['/api/terminal/easy/submit', 'alice', terminalFlagOf('easy', 2, 'B')],
      ['/api/terminal/easy/submit', 'alice', terminalFlagOf('easy', 3, 'A')],
      ['/api/terminal/hard/submit', 'bob', 'CTF{probe_hard_value}'],
    ];
    for (const [path, viewer, flag] of probes) {
      const response = await call('post', path, viewer, { flag });
      expect([200, 409, 429], `${path} ${viewer}`).toContain(response.status);
      const text = JSON.stringify(response.body);
      expect(text, `${path} echoes the submission`).not.toContain(flag);
      expect(text).not.toContain(env.FLAG_SECRET);
      expect(Object.keys(response.body).filter((key) => ['flag', 'expected', 'expectedFlag', 'submitted'].includes(key))).toEqual([]);
    }
  });

  it('start-instance and instance answers carry no container id and no flag', async () => {
    const response = await call('post', `/api/challenges/${world.challenges.docker3._id}/instance`, 'bob');
    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(['challengeId', 'expiresAt', 'extended', 'id', 'status', 'url']);
    expect(JSON.stringify(response.body)).not.toMatch(/container-\d+|CTF\{/);
  });

  it('terminal exec prints only the calling team\'s flags (that is the game), never another team\'s', async () => {
    const asAlice = await call('post', '/api/terminal/easy/exec', 'alice', { command: 'cat flag' });
    const asBob = await call('post', '/api/terminal/easy/exec', 'bob', { command: 'cat flag' });
    expect(asAlice.status).toBe(200);
    expect(asAlice.body.output).toContain(terminalFlagOf('easy', 1, 'A'));
    expect(asAlice.body.output).not.toContain(terminalFlagOf('easy', 1, 'B'));
    expect(asBob.body.output).toContain(terminalFlagOf('easy', 1, 'B'));
    expect(asBob.body.output).not.toContain(terminalFlagOf('easy', 1, 'A'));
    expect(Object.keys(asAlice.body).sort()).toEqual(['cwd', 'exit', 'output']);
    // The admin preview flags belong to no team and never validate.
    const asAdmin = await call('post', '/api/terminal/easy/exec', 'admin', { command: 'cat flag' });
    expect(asAdmin.body.output).not.toContain(terminalFlagOf('easy', 1, 'A'));
    expect(asAdmin.body.output).not.toContain(terminalFlagOf('easy', 1, 'B'));
  });

  it('team create and join answers show the invite code only to the team that now owns it', async () => {
    const created = await call('post', '/api/teams', 'carol', { name: 'Team Delta' });
    expect(created.status).toBe(201);
    expect(created.body.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(Object.keys(created.body).sort()).toEqual(['id', 'inviteCode', 'members', 'name', 'score']);
    const joined = await call('post', '/api/teams/join', 'eve', { inviteCode: created.body.inviteCode });
    expect(joined.status).toBe(200);
    expect(joined.body.id).toBe(created.body.id);
    // Somebody who guesses a wrong code learns nothing about real teams.
    const wrong = await call('post', '/api/teams/join', 'mallory', { inviteCode: 'ZZZZZZ' });
    expect(wrong.status).toBe(404);
    expect(JSON.stringify(wrong.body)).not.toMatch(/Team (Alpha|Bravo|Charlie|Delta)/);
  });
});

describe('public honeypot decoys', () => {
  it('hold only decoys: no real secret, flag, team, e-mail, invite code or hash', async () => {
    const realFlags = everyExpectedFlag();
    const realStrings = [
      env.FLAG_SECRET, env.MONGODB_URI, STATIC_FLAG, HIDDEN_FLAG, world.challenges.static.flagHash, world.challenges.static.flagSalt,
      ...Object.values(world.teams).flatMap((team) => [team.name, team.inviteCode]),
      ...Object.values(world.users).map((user) => user.email), ...realFlags,
    ];
    for (const path of HONEYPOT_PATHS) {
      for (const [method, token] of [['get', null], ['get', 'alice'], ['post', null], ['put', null], ['delete', 'admin']]) {
        const response = await call(method, path, token, method === 'get' ? undefined : {});
        expect(response.status, `${method} ${path}`).toBe(200);
        const text = JSON.stringify(response.body);
        for (const value of realStrings) { expect(text, `${method} ${path} leaks a real value`).not.toContain(value); }
        expect(text).not.toMatch(STACK_FRAME);
        expect(response.headers['cache-control']).toBe('no-store');
      }
    }
  });
});

describe('failures do not leak internals', () => {
  const LEAKY = new Error('connect ECONNREFUSED mongodb+srv://admin:hunter2-password@cluster0.abcde.mongodb.net/ctf at /app/node_modules/mongoose/lib/connection.js:12:3');

  it('answers every failing endpoint with the same generic 500 body and logs no message or stack', async () => {
    const writes = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    database.failure = LEAKY;
    try {
      const attempts = [
        ['get', '/api/me', 'alice'], ['get', '/api/teams/me', 'alice'], ['get', '/api/challenges', 'alice'],
        ['get', `/api/challenges/${world.challenges.static._id}`, 'alice'], ['get', '/api/instances', 'alice'],
        ['get', '/api/leaderboard', 'alice'], ['get', '/api/leaderboard/timeline', 'alice'], ['get', '/api/terminal/modes', 'alice'],
        ['get', '/api/terminal/easy/progress', 'alice'], ['get', '/api/admin/challenges', 'admin'], ['get', '/api/admin/stats', 'admin'],
        ['get', '/api/admin/instances', 'admin'], ['get', '/api/admin/teams', 'admin'], ['get', '/api/admin/integrity', 'admin'],
        ['post', '/api/teams', 'carol', { name: 'Team Fail' }], ['post', `/api/challenges/${world.challenges.static._id}/submit`, 'alice', { flag: 'CTF{x}' }],
        ['post', `/api/challenges/${world.challenges.docker4._id}/instance`, 'alice'], ['post', '/api/terminal/easy/exec', 'alice', { command: 'ls' }],
        ['post', '/api/terminal/easy/submit', 'alice', { flag: 'CTF{x}' }], ['patch', '/api/me', 'alice', { displayName: 'Renamed' }],
        ['patch', `/api/admin/teams/${world.teams.B._id}/ban`, 'admin', { banned: true }],
      ];
      let failures = 0;
      for (const [method, path, token, body] of attempts) {
        const response = await call(method, path, token, body);
        if (response.status >= 500) {
          failures += 1;
          expect(response.status, path).toBe(500);
          expect(response.body, path).toEqual({ error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } });
        }
        const text = `${JSON.stringify(response.body)} ${JSON.stringify(response.headers)}`;
        expect(text, path).not.toMatch(/hunter2|ECONNREFUSED|mongodb|node_modules|\bat \S+ \(/);
      }
      expect(failures).toBeGreaterThan(15);
    } finally {
      database.failure = null;
      spy.mockRestore();
    }
    const log = writes.join('');
    expect(log).toContain('[error]'); // failures are visible to operators ...
    expect(log).not.toMatch(/hunter2|ECONNREFUSED|mongodb|node_modules|admin:|password/); // ... without the message or stack
  });

  it('answers bad input with a short 4xx that does not echo it back', async () => {
    const response = await call('post', `/api/challenges/${world.challenges.static._id}/submit`, 'alice', { flag: 'x'.repeat(500) });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('xxxxxxxxxx');
  });
});
