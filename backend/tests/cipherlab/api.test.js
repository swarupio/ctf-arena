import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import { buildPuzzle, slugOf } from '../../src/games/cipherlab/game.js';
import { LEVELS, MAX_POINTS, TOOLS, TRACKS, levelById, trackMaxPoints } from '../../src/games/cipherlab/levels.js';
import { ATTEMPT_LIMIT } from '../../src/games/cipherlab/service.js';
import { netPoints, spentFor } from '../../src/services/hintCost.js';
import Challenge from '../../src/models/Challenge.js';
import CipherHint from '../../src/models/CipherHint.js';
import Solve from '../../src/models/Solve.js';
import Submission from '../../src/models/Submission.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { consumeAttempt } from '../../src/services/attemptLimiter.js';
import { achievementService } from '../../src/services/achievementService.js';
import { expectedFlagFor } from '../../src/services/flagService.js';
import { integrityService } from '../../src/services/integrityService.js';
import { AppError } from '../../src/utils/AppError.js';
import { cipherLabDefinitions } from '../../src/scripts/seedCipherLab.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({ default: { find: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn(), create: vi.fn(), updateOne: vi.fn(), aggregate: vi.fn() } }));
vi.mock('../../src/models/Submission.js', () => ({ default: { create: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/CipherHint.js', () => ({ default: { countDocuments: vi.fn(), updateOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/services/attemptLimiter.js', () => ({ consumeAttempt: vi.fn() }));
vi.mock('../../src/services/integrityService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, integrityService: { ...actual.integrityService, checkSubmittedFlag: vi.fn() } };
});

const oid = (n) => String(n).padStart(24, '0');
const secret = env.FLAG_SECRET;
const TEAM_A = oid(2);
const TEAM_B = oid(4);
const users = {
  player: { _id: oid(1), teamId: TEAM_A },
  player2: { _id: oid(3), teamId: TEAM_B },
  loner: { _id: oid(5), teamId: null },
  admin: { _id: oid(9), teamId: null },
};
let teams;
let docs;
let solves;
let submissions;
let hints;
let counters;
let solveCounts;

const api = (method, path, sub = 'player', body) => {
  const call = request(app)[method](`/api/cipherlab${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};
const docOf = (id) => docs.find((d) => d.slug === slugOf(levelById(id)));
const answerOf = (id, teamId = TEAM_A) => buildPuzzle(levelById(id), { secret, teamId }).answer;
const flagOf = (id, teamId = TEAM_A) => expectedFlagFor(docOf(id), { secret, teamId });
const solveAnswer = (id, sub = 'player', teamId = TEAM_A) => api('post', `/levels/${id}/answer`, sub, { answer: answerOf(id, teamId) });
const ORDER = TRACKS.flatMap((t) => LEVELS.filter((l) => l.track === t.id).map((l) => l.id));
const sumOf = (teamId) => solves.filter((s) => s.teamId === teamId).reduce((total, s) => total + s.points, 0);

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  teams = { [TEAM_A]: { _id: TEAM_A, name: 'Alpha', banned: false }, [TEAM_B]: { _id: TEAM_B, name: 'Bravo', banned: false } };
  docs = cipherLabDefinitions().map((def, i) => ({ ...def, _id: oid(5000 + i), visible: true, solveCount: 0 }));
  solves = [];
  submissions = [];
  hints = [];
  counters = new Map();
  solveCounts = new Map();
  User.findOne.mockImplementation(async ({ cognitoSub }) => users[cognitoSub] ?? null);
  Team.findById.mockImplementation(async (id) => teams[String(id)] ?? null);
  Challenge.find.mockImplementation(() => ({ lean: async () => docs.filter((d) => d.type === 'game' && d.visible) }));
  Challenge.findOneAndUpdate.mockImplementation(async ({ _id }) => {
    solveCounts.set(String(_id), (solveCounts.get(String(_id)) ?? 0) + 1);
    return { solveCount: solveCounts.get(String(_id)) };
  });
  Solve.find.mockImplementation((filter) => ({
    lean: async () => {
      const ids = filter.challengeId.$in.map(String);
      return solves.filter((s) => String(s.teamId) === String(filter.teamId) && ids.includes(String(s.challengeId)));
    },
  }));
  Solve.create.mockImplementation(async (row) => {
    if (solves.some((s) => String(s.teamId) === String(row.teamId) && String(s.challengeId) === String(row.challengeId))) {
      throw Object.assign(new Error('dup'), { code: 11000 });
    }
    solves.push({ ...row, teamId: String(row.teamId), solvedAt: new Date() });
  });
  Solve.updateOne.mockResolvedValue({});
  Solve.aggregate.mockImplementation(async ([{ $match }]) => [{ score: sumOf(String($match.teamId)) }]);
  Submission.create.mockImplementation(async (row) => { submissions.push({ ...row, createdAt: new Date(submissions.length) }); });
  Submission.find.mockImplementation((filter) => ({
    sort: () => ({
      limit: () => ({
        lean: async () => submissions.filter((s) => String(s.teamId) === String(filter.teamId)).reverse(),
      }),
    }),
  }));
  CipherHint.countDocuments.mockImplementation(async (filter) => hints.filter((h) => String(h.teamId) === String(filter.teamId) && h.levelId === filter.levelId).length);
  CipherHint.updateOne.mockImplementation(async (filter, update) => {
    if (!hints.some((h) => String(h.teamId) === String(filter.teamId) && h.levelId === filter.levelId && h.index === filter.index)) {
      hints.push({ ...filter, ...update.$setOnInsert, createdAt: new Date() });
    }
  });
  // The admin log sorts and limits; the hint ledger (services/hintLedger.js) reads one team's rows of one level with .lean().
  CipherHint.find.mockImplementation((filter = {}) => ({
    sort: () => ({ limit: () => ({ lean: async () => [...hints].reverse() }) }),
    lean: async () => hints.filter((h) => String(h.teamId) === String(filter.teamId) && h.levelId === filter.levelId),
  }));
  consumeAttempt.mockImplementation(async (key, { limit, message }) => {
    counters.set(key, (counters.get(key) ?? 0) + 1);
    if (counters.get(key) > limit) { throw new AppError(429, 'RATE_LIMITED', message); }
  });
});

describe('access', () => {
  it('needs a token', async () => {
    await request(app).get('/api/cipherlab/overview').expect(401);
    await request(app).get('/api/cipherlab/levels/e1').expect(401);
    await request(app).post('/api/cipherlab/levels/e1/answer').send({ answer: 'x' }).expect(401);
  });

  it('returns 404 for unknown level ids and validates bodies strictly', async () => {
    for (const id of ['z9', 'e1x', '__proto__', 'E1', 'e100']) {
      await api('get', `/levels/${id}`).expect(404);
      await api('post', `/levels/${id}/answer`, 'player', { answer: 'x' }).expect(404);
    }
    await api('post', '/levels/e1/answer', 'player', {}).expect(400);
    await api('post', '/levels/e1/answer', 'player', { answer: 'x', extra: 1 }).expect(400);
    await api('post', '/levels/e1/answer', 'player', { answer: 'x'.repeat(301) }).expect(400);
    await api('post', '/levels/e1/answer', 'player', { answer: 5 }).expect(400);
  });

  it('answers NO_TEAM, TEAM_BANNED and admin restrictions', async () => {
    expect((await api('get', '/levels/e1', 'loner').expect(404)).body.error.code).toBe('NO_TEAM');
    await api('get', '/overview', 'loner').expect(200);
    teams[TEAM_A].banned = true;
    expect((await api('get', '/levels/e1').expect(403)).body.error.code).toBe('TEAM_BANNED');
    expect((await api('post', '/levels/e1/answer', 'player', { answer: 'x' }).expect(403)).body.error.code).toBe('TEAM_BANNED');
    teams[TEAM_A].banned = false;
    await api('get', '/levels/e1', 'admin').expect(200);
    await api('post', '/levels/e1/answer', 'admin', { answer: 'x' }).expect(403);
  });

  it('returns 503 until seeded', async () => {
    docs = [];
    expect((await api('get', '/overview').expect(503)).body.error.code).toBe('CIPHERLAB_NOT_SEEDED');
  });

  it('hides levels whose challenge row is hidden', async () => {
    docOf('e1').visible = false;
    await api('get', '/levels/e1').expect(404);
    const { body } = await api('get', '/overview').expect(200);
    expect(body.total).toBe(LEVELS.length - 1);
  });
});

describe('overview and puzzles', () => {
  it('lists tracks, documented maximums, a locked-by-default ladder and the toolbox', async () => {
    const { body } = await api('get', '/overview').expect(200);
    expect(body.maxPoints).toBe(MAX_POINTS);
    expect(body.tracks.map((t) => [t.id, t.maxPoints])).toEqual(TRACKS.map((t) => [t.id, trackMaxPoints(t.id)]));
    const easy = body.tracks[0].levels.map((l) => l.status);
    expect(easy).toEqual(['open', 'locked', 'locked', 'locked']);
    expect(body.tracks[3].levels.every((l) => l.hintsTotal === 0)).toBe(true);
    expect(body.toolbox.filter((t) => t.unlocked).map((t) => t.id)).toEqual(['shift']);
  });

  it('serves the same puzzle each time, a different one per team, and never the answer or a flag', async () => {
    const a1 = (await api('get', '/levels/e1').expect(200)).body;
    const a2 = (await api('get', '/levels/e1').expect(200)).body;
    const b = (await api('get', '/levels/e1', 'player2').expect(200)).body;
    expect(a1).toEqual(a2);
    expect(a1.ciphertext).not.toBe(b.ciphertext);
    const text = JSON.stringify(a1);
    expect(text).not.toContain(answerOf('e1'));
    expect(text).not.toContain('CTF{');
    expect(a1.hints).toEqual([]);
  });

  it('locks a level until the one before it is solved', async () => {
    expect((await api('get', '/levels/e2').expect(403)).body.error.code).toBe('LEVEL_LOCKED');
    expect((await api('post', '/levels/e2/answer', 'player', { answer: 'x' }).expect(403)).body.error.code).toBe('LEVEL_LOCKED');
    expect(consumeAttempt).not.toHaveBeenCalled();
    await solveAnswer('e1').expect(200);
    await api('get', '/levels/e2').expect(200);
    // The insane track is its own ladder: its first level is open from the start.
    await api('get', '/levels/i1').expect(200);
  });

  it('opens tools as levels are cleared', async () => {
    await solveAnswer('e1').expect(200);
    const { body } = await api('get', '/overview').expect(200);
    expect(body.toolbox.filter((t) => t.unlocked).map((t) => t.id)).toEqual(['shift', 'frequency']);
  });
});

describe('answers', () => {
  it('rejects a wrong answer without scoring, flag or hint about it', async () => {
    const { body } = await api('post', '/levels/e1/answer', 'player', { answer: 'WRONG ANSWER' }).expect(200);
    expect(body).toMatchObject({ correct: false, pointsAwarded: 0, firstBlood: false, streak: 0 });
    expect(JSON.stringify(body)).not.toContain('CTF{');
    expect(JSON.stringify(body)).not.toContain(answerOf('e1'));
    expect(solves).toHaveLength(0);
    expect(submissions).toEqual([expect.objectContaining({ correct: false })]);
    expect(integrityService.checkSubmittedFlag).toHaveBeenCalledOnce();
  });

  it('accepts the right answer once: points, per-team flag, no first blood, streak and next level', async () => {
    const { body } = await solveAnswer('e1').expect(200);
    expect(body).toMatchObject({
      correct: true, alreadySolved: false, pointsAwarded: levelById('e1').points, firstBlood: false,
      flag: flagOf('e1'), streak: 1, trackComplete: false, nextLevelId: 'e2',
    });
    expect(flagOf('e1', TEAM_A)).not.toBe(flagOf('e1', TEAM_B));
    // Team B solves the same level later: still exactly the fixed points (no first-blood difference either way).
    const other = await solveAnswer('e1', 'player2', TEAM_B).expect(200);
    expect(other.body.pointsAwarded).toBe(levelById('e1').points);
    expect(other.body.flag).toBe(flagOf('e1', TEAM_B));
  });

  it('accepts formatting differences in the answer', async () => {
    const { body } = await api('post', '/levels/e1/answer', 'player', { answer: `  ${answerOf('e1').toLowerCase().replaceAll(' ', '_')} ` }).expect(200);
    expect(body.correct).toBe(true);
  });

  it('does not accept a team\'s answer from another team', async () => {
    const { body } = await api('post', '/levels/e1/answer', 'player2', { answer: answerOf('e1', TEAM_A) }).expect(200);
    expect(body.correct).toBe(false);
  });

  it('is safe against double submits and parallel bursts', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => solveAnswer('e1')));
    const bodies = results.map((r) => r.body);
    expect(bodies.filter((b) => b.pointsAwarded > 0)).toHaveLength(1);
    expect(bodies.every((b) => b.correct && b.flag === flagOf('e1'))).toBe(true);
    expect(solves).toHaveLength(1);
    const again = (await solveAnswer('e1').expect(200)).body;
    expect(again).toMatchObject({ correct: true, alreadySolved: true, pointsAwarded: 0 });
    expect(sumOf(TEAM_A)).toBe(levelById('e1').points);
  });

  it('keeps a streak of consecutive correct answers and resets it on a miss', async () => {
    await solveAnswer('e1');
    expect((await solveAnswer('e2')).body.streak).toBe(2);
    expect((await api('post', '/levels/e3/answer', 'player', { answer: 'nope' })).body.streak).toBe(0);
    expect((await solveAnswer('e3')).body.streak).toBe(1);
  });

  it('ignores resubmissions of an already solved level when counting the streak', async () => {
    await solveAnswer('e1');
    await solveAnswer('e2');
    solves.find((row) => String(row.challengeId) === docOf('e1')._id).solvedAt = new Date(0); // solved before the resubmission
    expect((await api('post', '/levels/e3/answer', 'player', { answer: 'nope' })).body.streak).toBe(0);
    // A correct resubmission of e1 must not restart a streak after the miss.
    const again = (await solveAnswer('e1')).body;
    expect(again).toMatchObject({ alreadySolved: true, streak: 0 });
  });

  it('evaluates achievements after a new solve only, and adds badges when there are some', async () => {
    const badge = { id: 'first-solve', name: 'First solve' };
    const evaluate = vi.spyOn(achievementService, 'safeEvaluate').mockResolvedValue([badge]);
    const first = (await solveAnswer('e1')).body;
    expect(evaluate).toHaveBeenCalledWith({ userId: users.player._id, teamId: TEAM_A });
    expect(first.badges).toEqual([badge]);
    evaluate.mockClear();
    expect((await solveAnswer('e1')).body.badges).toBeUndefined();
    await api('post', '/levels/e2/answer', 'player', { answer: 'nope' });
    expect(evaluate).not.toHaveBeenCalled();
    evaluate.mockResolvedValue([]);
    expect((await solveAnswer('e2')).body.badges).toBeUndefined();
    evaluate.mockRestore();
  });

  it('finishes a track and reports it, with a speed-run badge from the solve times', async () => {
    for (const id of ['e1', 'e2', 'e3']) { await solveAnswer(id); }
    const last = (await solveAnswer('e4')).body;
    expect(last).toMatchObject({ trackComplete: true, nextLevelId: null });
    const { body } = await api('get', '/overview').expect(200);
    const easy = body.tracks[0];
    expect(easy).toMatchObject({ complete: true, solved: 4, pointsEarned: 80 });
    expect(easy.speedrun.badge).toBe('gold');
  });
});

describe('rate limit', () => {
  it('stops attempts per team and level after the limit, even a correct one, without revealing correctness', async () => {
    for (let i = 0; i < ATTEMPT_LIMIT; i += 1) {
      await api('post', '/levels/e1/answer', 'player', { answer: `guess ${i}` }).expect(200);
    }
    const blocked = await solveAnswer('e1').expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(solves).toHaveLength(0);
    expect(counters.get(`cipherlab:${TEAM_A}:e1`)).toBe(ATTEMPT_LIMIT + 1);
    // Other levels and other teams are independent.
    await api('post', '/levels/e1/answer', 'player2', { answer: 'x' }).expect(200);
  });
});

describe('hints', () => {
  it('reveals hints one at a time, charges them at solve time, and logs them for admins', async () => {
    const first = (await api('post', '/levels/e1/hints', 'player', {}).expect(200)).body;
    expect(first).toMatchObject({ index: 0, used: 1, total: 2 });
    expect(first.hint).toMatch(/\w/);
    expect((await api('post', '/levels/e1/hints', 'player', {}).expect(200)).body.index).toBe(1);
    expect((await api('post', '/levels/e1/hints', 'player', {}).expect(409)).body.error.code).toBe('NO_MORE_HINTS');
    expect(solves).toHaveLength(0);
    const view = (await api('get', '/levels/e1').expect(200)).body;
    expect(view.hints).toHaveLength(2);
    expect(JSON.stringify(view)).not.toContain(answerOf('e1'));
    // Hints cost points now (docs/HINTS.md "Hint costs"): two hints on e1 are charged at solve time with the default costs
    // (this test used to assert that hints were free).
    const base = levelById('e1').points;
    const paid = netPoints(base, spentFor(base, [0, 1]));
    expect(paid).toBeLessThan(base);
    const solved = (await solveAnswer('e1')).body;
    expect(solved.pointsAwarded).toBe(paid);
    expect(solved.hintCost).toEqual({ spent: base - paid, openedCount: 2, base, awarded: paid });
    const log = (await api('get', '/admin/hints', 'admin').expect(200)).body;
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ teamId: TEAM_A, levelId: 'e1' });
    await api('get', '/admin/hints', 'player').expect(403);
  });

  it('prices every hint: unopened hints carry tier, percent and points but no text; opening reports cost and spend', async () => {
    const base = levelById('e1').points;
    const before = (await api('get', '/levels/e1').expect(200)).body;
    expect(before.hints).toEqual([]);
    expect(before.hintPricing.map((p) => [p.index, p.tier])).toEqual([[0, 'nudge'], [1, 'approach']]);
    expect(Object.keys(before.hintPricing[0]).sort()).toEqual(['index', 'percent', 'points', 'tier']);
    expect(before.hintSpent).toEqual({ points: 0, percent: 0, cap: Math.round(base * 0.4) });
    const first = (await api('post', '/levels/e1/hints', 'player', {}).expect(200)).body;
    expect(first.cost).toEqual({ percent: 5, points: Math.round(base * 0.05), tier: 'nudge' });
    expect(first.spent).toMatchObject({ points: spentFor(base, [0]), cap: Math.round(base * 0.4) });
    const after = (await api('get', '/levels/e1').expect(200)).body;
    expect(after.hintPricing.map((p) => p.index)).toEqual([1]);
    expect(JSON.stringify(after.hintPricing)).not.toContain(first.hint);
  });

  it('keeps the admin preview free: no cost, spend or pricing fields, nothing recorded', async () => {
    const view = (await api('get', '/levels/e1', 'admin').expect(200)).body;
    expect(view.hintPricing).toBeUndefined();
    expect(view.hintSpent).toBeUndefined();
    const opened = (await api('post', '/levels/e1/hints', 'admin', {}).expect(200)).body;
    expect(opened.cost).toBeUndefined();
    expect(opened.spent).toBeUndefined();
    expect(hints).toHaveLength(0);
  });

  it('never reveals the full answer, even through the dynamic boss hint', async () => {
    for (const id of ['e1', 'e2', 'e3', 'e4', 'm1', 'm2', 'm3']) { await solveAnswer(id); }
    for (let i = 0; i < 3; i += 1) { await api('post', '/levels/m4/hints', 'player', {}).expect(200); }
    const view = (await api('get', '/levels/m4').expect(200)).body;
    expect(view.hints).toHaveLength(3);
    expect(JSON.stringify(view)).not.toContain(answerOf('m4'));
  });

  it('gives no hints on the insane track', async () => {
    expect((await api('post', '/levels/i1/hints', 'player', {}).expect(403)).body.error.code).toBe('NO_HINTS');
    expect((await api('get', '/levels/i1').expect(200)).body).toMatchObject({ hintsAllowed: false, hintsTotal: 0, hints: [] });
    expect(hints).toHaveLength(0);
  });

  it('cannot open hints of a locked level', async () => {
    await api('post', '/levels/e2/hints', 'player', {}).expect(403);
  });
});

describe('admin preview', () => {
  it('opens every tool, shows every hint and logs no CipherHint row', async () => {
    const overview = (await api('get', '/overview', 'admin').expect(200)).body;
    expect(overview.toolbox.every((tool) => tool.unlocked)).toBe(true);
    const puzzle = (await api('get', '/levels/h4', 'admin').expect(200)).body;
    expect(puzzle.hints).toHaveLength(puzzle.hintsTotal);
    expect(puzzle.hintsTotal).toBeGreaterThan(0);
    const opened = (await api('post', '/levels/m4/hints', 'admin', {}).expect(200)).body;
    expect(opened.hints).toHaveLength(opened.total);
    expect(CipherHint.updateOne).not.toHaveBeenCalled();
    expect(hints).toHaveLength(0);
    await api('post', '/levels/i1/hints', 'admin', {}).expect(403); // the Black Chamber still has none
    await api('post', '/levels/e1/answer', 'admin', { answer: 'x' }).expect(403);
  });

  it('unlocks the pipeline with h3, before the boss hint that recommends it', async () => {
    const pipeline = TOOLS.find((tool) => tool.id === 'pipeline');
    expect(pipeline.unlockedBy).toBe('h3');
    expect(levelById('h4').hints.join(' ')).toContain('pipeline');
  });
});

describe('maximum points', () => {
  it('a team that solves everything, repeatedly, never exceeds the documented maximum', async () => {
    for (const id of ORDER) {
      const { body } = await solveAnswer(id).expect(200);
      expect(body.pointsAwarded).toBe(levelById(id).points);
      expect(body.firstBlood).toBe(false);
      await solveAnswer(id).expect(200);
      await Promise.all([solveAnswer(id), solveAnswer(id)]);
    }
    expect(sumOf(TEAM_A)).toBe(MAX_POINTS);
    expect(solves).toHaveLength(LEVELS.length);
    expect(solves.every((s) => !s.firstBlood)).toBe(true);
    const { body } = await api('get', '/overview').expect(200);
    expect(body).toMatchObject({ pointsEarned: MAX_POINTS, maxPoints: MAX_POINTS, solved: LEVELS.length });
    expect(body.tracks.every((t) => t.complete && t.pointsEarned === t.maxPoints)).toBe(true);
    expect(body.toolbox.every((t) => t.unlocked)).toBe(true);
  });

  it('ignores an edited points value on the challenge row', async () => {
    docOf('e1').points = 99999;
    expect((await solveAnswer('e1')).body.pointsAwarded).toBe(levelById('e1').points);
  });
});

describe('no secret leakage', () => {
  it('no response other than a correct answer contains a flag, answer or flag hash', async () => {
    const seen = [];
    seen.push((await api('get', '/overview')).text);
    for (const id of ORDER) {
      const view = await api('get', `/levels/${id}`);
      seen.push(view.text);
      seen.push((await api('post', `/levels/${id}/answer`, 'player', { answer: 'nope' })).text);
      await solveAnswer(id);
    }
    seen.push((await api('get', '/overview')).text);
    const all = seen.join('\n');
    expect(all).not.toContain('CTF{');
    expect(all).not.toContain('flagHash');
    for (const id of ORDER) {
      const answer = answerOf(id);
      if (id !== 'h2') { expect(all, id).not.toContain(`"${answer}"`); }
      expect(all, id).not.toContain(flagOf(id));
    }
  });
});
