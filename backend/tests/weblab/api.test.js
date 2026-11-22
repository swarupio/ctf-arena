import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import Challenge from '../../src/models/Challenge.js';
import Solve from '../../src/models/Solve.js';
import Submission from '../../src/models/Submission.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { LABS, TRACK_MAX, WEBLAB_MAX_POINTS, labSlug } from '../../src/games/weblab/index.js';
import { achievementService } from '../../src/services/achievementService.js';
import { consumeAttempt } from '../../src/services/attemptLimiter.js';
import { expectedFlagFor, hashSubmission } from '../../src/services/flagService.js';
import { hasFirstBloodBonus, recordSolve } from '../../src/services/scoringService.js';
import { REQUEST_LIMIT, SUBMIT_LIMIT } from '../../src/services/weblabService.js';
import { AppError } from '../../src/utils/AppError.js';
import { weblabDefinitions } from '../../src/scripts/seedWebLab.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn(), create: vi.fn(), updateOne: vi.fn() },
}));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn(), create: vi.fn(), aggregate: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../../src/models/Submission.js', () => ({ default: { create: vi.fn(), countDocuments: vi.fn() } }));
vi.mock('../../src/services/attemptLimiter.js', () => ({ consumeAttempt: vi.fn() }));

const oid = (n) => String(n).padStart(24, '0');
const TEAM_A = oid(2);
const TEAM_B = oid(4);
const secret = env.FLAG_SECRET;
const users = {
  player: { _id: oid(1), teamId: TEAM_A },
  player2: { _id: oid(3), teamId: TEAM_B },
  loner: { _id: oid(5), teamId: null },
  admin: { _id: oid(9), teamId: null },
};
let rows;
let solves;
let counters;
let teams;

