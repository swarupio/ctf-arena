// Review follow-up: every player-visible view that shows live per-team or per-solve data must respect the event view.
// Frozen: players see nothing after the freeze, admins live. Ended: the final view stops at the end (solvedAt <= endsAt).
// Unfrozen and no-event behaviour is unchanged.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import Achievement from '../../src/models/Achievement.js';
import Challenge from '../../src/models/Challenge.js';
import Solve from '../../src/models/Solve.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import { getEventConfig } from '../../src/services/adminSettings.js';
import { configureRankingCache } from '../../src/services/leaderboardService.js';
import { getTeamContext } from '../../src/services/teamContext.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/Achievement.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({ default: { find: vi.fn(), findOne: vi.fn() } }));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn(), aggregate: vi.fn(), exists: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { find: vi.fn(), findById: vi.fn() } }));
vi.mock('../../src/models/User.js', () => ({ default: { find: vi.fn(), findById: vi.fn() } }));
vi.mock('../../src/services/teamContext.js', () => ({ getTeamContext: vi.fn() }));
vi.mock('../../src/services/adminSettings.js', async (importOriginal) => ({ ...(await importOriginal()), getEventConfig: vi.fn() }));

afterAll(() => replicaCounter.stop());
afterEach(() => { vi.useRealTimers(); });

const oid = (n) => String(n).padStart(24, '0');
const at = (hour, minute = 0) => new Date(Date.UTC(2030, 11, 5, hour, minute, 0));
const event = { name: 'Winter Cup', startsAt: at(18), endsAt: at(22), freezeAt: at(21) };
const NOW = { live: at(19), frozen: at(21, 50), ended: at(23) };

const SOLVES = [
  { teamId: oid(2), userId: oid(1), challengeId: oid(5), solvedAt: at(19), firstBlood: true, points: 100 },
  { teamId: oid(2), userId: oid(1), challengeId: oid(6), solvedAt: at(21, 30), firstBlood: true, points: 100 },
  { teamId: oid(3), userId: oid(7), challengeId: oid(5), solvedAt: at(21, 45), firstBlood: false, points: 50 },
  { teamId: oid(3), userId: oid(7), challengeId: oid(6), solvedAt: at(22, 1), firstBlood: false, points: 80 }, // stored after the end
];
const AWARDS = [
  { userId: oid(1), key: 'first-blood', awardedAt: at(21, 40) },
  { userId: oid(1), key: 'first-solve', awardedAt: at(19) },
];
const TEAMS = [
  { _id: oid(2), name: 'Zion', banned: false, createdAt: at(18, 10) },
  { _id: oid(3), name: 'Latecomers', banned: false, createdAt: at(21, 40) },
];
const CHALLENGES = [
  { _id: oid(5), title: 'Cookie Monster', category: 'web', difficulty: 'easy', visible: true, slug: 'a', points: 100, type: 'static', solveCount: 7 },
  { _id: oid(6), title: 'Warmup', category: 'crypto', difficulty: 'hard', visible: true, slug: 'b', points: 100, type: 'static', solveCount: 3 },
];

// A chainable, awaitable query applying the filter shapes the services send ($lte bounds, userId, adjustment).
function rows(all, filter = {}) {
  let list = all.filter((row) => {
    for (const field of ['solvedAt', 'awardedAt', 'createdAt']) {
      const cut = filter[field]?.$lte;
      if (cut && row[field] && row[field] > cut) { return false; }
    }
    return !filter.userId || String(row.userId) === String(filter.userId);
  });
  const query = {
    select: () => query,
    lean: () => query,
    sort: (spec) => {
      const [field, dir] = Object.entries(spec)[0];
      list = [...list].sort((a, b) => ((a[field] ?? 0) < (b[field] ?? 0) ? 1 : -1) * (dir === -1 ? 1 : -1));
      return query;
    },
    limit: (n) => { list = list.slice(0, n); return query; },
    then: (resolve, reject) => Promise.resolve(list).then(resolve, reject),
  };
  return query;
}

