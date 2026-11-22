// Scoreboard freeze: while an event is frozen players see standings as of the freeze time (never live data), admins see
// live data, the ranking cache keeps the two views apart, and after the end everybody sees the final standings.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import Solve from '../../src/models/Solve.js';
import Team from '../../src/models/Team.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import { getEventConfig } from '../../src/services/adminSettings.js';
import { configureRankingCache } from '../../src/services/leaderboardService.js';
import { getTeamContext } from '../../src/services/teamContext.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/Solve.js', () => ({ default: { aggregate: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../src/services/teamContext.js', () => ({ getTeamContext: vi.fn() }));
vi.mock('../../src/services/adminSettings.js', async (importOriginal) => ({ ...(await importOriginal()), getEventConfig: vi.fn() }));

afterAll(() => replicaCounter.stop());
afterEach(() => { vi.useRealTimers(); });

const oid = (n) => String(n).padStart(24, '0');
const at = (hour, minute = 0) => new Date(Date.UTC(2030, 11, 5, hour, minute, 0));
const NAMES = { 1: 'Leaders', 2: 'Chasers', 3: 'Latecomers' };
// Stored solves: team 1 leads before the freeze; team 3 only solves AFTER it and team 2 overtakes late.
const SOLVES = [
  { teamId: oid(1), points: 100, solvedAt: at(18, 30) },
  { teamId: oid(2), points: 50, solvedAt: at(19) },
  { teamId: oid(1), points: 100, solvedAt: at(20, 30) },
  { teamId: oid(2), points: 400, solvedAt: at(21, 30) },
  { teamId: oid(3), points: 300, solvedAt: at(21, 45) },
];
const event = { name: 'Winter Cup', startsAt: at(18), endsAt: at(22), freezeAt: at(21) };

// Behaves like the database for the two pipelines the service sends: optional $match on solvedAt, then $group by team.
function fakeAggregate(pipeline) {
  const match = pipeline.find((stage) => stage.$match?.solvedAt)?.$match.solvedAt.$lte;
  const rows = new Map();
  for (const solve of SOLVES) {
    if (match && solve.solvedAt > match) { continue; }
    const row = rows.get(solve.teamId) ?? { _id: solve.teamId, points: 0, solves: 0, lastSolveAt: null };
    row.points += solve.points;
    row.solves += 1;
    row.lastSolveAt = !row.lastSolveAt || solve.solvedAt > row.lastSolveAt ? solve.solvedAt : row.lastSolveAt;
    rows.set(solve.teamId, row);
  }
  return Promise.resolve([...rows.values()].map((row) => ({ ...row, teamName: NAMES[Number(row._id)] })));
}

const api = (path, sub = 'player') => request(app).get(`/api/leaderboard${path}`).set('Authorization', `Bearer ${sub}`);
const board = (body) => body.map((row) => [row.teamName, row.points]);

beforeEach(() => {
  vi.resetAllMocks();
  configureRankingCache({ ttlMs: 0 });
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  Solve.aggregate.mockImplementation(fakeAggregate);
  Team.find.mockResolvedValue([]);
  Solve.find.mockImplementation((filter) => {
    const cutoff = filter.solvedAt?.$lte;
    const wanted = new Set(filter.teamId.$in);
    const found = SOLVES.filter((solve) => wanted.has(solve.teamId) && (!cutoff || solve.solvedAt <= cutoff));
    return { sort: vi.fn().mockResolvedValue(found) };
  });
  getEventConfig.mockResolvedValue(null);
});

const LIVE = [['Chasers', 450], ['Latecomers', 300], ['Leaders', 200]];
const FROZEN = [['Leaders', 200], ['Chasers', 50]];

describe('no event configured: unchanged behaviour', () => {
  it('sends the live pipeline (no $match stage) and no freeze headers', async () => {
    const res = await api('').expect(200);
    expect(board(res.body)).toEqual(LIVE);
    expect(res.headers['x-scoreboard-frozen']).toBeUndefined();
    expect(res.headers['x-scoreboard-as-of']).toBeUndefined();
    expect(Solve.aggregate.mock.calls[0][0][0]).toHaveProperty('$group');
    expect(Solve.aggregate.mock.calls[0][0].some((stage) => stage.$match?.solvedAt)).toBe(false);
  });

  it('timeline has exactly the contract shape (no frozen/asOf) and an unfiltered solve query', async () => {
    const { body } = await api('/timeline').expect(200);
    expect(Object.keys(body)).toEqual(['teams']);
    expect(Solve.find.mock.calls[0][0]).toEqual({ teamId: { $in: [oid(2), oid(3), oid(1)] } });
  });

  it('/me has nothing to add', async () => {
    const { body } = await api('/me').expect(200);
    expect(body).toEqual({ frozen: false, asOf: null, team: null });
    expect(getTeamContext).not.toHaveBeenCalled();
  });
});

describe.each(['upcoming', 'live', 'ended'])('event phase %s: live scoreboard for everybody', (phase) => {
  const NOW = { upcoming: at(17), live: at(19), ended: at(23) }[phase];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    getEventConfig.mockResolvedValue(event);
  });
  afterAll(() => vi.useRealTimers());

  it('returns live standings to players and admins without freeze headers', async () => {
    for (const sub of ['player', 'admin']) {
      const res = await api('', sub).expect(200);
      expect(board(res.body)).toEqual(LIVE);
      expect(res.headers['x-scoreboard-frozen']).toBeUndefined();
    }
    vi.useRealTimers();
  });
});

describe('event phase frozen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: at(21, 50) });
    getEventConfig.mockResolvedValue(event);
  });
  afterAll(() => vi.useRealTimers());

  it('shows players standings as of the freeze time, excluding later solves, and flags it', async () => {
    const res = await api('').expect(200);
    expect(board(res.body)).toEqual(FROZEN);
    expect(res.body.map((row) => row.rank)).toEqual([1, 2]);
    expect(res.headers['x-scoreboard-frozen']).toBe('true');
    expect(res.headers['x-scoreboard-as-of']).toBe(at(21).toISOString());
    expect(JSON.stringify(res.body)).not.toContain('Latecomers');
    const [pipeline] = Solve.aggregate.mock.calls[0];
    expect(pipeline[0]).toEqual({ $match: { solvedAt: { $lte: at(21) } } });
  });

  it('keeps the documented row shape and the limit option in the frozen view', async () => {
    const res = await api('?limit=1').expect(200);
    expect(res.body).toHaveLength(1);
    expect(Object.keys(res.body[0]).sort()).toEqual(['lastSolveAt', 'points', 'rank', 'solves', 'teamId', 'teamName']);
  });

  it('shows admins live data with no freeze flag', async () => {
    const res = await api('', 'admin').expect(200);
    expect(board(res.body)).toEqual(LIVE);
    expect(res.headers['x-scoreboard-frozen']).toBeUndefined();
  });

  it('adds frozen and asOf to the timeline and ignores later solves for players only', async () => {
    const player = (await api('/timeline').expect(200)).body;
    expect(player.frozen).toBe(true);
    expect(player.asOf).toBe(at(21).toISOString());
    expect(player.teams.map((team) => team.teamName)).toEqual(['Leaders', 'Chasers']);
    const times = player.teams.flatMap((team) => team.points.map((point) => Date.parse(point.t)));
    expect(Math.max(...times)).toBeLessThanOrEqual(at(21).getTime());
    expect(player.teams.find((team) => team.teamName === 'Chasers').points.at(-1).score).toBe(50);
    expect(Solve.find.mock.calls[0][0].solvedAt).toEqual({ $lte: at(21) });

    const admin = (await api('/timeline', 'admin').expect(200)).body;
    expect(admin.frozen).toBeUndefined();
    expect(admin.teams.find((team) => team.teamName === 'Chasers').points.at(-1).score).toBe(450);
  });

  it('gives a team its own live totals separately, never other teams or a rank', async () => {
    getTeamContext.mockResolvedValue({ user: { _id: 'u2' }, team: { _id: oid(2), name: 'Chasers', banned: false } });
    Solve.aggregate.mockImplementation(async (pipeline) => (pipeline[0].$match?.teamId === oid(2)
      ? [{ _id: oid(2), points: 450, solves: 2 }] : fakeAggregate(pipeline)));
    const { body } = await api('/me').expect(200);
    expect(body).toEqual({ frozen: true, asOf: at(21).toISOString(), team: { teamId: oid(2), teamName: 'Chasers', points: 450, solves: 2 } });
    expect(JSON.stringify(body)).not.toMatch(/rank|Leaders|Latecomers/);
    expect(getTeamContext.mock.calls[0][1]).toMatchObject({ requireTeam: false });
  });

  it('answers /me with no team for team-less players, banned teams and admins', async () => {
    getTeamContext.mockResolvedValue({ user: { _id: 'u2' }, team: null });
    expect((await api('/me').expect(200)).body.team).toBeNull();
    getTeamContext.mockResolvedValue({ user: { _id: 'u2' }, team: { _id: oid(2), name: 'Chasers', banned: true } });
    expect((await api('/me').expect(200)).body.team).toBeNull();
    const admin = await api('/me', 'admin').expect(200);
    expect(admin.body).toEqual({ frozen: false, asOf: null, team: null });
  });

  it('rejects unknown query keys on /me and requires a token', async () => {
    await api('/me?team=1').expect(400);
    await request(app).get('/api/leaderboard/me').expect(401);
  });
});

