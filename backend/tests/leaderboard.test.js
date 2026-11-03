import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import Team from '../src/models/Team.js';
import Solve from '../src/models/Solve.js';

vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../src/models/Team.js', () => ({
  default: {
    find: vi.fn(),
  },
}));
vi.mock('../src/models/Solve.js', () => ({
  default: {
    aggregate: vi.fn().mockResolvedValue([]),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockResolvedValue([]),
    }),
  },
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

function api(method, path, sub = 'alice') {
  const call = request(app)[method](`/api${path}`);
  if (sub) {
    call.set('Authorization', `Bearer ${sub}`);
  }
  return call;
}

describe('Leaderboard API (P3-01)', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await api('get', '/leaderboard', null).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects non-player roles with 403', async () => {
    const res = await api('get', '/leaderboard', 'admin').expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns ranked leaderboard including teams with 0 solves', async () => {
    const team1Id = new mongoose.Types.ObjectId();
    const team2Id = new mongoose.Types.ObjectId();

    Solve.aggregate.mockResolvedValue([]);
    Team.find.mockReturnValue({
      select: vi.fn().mockResolvedValue([
        { _id: team1Id, name: 'Team Alpha', createdAt: new Date('2026-01-01') },
        { _id: team2Id, name: 'Team Beta', createdAt: new Date('2026-01-02') },
      ]),
    });

    const res = await api('get', '/leaderboard', 'alice').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      rank: 1,
      teamId: String(team1Id),
      teamName: 'Team Alpha',
      points: 0,
      solves: 0,
      lastSolveAt: null,
    });
    expect(res.body[1]).toMatchObject({
      rank: 2,
      teamId: String(team2Id),
      teamName: 'Team Beta',
      points: 0,
      solves: 0,
      lastSolveAt: null,
    });
  });

  it('returns timeline structure for top teams', async () => {
    Solve.aggregate.mockResolvedValue([]);
    Team.find.mockReturnValue({
      limit: vi.fn().mockResolvedValue([
        { _id: new mongoose.Types.ObjectId(), name: 'Team Alpha' },
      ]),
    });

    const res = await api('get', '/leaderboard/timeline', 'alice').expect(200);
    expect(res.body).toHaveProperty('teams');
    expect(Array.isArray(res.body.teams)).toBe(true);
    expect(res.body.teams[0]).toHaveProperty('points');
  });
});