const api = (path, sub = 'player') => request(app).get(`/api${path}`).set('Authorization', `Bearer ${sub}`);
const one = (value) => { const q = { select: () => q, lean: async () => value }; return q; };

beforeEach(() => {
  vi.resetAllMocks();
  configureRankingCache({ ttlMs: 0 });
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  Solve.find.mockImplementation((filter) => rows(SOLVES, filter));
  Achievement.find.mockImplementation((filter) => rows(AWARDS, filter));
  Team.find.mockImplementation((filter) => (filter?._id
    ? rows(TEAMS.filter((team) => filter._id.$in.map(String).includes(team._id)))
    : rows(TEAMS, filter)));
  Team.findById.mockImplementation(() => one(TEAMS[0]));
  User.find.mockImplementation(() => rows([{ _id: oid(1), teamId: oid(2) }]));
  User.findById.mockImplementation(() => one({ _id: oid(1), displayName: 'neo', teamId: oid(2) }));
  Challenge.find.mockImplementation((filter) => rows(CHALLENGES.filter((c) => !filter?._id?.$in || filter._id.$in.map(String).includes(c._id))));
  getTeamContext.mockResolvedValue({ user: null, team: null });
  getEventConfig.mockResolvedValue(event);
});

const feedTimes = (body) => body.map((item) => Date.parse(item.at));

describe.each(['frozen', 'live', 'ended'])('GET /api/feed in phase %s', (phase) => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: NOW[phase] }); });

  it('applies the cutoff to solves, badges and new teams for players, and nothing for admins', async () => {
    const player = await api('/feed?limit=50').expect(200);
    const cutoff = { frozen: event.freezeAt, ended: event.endsAt }[phase];
    if (cutoff) {
      expect(player.body.length).toBeGreaterThan(0);
      for (const time of feedTimes(player.body)) { expect(time).toBeLessThanOrEqual(cutoff.getTime()); }
      expect(Solve.find.mock.calls[0][0].solvedAt).toEqual({ $lte: cutoff });
      expect(Achievement.find.mock.calls[0][0].awardedAt).toEqual({ $lte: cutoff });
      expect(Team.find.mock.calls[0][0].createdAt).toEqual({ $lte: cutoff });
    } else {
      expect(Solve.find.mock.calls[0][0]).toEqual({ adjustment: { $ne: true } });
      expect(Achievement.find.mock.calls[0][0]).toEqual({});
    }
    vi.clearAllMocks();
    const admin = await api('/feed?limit=50', 'admin').expect(200);
    expect(Math.max(...feedTimes(admin.body))).toBe(at(22, 1).getTime());
    expect(Solve.find.mock.calls[0][0]).toEqual({ adjustment: { $ne: true } });
  });

  it('sets private caching that varies by caller, so views never mix', async () => {
    const res = await api('/feed').expect(200);
    expect(res.headers['cache-control']).toBe('private, max-age=5');
    expect(res.headers.vary).toMatch(/Authorization/i);
  });
});

describe('frozen feed content', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: NOW.frozen }); });

  it('shows a frozen player no solve, first blood, badge or team created after the freeze', async () => {
    const { body } = await api('/feed?limit=50').expect(200);
    expect(JSON.stringify(body)).not.toContain('Latecomers'); // created after the freeze, and so are its solves
    expect(body.find((item) => item.type === 'badge' && item.badge === 'First Blood')).toBeUndefined();
    expect(body.find((item) => item.type === 'first_blood' && item.challenge === 'Warmup')).toBeUndefined();
    expect(body.find((item) => item.type === 'first_blood' && item.challenge === 'Cookie Monster')).toBeTruthy();
  });

  it('shows an admin everything', async () => {
    const { body } = await api('/feed?limit=50', 'admin').expect(200);
    expect(body.find((item) => item.type === 'badge' && item.badge === 'First Blood')).toBeTruthy();
    expect(body.some((item) => item.team === 'Latecomers')).toBe(true);
  });

  it('fails with an error (never live data) when the event cannot be read', async () => {
    getEventConfig.mockRejectedValue(new Error('down'));
    await api('/feed').expect(500);
    expect(Solve.find).not.toHaveBeenCalled();
  });
});