describe('failing closed', () => {
  it('turns a failed event read into a 500, never into live data for players', async () => {
    getEventConfig.mockRejectedValue(new Error('mongodb://user:secret@host failed'));
    for (const path of ['', '/timeline', '/me']) {
      const res = await api(path).expect(500);
      expect(res.body).toEqual({ error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } });
    }
    expect(Solve.aggregate).not.toHaveBeenCalled();
  });

  it('reads the event with failOpen: false', async () => {
    await api('').expect(200);
    expect(getEventConfig).toHaveBeenCalledWith({ failOpen: false });
  });
});

describe('ranking cache keeps live and frozen views apart', () => {
  beforeEach(() => {
    configureRankingCache({ ttlMs: 5000 });
    vi.useFakeTimers({ toFake: ['Date'], now: at(21, 50) });
    getEventConfig.mockResolvedValue(event);
  });
  afterAll(() => { configureRankingCache({ ttlMs: 0 }); vi.useRealTimers(); });

  it('never serves a cached live ranking to a player (admin first, then player)', async () => {
    expect(board((await api('', 'admin').expect(200)).body)).toEqual(LIVE);
    expect(board((await api('', 'player').expect(200)).body)).toEqual(FROZEN);
    expect(board((await api('', 'admin').expect(200)).body)).toEqual(LIVE);
    expect(board((await api('', 'player').expect(200)).body)).toEqual(FROZEN);
    // One computation per view: the repeats were served from the cache.
    expect(Solve.aggregate).toHaveBeenCalledTimes(2);
  });

  it('never serves a cached frozen ranking to an admin (player first, then admin)', async () => {
    expect(board((await api('', 'player').expect(200)).body)).toEqual(FROZEN);
    expect(board((await api('', 'admin').expect(200)).body)).toEqual(LIVE);
  });

  it('serves the final live standings as soon as the event ends, even when a frozen entry is cached', async () => {
    expect(board((await api('', 'player').expect(200)).body)).toEqual(FROZEN);
    vi.setSystemTime(at(22, 1));
    expect(board((await api('', 'player').expect(200)).body)).toEqual(LIVE);
  });

  it('keys the timeline the same way', async () => {
    const admin = (await api('/timeline', 'admin').expect(200)).body;
    const player = (await api('/timeline', 'player').expect(200)).body;
    expect(admin.teams.map((team) => team.teamName)).toEqual(['Chasers', 'Latecomers', 'Leaders']);
    expect(player.teams.map((team) => team.teamName)).toEqual(['Leaders', 'Chasers']);
  });
});

describe('response caching headers', () => {
  it('keeps the player view private and varied by the token', async () => {
    getEventConfig.mockResolvedValue(event);
    vi.useFakeTimers({ toFake: ['Date'], now: at(21, 50) });
    const res = await api('').expect(200);
    expect(res.headers['cache-control']).toBe('private, max-age=5');
    expect(res.headers.vary).toMatch(/Authorization/i);
    vi.useRealTimers();
  });
});
