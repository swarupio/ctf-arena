import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import Solve from '../src/models/Solve.js';
import Team from '../src/models/Team.js';
import { compareStanding } from '../src/services/leaderboardService.js';

vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../src/models/Solve.js', () => ({ default: { aggregate: vi.fn(), find: vi.fn() } }));
vi.mock('../src/models/Team.js', () => ({ default: { find: vi.fn() } }));

const oid = (n) => String(n).padStart(24, '0');
const at = (minutes) => new Date(Date.UTC(2026, 10, 3, 12, minutes, 0));
const row = (n, teamName, points, solves, minutes) => ({ _id: oid(n), teamName, points, solves, lastSolveAt: at(minutes) });
const idleTeam = (n, name) => ({ _id: oid(n), name, inviteCode: 'ABCDEF', captainId: oid(90), memberIds: [oid(91)], banned: false });
const solve = (team, points, minutes) => ({ teamId: oid(team), points, solvedAt: at(minutes) });

const api = (path, sub = 'player') => request(app).get(`/api/leaderboard${path}`).set('Authorization', `Bearer ${sub}`);
const solveQuery = (solves) => ({ sort: vi.fn().mockResolvedValue(solves) });

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  Solve.aggregate.mockResolvedValue([]);
  Team.find.mockResolvedValue([]);
  Solve.find.mockReturnValue(solveQuery([]));
});

describe('GET /api/leaderboard', () => {
  it('ranks by points desc, then the earlier last solve, with rank equal to position', async () => {
    Solve.aggregate.mockResolvedValue([
      row(1, 'Late Bloomers', 300, 3, 40),
      row(2, 'Speedsters', 300, 3, 20),
      row(3, 'Leaders', 450, 4, 50),
      row(4, 'Newcomers', 25, 1, 5),
    ]);
    const { body } = await api('').expect(200);
    expect(body.map((t) => [t.rank, t.teamName, t.points, t.solves])).toEqual([
      [1, 'Leaders', 450, 4], [2, 'Speedsters', 300, 3], [3, 'Late Bloomers', 300, 3], [4, 'Newcomers', 25, 1],
    ]);
    expect(body[0]).toEqual({
      rank: 1, teamId: oid(3), teamName: 'Leaders', points: 450, solves: 4, lastSolveAt: at(50).toISOString(),
    });
  });

  it('breaks remaining ties by team name, ignoring case, so the order is deterministic', async () => {
    Solve.aggregate.mockResolvedValue([row(1, 'zeta', 100, 1, 10), row(2, 'Alpha', 100, 1, 10), row(3, 'beta', 100, 1, 10)]);
    const first = (await api('').expect(200)).body.map((t) => t.teamName);
    expect(first).toEqual(['Alpha', 'beta', 'zeta']);
    Solve.aggregate.mockResolvedValue([row(3, 'beta', 100, 1, 10), row(1, 'zeta', 100, 1, 10), row(2, 'Alpha', 100, 1, 10)]);
    expect((await api('').expect(200)).body.map((t) => t.teamName)).toEqual(first);
  });

  it('asks the database for the contract aggregation and hides banned teams', async () => {
    await api('').expect(200);
    const [pipeline] = Solve.aggregate.mock.calls[0];
    expect(pipeline[0]).toEqual({ $group: { _id: '$teamId', points: { $sum: '$points' }, solves: { $sum: 1 }, lastSolveAt: { $max: '$solvedAt' } } });
    expect(pipeline[1]).toEqual({ $sort: { points: -1, lastSolveAt: 1 } });
    expect(pipeline[2].$lookup).toMatchObject({ from: 'teams', localField: '_id', foreignField: '_id' });
    expect(pipeline).toContainEqual({ $match: { 'team.banned': { $ne: true } } });
    expect(Team.find.mock.calls[0][0]).toMatchObject({ banned: { $ne: true } });
  });

  it('appends teams without solves at the bottom with 0 points, never banned ones', async () => {
    const teams = [idleTeam(5, 'Quiet'), idleTeam(6, 'Alpha Idle'), { ...idleTeam(7, 'Banned Idle'), banned: true }, idleTeam(1, 'Solvers')];
    Solve.aggregate.mockResolvedValue([row(1, 'Solvers', 10, 1, 5)]);
    // Behaves like the database: applies the banned filter and the $nin list the service sends.
    Team.find.mockImplementation(async (filter) => teams.filter((t) => (
      !t.banned && !filter._id.$nin.some((id) => String(id) === String(t._id))
    )));
    const { body } = await api('').expect(200);
    expect(body.map((t) => [t.rank, t.teamName, t.points, t.solves, t.lastSolveAt])).toEqual([
      [1, 'Solvers', 10, 1, at(5).toISOString()], [2, 'Alpha Idle', 0, 0, null], [3, 'Quiet', 0, 0, null],
    ]);
  });

  it('returns an empty list when there are no teams', async () => {
    const { body } = await api('').expect(200);
    expect(body).toEqual([]);
  });

  it('supports an optional validated limit', async () => {
    Solve.aggregate.mockResolvedValue([row(1, 'A team', 30, 1, 1), row(2, 'B team', 20, 1, 2), row(3, 'C team', 10, 1, 3)]);
    expect((await api('?limit=2').expect(200)).body.map((t) => t.teamName)).toEqual(['A team', 'B team']);
    for (const bad of ['0', '-1', '501', 'many', '1.5']) {
      await api(`?limit=${bad}`).expect(400).expect((r) => expect(r.body.error.code).toBe('VALIDATION_ERROR'));
    }
  });

  it('exposes only the documented fields, never invite codes, members, emails or flag material', async () => {
    Solve.aggregate.mockResolvedValue([{
      ...row(1, 'Solvers', 10, 1, 5), team: { inviteCode: 'QWERTY', memberIds: [oid(91)] }, flagHash: 'deadbeef', email: 'a@b.c',
    }]);
    Team.find.mockResolvedValue([idleTeam(2, 'Quiet')]);
    const { body } = await api('').expect(200);
    for (const entry of body) {
      expect(Object.keys(entry).sort()).toEqual(['lastSolveAt', 'points', 'rank', 'solves', 'teamId', 'teamName']);
    }
    const text = JSON.stringify(body);
    for (const secret of ['QWERTY', 'ABCDEF', 'memberIds', 'captainId', 'inviteCode', 'flag', 'deadbeef', '@', oid(91)]) {
      expect(text).not.toContain(secret);
    }
    // Only the team name is read for teams without solves.
    expect(Team.find.mock.calls[0][1]).toBe('name');
  });
});

