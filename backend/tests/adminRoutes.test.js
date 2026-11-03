import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import { replicaCounter } from '../src/middleware/requestCounter.js';
import Challenge from '../src/models/Challenge.js';
import Instance from '../src/models/Instance.js';
import ReplicaStat from '../src/models/ReplicaStat.js';
import Solve from '../src/models/Solve.js';
import Submission from '../src/models/Submission.js';
import Team from '../src/models/Team.js';
import User from '../src/models/User.js';
import { instanceService } from '../src/services/instanceService.js';

vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../src/models/User.js', () => ({ default: { countDocuments: vi.fn() } }));
vi.mock('../src/models/Team.js', () => ({
  default: { countDocuments: vi.fn(), find: vi.fn(), findOneAndUpdate: vi.fn() },
}));
vi.mock('../src/models/Challenge.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../src/models/Instance.js', () => ({
  default: { find: vi.fn(), countDocuments: vi.fn() }, ACTIVE_STATUSES: ['starting', 'running', 'stopping'],
}));
vi.mock('../src/models/Solve.js', () => ({ default: { countDocuments: vi.fn(), aggregate: vi.fn() } }));
vi.mock('../src/models/Submission.js', () => ({ default: { countDocuments: vi.fn() } }));
vi.mock('../src/models/ReplicaStat.js', () => ({ default: { find: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../src/services/instanceService.js', () => ({
  instanceService: { stop: vi.fn(), stopTeamInstances: vi.fn() },
  serializeInstance: (i) => ({ id: String(i._id), url: `http://arena.test:${i.port}` }),
}));

const oid = (n) => String(n).padStart(24, '0');
const forbiddenFields = ['flag', 'flagHash', 'flagSalt', 'containerId', 'inviteCode', 'email'];

const api = (method, path, sub = 'admin', body) => {
  const call = request(app)[method](`/api${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};
const expectNoSecrets = (body) => {
  for (const field of forbiddenFields) { expect(JSON.stringify(body)).not.toContain(field); }
};

const adminRoutes = [
  ['get', '/admin/stats'],
  ['get', '/admin/instances'],
  ['post', `/admin/instances/${oid(1)}/kill`],
  ['get', '/admin/teams'],
  ['patch', `/admin/teams/${oid(1)}/ban`, { banned: true }],
];

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
});

afterAll(() => replicaCounter.stop());

describe('admin route guards', () => {
  it.each(adminRoutes)('%s %s rejects missing tokens (401) and players (403) before touching data', async (method, path, body) => {
    const anonymous = request(app)[method](`/api${path}`);
    await (body ? anonymous.send(body) : anonymous).expect(401);
    const { body: error } = await api(method, path, 'player', body).expect(403);
    expect(error.error.code).toBe('FORBIDDEN');
    expect(instanceService.stop).not.toHaveBeenCalled();
    expect(instanceService.stopTeamInstances).not.toHaveBeenCalled();
    expect(Team.findOneAndUpdate).not.toHaveBeenCalled();
    expect(User.countDocuments).not.toHaveBeenCalled();
  });
});

describe('GET /admin/stats', () => {
  const mockCounts = ({ submissions, wrong }) => {
    User.countDocuments.mockResolvedValue(12);
    Team.countDocuments.mockResolvedValue(5);
    Solve.countDocuments.mockResolvedValue(9);
    Submission.countDocuments.mockImplementation(async (filter) => (filter?.correct === false ? wrong : submissions));
    Instance.countDocuments.mockResolvedValue(3);
    ReplicaStat.find.mockResolvedValue([
      { replica: 'backend-1', requests: 120 }, { replica: 'backend-2', requests: 80 },
    ]);
  };

  it('returns the totals, the wrong-submission rate and per-replica requests', async () => {
    mockCounts({ submissions: 8, wrong: 2 });
    const { body } = await api('get', '/admin/stats').expect(200);
    expect(body).toEqual({
      users: 12, teams: 5, solves: 9, submissions: 8, wrongRate: 0.25, activeInstances: 3,
      requestsByReplica: { 'backend-1': 120, 'backend-2': 80 },
    });
    expect(Submission.countDocuments).toHaveBeenCalledWith({ correct: false });
  });

  it('counts only starting, running and stopping instances as active', async () => {
    mockCounts({ submissions: 1, wrong: 0 });
    await api('get', '/admin/stats').expect(200);
    expect(Instance.countDocuments).toHaveBeenCalledWith({ status: { $in: ['starting', 'running', 'stopping'] } });
  });

  it('reports a wrong rate of 0 (not NaN) when nothing was submitted and no replica has served yet', async () => {
    mockCounts({ submissions: 0, wrong: 0 });
    ReplicaStat.find.mockResolvedValue([]);
    const { body } = await api('get', '/admin/stats').expect(200);
    expect(body.wrongRate).toBe(0);
    expect(body.submissions).toBe(0);
    expect(body.requestsByReplica).toEqual({});
  });

  it('reports a wrong rate of 1 when every submission was wrong', async () => {
    mockCounts({ submissions: 4, wrong: 4 });
    expect((await api('get', '/admin/stats').expect(200)).body.wrongRate).toBe(1);
  });
});

describe('GET /admin/instances', () => {
  const expiresAt = new Date('2026-11-04T12:00:00.000Z');
  const stored = (n, extra = {}) => ({
    _id: oid(n), teamId: oid(2), challengeId: oid(3), userId: oid(4), port: 30000 + n, status: 'running',
    containerId: 'deadbeefcontainer', expiresAt, extended: true, ...extra,
  });
  const mockLookups = ({ teams = [], challenges = [] } = {}) => {
    Team.find.mockResolvedValue(teams);
    Challenge.find.mockResolvedValue(challenges);
  };

  it('lists active instances with team and challenge names and no secrets', async () => {
    Instance.find.mockReturnValue({ sort: vi.fn().mockResolvedValue([stored(1), stored(2, { status: 'starting', extended: undefined })]) });
    mockLookups({
      teams: [{ _id: oid(2), name: 'Rustaceans', inviteCode: 'ABC234' }],
      challenges: [{ _id: oid(3), slug: 'cookie-monster', title: 'Cookie Monster', flagHash: 'x'.repeat(64) }],
    });
    const { body } = await api('get', '/admin/instances').expect(200);
    expect(Instance.find).toHaveBeenCalledWith({ status: { $in: ['starting', 'running', 'stopping'] } });
    expect(body).toEqual([
      {
        id: oid(1), status: 'running', port: 30001, url: 'http://arena.test:30001', expiresAt: expiresAt.toISOString(),
        extended: true, team: { id: oid(2), name: 'Rustaceans' },
        challenge: { id: oid(3), slug: 'cookie-monster', title: 'Cookie Monster' },
      },
      expect.objectContaining({ id: oid(2), status: 'starting', port: 30002, extended: false }),
    ]);
    expectNoSecrets(body);
    // One lookup per collection, not one per instance.
    expect(Team.find).toHaveBeenCalledTimes(1);
    expect(Challenge.find).toHaveBeenCalledTimes(1);
  });

  it('tolerates deleted teams and challenges', async () => {
    Instance.find.mockReturnValue({ sort: vi.fn().mockResolvedValue([stored(1)]) });
    mockLookups();
    const { body } = await api('get', '/admin/instances').expect(200);
    expect(body[0]).toMatchObject({
      team: { id: oid(2), name: null }, challenge: { id: oid(3), slug: null, title: null },
    });
  });

  it('returns an empty list without any lookups when nothing is running', async () => {
    Instance.find.mockReturnValue({ sort: vi.fn().mockResolvedValue([]) });
    const { body } = await api('get', '/admin/instances').expect(200);
    expect(body).toEqual([]);
    expect(Team.find).not.toHaveBeenCalled();
    expect(Challenge.find).not.toHaveBeenCalled();
  });
});

describe('POST /admin/instances/:id/kill', () => {
  it('force stops the instance through the instance service', async () => {
    instanceService.stop.mockResolvedValue({ _id: oid(7), status: 'stopped' });
    const response = await api('post', `/admin/instances/${oid(7)}/kill`).expect(204);
    expect(response.text).toBe('');
    expect(instanceService.stop).toHaveBeenCalledWith(oid(7));
  });

  it('returns 404 when the instance does not exist or is no longer active', async () => {
    instanceService.stop.mockResolvedValue(null);
    const { body } = await api('post', `/admin/instances/${oid(8)}/kill`).expect(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for malformed ids without calling the service', async () => {
    await api('post', '/admin/instances/not-an-id/kill').expect(404);
    expect(instanceService.stop).not.toHaveBeenCalled();
  });

  it('hides Docker failures behind a generic 500', async () => {
    instanceService.stop.mockRejectedValue(new Error('docker socket /var/run/docker.sock refused'));
    const { body } = await api('post', `/admin/instances/${oid(9)}/kill`).expect(500);
    expect(JSON.stringify(body)).not.toContain('docker.sock');
  });
});

describe('GET /admin/teams', () => {
  it('lists teams with member count, score, solves and ban state, best score first', async () => {
    Team.find.mockResolvedValue([
      { _id: oid(1), name: 'Zeta', memberIds: [oid(11)], banned: false, inviteCode: 'ABC234', captainId: oid(11) },
      { _id: oid(2), name: 'Alpha', memberIds: [oid(12), oid(13)], banned: true, inviteCode: 'DEF567' },
      { _id: oid(3), name: 'Beta', memberIds: [oid(14), oid(15), oid(16)], banned: false, inviteCode: 'GHJ789' },
    ]);
    Solve.aggregate.mockResolvedValue([
      { _id: oid(1), score: 210, solves: 2 }, { _id: oid(2), score: 25, solves: 1 },
    ]);
    const { body } = await api('get', '/admin/teams').expect(200);
    expect(body).toEqual([
      { id: oid(1), name: 'Zeta', members: 1, score: 210, banned: false, solves: 2 },
      { id: oid(2), name: 'Alpha', members: 2, score: 25, banned: true, solves: 1 },
      { id: oid(3), name: 'Beta', members: 3, score: 0, banned: false, solves: 0 },
    ]);
    expectNoSecrets(body);
    expect(Solve.aggregate).toHaveBeenCalledWith([
      { $group: { _id: '$teamId', score: { $sum: '$points' }, solves: { $sum: 1 } } },
    ]);
  });

  it('breaks score ties by team name', async () => {
    Team.find.mockResolvedValue([
      { _id: oid(1), name: 'Bravo', memberIds: [], banned: false },
      { _id: oid(2), name: 'Alpha', memberIds: [], banned: false },
    ]);
    Solve.aggregate.mockResolvedValue([]);
    const { body } = await api('get', '/admin/teams').expect(200);
    expect(body.map((team) => team.name)).toEqual(['Alpha', 'Bravo']);
  });
});

describe('PATCH /admin/teams/:id/ban', () => {
  const stored = (banned) => ({ _id: oid(5), name: 'Rustaceans', banned, inviteCode: 'ABC234' });

  it('bans the team and stops all of its instances', async () => {
    Team.findOneAndUpdate.mockResolvedValue(stored(true));
    instanceService.stopTeamInstances.mockResolvedValue();
    const { body } = await api('patch', `/admin/teams/${oid(5)}/ban`, 'admin', { banned: true }).expect(200);
    expect(body).toEqual({ id: oid(5), name: 'Rustaceans', banned: true });
    expect(Team.findOneAndUpdate).toHaveBeenCalledWith({ _id: oid(5) }, { $set: { banned: true } }, { new: true });
    expect(instanceService.stopTeamInstances).toHaveBeenCalledWith(oid(5));
    // The flag is set before instances are stopped, so the team cannot start new ones in between.
    expect(Team.findOneAndUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(instanceService.stopTeamInstances.mock.invocationCallOrder[0]);
    expectNoSecrets(body);
  });

  it('unbans without stopping or restarting anything', async () => {
    Team.findOneAndUpdate.mockResolvedValue(stored(false));
    const { body } = await api('patch', `/admin/teams/${oid(5)}/ban`, 'admin', { banned: false }).expect(200);
    expect(body.banned).toBe(false);
    expect(instanceService.stopTeamInstances).not.toHaveBeenCalled();
    expect(instanceService.stop).not.toHaveBeenCalled();
  });

  it('returns 404 for unknown teams and malformed ids', async () => {
    Team.findOneAndUpdate.mockResolvedValue(null);
    await api('patch', `/admin/teams/${oid(6)}/ban`, 'admin', { banned: true }).expect(404);
    await api('patch', '/admin/teams/not-an-id/ban', 'admin', { banned: true }).expect(404);
    expect(instanceService.stopTeamInstances).not.toHaveBeenCalled();
  });

  it.each([
    ['missing body', undefined],
    ['empty object', {}],
    ['string instead of boolean', { banned: 'true' }],
    ['number instead of boolean', { banned: 1 }],
    ['null', { banned: null }],
    ['unknown extra field', { banned: true, name: 'hacked' }],
  ])('rejects an invalid body (%s) with 400', async (label, body) => {
    const response = await api('patch', `/admin/teams/${oid(5)}/ban`, 'admin', body).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(Team.findOneAndUpdate).not.toHaveBeenCalled();
    expect(instanceService.stopTeamInstances).not.toHaveBeenCalled();
  });

  it('keeps the ban but reports an error when stopping an instance fails, so it can be repeated', async () => {
    Team.findOneAndUpdate.mockResolvedValue(stored(true));
    instanceService.stopTeamInstances.mockRejectedValue(new Error('docker unavailable'));
    const { body } = await api('patch', `/admin/teams/${oid(5)}/ban`, 'admin', { banned: true }).expect(500);
    expect(body.error.code).toBe('SERVER_ERROR');
    expect(Team.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('request counting in the app', () => {
  it('counts /api requests but not health checks', async () => {
    const before = replicaCounter.pending();
    await request(app).get('/api/health').expect(200);
    expect(replicaCounter.pending()).toBe(before);
    await request(app).get('/api/admin/stats').expect(401);
    expect(replicaCounter.pending()).toBe(before + 1);
  });
});
