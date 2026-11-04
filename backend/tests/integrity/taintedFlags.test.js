import { createHash, createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import { env } from '../../src/config/env.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import Challenge from '../../src/models/Challenge.js';
import Solve from '../../src/models/Solve.js';
import Submission from '../../src/models/Submission.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { expectedFlagFor, hashStaticFlag } from '../../src/services/flagService.js';
import { instanceService } from '../../src/services/instanceService.js';
import { integrityService, taintedFlagFor } from '../../src/services/integrityService.js';
import { recordSolve } from '../../src/services/scoringService.js';
import { MODES } from '../../src/terminal/modes/index.js';
import { TaintedFlagFake, goLive, goOffline, installFakes, state } from './fakes.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), findById: vi.fn(), create: vi.fn(), findOneAndUpdate: vi.fn(), deleteOne: vi.fn() },
}));
vi.mock('../../src/models/Instance.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn() }, ACTIVE_STATUSES: ['starting', 'running', 'stopping'],
}));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn(), exists: vi.fn() } }));
vi.mock('../../src/models/Submission.js', () => ({ default: { create: vi.fn(), countDocuments: vi.fn() } }));
vi.mock('../../src/models/ReplicaStat.js', () => ({ default: { updateOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/CheatSignal.js', async () => ({ default: (await import('./fakes.js')).CheatSignalFake, SIGNAL_KINDS: [] }));
vi.mock('../../src/models/TaintedFlag.js', async () => ({ default: (await import('./fakes.js')).TaintedFlagFake }));
vi.mock('../../src/models/TerminalActivity.js', async () => ({ default: (await import('./fakes.js')).TerminalActivityFake }));
vi.mock('../../src/services/scoringService.js', () => ({ recordSolve: vi.fn() }));
vi.mock('../../src/services/instanceService.js', () => ({
  instanceService: {
    start: vi.fn(), stop: vi.fn(), extend: vi.fn(), stopTeamChallenge: vi.fn(), stopChallengeInstances: vi.fn(),
  },
  serializeInstance: (i) => ({ id: String(i._id) }),
}));
vi.mock('../../src/terminal/shell.js', () => ({ execute: vi.fn(), complete: vi.fn() }));

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const oid = (n) => String(n).padStart(24, '0');
const secret = env.FLAG_SECRET;
const TEAM_A = oid(2);
const TEAM_B = oid(4);
const users = {
  player: { _id: oid(1), teamId: TEAM_A },
  player2: { _id: oid(3), teamId: TEAM_B },
};
const staticChallenge = {
  _id: oid(10), slug: 'sanity-check', title: 'Sanity', category: 'misc', difficulty: 'easy', points: 25,
  type: 'static', description: 'hi', attachments: [], visible: true, solveCount: 3, ...hashStaticFlag('CTF{static_one}'),
};
const easyDocs = MODES.easy.codes.map((code) => ({
  _id: oid(1000 + code.n), slug: `terminal-easy-${code.n}`, title: `Terminal Easy #${code.n}`, category: 'terminal',
  type: 'terminal', difficulty: 'easy', points: code.points, visible: true, solveCount: 0, terminal: { mode: 'easy', code: code.n },
}));

const api = (method, path, sub, body) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${sub}`).send(body);
const submitChallenge = (flag, sub = 'player') => api('post', `/challenges/${staticChallenge._id}/submit`, sub, { flag });
const submitTerminal = (flag, sub = 'player') => api('post', '/terminal/easy/submit', sub, { flag });
const decoyFor = async (subjectKey, slug = 'terminal-hard-7') => (await integrityService.issueTaintedFlags({ subjectKey, slugs: [slug] }))[0];
const tainted = () => state.signals.filter((row) => row.kind === 'tainted-flag');

beforeAll(goLive);
afterAll(() => {
  goOffline();
  replicaCounter.stop();
});
beforeEach(() => {
  vi.resetAllMocks();
  installFakes();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': ['player'] })),
  });
  User.findOne.mockImplementation(async ({ cognitoSub }) => users[cognitoSub] ?? null);
  Team.findById.mockImplementation(async (id) => ({ _id: id, name: 'T', banned: false }));
  Challenge.findOne.mockResolvedValue(staticChallenge);
  Challenge.find.mockImplementation(() => ({ lean: async () => easyDocs }));
  Solve.exists.mockResolvedValue(null);
  Solve.find.mockImplementation(() => ({ lean: async () => [] }));
  Submission.countDocuments.mockResolvedValue(0);
  Submission.create.mockResolvedValue({});
  instanceService.stopTeamChallenge.mockResolvedValue();
  recordSolve.mockImplementation(async ({ challenge }) => ({ points: challenge.points, firstBlood: false, score: challenge.points }));
});
afterEach(() => vi.restoreAllMocks());

describe('taintedFlagFor', () => {
  it('is CTF{<slug_underscored>_<12 hex of HMAC-SHA256(secret, taint:subject:slug)>}', () => {
    const flag = taintedFlagFor({ secret, subjectKey: 'u1', slug: 'terminal-easy-canary' });
    const digest = createHmac('sha256', secret).update('taint:u1:terminal-easy-canary').digest('hex').slice(0, 12);
    expect(flag).toBe(`CTF{terminal_easy_canary_${digest}}`);
    expect(flag).toMatch(/^CTF\{[a-z0-9_]+_[0-9a-f]{12}\}$/); // same look as a real dynamic flag
  });

  it('is deterministic and differs by subject, slug and secret', () => {
    const base = { secret, subjectKey: 'u1', slug: 'a-b' };
    expect(taintedFlagFor(base)).toBe(taintedFlagFor({ ...base }));
    expect(taintedFlagFor({ ...base, subjectKey: 'u2' })).not.toBe(taintedFlagFor(base));
    expect(taintedFlagFor({ ...base, slug: 'a-c' })).not.toBe(taintedFlagFor(base));
    expect(taintedFlagFor({ ...base, secret: `${secret}x` })).not.toBe(taintedFlagFor(base));
  });

  it('never equals the real per-team flag of the same slug', () => {
    const challenge = { _id: oid(1001), slug: 'terminal-easy-1' };
    for (const teamId of [TEAM_A, TEAM_B, 'admin-preview']) {
      expect(taintedFlagFor({ secret, subjectKey: teamId, slug: challenge.slug })).not.toBe(expectedFlagFor(challenge, { secret, teamId }));
    }
  });
});

describe('issuing decoys', () => {
  it('stores each flag once, by hash only, with its subject and slug', async () => {
    const first = await integrityService.issueTaintedFlags({ subjectKey: 'u1', slugs: ['terminal-hard-7', 'vault-master-key'] });
    const again = await integrityService.issueTaintedFlags({ subjectKey: 'u1', slugs: ['terminal-hard-7', 'vault-master-key'] });
    expect(again).toEqual(first);
    expect(state.tainted).toHaveLength(2);
    expect(state.tainted[0]).toEqual({ hash: sha256(first[0]), subjectKey: 'u1', slug: 'terminal-hard-7', issuedAt: expect.any(Date) });
    expect(JSON.stringify(state.tainted)).not.toContain('CTF{');
    expect(TaintedFlagFake.insertMany.mock.calls[0][1]).toEqual({ ordered: false });
  });

  it('ignores the duplicate-key error of a repeat without logging a failure', async () => {
    const written = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { written.push(String(chunk)); return true; });
    await integrityService.issueTaintedFlags({ subjectKey: 'u1', slugs: ['a-b'] });
    await integrityService.issueTaintedFlags({ subjectKey: 'u1', slugs: ['a-b'] });
    await integrityService.flush();
    expect(written).toEqual([]);
  });
});

describe('wrong submissions on a normal challenge', () => {
  const plainWrong = 'CTF{plain_wrong_guess}';

  it('answers a copied decoy exactly like any incorrect flag and records a severity 3 signal', async () => {
    const decoy = await decoyFor(users.player2._id);
    const plain = await submitChallenge(plainWrong);
    const plainSaved = Submission.create.mock.calls[0][0];
    Submission.create.mockClear();
    const copied = await submitChallenge(decoy);
    const copiedSaved = Submission.create.mock.calls[0][0];

    expect(copied.status).toBe(plain.status);
    expect(copied.body).toEqual(plain.body);
    expect(copied.body).toEqual({ correct: false, pointsAwarded: 0, firstBlood: false, message: 'Incorrect flag. Keep trying!' });
    expect(Object.keys(copiedSaved).sort()).toEqual(Object.keys(plainSaved).sort());
    expect({ ...copiedSaved, submittedHash: null }).toEqual({ ...plainSaved, submittedHash: null });
    expect(JSON.stringify(copied.body)).not.toMatch(/taint|decoy|honeypot|canary|signal/i);
    expect(copied.headers['set-cookie']).toBeUndefined();

    await integrityService.flush();
    expect(tainted()).toHaveLength(1);
    expect(tainted()[0]).toMatchObject({
      subjectKey: users.player._id, userId: users.player._id, kind: 'tainted-flag', severity: 3, detail: `from:${users.player2._id}`, count: 1,
    });
    expect(recordSolve).not.toHaveBeenCalled();
  });

  it('shows reuse of the caller\'s own decoy as from:self and an anonymous scraper\'s as from:anonymous', async () => {
    await submitChallenge(await decoyFor(users.player._id)).expect(200);
    await submitChallenge(await decoyFor(`ip:${'ab'.repeat(32)}`, 'vault-master-key')).expect(200);
    await integrityService.flush();
    expect(tainted().map((row) => row.detail).sort()).toEqual(['from:anonymous', 'from:self']);
    expect(JSON.stringify(state.signals)).not.toContain('ab'.repeat(32));
  });

  it('counts repeats on the same signal row', async () => {
    const decoy = await decoyFor(users.player2._id);
    Submission.countDocuments.mockResolvedValue(0);
    await submitChallenge(decoy);
    await submitChallenge(decoy);
    await integrityService.flush();
    expect(tainted()).toHaveLength(1);
    expect(tainted()[0].count).toBe(2);
  });

  it('does ONE indexed lookup by the SHA-256 of the trimmed flag, and nothing for an unknown wrong flag', async () => {
    const decoy = await decoyFor(users.player2._id);
    TaintedFlagFake.findOne.mockClear();
    await submitChallenge(`  ${plainWrong}  `).expect(200);
    expect(TaintedFlagFake.findOne).toHaveBeenCalledTimes(1);
    expect(TaintedFlagFake.findOne.mock.calls[0][0]).toEqual({ hash: sha256(plainWrong) });
    await integrityService.flush();
    expect(tainted()).toEqual([]);

    TaintedFlagFake.findOne.mockClear();
    await submitChallenge(`  ${decoy}  `).expect(200);
    expect(TaintedFlagFake.findOne).toHaveBeenCalledTimes(1);
    expect(TaintedFlagFake.findOne.mock.calls[0][0]).toEqual({ hash: sha256(decoy) });
  });

  it('leaves the correct-flag path untouched and never looks anything up', async () => {
    const { body, status } = await submitChallenge('CTF{static_one}');
    expect(status).toBe(200);
    expect(body).toEqual({ correct: true, pointsAwarded: 25, firstBlood: false, message: 'Correct flag!' });
    expect(TaintedFlagFake.findOne).not.toHaveBeenCalled();
    await integrityService.flush();
    expect(state.signals).toEqual([]);
  });

  it('does not look up on rate-limited, duplicate-solve or invalid requests', async () => {
    Submission.countDocuments.mockResolvedValue(5);
    await submitChallenge('CTF{x}').expect(429);
    Submission.countDocuments.mockResolvedValue(0);
    Solve.exists.mockResolvedValue({ _id: 'x' });
    await submitChallenge('CTF{x}').expect(409);
    Solve.exists.mockResolvedValue(null);
    await api('post', `/challenges/${staticChallenge._id}/submit`, 'player', { flag: '' }).expect(400);
    expect(TaintedFlagFake.findOne).not.toHaveBeenCalled();
  });

  it('still answers a normal incorrect flag when the lookup fails or the database is not connected', async () => {
    TaintedFlagFake.findOne.mockImplementation(() => { throw new Error('db down'); });
    const failed = await submitChallenge('CTF{x}').expect(200);
    expect(failed.body.correct).toBe(false);
    goOffline();
    try {
      TaintedFlagFake.findOne.mockClear();
      const offline = await submitChallenge('CTF{x}').expect(200);
      expect(offline.body).toEqual(failed.body);
      expect(TaintedFlagFake.findOne).not.toHaveBeenCalled();
    } finally {
      goLive();
    }
  });
});

describe('wrong submissions in the terminal game', () => {
  const wrongBody = { correct: false, pointsAwarded: 0, firstBlood: false, message: 'Incorrect flag. Keep digging!', solved: 0, total: MODES.easy.codes.length };

  it('answers a copied decoy exactly like any incorrect flag and records the signal', async () => {
    const decoy = await decoyFor(users.player2._id, 'terminal-easy-canary');
    const plain = await submitTerminal('CTF{plain_wrong_guess}');
    const plainSaved = Submission.create.mock.calls[0][0];
    Submission.create.mockClear();
    const copied = await submitTerminal(decoy);
    expect(plain.body).toEqual(wrongBody);
    expect(copied.status).toBe(200);
    expect(copied.body).toEqual(wrongBody);
    expect({ ...Submission.create.mock.calls[0][0], submittedHash: null }).toEqual({ ...plainSaved, submittedHash: null });
    await integrityService.flush();
    expect(tainted()).toHaveLength(1);
    expect(tainted()[0]).toMatchObject({ subjectKey: users.player._id, severity: 3, detail: `from:${users.player2._id}` });
  });

  it('does not look anything up for a correct, an already solved or a rate limited submission', async () => {
    const own = expectedFlagFor(easyDocs[1], { secret, teamId: TEAM_A });
    const ok = await submitTerminal(own).expect(200);
    expect(ok.body).toMatchObject({ correct: true, code: 2 });
    Solve.find.mockImplementation(() => ({ lean: async () => [{ teamId: TEAM_A, challengeId: easyDocs[1]._id, points: 40, firstBlood: false }] }));
    const again = await submitTerminal(own).expect(200);
    expect(again.body).toMatchObject({ correct: true, alreadySolved: true });
    Submission.countDocuments.mockResolvedValue(10);
    await submitTerminal('CTF{x}').expect(429);
    expect(TaintedFlagFake.findOne).not.toHaveBeenCalled();
    await integrityService.flush();
    expect(state.signals).toEqual([]);
  });

  it('is not triggered by another team\'s real flag (only decoys count)', async () => {
    const theirs = expectedFlagFor(easyDocs[0], { secret, teamId: TEAM_B });
    const { body } = await submitTerminal(theirs).expect(200);
    expect(body.correct).toBe(false);
    expect(TaintedFlagFake.findOne).toHaveBeenCalledTimes(1);
    await integrityService.flush();
    expect(state.signals).toEqual([]);
  });
});