describe('no event: feed and profile are unchanged', () => {
  beforeEach(() => { getEventConfig.mockResolvedValue(null); });

  it('queries without any time bound', async () => {
    await api('/feed').expect(200);
    expect(Solve.find.mock.calls[0][0]).toEqual({ adjustment: { $ne: true } });
    expect(Achievement.find.mock.calls[0][0]).toEqual({});
    expect(Team.find.mock.calls[0][0]).toEqual({ banned: { $ne: true } });
    await api(`/players/${oid(1)}/profile`).expect(200);
    expect(Solve.find.mock.calls.at(-1)[0]).toEqual({ userId: oid(1), adjustment: { $ne: true } });
    expect(Achievement.find.mock.calls.at(-1)[0]).toEqual({ userId: oid(1) });
  });
});

describe('GET /api/players/:id/profile', () => {
  const profile = (sub = 'player') => api(`/players/${oid(1)}/profile`, sub);
  const unlocked = (body) => body.badges.filter((badge) => badge.unlocked).map((badge) => badge.key).sort();

  it('frozen: a player sees only solves and badges up to the freeze, counters from those rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW.frozen });
    getEventConfig.mockResolvedValue({ ...event, freezeAt: at(20) }); // freeze at 20:00: the 21:30 solve is hidden
    const { body, headers } = await profile().expect(200);
    expect(body.solves).toBe(1);
    expect(body.firstBloods).toBe(1);
    expect(body.recentSolves.map((solve) => solve.solvedAt)).toEqual([at(19).toISOString()]);
    expect(unlocked(body)).toEqual(['first-solve']);
    expect(JSON.stringify(body)).not.toContain(at(21, 30).toISOString());
    expect(JSON.stringify(body)).not.toContain(at(21, 40).toISOString());
    expect(headers['cache-control']).toBe('private, no-store');
    expect(headers.vary).toMatch(/Authorization/i);
  });

  it('frozen: an admin sees the live profile', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW.frozen });
    getEventConfig.mockResolvedValue({ ...event, freezeAt: at(20) });
    const { body } = await profile('admin').expect(200);
    expect(body.solves).toBe(2);
    expect(unlocked(body)).toEqual(['first-blood', 'first-solve']);
  });

  it('live: unchanged for everybody', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW.live });
    expect((await profile().expect(200)).body.solves).toBe(2);
  });

  it('ended: the final view stops at the end', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW.ended });
    getEventConfig.mockResolvedValue({ ...event, endsAt: at(21, 35), freezeAt: at(21) });
    expect((await profile().expect(200)).body.solves).toBe(2); // 19:00 and 21:30 are before 21:35
    getEventConfig.mockResolvedValue({ ...event, endsAt: at(21), freezeAt: at(20) });
    expect((await profile().expect(200)).body.solves).toBe(1);
  });

  it('reads at most a bounded number of solves', async () => {
    getEventConfig.mockResolvedValue(null);
    const limit = vi.fn();
    Solve.find.mockImplementation(() => {
      const q = { sort: () => q, limit: (n) => { limit(n); return q; }, select: () => q, lean: async () => [] };
      return q;
    });
    await profile().expect(200);
    expect(limit).toHaveBeenCalledWith(1000);
  });
});

describe('GET /api/me/achievements stays the callers own live data', () => {
  it('is not cut at the freeze (own badges only, like the own totals on the frozen scoreboard)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW.frozen });
    getTeamContext.mockResolvedValue({ user: { _id: oid(1) }, team: null });
    const { body } = await api('/me/achievements').expect(200);
    expect(Achievement.find.mock.calls[0][0]).toEqual({ userId: oid(1) });
    expect(body.unlocked).toBe(2);
  });
});