const rowOf = (id) => rows.find((row) => row.slug === labSlug(id));
const flagOf = (id, teamId = TEAM_A) => expectedFlagFor(rowOf(id), { secret, teamId });
const api = (method, path, sub = 'player', body) => {
  const call = request(app)[method](`/api/weblab${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};
const attack = (id, body, sub = 'player') => api('post', `/labs/${labSlug(id)}/request`, sub, { headers: {}, cookies: {}, body: '', ...body });
const submit = (id, flag, sub = 'player') => api('post', `/labs/${labSlug(id)}/submit`, sub, { flag });
const solveInOrder = async (sub = 'player', ids = LABS.map((lab) => lab.id)) => {
  for (const id of ids) { expect((await submit(id, flagOf(id, users[sub].teamId), sub)).body.correct).toBe(true); }
};

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  teams = { [TEAM_A]: { _id: TEAM_A, name: 'Alpha', banned: false }, [TEAM_B]: { _id: TEAM_B, name: 'Bravo', banned: false } };
  rows = weblabDefinitions().map((definition, index) => ({ _id: oid(500 + index), visible: true, solveCount: 0, ...definition }));
  solves = [];
  counters = new Map();
  User.findOne.mockImplementation(async ({ cognitoSub }) => users[cognitoSub] ?? null);
  Team.findById.mockImplementation(async (id) => teams[String(id)] ?? null);
  Challenge.find.mockImplementation((filter) => ({ lean: async () => rows.filter((row) => row.type === filter.type && row.visible === filter.visible) }));
  Challenge.findOneAndUpdate.mockImplementation(async ({ _id }, update) => {
    const row = rows.find((candidate) => candidate._id === _id);
    row.solveCount += update.$inc.solveCount;
    return { ...row };
  });
  Solve.find.mockImplementation((filter) => ({
    lean: async () => {
      const ids = filter.challengeId.$in.map(String);
      return solves.filter((row) => String(row.teamId) === String(filter.teamId) && ids.includes(String(row.challengeId)));
    },
  }));
  Solve.create.mockImplementation(async (doc) => {
    if (solves.some((row) => String(row.teamId) === String(doc.teamId) && String(row.challengeId) === String(doc.challengeId))) {
      throw Object.assign(new Error('duplicate'), { code: 11000 });
    }
    solves.push({ ...doc });
  });
  Solve.aggregate.mockImplementation(async ([{ $match }]) => {
    const mine = solves.filter((row) => String(row.teamId) === String($match.teamId));
    return mine.length ? [{ _id: null, score: mine.reduce((sum, row) => sum + row.points, 0) }] : [];
  });
  Solve.updateOne.mockResolvedValue({});
  Submission.create.mockResolvedValue({});
  consumeAttempt.mockImplementation(async (key, { limit, message }) => {
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count);
    if (count > limit) { throw new AppError(429, 'RATE_LIMITED', message); }
    return count;
  });
});

describe('overview', () => {
  it('requires a token', async () => {
    expect((await request(app).get('/api/weblab/labs')).status).toBe(401);
  });

  it('lists four tracks with companies, fixed points, locked bosses, hidden severity and no flags', async () => {
    const res = await api('get', '/labs');
    expect(res.status).toBe(200);
    expect(res.body.tracks.map((track) => track.id)).toEqual(['easy', 'medium', 'hard', 'insane']);
    expect(res.body.tracks.map((track) => track.points)).toEqual([TRACK_MAX.easy, TRACK_MAX.medium, TRACK_MAX.hard, TRACK_MAX.insane]);
    expect(res.body.totals).toMatchObject({ labs: 10, solved: 0, points: WEBLAB_MAX_POINTS, pointsEarned: 0, bountyUsd: 0 });
    const labs = res.body.tracks.flatMap((track) => track.labs);
    expect(labs.filter((lab) => lab.locked).map((lab) => lab.id).sort()).toEqual(['chain-vault', 'idor-statements', 'jwt-none', 'race-refill']);
    expect(labs.every((lab) => lab.severity === null && lab.bountyUsd === null)).toBe(true);
    expect(res.body.inspector.unlocked).toEqual(['edit']);
    expect(res.text).not.toContain('CTF{');
    expect(res.text).not.toContain('flagHash');
  });

  it('works for a player without a team and unlocks everything for admin previews', async () => {
    expect((await api('get', '/labs', 'loner')).status).toBe(200);
    const admin = await api('get', '/labs', 'admin');
    expect(admin.body.tracks.flatMap((track) => track.labs).some((lab) => lab.locked)).toBe(false);
  });

  it('reports cosmetic severity and bounty only after a solve, and the inspector grows', async () => {
    await solveInOrder('player', ['sqli-login']);
    const res = await api('get', '/labs');
    const lab = res.body.tracks[0].labs[0];
    expect(lab).toMatchObject({ solved: true, severity: 'high', bountyUsd: 500, pointsEarned: 30 });
    expect(res.body.totals).toMatchObject({ solved: 1, pointsEarned: 30, bountyUsd: 500 });
    expect(res.body.inspector.unlocked).toContain('decode');
  });
});

describe('lab detail and hints', () => {
  it('returns the story, objective and a per-team starting request without any flag', async () => {
    const res = await api('get', '/labs/weblab-cookie-tamper');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'cookie-tamper', track: 'easy', company: { name: 'RetroBank' }, points: 30 });
    expect(res.body.request.cookies.prefs).toBeTruthy();
    expect(res.body.hints).toBeUndefined();
    expect(res.text).not.toContain('CTF{');
  });

  it('hides the starting request of a locked boss and 404s unknown slugs', async () => {
    expect((await api('get', '/labs/weblab-idor-statements')).body).toMatchObject({ locked: true, request: null });
    expect((await api('get', '/labs/weblab-nope')).status).toBe(404);
    expect((await api('get', '/labs/NOT%20A%20SLUG')).status).toBe(404);
    expect((await api('get', '/labs/__proto__')).status).toBe(404);
  });

  it('serves hints one level at a time; the insane lab has none; locked labs give none', async () => {
    const first = await api('get', '/labs/weblab-sqli-login/hints/1');
    expect(first.body).toMatchObject({ level: 1, count: 3 });
    expect(first.body.text).toBeTruthy();
    expect((await api('get', '/labs/weblab-sqli-login/hints/4')).status).toBe(404);
    expect((await api('get', '/labs/weblab-sqli-login/hints/abc')).status).toBe(404);
    expect((await api('get', '/labs/weblab-chain-vault/hints/1', 'admin')).status).toBe(404);
    expect((await api('get', '/labs/weblab-idor-statements/hints/1')).status).toBe(403);
  });
});

describe('simulated requests', () => {
  it('validates the body strictly', async () => {
    const path = `/labs/${labSlug('sqli-login')}/request`;
    const bad = [
      { method: 'TRACE', path: '/' }, { method: 'GET', path: 'no-slash' }, { method: 'GET', path: `/${'a'.repeat(400)}` },
      { method: 'GET', path: '/', body: 'x'.repeat(2001) }, { method: 'GET', path: '/', extra: 1 },
      { method: 'GET', path: '/', headers: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`h${i}`, 'v'])) },
      { method: 'GET', path: '/', cookies: { a: 1 } }, { method: 'GET', path: '/', headers: { [`${'k'.repeat(41)}`]: 'v' } }, {},
    ];
    for (const body of bad) {
      const res = await api('post', path, 'player', body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('needs a team, refuses locked labs and unseeded games', async () => {
    expect((await attack('sqli-login', { method: 'GET', path: '/' }, 'loner')).body.error.code).toBe('NO_TEAM');
    const locked = await attack('idor-statements', { method: 'GET', path: '/' });
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('LAB_LOCKED');
    rows = [];
    const unseeded = await attack('sqli-login', { method: 'GET', path: '/' });
    expect(unseeded.status).toBe(503);
    expect(unseeded.body.error.code).toBe('WEBLAB_NOT_SEEDED');
  });

  it('plays a full exploit over HTTP and the flag it reveals is the team flag and only works for that team', async () => {
    const staff = await attack('sqli-login', { method: 'GET', path: '/staff' });
    const admin = staff.body.page.blocks.find((block) => block.t === 'table').rows[0][0];
    const plain = await attack('sqli-login', { method: 'POST', path: '/login', body: JSON.stringify({ username: 'x', password: 'y' }) });
    expect(plain.body).toMatchObject({ status: 401, exploited: false, hint: null });
    expect(JSON.stringify(plain.body)).not.toContain(flagOf('sqli-login'));
    const hit = await attack('sqli-login', { method: 'POST', path: '/login', body: JSON.stringify({ username: `${admin}'--`, password: '' }) });
    expect(hit.body.exploited).toBe(true);
    expect(hit.body.hint).toMatch(/EXPLOIT LANDED/);
    expect(hit.body.body).toContain(flagOf('sqli-login'));
    expect(Object.keys(hit.body).sort()).toEqual(['body', 'contentType', 'exploited', 'hint', 'page', 'setCookies', 'status']);
    // Another team's exploit reveals that team's flag instead.
    const other = await attack('sqli-login', { method: 'POST', path: '/login', body: JSON.stringify({ username: "x' OR role='admin' --", password: '' }) }, 'player2');
    expect(other.body.body).toContain(flagOf('sqli-login', TEAM_B));
    expect(other.body.body).not.toContain(flagOf('sqli-login', TEAM_A));
    expect((await submit('sqli-login', flagOf('sqli-login', TEAM_B))).body.correct).toBe(false);
  });

  it('lets admins preview with a flag no team can submit', async () => {
    const res = await attack('sqli-login', { method: 'POST', path: '/login', body: JSON.stringify({ username: "x' OR role='admin' --", password: '' }) }, 'admin');
    const previewFlag = /CTF\{[a-z0-9_]+\}/.exec(res.body.body)[0];
    expect(previewFlag).toBeTruthy();
    expect((await submit('sqli-login', previewFlag)).body.correct).toBe(false);
  });

  it('rate limits requests per team in the shared counter store', async () => {
    for (let i = 0; i < REQUEST_LIMIT; i += 1) { await attack('sqli-login', { method: 'GET', path: '/' }); }
    const res = await attack('sqli-login', { method: 'GET', path: '/' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect([...counters.keys()]).toContain(`weblab-req:${TEAM_A}`);
    expect((await attack('sqli-login', { method: 'GET', path: '/' }, 'player2')).status).toBe(200);
  });
});

