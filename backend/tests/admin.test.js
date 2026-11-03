import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import Team from '../src/models/Team.js';
import User from '../src/models/User.js';
import Solve from '../src/models/Solve.js';
import Submission from '../src/models/Submission.js';
import Instance from '../src/models/Instance.js';

vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../src/models/User.js', () => ({
  default: {
    countDocuments: vi.fn(),
    find: vi.fn(),
  },
}));
vi.mock('../src/models/Team.js', () => ({
  default: {
    countDocuments: vi.fn(),
    find: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));
vi.mock('../src/models/Solve.js', () => ({
  default: {
    countDocuments: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../src/models/Submission.js', () => ({
  default: {
    countDocuments: vi.fn().mockResolvedValue(0),
  },
}));
vi.mock('../src/models/Instance.js', () => ({
  default: {
    countDocuments: vi.fn().mockResolvedValue(0),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockResolvedValue([]),
    }),
    findById: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn(),
  },
  ACTIVE_STATUSES: ['starting', 'running', 'stopping'],
}));

let verify;
beforeEach(() => {
  vi.resetAllMocks();
  verify = vi.fn().mockImplementation(async (sub) => ({
    sub,
    email: `${sub}@example.com`,
    'cognito:groups': sub === 'admin' ? ['admin'] : ['player'],
  }));
  getCognitoVerifier.mockReturnValue({ verify });
});

function api(method, path, sub = 'admin', body) {
  const call = request(app)[method](`/api${path}`);
  if (sub) {
    call.set('Authorization', `Bearer ${sub}`);
  }
  return body === undefined ? call : call.send(body);
}

describe('Admin Stats API (P3-03)', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await api('get', '/admin/stats', null).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects player requests with 403', async () => {
    const res = await api('get', '/admin/stats', 'player-user').expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns system statistics for admin user', async () => {
    User.countDocuments.mockResolvedValue(10);
    Team.countDocuments.mockResolvedValue(4);
    Solve.countDocuments.mockResolvedValue(0);
    Submission.countDocuments.mockResolvedValue(0);
    Instance.countDocuments.mockResolvedValue(0);

    const res = await api('get', '/admin/stats', 'admin').expect(200);
    expect(res.body).toMatchObject({
      users: 10,
      teams: 4,
      solves: 0,
      submissions: 0,
      wrongRate: 0,
      activeInstances: 0,
    });
    expect(res.body.requestsByReplica).toBeDefined();
  });
});

describe('Admin Teams API (P3-04)', () => {
  it('returns all teams with ban state for admin', async () => {
    const fakeTeams = [
      {
        _id: new mongoose.Types.ObjectId(),
        name: 'Alpha Team',
        inviteCode: 'ABCDEF',
        captainId: new mongoose.Types.ObjectId(),
        memberIds: [],
        banned: false,
        createdAt: new Date(),
      },
    ];

    Team.find.mockReturnValue({
      sort: vi.fn().mockResolvedValue(fakeTeams),
    });
    User.find.mockResolvedValue([]);
    Solve.aggregate.mockResolvedValue([]);

    const res = await api('get', '/admin/teams', 'admin').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Alpha Team');
    expect(res.body[0].banned).toBe(false);
  });

  it('validates ban payload and updates team ban state', async () => {
    const teamId = new mongoose.Types.ObjectId().toHexString();

    Team.findByIdAndUpdate.mockResolvedValue({
      _id: teamId,
      name: 'Banned Team',
      banned: true,
    });

    const res = await api('patch', `/admin/teams/${teamId}/ban`, 'admin', { banned: true }).expect(200);
    expect(res.body).toEqual({
      id: teamId,
      name: 'Banned Team',
      banned: true,
    });
  });

  it('rejects invalid ObjectId on ban with 400', async () => {
    const res = await api('patch', '/admin/teams/invalid-id/ban', 'admin', { banned: true }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when team is not found', async () => {
    const teamId = new mongoose.Types.ObjectId().toHexString();
    Team.findByIdAndUpdate.mockResolvedValue(null);

    const res = await api('patch', `/admin/teams/${teamId}/ban`, 'admin', { banned: true }).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
