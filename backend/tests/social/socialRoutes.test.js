import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import Achievement from '../../src/models/Achievement.js';
import Challenge from '../../src/models/Challenge.js';
import Solve from '../../src/models/Solve.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { FEED_MAX, pickDaily } from '../../src/services/socialService.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/Achievement.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { find: vi.fn(), findById: vi.fn() } }));
vi.mock('../../src/models/User.js', () => ({ default: { find: vi.fn(), findById: vi.fn(), findOne: vi.fn() } }));

const oid = (n) => String(n).padStart(24, '0');
const at = (minutes) => new Date(Date.UTC(2026, 10, 3, 12, minutes));
const spy = {};
const query = (rows) => {
  const q = {
    select: () => q, sort: (s) => { spy.sort = s; return q; }, limit: (n) => { spy.limit = n; return q; },
    lean: () => Promise.resolve(rows),
  };
  return q;
};
const get = (path, sub = 'player') => request(app).get(`/api${path}`).set('Authorization', `Bearer ${sub}`);

beforeEach(() => {
  vi.resetAllMocks();
  Object.keys(spy).forEach((key) => delete spy[key]);
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
});

describe('GET /api/players/:id/profile', () => {
  const user = { _id: oid(1), displayName: 'neo', teamId: oid(2), email: 'neo@example.com', cognitoSub: 'sub-secret' };
  beforeEach(() => {
    User.findById.mockReturnValue(query(user));
    Team.findById.mockReturnValue(query({ _id: oid(2), name: 'Zion', banned: false, inviteCode: 'ABCDEF', memberIds: [oid(1)] }));
    Solve.find.mockReturnValue(query([
      { challengeId: oid(5), solvedAt: at(5), firstBlood: true, points: 110, teamId: oid(2), userId: oid(1) },
      { challengeId: oid(6), solvedAt: at(1), firstBlood: false, points: 50, teamId: oid(2), userId: oid(1) },
    ]));
    Achievement.find.mockReturnValue(query([{ key: 'first-solve', awardedAt: at(1) }]));
    Challenge.find.mockReturnValue(query([
      { _id: oid(5), category: 'web', difficulty: 'easy', title: 'Secret Title', flagHash: 'h', flagSalt: 's' },
      { _id: oid(6), category: 'crypto', difficulty: 'hard' },
    ]));
  });

  it('excludes manual score adjustments from the solve list and counters', async () => {
    await get(`/players/${oid(1)}/profile`).expect(200);
    expect(Solve.find).toHaveBeenCalledWith({ userId: oid(1), adjustment: { $ne: true } });
  });

  it('returns a public-safe profile with no emails, flags, ids of others or invite codes', async () => {
    const { body } = await get(`/players/${oid(1)}/profile`).expect(200);
    expect(body).toMatchObject({ id: oid(1), displayName: 'neo', team: { name: 'Zion' }, solves: 2, firstBloods: 1 });
    expect(body.recentSolves).toEqual([
      { category: 'web', difficulty: 'easy', firstBlood: true, solvedAt: at(5).toISOString() },
      { category: 'crypto', difficulty: 'hard', firstBlood: false, solvedAt: at(1).toISOString() },
    ]);
    expect(body.badges.filter((badge) => badge.unlocked).map((badge) => badge.key)).toEqual(['first-solve']);
    const text = JSON.stringify(body);
    for (const secret of ['example.com', 'sub-secret', 'ABCDEF', 'flagHash', 'flagSalt', 'Secret Title', 'points', 'challengeId', 'teamId']) {
      expect(text).not.toContain(secret);
    }
  });

  it('hides the team name of a banned team', async () => {
    Team.findById.mockReturnValue(query({ name: 'Cheaters', banned: true }));
    const { body } = await get(`/players/${oid(1)}/profile`).expect(200);
    expect(body.team).toBeNull();
  });

  it('404 for a malformed id or unknown player, 401 without a token', async () => {
    await get('/players/not-an-id/profile').expect(404);
    User.findById.mockReturnValue(query(null));
    await get(`/players/${oid(9)}/profile`).expect(404);
    await request(app).get(`/api/players/${oid(1)}/profile`).expect(401);
  });
});

describe('GET /api/me/achievements', () => {
  it('lists the whole catalog with locked and unlocked state', async () => {
    const user = { _id: oid(1), displayName: 'neo', teamId: null };
    User.findOne.mockResolvedValue(user);
    User.findById.mockReturnValue(query(user));
    Solve.find.mockReturnValue(query([]));
    Achievement.find.mockReturnValue(query([{ key: 'comeback', awardedAt: at(3) }]));
    const { body } = await get('/me/achievements').expect(200);
    expect(body.total).toBeGreaterThanOrEqual(20);
    expect(body.unlocked).toBe(1);
    expect(body.badges.find((badge) => badge.key === 'comeback')).toMatchObject({ unlocked: true, awardedAt: at(3).toISOString() });
    expect(body.streak).toEqual({ current: 0, best: 0 });
  });

  it('404 for a signed-in identity with no stored user', async () => {
    User.findOne.mockResolvedValue(null);
    await get('/me/achievements').expect(404);
  });
});

