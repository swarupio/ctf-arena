import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import { buildPuzzle, slugOf } from '../../src/games/crackme/game.js';
import {
  LEVELS, MAX_POINTS, TRACKS, levelById, trackMaxPoints,
} from '../../src/games/crackme/levels.js';
import { PATCH_MAX_EDITS } from '../../src/games/crackme/patch.js';
import { patchInputs } from '../../src/games/crackme/patchBay.js';
import { ATTEMPT_LIMIT, PATCH_ATTEMPT_LIMIT } from '../../src/games/crackme/service.js';
import Challenge from '../../src/models/Challenge.js';
import CrackmeHint from '../../src/models/CrackmeHint.js';
import CrackmePatch from '../../src/models/CrackmePatch.js';
import Solve from '../../src/models/Solve.js';
import Submission from '../../src/models/Submission.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { consumeAttempt } from '../../src/services/attemptLimiter.js';
import { expectedFlagFor, verifyFlag } from '../../src/services/flagService.js';
import { integrityService } from '../../src/services/integrityService.js';
import { hasFirstBloodBonus } from '../../src/services/scoringService.js';
import { achievementService } from '../../src/services/achievementService.js';
import { AppError } from '../../src/utils/AppError.js';
import { crackmeDefinitions } from '../../src/scripts/seedCrackme.js';
import { patchSolution, solveLevel } from './solvers.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({ default: { find: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn(), create: vi.fn(), updateOne: vi.fn(), aggregate: vi.fn() } }));
vi.mock('../../src/models/Submission.js', () => ({ default: { create: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/CrackmeHint.js', () => ({ default: { countDocuments: vi.fn(), updateOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/CrackmePatch.js', () => ({ default: { find: vi.fn(), findOne: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../../src/services/achievementService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, achievementService: { ...actual.achievementService, safeEvaluate: vi.fn() } };
});
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
let patches;
let counters;
let solveCounts;

const api = (method, path, sub = 'player', body) => {
  const call = request(app)[method](`/api/crackme${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};
const docOf = (id) => docs.find((d) => d.slug === slugOf(levelById(id)));
const cabinetOf = (id, teamId = TEAM_A) => buildPuzzle(levelById(id), { secret, teamId });
// What a player would type: solved from the program that the API shows, never from the generator.
const answerOf = (id, teamId = TEAM_A) => solveLevel(id, cabinetOf(id, teamId).program);
const flagOf = (id, teamId = TEAM_A) => expectedFlagFor(docOf(id), { secret, teamId });
const solveAnswer = (id, sub = 'player', teamId = TEAM_A) => api('post', `/levels/${id}/answer`, sub, { answer: answerOf(id, teamId) });
const ORDER = TRACKS.flatMap((t) => LEVELS.filter((l) => l.track === t.id).map((l) => l.id));
const sumOf = (teamId) => solves.filter((s) => s.teamId === teamId).reduce((total, s) => total + s.points, 0);

beforeEach(() => {
  vi.resetAllMocks();
  achievementService.safeEvaluate.mockResolvedValue([]);
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  teams = { [TEAM_A]: { _id: TEAM_A, name: 'Alpha', banned: false }, [TEAM_B]: { _id: TEAM_B, name: 'Bravo', banned: false } };
  docs = crackmeDefinitions().map((def, i) => ({ ...def, _id: oid(7000 + i), visible: true, solveCount: 0 }));
  solves = [];
  submissions = [];
  hints = [];
  patches = [];
  counters = new Map();
  solveCounts = new Map();
  User.findOne.mockImplementation(async ({ cognitoSub }) => users[cognitoSub] ?? null);
  Team.findById.mockImplementation(async (id) => teams[String(id)] ?? null);
  Challenge.find.mockImplementation(() => ({ lean: async () => docs.filter((d) => d.type === 'reversing' && d.visible) }));
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
  CrackmeHint.countDocuments.mockImplementation(async (filter) => hints.filter((h) => String(h.teamId) === String(filter.teamId) && h.levelId === filter.levelId).length);
  CrackmeHint.updateOne.mockImplementation(async (filter, update) => {
    if (!hints.some((h) => String(h.teamId) === String(filter.teamId) && h.levelId === filter.levelId && h.index === filter.index)) {
      hints.push({ ...filter, ...update.$setOnInsert, createdAt: new Date() });
    }
  });
  CrackmeHint.find.mockImplementation(() => ({ sort: () => ({ limit: () => ({ lean: async () => [...hints].reverse() }) }) }));
  CrackmePatch.find.mockImplementation((filter) => ({ lean: async () => patches.filter((p) => String(p.teamId) === String(filter.teamId)) }));
  CrackmePatch.findOne.mockImplementation((filter) => ({
    lean: async () => patches.find((p) => String(p.teamId) === String(filter.teamId) && p.levelId === filter.levelId) ?? null,
  }));
  CrackmePatch.updateOne.mockImplementation(async (filter, update) => {
    if (patches.some((p) => String(p.teamId) === String(filter.teamId) && p.levelId === filter.levelId)) { return { upsertedCount: 0 }; }
    patches.push({ ...filter, ...update.$setOnInsert });
    return { upsertedCount: 1 };
  });
  consumeAttempt.mockImplementation(async (key, { limit, message }) => {
    counters.set(key, (counters.get(key) ?? 0) + 1);
    if (counters.get(key) > limit) { throw new AppError(429, 'RATE_LIMITED', message); }
  });
});

describe('access', () => {
  it('needs a token', async () => {
    await request(app).get('/api/crackme/overview').expect(401);
    await request(app).get('/api/crackme/levels/e1').expect(401);
    await request(app).post('/api/crackme/levels/e1/answer').send({ answer: 'x' }).expect(401);
  });

  it('returns 404 for unknown level ids and validates bodies strictly', async () => {
    for (const id of ['z9', 'e1x', '__proto__', 'E1', 'e100']) {
      await api('get', `/levels/${id}`).expect(404);
      await api('post', `/levels/${id}/answer`, 'player', { answer: 'x' }).expect(404);
    }
    await api('post', '/levels/e1/answer', 'player', {}).expect(400);
    await api('post', '/levels/e1/answer', 'player', { answer: 'x', extra: 1 }).expect(400);
    await api('post', '/levels/e1/answer', 'player', { answer: 'x'.repeat(33) }).expect(400);
    await api('post', '/levels/e1/answer', 'player', { answer: 5 }).expect(400);
    await api('post', '/levels/e1/answer', 'player', { answer: '' }).expect(400);
    await api('post', '/levels/e1/answer', 'player', { answer: 'café' }).expect(400);
    await api('post', '/levels/e1/answer', 'player', { answer: 'tab\there' }).expect(400);
    await api('post', '/levels/e1/answer', 'player', { answer: ['a'] }).expect(400);
    expect(consumeAttempt).not.toHaveBeenCalled();
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
    await api('post', '/levels/e1/hints', 'admin', {}).expect(403);
  });

  it('returns 503 until seeded', async () => {
    docs = [];
    expect((await api('get', '/overview').expect(503)).body.error.code).toBe('CRACKME_NOT_SEEDED');
  });

  it('hides levels whose challenge row is hidden', async () => {
    docOf('e1').visible = false;
    await api('get', '/levels/e1').expect(404);
    expect((await api('get', '/overview').expect(200)).body.total).toBe(LEVELS.length - 1);
  });
});

describe('overview and cabinets', () => {
  it('lists tracks, documented maximums and a locked-by-default ladder', async () => {
    const { body } = await api('get', '/overview').expect(200);
    expect(body.maxPoints).toBe(MAX_POINTS);
    expect(body.tracks.map((t) => [t.id, t.maxPoints])).toEqual(TRACKS.map((t) => [t.id, trackMaxPoints(t.id)]));
    expect(body.tracks[0].levels.map((l) => l.status)).toEqual(['open', 'locked', 'locked', 'locked']);
    expect(body.tracks[3].levels.every((l) => l.hintsTotal === 0)).toBe(true);
    expect(body.tracks.map((t) => t.levels.filter((l) => l.boss).length)).toEqual([1, 1, 1, 1]);
  });

  it('serves the same program each time, a different one per team, and never the answer or a flag', async () => {
    const a1 = (await api('get', '/levels/e1').expect(200)).body;
    const a2 = (await api('get', '/levels/e1').expect(200)).body;
    const b = (await api('get', '/levels/e1', 'player2').expect(200)).body;
    expect(a1).toEqual(a2);
    expect(a1.program).not.toEqual(b.program);
    expect(a1).toMatchObject({ inputMax: 32, vm: { codeBase: 256 }, hints: [], status: 'open' });
    const text = JSON.stringify(a1);
    expect(text).not.toContain('CTF{');
    expect(text).not.toContain(answerOf('e1'));
    expect(a1.program).toEqual(cabinetOf('e1').program);
  });

  it('locks a level until the one before it is solved', async () => {
    expect((await api('get', '/levels/e2').expect(403)).body.error.code).toBe('LEVEL_LOCKED');
    expect((await api('post', '/levels/e2/answer', 'player', { answer: 'x' }).expect(403)).body.error.code).toBe('LEVEL_LOCKED');
    expect(consumeAttempt).not.toHaveBeenCalled();
    await solveAnswer('e1').expect(200);
    await api('get', '/levels/e2').expect(200);
    await api('get', '/levels/i1').expect(200);
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

  it('accepts the right input once: fixed points, per-team flag, no first blood, streak and next level', async () => {
    const { body } = await solveAnswer('e1').expect(200);
    expect(body).toMatchObject({
      correct: true, alreadySolved: false, pointsAwarded: levelById('e1').points, firstBlood: false,
      flag: flagOf('e1'), streak: 1, trackComplete: false, nextLevelId: 'e2',
    });
    expect(flagOf('e1', TEAM_A)).not.toBe(flagOf('e1', TEAM_B));
    expect(flagOf('e1')).toMatch(/^CTF\{crackme_e1_[0-9a-f]{12}\}$/);
    const other = await solveAnswer('e1', 'player2', TEAM_B).expect(200);
    expect(other.body.pointsAwarded).toBe(levelById('e1').points);
    expect(other.body.flag).toBe(flagOf('e1', TEAM_B));
  });

  it('does not accept a team\'s input on another team\'s cabinet', async () => {
    const { body } = await api('post', '/levels/e1/answer', 'player2', { answer: answerOf('e1', TEAM_A) }).expect(200);
    expect(body.correct).toBe(false);
  });

  it('evaluates badges once per new solve and returns them, never on a wrong or repeated answer', async () => {
    achievementService.safeEvaluate.mockResolvedValue([{ id: 'first-solve' }]);
    await api('post', '/levels/e1/answer', 'player', { answer: 'WRONG ANSWER' }).expect(200);
    expect(achievementService.safeEvaluate).not.toHaveBeenCalled();
    const { body } = await solveAnswer('e1').expect(200);
    expect(achievementService.safeEvaluate).toHaveBeenCalledWith({ userId: users.player._id, teamId: TEAM_A });
    expect(body.badges).toEqual([{ id: 'first-solve' }]);
    const again = await solveAnswer('e1').expect(200);
    expect(achievementService.safeEvaluate).toHaveBeenCalledOnce();
    expect(again.body.badges).toBeUndefined();
  });

  it('is safe against double submits and parallel bursts', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => solveAnswer('e1')));
    const bodies = results.map((r) => r.body);
    expect(bodies.filter((b) => b.pointsAwarded > 0)).toHaveLength(1);
    expect(bodies.every((b) => b.correct && b.flag === flagOf('e1'))).toBe(true);
    expect(solves).toHaveLength(1);
    expect((await solveAnswer('e1').expect(200)).body).toMatchObject({ correct: true, alreadySolved: true, pointsAwarded: 0 });
    expect(sumOf(TEAM_A)).toBe(levelById('e1').points);
  });

  it('keeps a streak of consecutive correct answers and resets it on a miss', async () => {
    await solveAnswer('e1');
    expect((await solveAnswer('e2')).body.streak).toBe(2);
    expect((await api('post', '/levels/e3/answer', 'player', { answer: 'nope' })).body.streak).toBe(0);
    expect((await solveAnswer('e3')).body.streak).toBe(1);
  });

  it('finishes a track and reports it', async () => {
    for (const id of ['e1', 'e2', 'e3']) { await solveAnswer(id); }
    expect((await solveAnswer('e4')).body).toMatchObject({ trackComplete: true, nextLevelId: null });
    const { body } = await api('get', '/overview').expect(200);
    expect(body.tracks[0]).toMatchObject({ complete: true, solved: 4, pointsEarned: trackMaxPoints('easy') });
  });

  it('a debugger decoy is never accepted by the server', async () => {
    for (const id of ['e1', 'e2', 'e3', 'e4', 'm1', 'm2', 'm3', 'm4', 'h1']) { await solveAnswer(id); }
    const { body } = await api('post', '/levels/h2/answer', 'player', { answer: 'FREEPLAY' }).expect(200);
    expect(body.correct).toBe(false);
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
    expect(counters.get(`crackme:${TEAM_A}:e1`)).toBe(ATTEMPT_LIMIT + 1);
    await api('post', '/levels/e1/answer', 'player2', { answer: 'x' }).expect(200);
  });
});

const patchOf = (id, teamId = TEAM_A) => patchSolution(cabinetOf(id, teamId).program);
const sendPatch = (id, edits, sub = 'player') => api('post', `/levels/${id}/patch`, sub, { edits });
const hiddenOf = (id, teamId = TEAM_A) => patchInputs(levelById(id), cabinetOf(id, teamId), { secret, teamId });

describe('patch bay', () => {
  it('is offered on the hard and insane cabinets only, with limits but no hidden data', async () => {
    const hard = (await api('get', '/levels/h1').expect(200)).body;
    expect(hard.patchBay).toMatchObject({ maxEdits: PATCH_MAX_EDITS, tests: 6, done: false, steps: 20000 });
    expect(hard.patchBay.rules.JNZ).toEqual(['JZ', 'POP']);
    expect((await api('get', '/levels/i1').expect(200)).body.patchBay).toBeDefined();
    expect((await api('get', '/levels/e1').expect(200)).body.patchBay).toBeUndefined();
    expect((await api('get', '/levels/m1').expect(200)).body.patchBay).toBeUndefined();
    const text = JSON.stringify(hard);
    for (const input of hiddenOf('h1')) { expect(text).not.toContain(input); }
    const overview = (await api('get', '/overview').expect(200)).body;
    expect(overview.tracks.flatMap((t) => t.levels).filter((l) => l.patchBay).map((l) => l.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'i1', 'i2', 'i3', 'i4']);
    expect(overview.patchBadges).toBe(0);
  });

  it('accepts a correct patch: cosmetic badge once, no points, no flag, no solve', async () => {
    const edits = patchOf('h1');
    const first = (await sendPatch('h1', edits).expect(200)).body;
    expect(first).toMatchObject({ valid: true, passed: 6, total: 6, serialOk: true, badge: true });
    const again = (await sendPatch('h1', edits).expect(200)).body;
    expect(again).toMatchObject({ valid: true, badge: false });
    expect(solves).toHaveLength(0);
    expect(submissions).toHaveLength(0);
    expect(JSON.stringify([first, again])).not.toContain('CTF{');
    expect(patches).toHaveLength(1);
    const level = (await api('get', '/levels/h1').expect(200)).body;
    expect(level.patchBay.done).toBe(true);
    expect(level.status).toBe('open');
    const overview = (await api('get', '/overview').expect(200)).body;
    expect(overview.patchBadges).toBe(1);
    expect(overview.pointsEarned).toBe(0);
    expect(overview.maxPoints).toBe(MAX_POINTS);
    expect((await api('get', '/levels/h1', 'player2').expect(200)).body.patchBay.done).toBe(false);
  });

  it('reports only counts: a wrong patch never reveals the hidden inputs', async () => {
    const wrong = (await sendPatch('h1', patchOf('h1').slice(1)).expect(200)).body;
    expect(wrong.valid).toBe(false);
    expect(wrong.passed).toBeLessThan(6);
    expect(Object.keys(wrong).sort()).toEqual(['badge', 'message', 'passed', 'serialOk', 'total', 'valid']);
    expect(wrong.badge).toBe(false);
    const text = JSON.stringify(wrong);
    for (const input of hiddenOf('h1')) { expect(text).not.toContain(input); }
    expect(patches).toHaveLength(0);
  });

  it('runs the patch on each team own program', async () => {
    const ok = (await sendPatch('h1', patchOf('h1', TEAM_B), 'player2').expect(200)).body;
    expect(ok.valid).toBe(true);
    expect(patches.map((p) => String(p.teamId))).toEqual([TEAM_B]);
    expect(hiddenOf('h1', TEAM_A)).not.toEqual(hiddenOf('h1', TEAM_B));
  });

  it('rejects oversized, malformed and non-whitelisted patches with 4xx before the limiter', async () => {
    const program = cabinetOf('h1').program;
    const accept = program.findIndex(([op]) => op === 'ACCEPT');
    const branch = program.findIndex(([op]) => op === 'JNZ' || op === 'JZ');
    const bodies = [
      { edits: [] },
      { edits: Array.from({ length: PATCH_MAX_EDITS + 1 }, (_, i) => ({ index: i, op: 'POP' })) },
      { edits: [{ index: branch, op: 'POP', extra: 1 }] },
      { edits: [{ index: branch }] },
      { edits: [{ index: -1, op: 'POP' }] },
      { edits: [{ index: '1', op: 'POP' }] },
      { edits: [{ index: 1.5, op: 'POP' }] },
      { edits: [{ index: branch, op: 'pop' }] },
      { edits: [{ index: branch, op: 'POP' }], extra: true },
      { edits: 'POP' },
      {},
      { edits: [{ index: accept, op: 'POP' }] },
      { edits: [{ index: branch, op: 'JMP' }] },
      { edits: [{ index: branch, op: 'ACCEPT' }] },
      { edits: [{ index: branch, op: 'POP' }, { index: branch, op: 'POP' }] },
      { edits: [{ index: 9999, op: 'POP' }] },
    ];
    for (const body of bodies) {
      const res = await api('post', '/levels/h1/patch', 'player', body).expect(400);
      expect(res.body.error.code).toBeTruthy();
    }
    expect((await sendPatch('h1', [{ index: accept, op: 'POP' }]).expect(400)).body.error.code).toBe('PATCH_NOT_ALLOWED');
    expect((await sendPatch('h1', [{ index: 9000, op: 'POP' }]).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    expect((await sendPatch('h1', [{ index: 250, op: 'POP' }]).expect(400)).body.error.code).toBe('PATCH_RANGE');
    expect(consumeAttempt).not.toHaveBeenCalled();
    expect(patches).toHaveLength(0);
  });

  it('answers 404 without a Patch Bay, 403 when locked, and admins cannot submit', async () => {
    expect((await sendPatch('e1', [{ index: 0, op: 'POP' }]).expect(404)).body.error.code).toBe('NO_PATCH_BAY');
    expect((await sendPatch('h2', patchOf('h2')).expect(403)).body.error.code).toBe('LEVEL_LOCKED');
    await sendPatch('h1', patchOf('h1'), 'admin').expect(403);
    await sendPatch('h1', patchOf('h1'), 'loner').expect(404);
    await api('post', '/levels/zz/patch', 'player', { edits: [{ index: 0, op: 'POP' }] }).expect(404);
    await request(app).post('/api/crackme/levels/h1/patch').send({ edits: [{ index: 0, op: 'POP' }] }).expect(401);
    expect(patches).toHaveLength(0);
    teams[TEAM_A].banned = true;
    expect((await sendPatch('h1', patchOf('h1')).expect(403)).body.error.code).toBe('TEAM_BANNED');
  });

  it('is rate limited per team and level through the shared limiter', async () => {
    const partial = patchOf('h1').slice(1);
    for (let i = 0; i < PATCH_ATTEMPT_LIMIT; i += 1) { await sendPatch('h1', partial).expect(200); }
    expect((await sendPatch('h1', patchOf('h1')).expect(429)).body.error.code).toBe('RATE_LIMITED');
    expect(counters.get(`crackme-patch:${TEAM_A}:h1`)).toBe(PATCH_ATTEMPT_LIMIT + 1);
    expect(counters.get(`crackme:${TEAM_A}:h1`)).toBeUndefined();
    expect(patches).toHaveLength(0);
    await sendPatch('h1', patchOf('h1', TEAM_B), 'player2').expect(200);
  });

  it('does not change the solve path or the documented totals', async () => {
    await sendPatch('h1', patchOf('h1')).expect(200);
    await solveAnswer('h1').expect(200);
    expect(sumOf(TEAM_A)).toBe(levelById('h1').points);
  });
});

describe('hints', () => {
  it('reveals hints one at a time, for free, and logs them for admins', async () => {
    const total = levelById('e1').hints.length;
    const first = (await api('post', '/levels/e1/hints', 'player', {}).expect(200)).body;
    expect(first).toMatchObject({ index: 0, used: 1, total });
    expect(first.hint).toMatch(/\w/);
    for (let i = 1; i < total; i += 1) { await api('post', '/levels/e1/hints', 'player', {}).expect(200); }
    expect((await api('post', '/levels/e1/hints', 'player', {}).expect(409)).body.error.code).toBe('NO_MORE_HINTS');
    const view = (await api('get', '/levels/e1').expect(200)).body;
    expect(view.hints).toHaveLength(total);
    expect(JSON.stringify(view.hints)).not.toContain(answerOf('e1'));
    expect((await solveAnswer('e1')).body.pointsAwarded).toBe(levelById('e1').points);
    const log = (await api('get', '/admin/hints', 'admin').expect(200)).body;
    expect(log).toHaveLength(total);
    expect(log[0]).toMatchObject({ teamId: TEAM_A, levelId: 'e1' });
    await api('get', '/admin/hints', 'player').expect(403);
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
  });

  it('ignores an edited points value on the challenge row, and the type has no first-blood bonus', async () => {
    docOf('e1').points = 99999;
    expect((await solveAnswer('e1')).body.pointsAwarded).toBe(levelById('e1').points);
    expect(hasFirstBloodBonus({ type: 'reversing' })).toBe(false);
  });
});

describe('flags', () => {
  it('reversing challenges use per-team dynamic flags in verifyFlag, nothing is stored', () => {
    const doc = docOf('e1');
    const own = expectedFlagFor(doc, { secret, teamId: TEAM_A });
    expect(verifyFlag(doc, { secret, teamId: TEAM_A, submitted: ` ${own} ` })).toBe(true);
    expect(verifyFlag(doc, { secret, teamId: TEAM_B, submitted: own })).toBe(false);
    expect(verifyFlag(doc, { secret, teamId: TEAM_A, submitted: 'CTF{guess}' })).toBe(false);
    expect(doc.flagHash).toBeUndefined();
  });
});

describe('no secret leakage', () => {
  it('no response other than a correct answer contains a flag, answer or flag hash', async () => {
    const seen = [];
    seen.push((await api('get', '/overview')).text);
    for (const id of ORDER) {
      seen.push((await api('get', `/levels/${id}`)).text);
      seen.push((await api('post', `/levels/${id}/answer`, 'player', { answer: 'nope' })).text);
      await solveAnswer(id);
    }
    seen.push((await api('get', '/overview')).text);
    const all = seen.join('\n');
    expect(all).not.toContain('CTF{');
    expect(all).not.toContain('flagHash');
    for (const id of ORDER) {
      expect(all, id).not.toContain(`"${answerOf(id)}"`);
      expect(all, id).not.toContain(flagOf(id));
    }
  });
});
