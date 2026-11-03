import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import Challenge from '../src/models/Challenge.js';
import Instance from '../src/models/Instance.js';
import Solve from '../src/models/Solve.js';
import Submission from '../src/models/Submission.js';
import Team from '../src/models/Team.js';
import User from '../src/models/User.js';
import { expectedFlagFor, hashStaticFlag } from '../src/services/flagService.js';
import { instanceService } from '../src/services/instanceService.js';
import { recordSolve } from '../src/services/scoringService.js';

vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../src/models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../src/models/Team.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../src/models/Challenge.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), findById: vi.fn(), create: vi.fn(), findOneAndUpdate: vi.fn(), deleteOne: vi.fn() },
}));
vi.mock('../src/models/Instance.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn() }, ACTIVE_STATUSES: ['starting', 'running', 'stopping'],
}));
vi.mock('../src/models/Solve.js', () => ({ default: { find: vi.fn(), exists: vi.fn() } }));
vi.mock('../src/models/Submission.js', () => ({ default: { create: vi.fn(), countDocuments: vi.fn() } }));
vi.mock('../src/services/scoringService.js', () => ({ recordSolve: vi.fn() }));
vi.mock('../src/services/instanceService.js', () => ({
  instanceService: {
    start: vi.fn(), stop: vi.fn(), extend: vi.fn(), stopTeamChallenge: vi.fn(), stopChallengeInstances: vi.fn(),
  },
  serializeInstance: (i) => ({ id: String(i._id), status: i.status, url: `http://localhost:${i.port}`, expiresAt: i.expiresAt }),
}));

const oid = (n) => String(n).padStart(24, '0');
const secretFields = ['flag', 'flagHash', 'flagSalt'];
const user = { _id: oid(1), teamId: oid(2) };
const team = { _id: oid(2), banned: false };
const staticStored = hashStaticFlag('CTF{static_one}');
const staticChallenge = {
  _id: oid(10), slug: 'sanity-check', title: 'Sanity', category: 'misc', difficulty: 'easy', points: 25,
  type: 'static', description: 'hi', attachments: [{ name: 'a.txt', url: '/a.txt', _id: 'zzz' }],
  visible: true, solveCount: 3, ...staticStored,
};
const dockerChallenge = {
  _id: oid(11), slug: 'cookie-monster', title: 'Cookie', category: 'web', difficulty: 'easy', points: 100,
  type: 'docker', image: 'ctf/cookie-monster', internalPort: 8000, visible: true, solveCount: 0,
};

