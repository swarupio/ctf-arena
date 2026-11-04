import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import { env } from '../../src/config/env.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { CheatSignalFake, goOffline, installFakes, state } from './fakes.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/ReplicaStat.js', () => ({ default: { updateOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/CheatSignal.js', async () => ({ default: (await import('./fakes.js')).CheatSignalFake, SIGNAL_KINDS: [] }));
vi.mock('../../src/models/TaintedFlag.js', async () => ({ default: (await import('./fakes.js')).TaintedFlagFake }));
vi.mock('../../src/models/TerminalActivity.js', async () => ({ default: (await import('./fakes.js')).TerminalActivityFake }));

const oid = (n) => String(n).padStart(24, '0');
const ALICE = oid(1);
const BOB = oid(2);
const CARA = oid(3);
const GHOST = oid(99);
const at = (minute) => new Date(Date.UTC(2026, 10, 4, 12, minute, 0));
const SIGNAL_KEYS = ['count', 'detail', 'firstAt', 'kind', 'lastAt', 'severity'];
const ENTRY_KEYS = ['displayName', 'risk', 'signals', 'teamName', 'userId'];

const api = (method, path, sub = 'admin') => request(app)[method](`/api/admin/integrity${path}`).set('Authorization', `Bearer ${sub}`);
const row = (subjectKey, kind, detail, count, severity, firstMinute, lastMinute) => ({
  subjectKey, userId: subjectKey.startsWith('ip:') ? null : subjectKey, kind, detail, count, severity, firstAt: at(firstMinute), lastAt: at(lastMinute),
});

function seed() {
  state.signals = [
    // Alice: 2*min(2,5) + 3*1 = 7
    row(ALICE, 'honeypot-endpoint', '/api/v1/flags', 2, 2, 1, 5),
    row(ALICE, 'tainted-flag', `from:${BOB}`, 1, 3, 6, 6),
    // Bob: 1*min(40,5) + 2*min(3,5) = 11
    row(BOB, 'automation-ua', 'curl', 40, 1, 0, 30),
    row(BOB, 'terminal-canary', 'easy:ai-verify --session', 3, 2, 2, 9),
    // Cara: 1 + 3 + 3 + 3 = 10
    row(CARA, 'automation-ua', 'missing', 1, 1, 3, 3),
    row(CARA, 'tainted-flag', `from:${GHOST}`, 1, 3, 4, 4),
    row(CARA, 'tainted-flag', 'from:self', 1, 3, 5, 5),
    row(CARA, 'tainted-flag', 'from:anonymous', 1, 3, 7, 7),
    // Anonymous scrapers (three addresses): flags path merges to 2*min(10,5) = 10, teams path adds 2 -> 12
    row(`ip:${'a'.repeat(64)}`, 'honeypot-endpoint', '/api/v1/flags', 4, 2, 10, 20),
    row(`ip:${'b'.repeat(64)}`, 'honeypot-endpoint', '/api/v1/flags', 6, 2, 8, 25),
    row(`ip:${'c'.repeat(64)}`, 'honeypot-endpoint', '/api/debug/teams', 1, 2, 11, 11),
  ];
  const people = {
    [ALICE]: { _id: ALICE, displayName: 'Alice', teamId: oid(21), email: 'alice@example.com' },
    [BOB]: { _id: BOB, displayName: 'Bob', teamId: null, email: 'bob@example.com' },
    [CARA]: { _id: CARA, displayName: 'Cara', teamId: oid(22), email: 'cara@example.com' },
  };
  User.find.mockImplementation((filter) => ({ lean: async () => filter._id.$in.map((id) => people[String(id)]).filter(Boolean) }));
  Team.find.mockImplementation((filter) => ({
    lean: async () => [{ _id: oid(21), name: 'Alpha' }, { _id: oid(22), name: 'Charlie' }].filter((team) => filter._id.$in.includes(String(team._id))),
  }));
}

afterAll(() => {
  goOffline();
  replicaCounter.stop();
});
beforeEach(() => {
  vi.resetAllMocks();
  installFakes();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
});