describe('GET /api/leaderboard/timeline', () => {
  it('returns cumulative scores per team with a starting point at 0', async () => {
    Solve.aggregate.mockResolvedValue([row(1, 'Leaders', 210, 2, 30), row(2, 'Chasers', 100, 1, 20)]);
    const solves = solveQuery([solve(1, 100, 10), solve(2, 100, 20), solve(1, 110, 30)]);
    Solve.find.mockReturnValue(solves);
    const { body } = await api('/timeline').expect(200);
    expect(body).toEqual({
      teams: [
        { teamId: oid(1), teamName: 'Leaders', points: [
          { t: at(10).toISOString(), score: 0 }, { t: at(10).toISOString(), score: 100 }, { t: at(30).toISOString(), score: 210 },
        ] },
        { teamId: oid(2), teamName: 'Chasers', points: [{ t: at(10).toISOString(), score: 0 }, { t: at(20).toISOString(), score: 100 }] },
      ],
    });
    expect(Solve.find).toHaveBeenCalledWith({ teamId: { $in: [oid(1), oid(2)] } }, 'teamId points solvedAt');
    expect(solves.sort).toHaveBeenCalledWith({ solvedAt: 1, _id: 1 });
  });

  it('covers only the top 10 teams and keeps zero-solve teams as a flat line at 0', async () => {
    const solved = Array.from({ length: 9 }, (_, i) => row(i + 1, `Team ${String(i + 1).padStart(2, '0')}`, 100 - i, 1, i + 1));
    Solve.aggregate.mockResolvedValue([...solved, row(10, 'Team 10', 50, 1, 10), row(11, 'Team 11', 40, 1, 11)]);
    Team.find.mockResolvedValue([idleTeam(12, 'Idle team')]);
    Solve.find.mockReturnValue(solveQuery(Array.from({ length: 10 }, (_, i) => solve(i + 1, i === 9 ? 50 : 100 - i, i + 1))));
    const { body } = await api('/timeline').expect(200);
    expect(body.teams).toHaveLength(10);
    expect(body.teams.map((t) => t.teamId)).not.toContain(oid(11));
    expect(body.teams.map((t) => t.teamId)).not.toContain(oid(12));
    expect(Solve.find.mock.calls[0][0].teamId.$in).toHaveLength(10);

    Solve.aggregate.mockResolvedValue([row(1, 'Only solver', 100, 1, 5)]);
    Team.find.mockResolvedValue([idleTeam(2, 'Idle team')]);
    Solve.find.mockReturnValue(solveQuery([solve(1, 100, 5)]));
    const small = (await api('/timeline').expect(200)).body;
    expect(small.teams[1]).toEqual({ teamId: oid(2), teamName: 'Idle team', points: [{ t: at(5).toISOString(), score: 0 }] });
  });

  it('ignores solves of teams that are not on the chart and handles no data at all', async () => {
    Solve.aggregate.mockResolvedValue([row(1, 'Visible', 100, 1, 5)]);
    Solve.find.mockReturnValue(solveQuery([solve(9, 500, 1), solve(1, 100, 5)]));
    const { body } = await api('/timeline').expect(200);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].points.map((p) => p.score)).toEqual([0, 100]);

    Solve.aggregate.mockResolvedValue([]);
    Team.find.mockResolvedValue([]);
    expect((await api('/timeline').expect(200)).body).toEqual({ teams: [] });
    expect(Solve.find).toHaveBeenCalledTimes(1);

    Team.find.mockResolvedValue([idleTeam(1, 'Nobody solved')]);
    Solve.find.mockReturnValue(solveQuery([]));
    const flat = (await api('/timeline').expect(200)).body;
    expect(flat.teams[0].points).toHaveLength(1);
    expect(flat.teams[0].points[0].score).toBe(0);
    expect(Number.isNaN(Date.parse(flat.teams[0].points[0].t))).toBe(false);
  });

  it('never includes invite codes, members or emails', async () => {
    Solve.aggregate.mockResolvedValue([row(1, 'Leaders', 100, 1, 5)]);
    Team.find.mockResolvedValue([idleTeam(2, 'Idle team')]);
    Solve.find.mockReturnValue(solveQuery([{ ...solve(1, 100, 5), userId: oid(77), flagHash: 'deadbeef' }]));
    const text = JSON.stringify((await api('/timeline').expect(200)).body);
    for (const secret of ['ABCDEF', 'memberIds', 'inviteCode', 'userId', 'flag', 'deadbeef', '@', oid(77)]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('leaderboard access rules', () => {
  it.each(['', '/timeline'])('requires authentication for %s', async (path) => {
    await request(app).get(`/api/leaderboard${path}`).expect(401);
    await request(app).get(`/api/leaderboard${path}`).set('Authorization', 'Bearer ').expect(401);
    expect(Solve.aggregate).not.toHaveBeenCalled();
  });

  it.each(['', '/timeline'])('is player-only: admins get 403 for %s', async (path) => {
    await api(path, 'admin').expect(403).expect((r) => expect(r.body.error.code).toBe('FORBIDDEN'));
    expect(Solve.aggregate).not.toHaveBeenCalled();
  });

  it('only exposes GET', async () => {
    await request(app).post('/api/leaderboard').set('Authorization', 'Bearer player').send({}).expect(404);
  });

  it('turns database failures into the standard error without details', async () => {
    Solve.aggregate.mockRejectedValue(new Error('mongodb://user:secret@host failed'));
    const { body } = await api('').expect(500);
    expect(body).toEqual({ error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } });
  });
});

describe('compareStanding', () => {
  const standing = (teamId, teamName, points, lastSolveAt) => ({ teamId, teamName, points, solves: 1, lastSolveAt });

  it('orders by points, then last solve, then name, then id; teams without solves come last', () => {
    const list = [
      standing('d', 'Zed', 0, null), standing('b', 'Same', 50, at(2).toISOString()), standing('a', 'Same', 50, at(2).toISOString()),
      standing('c', 'Early', 50, at(1).toISOString()), standing('e', 'Top', 60, at(9).toISOString()), standing('f', 'Abe', 0, null),
    ];
    expect(list.sort(compareStanding).map((s) => s.teamId)).toEqual(['e', 'c', 'a', 'b', 'f', 'd']);
  });
});
