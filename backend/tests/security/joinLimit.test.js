// Invite-code brute force: POST /api/teams/join is limited per account by a counter in MongoDB
// (services/attemptLimiter.js), on top of the 6-character code space and nginx's per-IP limit.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import { JOIN_ATTEMPT_LIMIT, JOIN_ATTEMPT_WINDOW_MS } from '../../src/routes/teams.js';
import { consumeAttempt } from '../../src/services/attemptLimiter.js';
import { behaviour, models } from './helpers/fakeDb.js';
import { call, getApp, seedWorld, verify, world } from './helpers/harness.js';

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

beforeAll(async () => { await getApp(); });
afterAll(() => replicaCounter.stop());
beforeEach(() => {
  seedWorld();
  verify.mockClear();
  behaviour.interleave = false;
});
afterEach(() => {
  vi.useRealTimers();
  behaviour.interleave = false;
});

const join = (token, inviteCode) => call('post', '/api/teams/join', token, { inviteCode });
const memberCount = (teamKey) => models.Team.docs.get(world.teams[teamKey]._id).memberIds.length;

describe('team join attempt limit', () => {
  it('allows the limit, then answers 429 for every further attempt, also with the right code', async () => {
    for (let attempt = 0; attempt < JOIN_ATTEMPT_LIMIT; attempt += 1) {
      const response = await join('carol', 'ZZZZZ' + 'ABCDEFGHJK'[attempt]);
      expect(response.status, `attempt ${attempt + 1}`).toBe(404);
    }
    const blocked = await join('carol', 'BRAVE3'); // a valid code, but the account is out of attempts
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: { code: 'RATE_LIMITED', message: expect.stringMatching(/join attempts/i) } });
    expect(models.User.docs.get(world.users.carol._id).teamId).toBeNull();
    expect(memberCount('B')).toBe(1);
    expect((await join('carol', 'ZZZZZZ')).status).toBe(429);
  });

  it('counts every attempt, whatever its outcome (wrong code, full or valid team, already in a team)', async () => {
    expect((await join('carol', 'ZZZZZ2')).status).toBe(404); // 1: wrong
    expect((await join('carol', 'ALPHA2')).status).toBe(200); // 2: valid, joins Alpha
    expect((await join('carol', 'BRAVE3')).status).toBe(409); // 3: already in a team
    const counter = models.AttemptCounter.all().find((row) => row.key === 'join:carol');
    expect(counter.count).toBe(3);
  });

  it('limits each account separately: one account being locked out does not affect another', async () => {
    for (let attempt = 0; attempt <= JOIN_ATTEMPT_LIMIT; attempt += 1) { await join('carol', 'ZZZZZ3'); }
    expect((await join('carol', 'ZZZZZ3')).status).toBe(429);
    expect((await join('eve', 'ZZZZZ3')).status).toBe(404);
    const good = await join('eve', 'BRAVE3');
    expect(good.status).toBe(200);
  });

  it('opens a new window after the old one ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
    for (let attempt = 0; attempt < JOIN_ATTEMPT_LIMIT; attempt += 1) { await join('carol', 'ZZZZZ4'); }
    expect((await join('carol', 'ZZZZZ4')).status).toBe(429);
    vi.setSystemTime(new Date(Date.now() + JOIN_ATTEMPT_WINDOW_MS - 1000));
    expect((await join('carol', 'ZZZZZ4')).status).toBe(429); // still inside the window: a lockout cannot be shortened
    vi.setSystemTime(new Date(Date.now() + 2000));
    expect((await join('carol', 'ZZZZZ4')).status).toBe(404);
    expect(models.AttemptCounter.all().find((row) => row.key === 'join:carol').count).toBe(1);
  });

  it('holds under a parallel burst: only the allowed number of attempts reach the lookup', async () => {
    behaviour.interleave = true;
    const burst = await Promise.all(Array.from({ length: 40 }, () => join('carol', 'ZZZZZ5')));
    behaviour.interleave = false;
    const lookedUp = burst.filter((response) => response.status === 404).length;
    expect(lookedUp).toBeLessThanOrEqual(JOIN_ATTEMPT_LIMIT);
    expect(lookedUp).toBeGreaterThanOrEqual(1);
    expect(burst.filter((response) => response.status === 429).length).toBe(40 - lookedUp);
  });

  it('does not spend attempts on requests that fail validation, and cannot be abused to lock others out', async () => {
    for (const body of [{ inviteCode: 'abc' }, { inviteCode: 'ALPHA' }, { inviteCode: 'ALPHA22' }, { inviteCode: 'IIIIII' }, { inviteCode: { $ne: null } }, {}]) {
      expect((await call('post', '/api/teams/join', 'carol', body)).status).toBe(400);
    }
    expect(models.AttemptCounter.all()).toHaveLength(0);
    // The key is the caller's own verified identity: nobody can burn another account's attempts.
    await join('eve', 'ZZZZZ6');
    expect(models.AttemptCounter.all().map((row) => row.key)).toEqual(['join:eve']);
  });

  it('rejects unauthenticated and admin callers before any counting', async () => {
    expect((await call('post', '/api/teams/join', null, { inviteCode: 'ZZZZZ7' })).status).toBe(401);
    expect((await call('post', '/api/teams/join', 'admin', { inviteCode: 'ZZZZZ7' })).status).toBe(403);
    expect(models.AttemptCounter.all()).toHaveLength(0);
  });

  it('keeps online guessing hopeless: a 32^6 code space against at most ~1000 guesses per account and day', () => {
    const codeSpace = 32 ** 6;
    const guessesPerDay = JOIN_ATTEMPT_LIMIT * (24 * 60 * 60 * 1000 / JOIN_ATTEMPT_WINDOW_MS);
    expect(codeSpace).toBe(1_073_741_824);
    expect(guessesPerDay).toBeLessThanOrEqual(1000);
    const teams = 200; // a generous number of live teams
    const daysForEvenOdds = (Math.LN2 * codeSpace / teams) / guessesPerDay;
    expect(daysForEvenOdds).toBeGreaterThan(365 * 5); // years of continuous guessing for ONE account
  });
});