describe('access', () => {
  it.each([
    ['get', ''],
    ['get', '?limit=5'],
    ['delete', `/${ALICE}`],
  ])('%s /admin/integrity%s needs a token (401) and the admin role (403) before reading or deleting anything', async (method, path) => {
    seed();
    const anonymous = await request(app)[method](`/api/admin/integrity${path}`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
    const player = await api(method, path, 'player');
    expect(player.status).toBe(403);
    expect(player.body.error.code).toBe('FORBIDDEN');
    expect(CheatSignalFake.find).not.toHaveBeenCalled();
    expect(CheatSignalFake.deleteMany).not.toHaveBeenCalled();
    expect(User.find).not.toHaveBeenCalled();
    expect(state.signals).toHaveLength(11);
  });
});

describe('GET /api/admin/integrity', () => {
  it('ranks users by risk = sum(severity * min(count, 5)) and puts the anonymous scrapers in one entry', async () => {
    seed();
    const { body } = await api('get', '').expect(200);
    expect(body.map((entry) => [entry.displayName, entry.risk])).toEqual([
      ['anonymous scrapers', 12], ['Bob', 11], ['Cara', 10], ['Alice', 7],
    ]);
    expect(body.map((entry) => entry.userId)).toEqual([null, BOB, CARA, ALICE]);
    for (const entry of body) {
      expect(Object.keys(entry).sort()).toEqual(ENTRY_KEYS);
      for (const signal of entry.signals) { expect(Object.keys(signal).sort()).toEqual(SIGNAL_KEYS); }
    }
  });

  it('joins display and team names and orders each user\'s signals by severity, then recency', async () => {
    seed();
    const { body } = await api('get', '').expect(200);
    const [anonymous, bob, cara, alice] = body;
    expect(alice).toMatchObject({ displayName: 'Alice', teamName: 'Alpha' });
    expect(bob).toMatchObject({ displayName: 'Bob', teamName: null });
    expect(cara).toMatchObject({ displayName: 'Cara', teamName: 'Charlie' });
    expect(anonymous).toMatchObject({ userId: null, displayName: 'anonymous scrapers', teamName: null });
    expect(alice.signals.map((signal) => signal.kind)).toEqual(['tainted-flag', 'honeypot-endpoint']);
    expect(bob.signals.map((signal) => signal.kind)).toEqual(['terminal-canary', 'automation-ua']);
    expect(alice.signals[1]).toEqual({
      kind: 'honeypot-endpoint', detail: '/api/v1/flags', count: 2, severity: 2, firstAt: at(1).toISOString(), lastAt: at(5).toISOString(),
    });
    expect(bob.signals[1].count).toBe(40); // the real count is shown; only the risk caps it at 5
  });

  it('shows counts only for the anonymous entry: addresses merged per kind and path', async () => {
    seed();
    const { body } = await api('get', '').expect(200);
    const anonymous = body[0];
    expect(anonymous.signals).toEqual([
      { kind: 'honeypot-endpoint', detail: '/api/v1/flags', count: 10, severity: 2, firstAt: at(8).toISOString(), lastAt: at(25).toISOString() },
      { kind: 'honeypot-endpoint', detail: '/api/debug/teams', count: 1, severity: 2, firstAt: at(11).toISOString(), lastAt: at(11).toISOString() },
    ]);
  });

  it('names whose flag was reused, and keeps self and anonymous as they are', async () => {
    seed();
    const { body } = await api('get', '').expect(200);
    const details = (id) => body.find((entry) => entry.userId === id).signals.filter((signal) => signal.kind === 'tainted-flag').map((signal) => signal.detail).sort();
    expect(details(ALICE)).toEqual(['from:Bob']);
    expect(details(CARA)).toEqual(['from:anonymous', 'from:self', 'from:unknown user']);
  });

  it('never exposes emails, address hashes, subject keys or the secret', async () => {
    seed();
    const { text } = await api('get', '').expect(200);
    for (const forbidden of ['@example.com', 'email', 'ip:', 'a'.repeat(64), 'b'.repeat(64), 'subjectKey', 'cognitoSub', env.FLAG_SECRET, env.MONGODB_URI]) {
      expect(text).not.toContain(forbidden);
    }
    // Lean queries with explicit projections: no email is even requested.
    expect(User.find.mock.calls[0][1]).toBe('displayName teamId');
    expect(Team.find.mock.calls[0][1]).toBe('name');
    expect(CheatSignalFake.find.mock.calls[0][1]).not.toContain('subjectKey');
  });

  it('honours ?limit after ranking and rejects bad limits', async () => {
    seed();
    expect((await api('get', '?limit=2').expect(200)).body.map((entry) => entry.displayName)).toEqual(['anonymous scrapers', 'Bob']);
    expect((await api('get', '?limit=1').expect(200)).body).toHaveLength(1);
    expect((await api('get', '?limit=200').expect(200)).body).toHaveLength(4);
    for (const limit of ['0', '-1', 'abc', '201', '1.5', '']) {
      const { body } = await api('get', `?limit=${limit}`).expect(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('is an empty list when there are no signals and skips the name lookups', async () => {
    const { body } = await api('get', '').expect(200);
    expect(body).toEqual([]);
    expect(User.find).not.toHaveBeenCalled();
    expect(Team.find).not.toHaveBeenCalled();
  });

  it('lists a signal of a deleted user under a placeholder name', async () => {
    state.signals = [row(GHOST, 'automation-ua', 'curl', 1, 1, 1, 1)];
    User.find.mockImplementation(() => ({ lean: async () => [] }));
    const { body } = await api('get', '').expect(200);
    expect(body).toEqual([{
      userId: GHOST, displayName: '(unknown user)', teamName: null, risk: 1,
      signals: [{ kind: 'automation-ua', detail: 'curl', count: 1, severity: 1, firstAt: at(1).toISOString(), lastAt: at(1).toISOString() }],
    }]);
  });

  it('answers with the standard error and no stack when the database fails', async () => {
    CheatSignalFake.find.mockImplementation(() => { throw new Error(`boom ${env.FLAG_SECRET}`); });
    const { body, text } = await api('get', '').expect(500);
    expect(body).toEqual({ error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } });
    expect(text).not.toContain('boom');
  });
});

describe('DELETE /api/admin/integrity/:userId', () => {
  it('dismisses that user\'s signals with 204 and leaves everyone else\'s alone', async () => {
    seed();
    const response = await api('delete', `/${ALICE}`).expect(204);
    expect(response.text).toBe('');
    expect(CheatSignalFake.deleteMany).toHaveBeenCalledWith({ subjectKey: ALICE });
    expect(state.signals.some((item) => item.subjectKey === ALICE)).toBe(false);
    expect(state.signals).toHaveLength(9);
    const { body } = await api('get', '').expect(200);
    expect(body.map((entry) => entry.displayName)).toEqual(['anonymous scrapers', 'Bob', 'Cara']);
  });

  it('is idempotent and normalises the id to lower case', async () => {
    seed();
    await api('delete', `/${'AB'.repeat(12)}`).expect(204);
    expect(CheatSignalFake.deleteMany).toHaveBeenCalledWith({ subjectKey: 'ab'.repeat(12) });
    await api('delete', `/${BOB}`).expect(204);
    await api('delete', `/${BOB}`).expect(204);
    expect(state.signals).toHaveLength(9);
  });

  it('answers 404 NOT_FOUND for a malformed id and deletes nothing', async () => {
    seed();
    for (const id of ['not-an-id', '123', `${ALICE}0`, 'zz'.repeat(12)]) {
      const { body } = await api('delete', `/${id}`).expect(404);
      expect(body.error.code).toBe('NOT_FOUND');
    }
    expect(CheatSignalFake.deleteMany).not.toHaveBeenCalled();
    expect(state.signals).toHaveLength(11);
  });

  it('does not touch the anonymous entry (it has no user to dismiss)', async () => {
    seed();
    await api('delete', `/null`).expect(404);
    expect(state.signals.filter((item) => item.subjectKey.startsWith('ip:'))).toHaveLength(3);
  });
});
