import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import AttemptCounter from '../../src/models/AttemptCounter.js';
import Challenge from '../../src/models/Challenge.js';
import OsintBoard from '../../src/models/OsintBoard.js';
import OsintHint from '../../src/models/OsintHint.js';
import Solve from '../../src/models/Solve.js';
import Submission from '../../src/models/Submission.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { osintDefinitions } from '../../src/scripts/seedOsint.js';
import { achievementService } from '../../src/services/achievementService.js';
import { expectedFlagFor } from '../../src/services/flagService.js';
import { hasFirstBloodBonus } from '../../src/services/scoringService.js';
import { OSINT_MAX_POINTS, TRACKS, TRACK_IDS, buildCase } from '../../src/osint/cases.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({ default: { find: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn(), create: vi.fn(), aggregate: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../../src/models/Submission.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../../src/models/AttemptCounter.js', () => ({ default: { findOneAndUpdate: vi.fn(), create: vi.fn() } }));
vi.mock('../../src/models/OsintBoard.js', () => ({ default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../../src/models/OsintHint.js', () => ({ default: { find: vi.fn(), countDocuments: vi.fn(), updateOne: vi.fn() } }));

vi.mock('../../src/services/achievementService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, achievementService: { ...actual.achievementService, safeEvaluate: vi.fn() } };
});

const oid = (n) => String(n).padStart(24, '0');
const TEAM_A = oid(2);
const TEAM_B = oid(4);
const users = { player: { _id: oid(1), teamId: TEAM_A }, player2: { _id: oid(3), teamId: TEAM_B }, admin: { _id: oid(9), teamId: null } };
let rows;
let solves;
let counters;
let hints;
let boards;
let seeded;

const api = (method, path, sub = 'player', body) => {
  const call = request(app)[method](`/api/osint${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};
const answer = (track, n, text, sub = 'player') => api('post', `/cases/${track}/questions/${n}/answer`, sub, { answer: text });
const truth = (track, n, teamId = TEAM_A) => buildCase(env.FLAG_SECRET, teamId, track).ans[n];
const rowOf = (track, n) => rows.find((r) => r.osint.track === track && r.osint.stage === n);
const scoreOf = (teamId) => solves.filter((s) => s.teamId === teamId).reduce((t, s) => t + s.points, 0);
const nonFinal = (track) => TRACKS[track].stages.filter((s) => !s.final).map((s) => s.n);
const finalOf = (track) => TRACKS[track].stages.find((s) => s.final).n;
// The board gate (docs/OSINT_TRAIL.md "Case board") is tested in board.api.test.js; here it is opened like a finished chain.
const openBoard = (track, teamId = TEAM_A) => { boards.push({ teamId, track, unlocked: true, version: 1, pins: [], links: [] }); };
const solveAllButFinal = async (track, sub = 'player', teamId = TEAM_A, { board = true } = {}) => {
  for (const n of nonFinal(track)) { await answer(track, n, truth(track, n, teamId), sub).expect(200); }
  if (board) { openBoard(track, teamId); }
};

beforeEach(() => {
  vi.resetAllMocks();
  achievementService.safeEvaluate.mockResolvedValue([]);
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  seeded = true;
  rows = osintDefinitions().map((d, i) => ({ ...d, _id: oid(7000 + i), visible: true, solveCount: 0 }));
  solves = [];
  counters = new Map();
  hints = [];
  boards = [];
  OsintBoard.findOne.mockImplementation((filter) => ({
    lean: async () => boards.find((b) => b.teamId === String(filter.teamId) && b.track === filter.track && (filter.unlocked === undefined || b.unlocked === filter.unlocked)) ?? null,
  }));
  User.findOne.mockImplementation(async ({ cognitoSub }) => users[cognitoSub] ?? null);
  Team.findById.mockImplementation(async (id) => ({ _id: String(id), name: 'T', banned: false }));
  Challenge.find.mockImplementation((filter) => ({
    lean: async () => (seeded ? rows.filter((r) => r.type === filter.type && r.visible === filter.visible
      && (filter['osint.track'] === undefined || r.osint.track === filter['osint.track'])) : []),
  }));
  Challenge.findOneAndUpdate.mockImplementation(async ({ _id }, update) => {
    const row = rows.find((r) => r._id === _id);
    row.solveCount += update.$inc.solveCount;
    return { ...row };
  });
  Solve.find.mockImplementation((filter) => ({
    lean: async () => solves.filter((s) => s.teamId === String(filter.teamId) && filter.challengeId.$in.includes(s.challengeId)),
  }));
  Solve.create.mockImplementation(async (doc) => {
    // Emulates the unique (teamId, challengeId) index.
    if (solves.some((s) => s.teamId === String(doc.teamId) && s.challengeId === doc.challengeId)) {
      throw Object.assign(new Error('dup'), { code: 11000 });
    }
    solves.push({ ...doc, teamId: String(doc.teamId) });
    return doc;
  });
  Solve.updateOne.mockResolvedValue({});
  Solve.aggregate.mockImplementation(async ([{ $match }]) => [{ score: scoreOf(String($match.teamId)) }]);
  Submission.create.mockResolvedValue({});
  AttemptCounter.findOneAndUpdate.mockImplementation(async (filter, update) => {
    const doc = counters.get(filter.key);
    if (!doc) { return null; }
    const now = new Date();
    if (filter.expiresAt.$gt && doc.expiresAt > now) { doc.count += update.$inc.count; return { ...doc }; }
    if (filter.expiresAt.$lte && doc.expiresAt <= now) { Object.assign(doc, update.$set); return { ...doc }; }
    return null;
  });
  AttemptCounter.create.mockImplementation(async (doc) => { counters.set(doc.key, { ...doc }); return doc; });
  OsintHint.find.mockImplementation((filter) => {
    const chain = {
      sort: () => chain,
      limit: () => chain,
      lean: async () => (filter.teamId
        ? hints.filter((h) => h.teamId === String(filter.teamId) && filter.key.$in.includes(h.key))
        : [...hints].reverse()),
    };
    return chain;
  });
  OsintHint.countDocuments.mockImplementation(async (filter) => hints.filter((h) => h.teamId === String(filter.teamId) && h.key === filter.key).length);
  OsintHint.updateOne.mockImplementation(async (filter, update) => {
    if (!hints.some((h) => h.teamId === String(filter.teamId) && h.key === filter.key && h.index === filter.index)) {
      hints.push({ teamId: String(filter.teamId), key: filter.key, index: filter.index, userId: update.$setOnInsert.userId, createdAt: new Date() });
    }
    return {};
  });
});

describe('access', () => {
  it('needs a token, a known case and a player for answers and hints', async () => {
    await request(app).get('/api/osint/cases').expect(401);
    await request(app).post('/api/osint/cases/easy/questions/1/answer').send({ answer: 'x' }).expect(401);
    for (const bad of ['nightmare', '__proto__', 'EASY']) {
      expect((await api('get', `/cases/${bad}`).expect(404)).body.error.code).toBe('NOT_FOUND');
      await api('get', `/cases/${bad}/sources/feed`).expect(404);
      await api('get', `/cases/${bad}/search?q=ab`).expect(404);
      await answer(bad, 1, 'x').expect(404);
    }
    expect((await answer('easy', 1, 'x', 'admin').expect(403)).body.error.code).toBe('FORBIDDEN');
    await api('post', '/cases/easy/questions/1/hints', 'admin', {}).expect(403);
    await api('get', '/cases', 'admin').expect(200);
    await api('get', '/cases/hard', 'admin').expect(200);
    await api('get', '/cases/hard/sources/photos', 'admin').expect(200);
    await api('get', '/admin/hints', 'player').expect(403);
    await api('get', '/admin/hints', 'admin').expect(200);
  });

  it('validates parameters, bodies and queries', async () => {
    await answer('easy', 'abc', 'x').expect(400);
    await api('post', '/cases/easy/questions/1/answer', 'player', { answer: '' }).expect(400);
    await api('post', '/cases/easy/questions/1/answer', 'player', { answer: 'x', extra: 1 }).expect(400);
    await api('post', '/cases/easy/questions/1/answer', 'player', { answer: 'x'.repeat(201) }).expect(400);
    expect((await answer('easy', 9, 'x').expect(404)).body.error.code).toBe('NOT_FOUND');
    expect((await api('get', '/cases/easy/sources/secrets').expect(404)).body.error.code).toBe('NOT_FOUND');
    await api('get', '/cases/easy/sources/feed?limit=51').expect(400);
    await api('get', '/cases/easy/sources/feed?offset=-1').expect(400);
    await api('get', '/cases/easy/sources/feed?foo=1').expect(400);
    await api('get', '/cases/easy/sources/feed?author=__proto__').expect(400);
    await api('get', '/cases/easy/search').expect(400);
    await api('get', '/cases/easy/search?q=a').expect(400);
    await api('get', `/cases/easy/search?q=${'x'.repeat(65)}`).expect(400);
    await api('get', '/cases/easy/search?q=ab&limit=21').expect(400);
    await api('post', '/cases/easy/questions/1/hints', 'player', { extra: 1 }).expect(400);
  });

  it('says so when the game has not been seeded', async () => {
    seeded = false;
    expect((await api('get', '/cases/easy').expect(503)).body.error.code).toBe('OSINT_NOT_SEEDED');
    expect((await answer('easy', 1, 'x').expect(503)).body.error.code).toBe('OSINT_NOT_SEEDED');
    const { body } = await api('get', '/cases').expect(200);
    expect(body.every((t) => t.seeded === false)).toBe(true);
  });
});

describe('listing and sources', () => {
  it('lists four cases with documented maximum points', async () => {
    const { body } = await api('get', '/cases').expect(200);
    expect(body.map((t) => t.id)).toEqual(TRACK_IDS);
    expect(body.map((t) => t.maxPoints)).toEqual([150, 300, 650, 1200]);
    expect(body.reduce((total, t) => total + t.maxPoints, 0)).toBe(OSINT_MAX_POINTS);
    expect(body.map((t) => t.hints)).toEqual([true, true, false, false]);
  });

  it('serves bounded pages of every source and a bounded search', async () => {
    for (const track of TRACK_IDS) {
      for (const source of ['feed', 'cast', 'pages', 'docs', 'registry', 'photos', 'pastes', 'map']) {
        const { text, body } = await api('get', `/cases/${track}/sources/${source}?limit=50`).expect(200);
        expect(text.length, `${track}/${source}`).toBeLessThan(90_000);
        expect(body.source).toBe(source);
        expect(body.items.length).toBeLessThanOrEqual(source === 'photos' ? 8 : 50);
      }
      const search = await api('get', `/cases/${track}/search?q=an&limit=20`).expect(200);
      expect(search.body.results.length).toBeLessThanOrEqual(20);
      expect(search.text.length).toBeLessThan(10_000);
    }
    const feed = await api('get', '/cases/medium/sources/feed?limit=5&offset=5').expect(200);
    expect(feed.body).toMatchObject({ offset: 5, limit: 5 });
    expect(feed.body.items).toHaveLength(5);
    const filtered = await api('get', `/cases/medium/sources/feed?author=${feed.body.items[0].author.id}`).expect(200);
    expect(filtered.body.items.every((p) => p.author.id === feed.body.items[0].author.id)).toBe(true);
  });

  it('serves each team its own world', async () => {
    const a = await api('get', '/cases/easy/sources/feed?limit=20', 'player').expect(200);
    const b = await api('get', '/cases/easy/sources/feed?limit=20', 'player2').expect(200);
    expect(a.body.items).not.toEqual(b.body.items);
    const again = await api('get', '/cases/easy/sources/feed?limit=20', 'player').expect(200);
    expect(again.body).toEqual(a.body);
  });
});

describe('no answer leakage', () => {
  it('shows no answer or flag before a question is solved and keeps the final locked', async () => {
    for (const track of TRACK_IDS) {
      const { body, text } = await api('get', `/cases/${track}`).expect(200);
      for (const stage of TRACKS[track].stages) { expect(text.toLowerCase()).not.toContain(String(truth(track, stage.n)).toLowerCase()); }
      expect(text).not.toMatch(/CTF\{/);
      expect(body.questions.some((q) => 'flag' in q || 'confirmed' in q)).toBe(false);
      expect(body.questions.at(-1)).toMatchObject({ final: true, locked: true, solved: false });
      expect(body.questions.slice(0, -1).every((q) => q.locked === false)).toBe(true);
    }
  });

  it('reveals only what the team earned, and wrong answers reveal nothing', async () => {
    const wrong = await answer('easy', 1, 'Nobody Atall').expect(200);
    expect(wrong.body).toMatchObject({ correct: false, pointsAwarded: 0, firstBlood: false });
    expect(JSON.stringify(wrong.body)).not.toContain(truth('easy', 1));
    expect(wrong.body.flag).toBeUndefined();
    expect(Submission.create.mock.calls[0][0].submittedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(Submission.create.mock.calls[0][0])).not.toContain('Nobody');
    const right = await answer('easy', 2, truth('easy', 2)).expect(200);
    expect(right.body.flag).toBe(expectedFlagFor(rowOf('easy', 2), { secret: env.FLAG_SECRET, teamId: TEAM_A }));
    const { body, text } = await api('get', '/cases/easy').expect(200);
    expect(body.questions[1]).toMatchObject({ solved: true, confirmed: truth('easy', 2), flag: right.body.flag });
    expect(text.toLowerCase()).not.toContain(String(truth('easy', 3)).toLowerCase());
    const other = await api('get', '/cases/easy', 'player2').expect(200);
    expect(other.text).not.toContain(right.body.flag);
  });

  it('never accepts another team\'s answer or a flag as the answer', async () => {
    for (const text of [truth('easy', 1, TEAM_B), expectedFlagFor(rowOf('easy', 1), { secret: env.FLAG_SECRET, teamId: TEAM_A })]) {
      expect((await answer('easy', 1, text).expect(200)).body.correct).toBe(false);
    }
    expect(solves).toHaveLength(0);
  });
});

describe('scoring', () => {
  it('awards the fixed question points with no first-blood bonus, even for the very first team', async () => {
    expect(hasFirstBloodBonus({ type: 'osint' })).toBe(false);
    const { body } = await answer('hard', 1, truth('hard', 1)).expect(200);
    expect(body).toMatchObject({ correct: true, pointsAwarded: 70, firstBlood: false, solved: 1, total: 6 });
    expect(rowOf('hard', 1).solveCount).toBe(1);
    expect(solves[0]).toMatchObject({ points: 70, firstBlood: false });
    expect(Solve.updateOne).not.toHaveBeenCalled();
  });

  it('evaluates badges after a new solve only', async () => {
    achievementService.safeEvaluate.mockResolvedValue([{ id: 'sleuth' }]);
    const track = TRACK_IDS[0];
    const [n] = nonFinal(track);
    await answer(track, n, 'definitely wrong').expect(200);
    expect(achievementService.safeEvaluate).not.toHaveBeenCalled();
    const { body } = await answer(track, n, truth(track, n)).expect(200);
    expect(achievementService.safeEvaluate).toHaveBeenCalledWith({ userId: users.player._id, teamId: TEAM_A });
    expect(body.badges).toEqual([{ id: 'sleuth' }]);
    const again = await answer(track, n, truth(track, n)).expect(200);
    expect(achievementService.safeEvaluate).toHaveBeenCalledOnce();
    expect(again.body.badges).toBeUndefined();
  });

  it('ignores a stored points value that is higher than the definition', async () => {
    rowOf('hard', 1).points = 99999;
    expect((await answer('hard', 1, truth('hard', 1)).expect(200)).body.pointsAwarded).toBe(70);
  });

  it('counts a double submit once, in sequence and in parallel', async () => {
    await answer('medium', 1, truth('medium', 1)).expect(200);
    const again = await answer('medium', 1, truth('medium', 1)).expect(200);
    expect(again.body).toMatchObject({ correct: true, alreadySolved: true, pointsAwarded: 0 });
    const results = await Promise.all([1, 2, 3].map(() => answer('medium', 2, truth('medium', 2))));
    expect(results.filter((r) => r.body.pointsAwarded === 50)).toHaveLength(1);
    expect(solves.filter((s) => s.teamId === TEAM_A)).toHaveLength(2);
    expect(scoreOf(TEAM_A)).toBe(90);
  });

  it('accepts harmless format differences and rejects wrong values', async () => {
    expect((await answer('easy', 1, `  ${truth('easy', 1).toUpperCase()} `).expect(200)).body.correct).toBe(true);
    expect((await answer('easy', 4, `${truth('easy', 4)}x`).expect(200)).body.correct).toBe(false);
    expect((await answer('medium', 3, truth('medium', 3).toLowerCase()).expect(200)).body.correct).toBe(true);
  });

  it.each(TRACK_IDS)('locks the final question of %s until the others are solved, then closes the case', async (track) => {
    const last = finalOf(track);
    const locked = await answer(track, last, 'anyone').expect(403);
    expect(locked.body.error.code).toBe('STAGE_LOCKED');
    expect(Submission.create).not.toHaveBeenCalled();
    await solveAllButFinal(track, 'player', TEAM_A, { board: false });
    const gated = (await api('get', `/cases/${track}`).expect(200)).body;
    expect(gated.questions.at(-1)).toMatchObject({ locked: true, lockedBy: 'board' });
    expect((await answer(track, last, 'anyone').expect(403)).body.error.code).toBe('BOARD_LOCKED');
    openBoard(track);
    const view = (await api('get', `/cases/${track}`).expect(200)).body;
    expect(view.questions.at(-1).locked).toBe(false);
    expect((await answer(track, last, 'Nobody Atall').expect(200)).body.correct).toBe(false);
    const done = await answer(track, last, truth(track, last)).expect(200);
    expect(done.body).toMatchObject({ correct: true, caseClosed: true, firstBlood: false });
    expect(scoreOf(TEAM_A)).toBe(TRACKS[track].maxPoints);
    expect((await api('get', `/cases/${track}`).expect(200)).body.caseClosed).toBe(true);
  });

  it('never lets a team exceed the documented maximum, however often it replays', async () => {
    for (const track of TRACK_IDS) {
      await solveAllButFinal(track);
      await answer(track, finalOf(track), truth(track, finalOf(track))).expect(200);
    }
    expect(scoreOf(TEAM_A)).toBe(OSINT_MAX_POINTS);
    for (const track of TRACK_IDS) {
      for (const stage of TRACKS[track].stages) {
        expect((await answer(track, stage.n, truth(track, stage.n)).expect(200)).body.pointsAwarded).toBe(0);
      }
    }
    for (const track of TRACK_IDS) {
      await solveAllButFinal(track, 'player2', TEAM_B);
      await answer(track, finalOf(track), truth(track, finalOf(track), TEAM_B), 'player2').expect(200);
    }
    expect(scoreOf(TEAM_B)).toBe(OSINT_MAX_POINTS);
    expect(scoreOf(TEAM_A)).toBe(OSINT_MAX_POINTS);
    expect(solves.every((s) => s.firstBlood === false)).toBe(true);
  });

  it('accepts a map point inside the tolerance for the insane final, and nothing outside it', async () => {
    await solveAllButFinal('insane');
    const [x, y] = truth('insane', 6).split(',').map(Number);
    expect((await answer('insane', 6, `${x + 300},${y}`).expect(200)).body.correct).toBe(false);
    expect((await answer('insane', 6, `${x + 40},${y - 30}`).expect(200)).body.correct).toBe(true);
  });
});

describe('attempt limit', () => {
  it('allows 8 wrong guesses a minute per question, then 429, and is counted per team', async () => {
    for (let i = 0; i < 8; i += 1) { await answer('easy', 1, `guess ${i}`).expect(200); }
    const blocked = await answer('easy', 1, 'guess 9').expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Submission.create).toHaveBeenCalledTimes(8);
    await answer('easy', 2, 'other question').expect(200);
    await answer('easy', 1, 'other team', 'player2').expect(200);
  });

  it('is stricter on the final question: 3 a minute', async () => {
    await solveAllButFinal('easy');
    for (let i = 0; i < 3; i += 1) { await answer('easy', 5, `guess ${i}`).expect(200); }
    expect((await answer('easy', 5, 'guess 4').expect(429)).body.error.code).toBe('RATE_LIMITED');
  });
});

describe('hints', () => {
  it('opens free hints one at a time for easy and medium, logged for admins', async () => {
    const first = await api('post', '/cases/easy/questions/1/hints', 'player', {}).expect(200);
    expect(first.body).toMatchObject({ index: 0, used: 1, total: 2 });
    expect(first.body.hint).toBe(TRACKS.easy.stages[0].hints[0]);
    const second = await api('post', '/cases/easy/questions/1/hints', 'player', {}).expect(200);
    expect(second.body).toMatchObject({ index: 1, used: 2 });
    expect((await api('post', '/cases/easy/questions/1/hints', 'player', {}).expect(409)).body.error.code).toBe('NO_MORE_HINTS');
    await api('post', '/cases/medium/questions/2/hints', 'player', {}).expect(200);
    const view = (await api('get', '/cases/easy').expect(200)).body;
    expect(view.questions[0].hints).toHaveLength(2);
    expect(view.questions[1].hints).toEqual([]);
    expect(view.questions[1].hintsTotal).toBe(2);
    const log = (await api('get', '/admin/hints', 'admin').expect(200)).body;
    expect(log.map((h) => h.key).sort()).toEqual(['easy:1', 'easy:1', 'medium:2']);
    expect(log[0]).toHaveProperty('teamId', TEAM_A);
    expect(hints).toHaveLength(3);
  });

  it('gives no hints for hard and insane and none on a locked final', async () => {
    for (const track of ['hard', 'insane']) {
      expect((await api('post', `/cases/${track}/questions/1/hints`, 'player', {}).expect(403)).body.error.code).toBe('NO_HINTS');
      const view = (await api('get', `/cases/${track}`).expect(200)).body;
      expect(view.hintsAllowed).toBe(false);
      expect(view.questions.every((q) => q.hintsTotal === 0 && q.hints.length === 0)).toBe(true);
    }
    expect((await api('post', '/cases/easy/questions/5/hints', 'player', {}).expect(403)).body.error.code).toBe('STAGE_LOCKED');
  });
});