describe('consumeAttempt (the shared limiter)', () => {
  const options = { limit: 3, windowMs: 60_000, message: 'slow down' };

  it('counts per key inside a fixed window and then refuses', async () => {
    expect(await consumeAttempt('k:a', options)).toBe(1);
    expect(await consumeAttempt('k:a', options)).toBe(2);
    expect(await consumeAttempt('k:b', options)).toBe(1);
    expect(await consumeAttempt('k:a', options)).toBe(3);
    await expect(consumeAttempt('k:a', options)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED', message: 'slow down' });
    await expect(consumeAttempt('k:a', options)).rejects.toMatchObject({ status: 429 });
    expect(await consumeAttempt('k:b', options)).toBe(2);
  });

  it('stores one document per key with an expiry (the TTL index removes it later)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
    await consumeAttempt('k:ttl', options);
    await consumeAttempt('k:ttl', options);
    const rows = models.AttemptCounter.all().filter((row) => row.key === 'k:ttl');
    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt.toISOString()).toBe('2026-11-04T12:01:00.000Z');
    expect(rows[0].count).toBe(2);
  });

  it('starts a fresh window once the old one expired, even if the TTL monitor has not removed the row yet', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
    for (let i = 0; i < 3; i += 1) { await consumeAttempt('k:reset', options); }
    await expect(consumeAttempt('k:reset', options)).rejects.toMatchObject({ status: 429 });
    vi.setSystemTime(new Date('2026-11-04T12:01:00.001Z'));
    expect(await consumeAttempt('k:reset', options)).toBe(1);
  });

  it('never lets parallel callers beyond the limit through (atomic increments, one winner for the first insert)', async () => {
    behaviour.interleave = true;
    const outcomes = await Promise.allSettled(Array.from({ length: 25 }, () => consumeAttempt('k:race', options)));
    behaviour.interleave = false;
    const allowed = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    expect(allowed.length).toBeLessThanOrEqual(options.limit);
    expect(allowed.length).toBeGreaterThanOrEqual(1);
    expect(new Set(allowed.map((outcome) => outcome.value)).size).toBe(allowed.length); // no two callers got the same attempt number
    for (const outcome of outcomes.filter((item) => item.status === 'rejected')) { expect(outcome.reason).toMatchObject({ status: 429 }); }
  });

  it('fails closed (429) when it cannot settle a race, and rethrows real database errors', async () => {
    const original = models.AttemptCounter.create;
    models.AttemptCounter.create = async () => { throw Object.assign(new Error('dup'), { code: 11000 }); };
    try {
      await expect(consumeAttempt('k:contended', options)).rejects.toMatchObject({ status: 429 });
      models.AttemptCounter.create = async () => { throw Object.assign(new Error('disk full'), { code: 12345 }); };
      await expect(consumeAttempt('k:broken', options)).rejects.toThrow('disk full');
    } finally {
      models.AttemptCounter.create = original;
    }
  });
});
