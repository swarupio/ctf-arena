import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import { env } from '../../src/config/env.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { dynamicFlag } from '../../src/services/flagService.js';
import { HONEYPOT_PATHS } from '../../src/services/integrityBait.js';
import { integrityService, ipHash, taintedFlagFor } from '../../src/services/integrityService.js';
import { CheatSignalFake, TaintedFlagFake, goLive, goOffline, installFakes, state } from './fakes.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/ReplicaStat.js', () => ({ default: { updateOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/CheatSignal.js', async () => ({ default: (await import('./fakes.js')).CheatSignalFake, SIGNAL_KINDS: [] }));
vi.mock('../../src/models/TaintedFlag.js', async () => ({ default: (await import('./fakes.js')).TaintedFlagFake }));
vi.mock('../../src/models/TerminalActivity.js', async () => ({ default: (await import('./fakes.js')).TerminalActivityFake }));

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const oid = (n) => String(n).padStart(24, '0');
const METHODS = ['get', 'post', 'put', 'delete'];
const FLAG_SHAPE = /CTF\{[a-z0-9_]+_[0-9a-f]{12}\}/g;
const IP = '203.0.113.9';
const ipKey = (address) => `ip:${ipHash(address)}`;
const hit = (path, { method = 'get', ip = IP, token } = {}) => {
  const call = request(app)[method](path).set('X-Forwarded-For', ip);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
};
const flagsIn = (body) => JSON.stringify(body).match(FLAG_SHAPE) ?? [];

beforeAll(goLive);
afterAll(() => {
  goOffline();
  replicaCounter.stop();
});
beforeEach(() => {
  installFakes();
  vi.mocked(User.findOne).mockReset();
  vi.mocked(Team.find).mockReset();
  vi.mocked(Team.findById).mockReset();
  getCognitoVerifier.mockReset();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (token) => {
      if (token === 'bad') { throw new Error('invalid token'); }
      return { sub: token, email: `${token}@example.com`, 'cognito:groups': ['player'] };
    }),
  });
});
afterEach(() => vi.restoreAllMocks());