const api = (method, path, sub = 'player', body) => {
  const call = request(app)[method](`/api${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  User.findOne.mockResolvedValue(user);
  Team.findById.mockResolvedValue({ ...team });
  Challenge.findOne.mockResolvedValue(staticChallenge);
  Solve.exists.mockResolvedValue(null);
  Submission.countDocuments.mockResolvedValue(0);
  Submission.create.mockResolvedValue({});
  instanceService.stopTeamChallenge.mockResolvedValue();
});

describe('player challenge routes', () => {
  it('lists visible challenges with solved state and never leaks flag material', async () => {
    Challenge.find.mockReturnValue({ sort: vi.fn().mockResolvedValue([staticChallenge, dockerChallenge]) });
    Solve.find.mockResolvedValue([{ challengeId: staticChallenge._id }]);
    const { body } = await api('get', '/challenges').expect(200);
    expect(Challenge.find).toHaveBeenCalledWith({ visible: true });
    expect(body.map((c) => [c.slug, c.solvedByMyTeam, c.solveCount])).toEqual([['sanity-check', true, 3], ['cookie-monster', false, 0]]);
    for (const field of secretFields) { expect(JSON.stringify(body)).not.toContain(field); }
    expect(JSON.stringify(body)).not.toContain(staticStored.flagHash);
    expect(body[0]).not.toHaveProperty('description');
  });

  it('shows detail with the team instance and no flag material', async () => {
    Challenge.findOne.mockResolvedValue(dockerChallenge);
    Instance.findOne.mockResolvedValue({ _id: oid(20), status: 'running', port: 30001, expiresAt: new Date(0) });
    const { body } = await api('get', `/challenges/${dockerChallenge._id}`).expect(200);
    expect(body).toMatchObject({ hasInstance: true, myInstance: { id: oid(20), status: 'running', url: 'http://localhost:30001' } });
    for (const field of secretFields) { expect(JSON.stringify(body)).not.toContain(field); }
    const staticDetail = await api('get', `/challenges/${staticChallenge._id}`).expect(200);
    Challenge.findOne.mockResolvedValue(staticChallenge);
    expect(JSON.stringify(staticDetail.body)).not.toContain(staticStored.flagSalt);
  });

  it('hides hidden or unknown challenges and rejects malformed ids', async () => {
    Challenge.findOne.mockResolvedValue(null);
    await api('get', `/challenges/${oid(99)}`).expect(404);
    await api('get', '/challenges/not-an-id').expect(404);
  });

  it('is player-only and requires authentication', async () => {
    await api('get', '/challenges', 'admin').expect(403);
    await request(app).get('/api/challenges').expect(401);
  });

  it('starts an instance for the caller\'s team', async () => {
    Challenge.findOne.mockResolvedValue(dockerChallenge);
    instanceService.start.mockResolvedValue({ _id: oid(20), status: 'running', port: 30002, expiresAt: new Date(0) });
    const { body } = await api('post', `/challenges/${dockerChallenge._id}/instance`).expect(201);
    expect(body.url).toBe('http://localhost:30002');
    expect(instanceService.start).toHaveBeenCalledWith(expect.objectContaining({ challenge: dockerChallenge, team: expect.objectContaining({ _id: oid(2) }) }));
  });

  it('blocks instance and submit routes for banned teams and players without a team', async () => {
    Team.findById.mockResolvedValue({ ...team, banned: true });
    await api('post', `/challenges/${staticChallenge._id}/submit`, 'player', { flag: 'x' }).expect(403).expect((r) => expect(r.body.error.code).toBe('TEAM_BANNED'));
    await api('post', `/challenges/${dockerChallenge._id}/instance`).expect(403);
    User.findOne.mockResolvedValue({ _id: oid(1), teamId: null });
    await api('post', `/challenges/${staticChallenge._id}/submit`, 'player', { flag: 'x' }).expect(404).expect((r) => expect(r.body.error.code).toBe('NO_TEAM'));
  });
});

describe('flag submission', () => {
  it('logs a wrong flag as a hash only and awards nothing', async () => {
    const { body } = await api('post', `/challenges/${staticChallenge._id}/submit`, 'player', { flag: 'CTF{nope}' }).expect(200);
    expect(body).toMatchObject({ correct: false, pointsAwarded: 0, firstBlood: false });
    const saved = Submission.create.mock.calls[0][0];
    expect(saved).toMatchObject({ correct: false, teamId: oid(2), challengeId: staticChallenge._id });
    expect(JSON.stringify(saved)).not.toContain('nope');
    expect(recordSolve).not.toHaveBeenCalled();
  });

  it('awards points, reports first blood and stops the team instance on a correct flag', async () => {
    recordSolve.mockResolvedValue({ points: 27, firstBlood: true, score: 27 });
    const { body } = await api('post', `/challenges/${staticChallenge._id}/submit`, 'player', { flag: 'CTF{static_one}' }).expect(200);
    expect(body).toMatchObject({ correct: true, pointsAwarded: 27, firstBlood: true });
    expect(instanceService.stopTeamChallenge).toHaveBeenCalledWith(oid(2), staticChallenge._id);
  });

  it('accepts the team-specific docker flag and rejects another team\'s flag', async () => {
    Challenge.findOne.mockResolvedValue(dockerChallenge);
    recordSolve.mockResolvedValue({ points: 100, firstBlood: false, score: 100 });
    const own = expectedFlagFor(dockerChallenge, { secret: env.FLAG_SECRET, teamId: oid(2) });
    const other = expectedFlagFor(dockerChallenge, { secret: env.FLAG_SECRET, teamId: oid(3) });
    expect(own).not.toBe(other);
    await api('post', `/challenges/${dockerChallenge._id}/submit`, 'player', { flag: other }).expect(200).expect((r) => expect(r.body.correct).toBe(false));
    await api('post', `/challenges/${dockerChallenge._id}/submit`, 'player', { flag: own }).expect(200).expect((r) => expect(r.body.correct).toBe(true));
  });

  it('turns a double click into exactly one solve (second gets 409)', async () => {
    recordSolve.mockResolvedValueOnce({ points: 25, firstBlood: false, score: 25 }).mockResolvedValueOnce(null);
    const send = () => api('post', `/challenges/${staticChallenge._id}/submit`, 'player', { flag: 'CTF{static_one}' });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(409);
  });

  it('returns 409 up front when the team already solved it', async () => {
    Solve.exists.mockResolvedValue({ _id: 'x' });
    await api('post', `/challenges/${staticChallenge._id}/submit`, 'player', { flag: 'CTF{static_one}' }).expect(409);
    expect(Submission.create).not.toHaveBeenCalled();
  });

  it('rate limits at 5 attempts per minute per team per challenge', async () => {
    Submission.countDocuments.mockResolvedValue(5);
    const { body } = await api('post', `/challenges/${staticChallenge._id}/submit`, 'player', { flag: 'x' }).expect(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(Submission.countDocuments.mock.calls[0][0]).toMatchObject({ teamId: oid(2), challengeId: staticChallenge._id });
    expect(Submission.create).not.toHaveBeenCalled();
  });

  it('validates the body strictly', async () => {
    await api('post', `/challenges/${staticChallenge._id}/submit`, 'player', {}).expect(400);
    await api('post', `/challenges/${staticChallenge._id}/submit`, 'player', { flag: 'x', extra: 1 }).expect(400);
    await api('post', `/challenges/${staticChallenge._id}/submit`, 'player', { flag: 'x'.repeat(201) }).expect(400);
  });
});

describe('instance routes', () => {
  const instance = { _id: oid(20), teamId: oid(2), status: 'running', port: 30001, expiresAt: new Date(0) };

  it('lists, extends and stops only the team\'s own instances', async () => {
    Instance.find.mockReturnValue({ sort: vi.fn().mockResolvedValue([instance]) });
    expect((await api('get', '/instances').expect(200)).body[0].id).toBe(oid(20));
    Instance.findOne.mockResolvedValue(instance);
    instanceService.extend.mockResolvedValue({ ...instance, extended: true });
    await api('post', `/instances/${oid(20)}/extend`).expect(200);
    await api('delete', `/instances/${oid(20)}`).expect(204);
    expect(instanceService.stop).toHaveBeenCalledWith(oid(20));
    expect(Instance.findOne.mock.calls[0][0]).toMatchObject({ teamId: oid(2) });
  });

  it('returns 404 for another team\'s instance', async () => {
    Instance.findOne.mockResolvedValue(null);
    await api('delete', `/instances/${oid(21)}`).expect(404);
    expect(instanceService.stop).not.toHaveBeenCalled();
  });
});

describe('admin challenge CRUD', () => {
  const staticBody = {
    slug: 'sanity-check', title: 'Sanity Check', category: 'misc', difficulty: 'easy', points: 25,
    type: 'static', flag: 'CTF{welcome_to_the_arena}', description: 'md',
  };

  it('is admin-only', async () => {
    await api('get', '/admin/challenges', 'player').expect(403);
    await api('post', '/admin/challenges', 'player', staticBody).expect(403);
    await api('delete', `/admin/challenges/${oid(10)}`, 'player').expect(403);
  });

  it('hashes static flags on create and never echoes the flag or hash', async () => {
    Challenge.create.mockImplementation(async (doc) => ({ _id: oid(30), ...doc }));
    const { body } = await api('post', '/admin/challenges', 'admin', staticBody).expect(201);
    const stored = Challenge.create.mock.calls[0][0];
    expect(stored.flag).toBeUndefined();
    expect(stored.flagHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('welcome_to_the_arena');
    expect(body).toMatchObject({ slug: 'sanity-check', hasFlag: true });
    for (const field of ['flag"', 'flagHash', 'flagSalt']) { expect(JSON.stringify(body)).not.toContain(field); }
  });

  it('rejects invalid bodies: missing flag, docker without image, foreign images, unknown fields', async () => {
    const { flag, ...noFlag } = staticBody;
    await api('post', '/admin/challenges', 'admin', noFlag).expect(400);
    await api('post', '/admin/challenges', 'admin', { ...staticBody, type: 'docker' }).expect(400);
    await api('post', '/admin/challenges', 'admin', { ...staticBody, type: 'docker', image: 'nginx', internalPort: 80 }).expect(400);
    await api('post', '/admin/challenges', 'admin', { ...staticBody, extra: true }).expect(400);
    await api('post', '/admin/challenges', 'admin', { ...staticBody, slug: 'Bad Slug' }).expect(400);
    expect(Challenge.create).not.toHaveBeenCalled();
  });

  it('does not store a shared flag for docker challenges', async () => {
    Challenge.create.mockImplementation(async (doc) => ({ _id: oid(31), ...doc }));
    await api('post', '/admin/challenges', 'admin', {
      ...staticBody, slug: 'cookie-monster', type: 'docker', image: 'ctf/cookie-monster', internalPort: 8000,
    }).expect(201);
    const stored = Challenge.create.mock.calls[0][0];
    expect(stored.flagHash).toBeUndefined();
    expect(stored.flagSalt).toBeUndefined();
  });

  it('maps duplicate slugs to 409 and lists hidden challenges for admins', async () => {
    Challenge.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    await api('post', '/admin/challenges', 'admin', staticBody).expect(409);
    Challenge.find.mockReturnValue({ sort: vi.fn().mockResolvedValue([{ ...staticChallenge, visible: false }]) });
    const { body } = await api('get', '/admin/challenges', 'admin').expect(200);
    expect(Challenge.find).toHaveBeenCalledWith({});
    expect(body[0]).toMatchObject({ visible: false, hasFlag: true });
    expect(JSON.stringify(body)).not.toContain(staticStored.flagHash);
  });

  it('keeps the stored flag when PUT omits it, and deletes after stopping instances', async () => {
    Challenge.findById.mockResolvedValue(staticChallenge);
    Challenge.findOneAndUpdate.mockImplementation(async (filter, update) => ({ ...staticChallenge, ...update.$set }));
    const { flag, ...noFlag } = staticBody;
    await api('put', `/admin/challenges/${staticChallenge._id}`, 'admin', { ...noFlag, points: 50 }).expect(200);
    expect(Challenge.findOneAndUpdate.mock.calls[0][1].$set.flagHash).toBeUndefined();
    Challenge.deleteOne.mockResolvedValue({});
    await api('delete', `/admin/challenges/${staticChallenge._id}`, 'admin').expect(204);
    expect(instanceService.stopChallengeInstances).toHaveBeenCalledWith(staticChallenge._id);
    Challenge.findById.mockResolvedValue(null);
    await api('delete', `/admin/challenges/${oid(77)}`, 'admin').expect(404);
  });
});