describe('GET /api/challenges: live solve counters while frozen', () => {
  const list = (sub = 'player') => api('/challenges', sub);
  const detail = (sub = 'player') => api(`/challenges/${oid(5)}`, sub);
  beforeEach(() => {
    Challenge.find.mockImplementation(() => ({ sort: async () => CHALLENGES.map((c) => ({ ...c })) }));
    Challenge.findOne.mockResolvedValue({ ...CHALLENGES[0], description: 'd', attachments: [] });
  });

  it('frozen: solveCount is null for players in the list and the detail, live for admins', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW.frozen });
    expect((await list().expect(200)).body.map((c) => c.solveCount)).toEqual([null, null]);
    expect((await detail().expect(200)).body.solveCount).toBeNull();
    expect((await list('admin').expect(200)).body.map((c) => c.solveCount)).toEqual([7, 3]);
    expect((await detail('admin').expect(200)).body.solveCount).toBe(7);
    const res = await list().expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers.vary).toMatch(/Authorization/i);
  });

  it.each(['live', 'ended'])('%s: counters are unchanged', async (phase) => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW[phase] });
    expect((await list().expect(200)).body.map((c) => c.solveCount)).toEqual([7, 3]);
    expect((await detail().expect(200)).body.solveCount).toBe(7);
  });

  it('no event: unchanged', async () => {
    getEventConfig.mockResolvedValue(null);
    expect((await list().expect(200)).body.map((c) => c.solveCount)).toEqual([7, 3]);
  });
});

// A request admitted just before the end can be stored a moment after it. The final view must not count it.
describe('ended view of the leaderboard', () => {
  const aggregateFor = (pipeline) => {
    const cut = pipeline.find((stage) => stage.$match?.solvedAt)?.$match.solvedAt.$lte;
    const totals = new Map();
    for (const solve of SOLVES) {
      if (cut && solve.solvedAt > cut) { continue; }
      totals.set(solve.teamId, (totals.get(solve.teamId) ?? 0) + solve.points);
    }
    return Promise.resolve([...totals].map(([teamId, points]) => ({
      _id: teamId, points, solves: 1, lastSolveAt: at(21), teamName: teamId === oid(2) ? 'Zion' : 'Latecomers',
    })));
  };
  const board = (res) => res.body.map((row) => [row.teamName, row.points]);
  beforeEach(() => {
    Solve.aggregate.mockImplementation(aggregateFor);
    Team.find.mockResolvedValue([]);
    vi.useFakeTimers({ toFake: ['Date'], now: NOW.ended });
  });

  it('players: the board and the timeline ignore solves stored after endsAt, without a frozen flag', async () => {
    const res = await api('/leaderboard').expect(200);
    expect(board(res)).toEqual([['Zion', 200], ['Latecomers', 50]]);
    expect(Solve.aggregate.mock.calls[0][0][0]).toEqual({ $match: { solvedAt: { $lte: event.endsAt } } });
    expect(res.headers['x-scoreboard-frozen']).toBeUndefined();
    Solve.find.mockImplementation((filter) => ({ sort: async () => SOLVES.filter((s) => !filter.solvedAt || s.solvedAt <= filter.solvedAt.$lte) }));
    const timeline = (await api('/leaderboard/timeline').expect(200)).body;
    expect(timeline.frozen).toBeUndefined();
    expect(Solve.find.mock.calls.at(-1)[0].solvedAt).toEqual({ $lte: event.endsAt });
    const latecomers = timeline.teams.find((team) => team.teamName === 'Latecomers');
    expect(latecomers.points.at(-1).score).toBe(50);
  });

  it('admins keep the live view', async () => {
    const res = await api('/leaderboard', 'admin').expect(200);
    expect(board(res)).toEqual([['Zion', 200], ['Latecomers', 130]]);
    expect(Solve.aggregate.mock.calls[0][0].some((stage) => stage.$match?.solvedAt)).toBe(false);
  });

  it('the live phase is unchanged (no bound)', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date'], now: NOW.live });
    await api('/leaderboard').expect(200);
    expect(Solve.aggregate.mock.calls[0][0].some((stage) => stage.$match?.solvedAt)).toBe(false);
  });
});