describe('decoy endpoints are public', () => {
  it.each(HONEYPOT_PATHS.flatMap((path) => METHODS.map((method) => [method, path])))('%s %s answers 200 JSON without a token', async (method, path) => {
    const response = await hit(path, { method });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(flagsIn(response.body).length).toBeGreaterThan(0);
  });

  it('works for any token state without failing the request, and ignores other methods', async () => {
    await hit(HONEYPOT_PATHS[0], { token: 'bad' }).expect(200);
    await request(app).patch(HONEYPOT_PATHS[0]).expect(404);
    // Express answers OPTIONS itself (Allow header only): no decoy body, no signal.
    const options = await request(app).options(HONEYPOT_PATHS[0]);
    expect(flagsIn(options.body)).toEqual([]);
    expect(options.text).not.toContain('CTF{');
    await integrityService.flush();
    expect(state.signals.filter((row) => row.detail === HONEYPOT_PATHS[0]).length).toBeLessThanOrEqual(1); // only the 'bad' token hit
  });

  it('is reachable even with a malformed JSON body and does not read it', async () => {
    const response = await request(app).post(HONEYPOT_PATHS[2]).set('Content-Type', 'application/json').send('{"broken":');
    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('matches case-insensitively and with a trailing slash, recording the canonical path', async () => {
    await hit('/API/V1/FLAGS/').expect(200);
    await integrityService.flush();
    expect(state.signals.map((row) => row.detail)).toEqual(['/api/v1/flags']);
  });

  it('does not change the other routes: protected ones still need a token and unknown ones are 404', async () => {
    await request(app).get('/api/challenges').expect(401);
    await request(app).get('/api/admin/integrity').expect(401);
    await request(app).get('/api/internal/unknown').expect(404);
    await request(app).get('/api/v1/flags/extra').expect(404);
    await integrityService.flush();
    expect(state.signals).toEqual([]);
  });
});

describe('what the decoys answer', () => {
  it('gives every path its own body shape', async () => {
    const keys = {};
    for (const path of HONEYPOT_PATHS) { keys[path] = Object.keys((await hit(path)).body).sort().join(','); }
    expect(new Set(Object.values(keys)).size).toBe(HONEYPOT_PATHS.length);
    const [debugFlags, config, v1, teams, legacy] = await Promise.all(HONEYPOT_PATHS.map(async (path) => (await hit(path)).body));
    expect(debugFlags.flags[0]).toEqual({ challenge: expect.any(String), flag: expect.stringMatching(/^CTF\{/) });
    expect(config.secrets.flagSecret).toMatch(/^[0-9a-f]{48}$/);
    expect(v1.data[0]).toEqual({ id: 1, name: expect.any(String), value: expect.stringMatching(/^CTF\{/) });
    expect(teams.teams[0]).toMatchObject({ name: expect.any(String), score: expect.any(Number) });
    expect(legacy.solutions[0]).toMatchObject({ challenge: expect.any(String), flag: expect.stringMatching(/^CTF\{/) });
  });

  it('is deterministic for one caller and different for another', async () => {
    const a1 = (await hit(HONEYPOT_PATHS[0], { ip: '198.51.100.1' })).body;
    const a2 = (await hit(HONEYPOT_PATHS[0], { ip: '198.51.100.1' })).body;
    const b = (await hit(HONEYPOT_PATHS[0], { ip: '198.51.100.2' })).body;
    expect(a2).toEqual(a1);
    expect(b).not.toEqual(a1);
    expect(flagsIn(b).filter((flag) => flagsIn(a1).includes(flag))).toEqual([]);
  });

  it('holds only tainted flags, each stored by hash for its caller', async () => {
    const responses = await Promise.all(HONEYPOT_PATHS.map((path) => hit(path)));
    const subject = ipKey(IP);
    const flags = new Set(responses.flatMap((response) => flagsIn(response.body)));
    expect(flags.size).toBeGreaterThan(0);
    for (const flag of flags) {
      const stored = state.tainted.find((row) => row.hash === sha256(flag));
      expect(stored, flag).toBeDefined();
      expect(stored.subjectKey).toBe(subject);
      expect(taintedFlagFor({ secret: env.FLAG_SECRET, subjectKey: subject, slug: stored.slug })).toBe(flag);
    }
    expect(state.tainted).toHaveLength(flags.size); // one row per flag, however many paths and hits
    expect(JSON.stringify(state.tainted)).not.toContain('CTF{');
  });

  it('never contains real data: no env values, real flags, real team names or database reads', async () => {
    User.findOne.mockResolvedValue({ _id: oid(1) });
    Team.find.mockResolvedValue([{ name: 'Real Team Rocket' }]);
    const responses = await Promise.all(HONEYPOT_PATHS.map((path) => hit(path)));
    const text = JSON.stringify(responses.map((response) => response.body));
    for (const secret of [env.FLAG_SECRET, env.MONGODB_URI, env.COGNITO_USER_POOL_ID, env.COGNITO_CLIENT_ID, env.PUBLIC_HOST]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain(env.FLAG_SECRET.slice(0, 12));
    expect(text).not.toContain('Real Team Rocket');
    for (const slug of ['terminal-hard-7', 'terminal-medium-6', 'vault-master-key', 'admin-backdoor', 'terminal-easy-1']) {
      for (const teamId of [oid(1), oid(2), 'admin-preview']) {
        expect(text).not.toContain(dynamicFlag({ secret: env.FLAG_SECRET, slug, teamId, challengeId: oid(1) }));
      }
    }
    expect(text).not.toMatch(/@example\.com|mongodb\+srv|mongodb:\/\//);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(Team.find).not.toHaveBeenCalled();
    expect(Team.findById).not.toHaveBeenCalled();
  });
});

describe('signals', () => {
  it('records one deduplicated signal per caller and path', async () => {
    for (let i = 0; i < 3; i += 1) { await hit(HONEYPOT_PATHS[0]).expect(200); }
    await integrityService.flush();
    expect(state.signals).toHaveLength(1);
    expect(state.signals[0]).toMatchObject({
      subjectKey: ipKey(IP), userId: null, kind: 'honeypot-endpoint', severity: 2, detail: HONEYPOT_PATHS[0], count: 3,
    });
    expect(state.signals[0].firstAt).toBeInstanceOf(Date);
    expect(state.signals[0].lastAt.getTime()).toBeGreaterThanOrEqual(state.signals[0].firstAt.getTime());

    await hit(HONEYPOT_PATHS[1], { method: 'post' }).expect(200);
    await hit(HONEYPOT_PATHS[0], { ip: '198.51.100.7' }).expect(200);
    await integrityService.flush();
    expect(state.signals).toHaveLength(3);
    // The same path with another method is the same signal.
    await hit(HONEYPOT_PATHS[0], { method: 'delete' }).expect(200);
    await integrityService.flush();
    expect(state.signals).toHaveLength(3);
    expect(state.signals.find((row) => row.detail === HONEYPOT_PATHS[0] && row.subjectKey === ipKey(IP)).count).toBe(4);
  });

  it('uses one cheap update per hit: an upsert keyed by subject, kind and detail', async () => {
    await hit(HONEYPOT_PATHS[3]).expect(200);
    await integrityService.flush();
    const [filter, update, options] = CheatSignalFake.updateOne.mock.calls[0];
    expect(filter).toEqual({ subjectKey: ipKey(IP), kind: 'honeypot-endpoint', detail: HONEYPOT_PATHS[3] });
    expect(update.$inc).toEqual({ count: 1 });
    expect(Object.keys(update.$set)).toEqual(['lastAt']);
    expect(options).toMatchObject({ upsert: true });
  });

  it('keeps raw addresses out of the database and ignores forged forwarding chains', async () => {
    await hit(HONEYPOT_PATHS[0], { ip: '6.6.6.6, 198.51.100.7' }).expect(200);
    await integrityService.flush();
    expect(state.signals.map((row) => row.subjectKey)).toEqual([ipKey('198.51.100.7')]);
    const everything = JSON.stringify([state.signals, state.tainted]);
    expect(everything).not.toContain('198.51.100.7');
    expect(everything).not.toContain('6.6.6.6');
    expect(state.signals[0].subjectKey).toMatch(/^ip:[0-9a-f]{64}$/);
  });

  it('falls back to the socket address when there is no forwarding header', async () => {
    await request(app).get(HONEYPOT_PATHS[0]).expect(200);
    await integrityService.flush();
    expect(state.signals[0].subjectKey).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(JSON.stringify(state.signals)).not.toMatch(/127\.0\.0\.1|::1/);
  });
});

describe('who is calling', () => {
  it('identifies a signed-in user by token and stores the signal and flags against the user id', async () => {
    User.findOne.mockResolvedValue({ _id: oid(7) });
    const response = await hit(HONEYPOT_PATHS[2], { token: 'sub-7' }).expect(200);
    await integrityService.flush();
    expect(User.findOne).toHaveBeenCalledWith({ cognitoSub: 'sub-7' });
    expect(state.signals).toHaveLength(1);
    expect(state.signals[0]).toMatchObject({ subjectKey: oid(7), userId: oid(7), kind: 'honeypot-endpoint', severity: 2 });
    expect(state.tainted.every((row) => row.subjectKey === oid(7))).toBe(true);
    const anonymous = (await hit(HONEYPOT_PATHS[2], { ip: '198.51.100.99' })).body;
    expect(flagsIn(response.body)).not.toEqual(flagsIn(anonymous));
    expect(flagsIn(response.body)[0]).toBe(taintedFlagFor({ secret: env.FLAG_SECRET, subjectKey: oid(7), slug: 'terminal-hard-7' }));
  });

  it.each([
    ['an invalid token', 'bad', () => {}],
    ['a valid token without a user record', 'sub-8', () => User.findOne.mockResolvedValue(null)],
    ['a user lookup that fails', 'sub-9', () => User.findOne.mockRejectedValue(new Error('db down'))],
  ])('treats %s as anonymous and still answers 200', async (name, token, arrange) => {
    arrange();
    await hit(HONEYPOT_PATHS[0], { token }).expect(200);
    await integrityService.flush();
    expect(state.signals).toHaveLength(1);
    expect(state.signals[0]).toMatchObject({ subjectKey: ipKey(IP), userId: null });
  });

  it('does not verify a malformed Authorization header', async () => {
    const verify = vi.fn();
    getCognitoVerifier.mockReturnValue({ verify });
    await request(app).get(HONEYPOT_PATHS[0]).set('X-Forwarded-For', IP).set('Authorization', 'Bearer two words').expect(200);
    await request(app).get(HONEYPOT_PATHS[0]).set('X-Forwarded-For', IP).set('Authorization', 'Basic abc').expect(200);
    expect(verify).not.toHaveBeenCalled();
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('answers even when the verifier itself cannot be created', async () => {
    getCognitoVerifier.mockImplementation(() => { throw new Error('no pool configured'); });
    const response = await hit(HONEYPOT_PATHS[0], { token: 'sub-1' }).expect(200);
    expect(flagsIn(response.body).length).toBeGreaterThan(0);
  });
});

describe('failure handling', () => {
  it('answers a generic JSON error and leaks nothing when the handler itself fails', async () => {
    vi.spyOn(integrityService, 'identifyCaller').mockRejectedValueOnce(new Error(`boom CTF{real_1234567890ab} at C:/srv/secret.js ${env.FLAG_SECRET}`));
    const response = await hit(HONEYPOT_PATHS[0]);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).not.toMatch(/boom|secret|CTF\{|stack|at /);
  });

  it('still answers 200 with decoy flags when the signal or flag writes fail', async () => {
    const written = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { written.push(String(chunk)); return true; });
    CheatSignalFake.updateOne.mockRejectedValue(new Error('db down'));
    TaintedFlagFake.insertMany.mockRejectedValue(new Error('db down'));
    const response = await hit(HONEYPOT_PATHS[0]).expect(200);
    await integrityService.flush();
    expect(flagsIn(response.body).length).toBeGreaterThan(0);
    expect(written.join('')).not.toContain('db down');
    expect(written.join('')).not.toContain(env.FLAG_SECRET);
  });

  it('serves the decoy without storing anything when the database is not connected', async () => {
    goOffline();
    try {
      const response = await hit(HONEYPOT_PATHS[0], { token: 'sub-1' }).expect(200);
      await integrityService.flush();
      expect(flagsIn(response.body).length).toBeGreaterThan(0);
      expect(CheatSignalFake.updateOne).not.toHaveBeenCalled();
      expect(TaintedFlagFake.insertMany).not.toHaveBeenCalled();
      expect(User.findOne).not.toHaveBeenCalled();
    } finally {
      goLive();
    }
  });
});
