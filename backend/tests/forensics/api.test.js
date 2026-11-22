import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import AttemptCounter from '../../src/models/AttemptCounter.js';
import Challenge from '../../src/models/Challenge.js';
import HintOpen from '../../src/models/HintOpen.js';
import Solve from '../../src/models/Solve.js';
import Submission from '../../src/models/Submission.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { forensicsDefinitions } from '../../src/scripts/seedForensics.js';
import { achievementService } from '../../src/services/achievementService.js';
import { expectedFlagFor } from '../../src/services/flagService.js';
import { integrityService } from '../../src/services/integrityService.js';
import { hasFirstBloodBonus } from '../../src/services/scoringService.js';
import { FORENSICS_MAX_POINTS, TRACKS, TRACK_IDS, answerOf, makeContext, suspectsFor } from '../../src/forensics/tracks.js';
import { installHintOpen } from '../helpers/hintOpenStore.js';
import { NO_STATEMENTS, interviewAnswer, interviewQuestions, lieStagesFor } from '../../src/forensics/interviews.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({ default: { find: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn(), create: vi.fn(), aggregate: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../../src/models/Submission.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../../src/models/HintOpen.js', () => ({ default: { updateOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/AttemptCounter.js', () => ({ default: { findOneAndUpdate: vi.fn(), create: vi.fn() } }));
vi.mock('../../src/services/integrityService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, integrityService: { ...actual.integrityService, checkSubmittedFlag: vi.fn() } };
});

const oid = (n) => String(n).padStart(24, '0');
const TEAM_A = oid(2);
const TEAM_B = oid(4);
const users = { player: { _id: oid(1), teamId: TEAM_A }, player2: { _id: oid(3), teamId: TEAM_B }, admin: { _id: oid(9), teamId: null } };
let rows;
let solves;
let counters;
let seeded;
let opens;

const api = (method, path, sub = 'player', body) => {
  const call = request(app)[method](`/api/forensics${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};
const answer = (track, n, text, sub = 'player') => api('post', `/tracks/${track}/stages/${n}/answer`, sub, { answer: text });
const truth = (track, n, teamId = TEAM_A) => answerOf(makeContext(track, env.FLAG_SECRET, teamId), n);
const rowOf = (track, n) => rows.find((r) => r.forensics.track === track && r.forensics.stage === n);
const scoreOf = (teamId) => solves.filter((s) => s.teamId === teamId).reduce((t, s) => t + s.points, 0);

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  seeded = true;
  rows = forensicsDefinitions().map((d, i) => ({ ...d, _id: oid(5000 + i), visible: true, solveCount: 0 }));
  solves = [];
  counters = new Map();
  opens = installHintOpen(HintOpen);
  User.findOne.mockImplementation(async ({ cognitoSub }) => users[cognitoSub] ?? null);
  Team.findById.mockImplementation(async (id) => ({ _id: String(id), name: 'T', banned: false }));
  Challenge.find.mockImplementation((filter) => ({
    lean: async () => (seeded ? rows.filter((r) => r.type === filter.type && r.visible === filter.visible
      && (filter['forensics.track'] === undefined || r.forensics.track === filter['forensics.track'])) : []),
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
});

const solveAllExceptWhodunit = async (track, sub = 'player', teamId = TEAM_A) => {
  for (const n of [1, 2, 3, 4]) {
    await answer(track, n, truth(track, n, teamId), sub).expect(200);
  }
};

describe('access', () => {
  it('needs a token, a known case and a player for answers', async () => {
    await request(app).get('/api/forensics/tracks').expect(401);
    await request(app).post('/api/forensics/tracks/easy/stages/1/answer').send({ answer: 'x' }).expect(401);
    for (const bad of ['nightmare', '__proto__', 'EASY']) {
      expect((await api('get', `/tracks/${bad}`).expect(404)).body.error.code).toBe('NOT_FOUND');
      await api('get', `/tracks/${bad}/artefacts/log`).expect(404);
      await answer(bad, 1, 'x').expect(404);
    }
    expect((await answer('easy', 1, 'x', 'admin').expect(403)).body.error.code).toBe('FORBIDDEN');
    await api('get', '/tracks', 'admin').expect(200);
    await api('get', '/tracks/hard', 'admin').expect(200);
    await api('get', '/tracks/hard/artefacts/exif', 'admin').expect(200);
  });

  it('validates stage numbers and bodies', async () => {
    await answer('easy', 'abc', 'x').expect(400);
    await api('post', '/tracks/easy/stages/1/answer', 'player', { answer: '' }).expect(400);
    await api('post', '/tracks/easy/stages/1/answer', 'player', { answer: 'x', extra: 1 }).expect(400);
    await api('post', '/tracks/easy/stages/1/answer', 'player', { answer: 'x'.repeat(201) }).expect(400);
    expect((await answer('easy', 9, 'x').expect(404)).body.error.code).toBe('NOT_FOUND');
  });

  it('says so when the game has not been seeded', async () => {
    seeded = false;
    expect((await api('get', '/tracks/easy').expect(503)).body.error.code).toBe('FORENSICS_NOT_SEEDED');
    expect((await answer('easy', 1, 'x').expect(503)).body.error.code).toBe('FORENSICS_NOT_SEEDED');
    expect((await api('get', '/tracks/easy/artefacts/log').expect(503)).body.error.code).toBe('FORENSICS_NOT_SEEDED');
    const { body } = await api('get', '/tracks').expect(200);
    expect(body.every((t) => t.seeded === false)).toBe(true);
  });
});

describe('listing and artefacts', () => {
  it('lists four tracks with documented maximum points', async () => {
    const { body } = await api('get', '/tracks').expect(200);
    expect(body.map((t) => t.id)).toEqual(TRACK_IDS);
    expect(body.map((t) => t.maxPoints)).toEqual([160, 350, 600, 1200]);
    expect(body.reduce((total, t) => total + t.maxPoints, 0)).toBe(FORENSICS_MAX_POINTS);
  });

  it('serves bounded, validated artefact pages', async () => {
    const page = await api('get', '/tracks/easy/artefacts/log?offset=1000&limit=500').expect(200);
    expect(page.body.lines).toHaveLength(500);
    expect(page.text.length).toBeLessThan(110_000);
    expect((await api('get', '/tracks/easy/artefacts/log?limit=501').expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    await api('get', '/tracks/easy/artefacts/log?offset=-1').expect(400);
    await api('get', '/tracks/easy/artefacts/log?foo=1').expect(400);
    await api('get', '/tracks/easy/artefacts/capture').expect(404);
    await api('get', '/tracks/easy/artefacts/__proto__').expect(404);
    await api('get', '/tracks/hard/artefacts/disk?cluster=300').expect(400);
    const clusters = await api('get', '/tracks/hard/artefacts/disk?cluster=10&count=4').expect(200);
    expect(clusters.body.clusters).toHaveLength(4);
  });

  it('serves each team its own data', async () => {
    const a = await api('get', '/tracks/easy/artefacts/log?limit=20', 'player').expect(200);
    const b = await api('get', '/tracks/easy/artefacts/log?limit=20', 'player2').expect(200);
    expect(a.body.lines).not.toEqual(b.body.lines);
  });
});

describe('no answer leakage', () => {
  it('shows no answer, flag or suspect fact before a stage is solved', async () => {
    const { body, text } = await api('get', '/tracks/easy').expect(200);
    for (const n of [1, 2, 3, 4]) { expect(text).not.toContain(truth('easy', n)); }
    expect(text).not.toMatch(/CTF\{/);
    expect(body.evidence).toEqual([]);
    expect(body.stages[4]).toMatchObject({ whodunit: true, locked: true, solved: false });
    expect(body.suspects.flatMap((s) => s.facts).every((f) => f.value === null)).toBe(true);
    expect(body.stages.some((s) => 'flag' in s)).toBe(false);
    // The hint text is withheld until the team opens it (hint costs); the stage only says that a hint exists.
    expect(body.stages.slice(0, 4).every((s) => s.hint === null && s.hasHint)).toBe(true);
    expect(body.stages.some((s) => s.hint)).toBe(false);
    expect((await api('get', '/tracks/insane').expect(200)).body.stages.some((s) => s.hint || s.hasHint)).toBe(false);
  });

  it('reveals only what the team earned, and wrong answers reveal nothing', async () => {
    const wrong = await answer('easy', 1, '1.2.3.4').expect(200);
    expect(wrong.body).toMatchObject({ correct: false, pointsAwarded: 0, firstBlood: false });
    expect(JSON.stringify(wrong.body)).not.toContain(truth('easy', 1));
    expect(wrong.body.flag).toBeUndefined();
    // A wrong answer may be a pasted decoy flag: the fair-play lookup runs, and only on wrong answers.
    expect(integrityService.checkSubmittedFlag).toHaveBeenCalledOnce();
    expect(integrityService.checkSubmittedFlag).toHaveBeenCalledWith({ flag: '1.2.3.4', user: expect.objectContaining({ _id: oid(1) }) });
    expect(Submission.create.mock.calls[0][0].submittedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(Submission.create.mock.calls[0][0])).not.toContain('1.2.3.4');
    const right = await answer('easy', 2, truth('easy', 2)).expect(200);
    expect(right.body.flag).toBe(expectedFlagFor(rowOf('easy', 2), { secret: env.FLAG_SECRET, teamId: TEAM_A }));
    const { body, text } = await api('get', '/tracks/easy').expect(200);
    expect(body.evidence).toEqual([{ n: 2, title: 'First victim', value: truth('easy', 2) }]);
    expect(text).not.toContain(truth('easy', 1));
    expect(text).not.toContain(truth('easy', 4));
    expect(body.stages[1].flag).toBe(right.body.flag);
    expect(body.suspects.flatMap((s) => s.facts).filter((f) => f.value !== null).every((f) => f.stage === 2)).toBe(true);
    // Another team's view never contains this team's flag or answer.
    const other = await api('get', '/tracks/easy', 'player2').expect(200);
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
  it('awards the fixed stage points with no first-blood bonus, even for the very first team', async () => {
    expect(hasFirstBloodBonus({ type: 'forensics' })).toBe(false);
    expect(hasFirstBloodBonus({ type: 'docker' })).toBe(true);
    const { body } = await answer('hard', 1, truth('hard', 1)).expect(200);
    expect(body).toMatchObject({ correct: true, pointsAwarded: 80, firstBlood: false, solved: 1, total: 5 });
    expect(rowOf('hard', 1).solveCount).toBe(1);
    expect(solves[0]).toMatchObject({ points: 80, firstBlood: false });
    expect(Solve.updateOne).not.toHaveBeenCalled();
  });

  it('evaluates achievements after a new solve only, and reports new badges', async () => {
    const spy = vi.spyOn(achievementService, 'safeEvaluate').mockResolvedValue([{ key: 'fake', name: 'Fake' }]);
    try {
      const first = await answer('hard', 1, truth('hard', 1)).expect(200);
      expect(spy).toHaveBeenCalledWith({ userId: expect.anything(), teamId: TEAM_A });
      expect(first.body.badges).toEqual([{ key: 'fake', name: 'Fake' }]);
      spy.mockClear();
      await answer('hard', 1, truth('hard', 1)).expect(200);
      await answer('hard', 2, 'definitely-wrong').expect(200);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('ignores a stored points value that is higher than the definition', async () => {
    rowOf('hard', 1).points = 99999;
    expect((await answer('hard', 1, truth('hard', 1)).expect(200)).body.pointsAwarded).toBe(80);
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
    const ip = truth('easy', 1);
    expect((await answer('easy', 1, `  ${ip.toUpperCase()} `).expect(200)).body.correct).toBe(true);
    expect((await answer('medium', 3, `${truth('medium', 3)} seconds`).expect(200)).body.correct).toBe(true);
    expect((await answer('easy', 3, `${truth('easy', 3)}`).expect(200)).body.correct).toBe(true);
    expect((await answer('easy', 4, `${truth('easy', 4)}x`).expect(200)).body.correct).toBe(false);
  });

  it.each(TRACK_IDS)('locks the whodunit of %s until the evidence is in, then closes the case', async (track) => {
    const locked = await answer(track, 5, 'anyone').expect(403);
    expect(locked.body.error.code).toBe('STAGE_LOCKED');
    expect(Submission.create).not.toHaveBeenCalled();
    await solveAllExceptWhodunit(track);
    const view = (await api('get', `/tracks/${track}`).expect(200)).body;
    expect(view.stages[4].locked).toBe(false);
    const culprit = view.suspects.find((s) => s.name === truth(track, 5));
    expect(culprit.facts.every((f) => f.value !== null)).toBe(true);
    const wrong = view.suspects.find((s) => s !== culprit);
    expect((await answer(track, 5, wrong.name).expect(200)).body.correct).toBe(false);
    const done = await answer(track, 5, culprit.name).expect(200);
    expect(done.body).toMatchObject({ correct: true, caseClosed: true, firstBlood: false });
    expect(scoreOf(TEAM_A)).toBe(TRACKS[track].maxPoints);
    expect((await api('get', `/tracks/${track}`).expect(200)).body.caseClosed).toBe(true);
  });

  it('never lets a team exceed the documented maximum, however often it replays', async () => {
    for (const track of TRACK_IDS) {
      await solveAllExceptWhodunit(track);
      await answer(track, 5, truth(track, 5)).expect(200);
    }
    expect(scoreOf(TEAM_A)).toBe(FORENSICS_MAX_POINTS);
    for (const track of TRACK_IDS) {
      for (const n of [1, 2, 3, 4, 5]) {
        expect((await answer(track, n, truth(track, n)).expect(200)).body.pointsAwarded).toBe(0);
      }
    }
    // A second team playing the same game also lands exactly on the maximum (no first-blood difference).
    for (const track of TRACK_IDS) {
      await solveAllExceptWhodunit(track, 'player2', TEAM_B);
      await answer(track, 5, truth(track, 5, TEAM_B), 'player2').expect(200);
    }
    expect(scoreOf(TEAM_B)).toBe(FORENSICS_MAX_POINTS);
    expect(scoreOf(TEAM_A)).toBe(FORENSICS_MAX_POINTS);
    expect(solves.every((s) => s.firstBlood === false)).toBe(true);
  });
});

describe('attempt rate limit', () => {
  it('stops guessing after 8 tries a minute per stage, without telling anything about correctness', async () => {
    for (let i = 0; i < 8; i += 1) { await answer('easy', 1, `guess-${i}`).expect(200); }
    const limited = await answer('easy', 1, truth('easy', 1)).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(JSON.stringify(limited.body)).not.toContain(truth('easy', 1));
    expect(solves).toHaveLength(0);
    // Another stage has its own budget.
    expect((await answer('easy', 2, truth('easy', 2)).expect(200)).body.correct).toBe(true);
    // Another team is not affected.
    expect((await answer('easy', 1, truth('easy', 1, TEAM_B), 'player2').expect(200)).body.correct).toBe(true);
  });

  it('is much stricter for the whodunit', async () => {
    await solveAllExceptWhodunit('easy');
    for (let i = 0; i < 3; i += 1) { await answer('easy', 5, `nobody-${i}`).expect(200); }
    expect((await answer('easy', 5, 'nobody-3').expect(429)).body.error.code).toBe('RATE_LIMITED');
  });

  it('keeps counters in MongoDB only (no process state)', async () => {
    await answer('easy', 1, 'a').expect(200);
    expect([...counters.keys()].every((key) => key.startsWith('forensics:'))).toBe(true);
    expect(counters.size).toBe(2);
  });
});

describe('suspect interviews', () => {
  const ask = (track, body, sub = 'player') => api('post', `/tracks/${track}/interviews`, sub, body);
  const suspectsOf = (track, teamId = TEAM_A) => suspectsFor(makeContext(track, env.FLAG_SECRET, teamId));

  it('offers no question before a stage is solved, and one per solved stage after', async () => {
    expect((await api('get', '/tracks/easy/interviews').expect(200)).body.questions).toEqual([]);
    expect((await ask('easy', { suspectId: 's1', questionId: 'q1' }).expect(404)).body.error.code).toBe('NOT_FOUND');
    await answer('easy', 1, truth('easy', 1)).expect(200);
    const view = (await api('get', '/tracks/easy/interviews').expect(200)).body;
    expect(view.questions.map((q) => q.stage)).toEqual([1]);
    expect(view.suspects).toHaveLength(8);
    // Stage 2 is still unsolved: its question stays closed.
    await ask('easy', { suspectId: 's1', questionId: 'q2' }).expect(404);
  });

  it('answers never contain an unsolved-stage fact, a flag or a hash', async () => {
    await answer('easy', 1, truth('easy', 1)).expect(200);
    const hidden = [2, 3, 4].map((n) => truth('easy', n));
    const { suspects } = suspectsOf('easy');
    for (const s of suspects) {
      const body = JSON.stringify((await ask('easy', { suspectId: s.id, questionId: 'q1' }).expect(200)).body);
      for (const value of [...hidden, ...s.facts.filter((f) => f.stage !== 1).map((f) => f.value)]) { expect(body).not.toContain(value); }
      expect(body).not.toMatch(/CTF\{|[0-9a-f]{32}/);
    }
  });

  // Replaces the old rule test ("the culprit is the only one who contradicts the board"): that rule no longer holds, decoys
  // now tell one lie each. The new rule: false denials (answer no while the board fact equals the evidence).
  const falseDenials = (ctx, solved) => {
    const { suspects } = suspectsFor(ctx);
    const questions = interviewQuestions(ctx, solved);
    return suspects.map((s) => ({
      id: s.id,
      count: questions.filter((q) => interviewAnswer(ctx, solved, s.id, q.id).answer === 'no'
        && s.facts.find((f) => f.stage === q.stage).value === answerOf(ctx, q.stage)).length,
    }));
  };

  it('the culprit is the unique suspect with two or more false denials once two stages are solved (500 seeds per track)', () => {
    for (const track of TRACK_IDS) {
      for (let i = 0; i < 500; i += 1) {
        const ctx = makeContext(track, env.FLAG_SECRET, `deduce-${i}`);
        const { culprit } = suspectsFor(ctx);
        const stages = ctx.track.clues.map((c) => c[1]);
        const subsets = [[stages[0], stages[1]], [stages[1], stages[3]], [stages[0], stages[2], stages[3]], stages];
        for (const sub of subsets) {
          const counts = falseDenials(ctx, new Set(sub));
          expect(counts.filter((c) => c.count >= 2).map((c) => c.id)).toEqual([culprit.id]);
          const max = Math.max(...counts.map((c) => c.count));
          expect(counts.filter((c) => c.count === max).map((c) => c.id)).toEqual([culprit.id]);
          expect(counts.filter((c) => c.id !== culprit.id).every((c) => c.count <= 1)).toBe(true);
        }
      }
    }
  }, 120000);

  it('every decoy tells at most one lie, only on a clue it matches; the culprit and non-matching suspects add none', () => {
    for (const track of TRACK_IDS) {
      for (let i = 0; i < 200; i += 1) {
        const ctx = makeContext(track, env.FLAG_SECRET, `lies-${i}`);
        const { suspects, culprit } = suspectsFor(ctx);
        const lies = lieStagesFor(ctx);
        const all = new Set(ctx.track.clues.map((c) => c[1]));
        for (const s of suspects) {
          const matching = s.facts.filter((f) => f.value === answerOf(ctx, f.stage)).map((f) => f.stage);
          if (s.id === culprit.id || matching.length === 0) { expect(lies.has(s.id)).toBe(false); continue; }
          expect(matching).toContain(lies.get(s.id));
          const denials = [...all].filter((n) => interviewAnswer(ctx, all, s.id, `q${n}`)?.answer === 'no' && matching.includes(n));
          expect(denials.length).toBeLessThanOrEqual(1);
        }
      }
    }
  }, 120000);

  it('keeps the puzzle data untouched: answers, culprit and suspect board do not depend on interviews', () => {
    for (const track of TRACK_IDS) {
      const ctx = makeContext(track, env.FLAG_SECRET, TEAM_A);
      const before = JSON.stringify([ctx.track.stages.map((s) => answerOf(ctx, s.n)), suspectsFor(ctx)]);
      lieStagesFor(ctx);
      interviewAnswer(ctx, new Set([1, 2, 3]), 's1', 'q1');
      expect(JSON.stringify([ctx.track.stages.map((s) => answerOf(ctx, s.n)), suspectsFor(ctx)])).toBe(before);
    }
  });

  it('uses one statement pool for a "no", whether it is true or false', () => {
    const seen = new Set();
    for (const track of TRACK_IDS) {
      for (let i = 0; i < 40; i += 1) {
        const ctx = makeContext(track, env.FLAG_SECRET, `pool-${i}`);
        const solved = new Set([1, 2, 3]);
        const { suspects } = suspectsFor(ctx);
        for (const s of suspects) {
          for (const q of interviewQuestions(ctx, solved)) {
            const reply = interviewAnswer(ctx, solved, s.id, q.id);
            if (reply.answer !== 'no') { continue; }
            expect(NO_STATEMENTS).toContain(reply.statement);
            const falseNo = s.facts.find((f) => f.stage === q.stage).value === answerOf(ctx, q.stage);
            seen.add(`${falseNo}:${reply.statement}`);
          }
        }
      }
    }
    for (const statement of NO_STATEMENTS) {
      expect(seen.has(`true:${statement}`)).toBe(true);
      expect(seen.has(`false:${statement}`)).toBe(true);
    }
  }, 60000);

  it('is deterministic per team and differs between teams', () => {
    const run = (teamId) => {
      const ctx = makeContext('hard', env.FLAG_SECRET, teamId);
      return JSON.stringify(suspectsFor(ctx).suspects.map((s) => [1, 2, 3].map((n) => interviewAnswer(ctx, new Set([1, 2, 3]), s.id, `q${n}`))));
    };
    expect(run(TEAM_A)).toBe(run(TEAM_A));
    const ctxA = makeContext('hard', env.FLAG_SECRET, TEAM_A);
    const ctxB = makeContext('hard', env.FLAG_SECRET, TEAM_B);
    expect(interviewQuestions(ctxA, new Set([1])).map((q) => q.text)).not.toEqual(interviewQuestions(ctxB, new Set([1])).map((q) => q.text));
  });

  it('validates the body strictly and rate limits per team in MongoDB', async () => {
    await answer('easy', 1, truth('easy', 1)).expect(200);
    for (const bad of [{}, { suspectId: 's1' }, { suspectId: 's1', questionId: 'q1', extra: 1 }, { suspectId: '../x', questionId: 'q1' }, { suspectId: 's1', questionId: 5 }]) {
      expect((await ask('easy', bad).expect(400)).body.error.code).toBeDefined();
    }
    for (let i = 0; i < 20; i += 1) { await ask('easy', { suspectId: 's1', questionId: 'q1' }).expect(200); }
    expect((await ask('easy', { suspectId: 's1', questionId: 'q1' }).expect(429)).body.error.code).toBe('RATE_LIMITED');
    expect([...counters.keys()].filter((k) => k.includes(':interview:')).length).toBe(2);
    // The answer budget of a stage is separate.
    expect((await answer('easy', 2, 'wrong').expect(200)).body.correct).toBe(false);
  });

  it('lets admins read the preview world without a team, a score or a rate limit', async () => {
    const view = (await api('get', '/tracks/medium/interviews', 'admin').expect(200)).body;
    expect(view.questions.map((q) => q.stage)).toEqual([1, 2, 3, 4].slice(0, 3));
    for (let i = 0; i < 25; i += 1) { await ask('medium', { suspectId: 's2', questionId: 'q1' }, 'admin').expect(200); }
    expect(counters.size).toBe(0);
    expect(solves).toHaveLength(0);
  });

  it('needs a token and a known case', async () => {
    await request(app).get('/api/forensics/tracks/easy/interviews').expect(401);
    await api('get', '/tracks/nightmare/interviews').expect(404);
    await ask('nightmare', { suspectId: 's1', questionId: 'q1' }).expect(404);
  });
});

describe('hint costs', () => {
  const hintPath = (track, n) => `/tracks/${track}/stages/${n}/hint`;
  const openHint = (track, n, sub = 'player', body = {}) => api('post', hintPath(track, n), sub, body);

  it('withholds the text, prices it, and reveals it only after the team opened it (idempotent, recorded once)', async () => {
    const before = (await api('get', '/tracks/easy').expect(200)).body.stages[0];
    expect(before).toMatchObject({ hint: null, hasHint: true, hintOpened: false, hintSpent: { points: 0, percent: 0, cap: 8 } });
    expect(before.hintPricing).toEqual([{ index: 0, tier: 'nudge', percent: 5, points: 1 }]);
    const first = (await openHint('easy', 1).expect(200)).body;
    expect(first).toMatchObject({ index: 0, used: 1, total: 1, cost: { percent: 5, points: 1, tier: 'nudge' }, spent: { points: 1, percent: 5, cap: 8 } });
    expect(first.hint).toBe(TRACKS.easy.stages[0].hint);
    expect((await openHint('easy', 1).expect(200)).body.hint).toBe(first.hint);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ scope: 'forensics', key: 'easy:1', index: 0 });
    const after = (await api('get', '/tracks/easy').expect(200)).body.stages;
    expect(after[0]).toMatchObject({ hint: first.hint, hintOpened: true, hintPricing: [], hintSpent: { points: 1 } });
    expect(after[1].hint).toBeNull();
    // Another team sees nothing opened.
    expect((await api('get', '/tracks/easy', 'player2').expect(200)).body.stages[0].hint).toBeNull();
  });

  it('deducts the opened hint when the stage is solved, only for that stage', async () => {
    await openHint('easy', 1).expect(200);
    const solved = (await answer('easy', 1, truth('easy', 1)).expect(200)).body;
    expect(solved.pointsAwarded).toBe(19);
    expect(solved.hintCost).toEqual({ spent: 1, openedCount: 1, base: 20, awarded: 19 });
    const clean = (await answer('easy', 2, truth('easy', 2)).expect(200)).body;
    expect(clean.pointsAwarded).toBe(20);
    expect(clean.hintCost).toBeUndefined();
    expect(scoreOf(TEAM_A)).toBe(39);
  });

  it('charges nothing for a hint opened after the solve', async () => {
    await answer('easy', 1, truth('easy', 1)).expect(200);
    await openHint('easy', 1).expect(200);
    expect(scoreOf(TEAM_A)).toBe(20);
  });

  it('refuses stages without a hint, unknown stages and bad bodies', async () => {
    expect((await openHint('easy', 5).expect(403)).body.error.code).toBe('NO_HINTS');
    expect((await openHint('hard', 1).expect(403)).body.error.code).toBe('NO_HINTS');
    expect((await openHint('insane', 2).expect(403)).body.error.code).toBe('NO_HINTS');
    expect((await openHint('easy', 9).expect(404)).body.error.code).toBe('NOT_FOUND');
    expect((await openHint('nightmare', 1).expect(404)).body.error.code).toBe('NOT_FOUND');
    await openHint('easy', 1, 'player', { extra: 1 }).expect(400);
    await request(app).post(`/api/forensics${hintPath('easy', 1)}`).send({}).expect(401);
    expect(opens).toHaveLength(0);
  });

  it('keeps the admin preview free: text visible, no pricing, nothing recorded', async () => {
    const stage = (await api('get', '/tracks/easy', 'admin').expect(200)).body.stages[0];
    expect(stage.hint).toBe(TRACKS.easy.stages[0].hint);
    expect(stage.hintPricing).toBeUndefined();
    expect(stage.hintSpent).toBeUndefined();
    const opened = (await openHint('easy', 1, 'admin').expect(200)).body;
    expect(opened).toEqual({ index: 0, hint: TRACKS.easy.stages[0].hint, used: 1, total: 1 });
    expect(opens).toHaveLength(0);
  });

  it('uses the same team guards as other hint opens: a banned team cannot open, nothing is recorded', async () => {
    Team.findById.mockImplementation(async (id) => ({ _id: String(id), name: 'T', banned: true }));
    expect((await openHint('easy', 1).expect(403)).body.error.code).toBe('TEAM_BANNED');
    expect(opens).toHaveLength(0);
  });

  it('never leaks the hint or an answer before opening', async () => {
    const { text } = await api('get', '/tracks/medium').expect(200);
    for (const stage of TRACKS.medium.stages.filter((s) => s.hint)) { expect(text).not.toContain(stage.hint); }
  });
});