describe('GET /api/feed', () => {
  const setup = ({ solves = [], awards = [], teams = [], teamRows = [], challenges = [], users = [] } = {}) => {
    Solve.find.mockReturnValue(query(solves));
    Achievement.find.mockReturnValue(query(awards));
    User.find.mockReturnValue(query(users));
    Challenge.find.mockReturnValue(query(challenges));
    Team.find.mockImplementation((filter) => query(filter?._id ? teamRows : teams));
  };

  it('reads only real solves, so adjustments cannot push solves out of the bounded window', async () => {
    setup();
    await get('/feed').expect(200);
    expect(Solve.find).toHaveBeenCalledWith({ adjustment: { $ne: true } });
  });

  it('merges events newest first with team names and challenge titles only', async () => {
    setup({
      solves: [
        { teamId: oid(2), challengeId: oid(5), firstBlood: true, solvedAt: at(10) },
        { teamId: oid(2), challengeId: oid(6), firstBlood: false, solvedAt: at(2) },
      ],
      awards: [{ userId: oid(1), key: 'first-blood', awardedAt: at(11) }],
      users: [{ _id: oid(1), teamId: oid(2), email: 'neo@example.com' }],
      teams: [{ _id: oid(3), name: 'Newbies', createdAt: at(6) }],
      teamRows: [{ _id: oid(2), name: 'Zion', banned: false }],
      challenges: [{ _id: oid(5), title: 'Cookie Monster', visible: true }, { _id: oid(6), title: 'Warmup', visible: true }],
    });
    const res = await get('/feed').expect(200);
    expect(res.headers['cache-control']).toBe('private, max-age=5');
    expect(res.body).toEqual([
      { type: 'badge', at: at(11).toISOString(), team: 'Zion', badge: 'First Blood' },
      { type: 'first_blood', at: at(10).toISOString(), team: 'Zion', challenge: 'Cookie Monster' },
      { type: 'team', at: at(6).toISOString(), team: 'Newbies' },
      { type: 'solve', at: at(2).toISOString(), team: 'Zion', challenge: 'Warmup' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('example.com');
  });

  it('drops events of banned teams and hidden challenges', async () => {
    setup({
      solves: [
        { teamId: oid(2), challengeId: oid(5), firstBlood: false, solvedAt: at(3) },
        { teamId: oid(4), challengeId: oid(6), firstBlood: false, solvedAt: at(2) },
      ],
      teamRows: [{ _id: oid(2), name: 'Zion', banned: false }, { _id: oid(4), name: 'Cheaters', banned: true }],
      challenges: [{ _id: oid(5), title: 'Hidden', visible: false }, { _id: oid(6), title: 'Shown', visible: true }],
    });
    expect((await get('/feed').expect(200)).body).toEqual([]);
  });

  it('bounds every read by the limit and rejects limits outside 1..max', async () => {
    setup();
    await get('/feed').expect(200);
    expect(spy.limit).toBe(20);
    await get('/feed?limit=7').expect(200);
    expect(spy.limit).toBe(7);
    await get(`/feed?limit=${FEED_MAX}`).expect(200);
    await get(`/feed?limit=${FEED_MAX + 1}`).expect(400);
    await get('/feed?limit=0').expect(400);
    await get('/feed?limit=abc').expect(400);
  });

  it('cuts the merged result to the limit', async () => {
    const solves = Array.from({ length: 5 }, (_, i) => ({ teamId: oid(2), challengeId: oid(5), firstBlood: false, solvedAt: at(i) }));
    setup({ solves, teamRows: [{ _id: oid(2), name: 'Zion' }], challenges: [{ _id: oid(5), title: 'T' }] });
    expect((await get('/feed?limit=3').expect(200)).body).toHaveLength(3);
  });

  it('requires a token', async () => {
    await request(app).get('/api/feed').expect(401);
  });
});

describe('daily spotlight', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((slug) => ({ _id: oid(slug.charCodeAt(0)), slug, title: slug, category: 'web', difficulty: 'easy', points: 10 }));

  it('is deterministic per UTC day, independent of input order', () => {
    const day = new Date('2026-11-03T01:00:00Z');
    const same = new Date('2026-11-03T23:59:00Z');
    expect(pickDaily(list, day).slug).toBe(pickDaily([...list].reverse(), same).slug);
    const picks = new Set(Array.from({ length: 30 }, (_, i) => pickDaily(list, new Date(Date.UTC(2026, 10, 1 + i))).slug));
    expect(picks.size).toBeGreaterThan(1);
    expect(pickDaily([], day)).toBeNull();
  });

  it('serves a cosmetic bonus label and no flag material', async () => {
    Challenge.find.mockReturnValue(query(list));
    const res = await get('/daily').expect(200);
    expect(res.body.bonusLabel).toBe('Daily bonus');
    expect(Object.keys(res.body.challenge).sort()).toEqual(['category', 'difficulty', 'id', 'points', 'slug', 'title']);
    expect(res.headers['cache-control']).toBe('private, max-age=60');
  });
});
