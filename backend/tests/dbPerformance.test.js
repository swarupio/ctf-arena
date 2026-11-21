import request from 'supertest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import Solve from '../src/models/Solve.js';
import Team from '../src/models/Team.js';
import Challenge from '../src/models/Challenge.js';
import Instance from '../src/models/Instance.js';
import User from '../src/models/User.js';
import { configureRankingCache } from '../src/services/leaderboardService.js';
import { getTeamContext } from '../src/services/teamContext.js';

vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../src/models/Solve.js', () => ({ default: { aggregate: vi.fn(), find: vi.fn() } }));
vi.mock('../src/models/Team.js', () => ({ default: { find: vi.fn(), findById: vi.fn() } }));
vi.mock('../src/models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../src/models/Challenge.js', () => ({ default: { find: vi.fn(), findOne: vi.fn() } }));
vi.mock('../src/models/Instance.js', () => ({ default: { findOne: vi.fn() }, ACTIVE_STATUSES: ['starting', 'running', 'stopping'] }));

const oid = (n) => String(n).padStart(24, '0');
const get = (path) => request(app).get(path).set('Authorization', 'Bearer p');

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': ['player'] })),
  });
  Solve.aggregate.mockResolvedValue([]);
  Team.find.mockResolvedValue([]);
});
afterEach(() => configureRankingCache({ ttlMs: 0 }));

describe('leaderboard caching', () => {
  it('serves repeat polls from a short in-process memo and shares concurrent computations', async () => {
    configureRankingCache({ ttlMs: 60_000 });
    await Promise.all([get('/api/leaderboard').expect(200), get('/api/leaderboard').expect(200)]);
    await get('/api/leaderboard').expect(200);
    expect(Solve.aggregate).toHaveBeenCalledTimes(1);
    expect(Team.find).toHaveBeenCalledTimes(1);
  });

  it('does not memoise failures', async () => {
    Solve.aggregate.mockRejectedValueOnce(new Error('boom'));
    configureRankingCache({ ttlMs: 60_000 });
    await get('/api/leaderboard').expect(500);
    await get('/api/leaderboard').expect(200);
    expect(Solve.aggregate).toHaveBeenCalledTimes(2);
  });

  it('sets private short Cache-Control and an ETag; idle-team read is lean with a name projection', async () => {
    const res = await get('/api/leaderboard').expect(200);
    expect(res.headers['cache-control']).toBe('private, max-age=5');
    expect(res.headers.etag).toBeTruthy();
    expect(Team.find.mock.calls[0].slice(1)).toEqual(['name', { lean: true }]);
  });
});

describe('lean reads with projections', () => {
  it('team context loads one user and one team, lean, with projections', async () => {
    User.findOne.mockResolvedValue({ _id: oid(1), teamId: oid(2) });
    Team.findById.mockResolvedValue({ _id: oid(2), banned: false });
    await getTeamContext({ cognitoSub: 's' });
    expect(User.findOne).toHaveBeenCalledTimes(1);
    expect(Team.findById).toHaveBeenCalledTimes(1);
    expect(User.findOne.mock.calls[0][2]).toEqual({ lean: true });
    expect(Team.findById.mock.calls[0][2]).toEqual({ lean: true });
    expect(User.findOne.mock.calls[0][1]).not.toMatch(/email/);
  });

  it('challenge list never selects flag fields and reads lean', async () => {
    User.findOne.mockResolvedValue({ _id: oid(1), teamId: oid(2) });
    Team.findById.mockResolvedValue({ _id: oid(2), banned: false });
    Challenge.find.mockReturnValue({ sort: vi.fn().mockResolvedValue([]) });
    Solve.find.mockResolvedValue([]);
    await get('/api/challenges').expect(200);
    const [, fields, options] = Challenge.find.mock.calls[0];
    expect(fields).not.toMatch(/flag/);
    expect(options).toEqual({ lean: true });
    expect(Solve.find.mock.calls[0][2]).toEqual({ lean: true });
    expect(Instance.findOne).not.toHaveBeenCalled();
  });
});