describe('submitting flags', () => {
  it('rejects a wrong flag with a quip and stores only a hash', async () => {
    const res = await submit('sqli-login', 'CTF{nope}');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ correct: false, pointsAwarded: 0, firstBlood: false });
    expect(res.body.message).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(flagOf('sqli-login'));
    expect(Submission.create).toHaveBeenCalledWith(expect.objectContaining({ correct: false, submittedHash: hashSubmission('CTF{nope}') }));
    expect(JSON.stringify(Submission.create.mock.calls)).not.toContain('CTF{nope}');
    expect(solves).toHaveLength(0);
  });

  it('awards fixed points with a severity badge, never a first-blood bonus', async () => {
    const res = await submit('sqli-login', flagOf('sqli-login'));
    expect(res.body).toMatchObject({ correct: true, pointsAwarded: 30, firstBlood: false, severity: 'high', bountyUsd: 500 });
    expect(res.body.message).toMatch(/BOUNTY PAID/);
    // This team was the first ever to solve it (solveCount went 0 -> 1) and still got exactly the fixed points.
    expect(rows[0].solveCount).toBe(1);
    expect(solves[0]).toMatchObject({ points: 30, firstBlood: false });
    expect(Solve.updateOne).not.toHaveBeenCalled();
  });

  it('evaluates achievements after a new solve only, and reports new badges', async () => {
    const spy = vi.spyOn(achievementService, 'safeEvaluate').mockResolvedValue([{ key: 'fake', name: 'Fake' }]);
    try {
      const first = await submit('sqli-login', flagOf('sqli-login'));
      expect(spy).toHaveBeenCalledWith({ userId: users.player._id, teamId: TEAM_A });
      expect(first.body.badges).toEqual([{ key: 'fake', name: 'Fake' }]);
      spy.mockClear();
      const again = await submit('sqli-login', flagOf('sqli-login'));
      expect(again.body.alreadySolved).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      await submit('sqli-login', 'CTF{wrong}');
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('takes points from the lab definition, never from the stored row', async () => {
    rowOf('sqli-login').points = 9999;
    const res = await submit('sqli-login', flagOf('sqli-login'));
    expect(res.body).toMatchObject({ correct: true, pointsAwarded: 30 });
    expect(solves[0]).toMatchObject({ points: 30 });
  });

  it('double submit and parallel submits score once', async () => {
    const flag = flagOf('sqli-login');
    const again = await Promise.all([submit('sqli-login', flag), submit('sqli-login', flag), submit('sqli-login', flag)]);
    const fresh = again.filter((res) => !res.body.alreadySolved);
    expect(fresh).toHaveLength(1);
    expect(again.filter((res) => res.body.alreadySolved).every((res) => res.body.pointsAwarded === 0 && res.body.correct)).toBe(true);
    expect(solves).toHaveLength(1);
    expect((await submit('sqli-login', flag)).body).toMatchObject({ correct: true, alreadySolved: true, pointsAwarded: 0 });
  });

  it('admins cannot submit; unseeded labs and bad bodies are refused', async () => {
    expect((await submit('sqli-login', 'x', 'admin')).status).toBe(403);
    expect((await api('post', `/labs/${labSlug('sqli-login')}/submit`, 'player', { flag: '' })).status).toBe(400);
    expect((await api('post', `/labs/${labSlug('sqli-login')}/submit`, 'player', { flag: 'x'.repeat(201) })).status).toBe(400);
    expect((await api('post', `/labs/${labSlug('sqli-login')}/submit`, 'player', { flag: 'x', more: 1 })).status).toBe(400);
    expect((await submit('sqli-login', 'x', 'loner')).body.error.code).toBe('NO_TEAM');
    rows = [];
    expect((await submit('sqli-login', 'x')).body.error.code).toBe('WEBLAB_NOT_SEEDED');
  });

  it('limits attempts per team and lab: the ninth try in a window is 429 even with the right flag', async () => {
    for (let i = 0; i < SUBMIT_LIMIT; i += 1) { expect((await submit('sqli-login', `CTF{guess${i}}`)).status).toBe(200); }
    const blocked = await submit('sqli-login', flagOf('sqli-login'));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(solves).toHaveLength(0);
    // Other labs and other teams are not affected.
    expect((await submit('cookie-tamper', 'CTF{x}')).status).toBe(200);
    expect((await submit('sqli-login', 'CTF{x}', 'player2')).status).toBe(200);
  });

  it('bosses cannot be submitted before their track mates are cleared', async () => {
    const early = await submit('idor-statements', flagOf('idor-statements'));
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('LAB_LOCKED');
    expect(solves).toHaveLength(0);
    await solveInOrder('player', ['sqli-login', 'cookie-tamper']);
    expect((await submit('idor-statements', flagOf('idor-statements'))).body).toMatchObject({ correct: true, pointsAwarded: 60 });
  });
});

describe('maximum points', () => {
  it('a team that solves everything, and submits again and again, ends exactly at the documented maximum', async () => {
    await solveInOrder('player');
    for (const lab of LABS) {
      const again = await submit(lab.id, flagOf(lab.id));
      expect(again.body).toMatchObject({ alreadySolved: true, pointsAwarded: 0 });
    }
    const total = solves.filter((row) => row.teamId === TEAM_A).reduce((sum, row) => sum + row.points, 0);
    expect(total).toBe(WEBLAB_MAX_POINTS);
    expect(total).toBe(1470);
    expect(solves.every((row) => row.firstBlood === false)).toBe(true);
    const res = await api('get', '/labs');
    expect(res.body.totals).toMatchObject({ solved: 10, pointsEarned: 1470, points: 1470 });
    for (const track of res.body.tracks) {
      expect(track.pointsEarned).toBe(TRACK_MAX[track.id]);
      expect(track.cleared).toBe(true);
    }
    expect(res.body.inspector.level).toBe(5);
  });

  it('every team is capped independently, and a solve row can never exceed its lab points', async () => {
    await solveInOrder('player');
    await solveInOrder('player2');
    for (const lab of LABS) {
      for (const row of solves.filter((solve) => String(solve.challengeId) === rowOf(lab.id)._id)) { expect(row.points).toBeLessThanOrEqual(lab.points); }
    }
    for (const team of [TEAM_A, TEAM_B]) {
      expect(solves.filter((row) => row.teamId === team).reduce((sum, row) => sum + row.points, 0)).toBe(WEBLAB_MAX_POINTS);
    }
  });
});

describe('scoring service rules', () => {
  it('weblab challenges never get a first-blood bonus; only classic static and docker challenges do', async () => {
    expect(hasFirstBloodBonus({ type: 'weblab' })).toBe(false);
    for (const type of ['static', 'docker']) { expect(hasFirstBloodBonus({ type })).toBe(true); }
    for (const type of ['terminal', 'game', 'forensics']) { expect(hasFirstBloodBonus({ type })).toBe(false); }
    const out = await recordSolve({ challenge: rowOf('sqli-login'), teamId: TEAM_A, userId: users.player._id });
    expect(out).toMatchObject({ points: 30, firstBlood: false });
    const dockerRow = { _id: oid(900), type: 'docker', points: 100, solveCount: 0 };
    rows.push(dockerRow);
    const docker = await recordSolve({ challenge: dockerRow, teamId: TEAM_B, userId: users.player2._id });
    expect(docker).toMatchObject({ points: 110, firstBlood: true });
  });
});

describe('seed definitions', () => {
  it('has one definition per lab, unique slugs, web category, fixed points', () => {
    const defs = weblabDefinitions();
    expect(defs).toHaveLength(LABS.length);
    expect(new Set(defs.map((d) => d.slug)).size).toBe(LABS.length);
    for (const def of defs) { expect(def).toMatchObject({ type: 'weblab', category: 'web' }); }
    expect(defs.reduce((sum, d) => sum + d.points, 0)).toBe(WEBLAB_MAX_POINTS);
    expect(JSON.stringify(defs)).not.toContain('CTF{');
  });
});
