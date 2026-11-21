// Regression: a friend finished Arena Terminal "easy" with 176 of 160 points. Cause: recordSolve gave the 10%
// first-blood bonus to terminal solves (4 x (40 + 4) = 176). Terminal points are now capped at the listed values.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Challenge from '../../src/models/Challenge.js';
import Solve from '../../src/models/Solve.js';
import { recordSolve } from '../../src/services/scoringService.js';
import { progressView, repairTerminalSolves, summarizeMode } from '../../src/services/terminalService.js';
import { MODES } from '../../src/terminal/modes/index.js';

const store = vi.hoisted(() => ({ solves: [], counts: new Map() }));
vi.mock('../../src/models/Challenge.js', () => ({
  default: {
    findOneAndUpdate: vi.fn(async ({ _id }) => {
      // Mongo applies $inc atomically: each caller observes a distinct count.
      const next = (store.counts.get(String(_id)) ?? 0) + 1;
      store.counts.set(String(_id), next);
      return { solveCount: next };
    }),
    find: vi.fn(),
  },
}));
vi.mock('../../src/models/Solve.js', () => ({
  default: {
    create: vi.fn(async (doc) => {
      await Promise.resolve();
      if (store.solves.some((s) => s.teamId === doc.teamId && s.challengeId === doc.challengeId)) {
        throw Object.assign(new Error('dup'), { code: 11000 });
      }
      store.solves.push({ ...doc });
    }),
    updateOne: vi.fn(async (filter, { $set }) => {
      Object.assign(store.solves.find((s) => s.teamId === filter.teamId && s.challengeId === filter.challengeId), $set);
    }),
    updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
    aggregate: vi.fn(async () => [{ score: store.solves.reduce((t, s) => t + s.points, 0) }]),
  },
}));

const challengesFor = (definition) => definition.codes.map((code) => ({
  _id: `${definition.mode}-${code.n}`, type: 'terminal', points: code.points, terminal: { mode: definition.mode, code: code.n },
}));
const maxOf = (definition) => definition.codes.reduce((t, c) => t + c.points, 0);
const teamTotal = (teamId) => store.solves.filter((s) => s.teamId === teamId).reduce((t, s) => t + s.points, 0);

beforeEach(() => { store.solves.length = 0; store.counts.clear(); });

describe('terminal scoring cap', () => {
  it('easy is worth 160 and a first-blood team still scores exactly 160', async () => {
    const challenges = challengesFor(MODES.easy);
    expect(maxOf(MODES.easy)).toBe(160);
    let total = 0;
    for (const challenge of challenges) {
      const solve = await recordSolve({ challenge, teamId: 'alpha', userId: 'u1' });
      expect(solve.firstBlood).toBe(false);
      total += solve.points;
    }
    expect(total).toBe(160);
    expect(store.solves.every((s) => s.firstBlood === false)).toBe(true);
  });

  it.each(Object.keys(MODES))('mode %s can never exceed its documented maximum, whoever is first', async (mode) => {
    const challenges = challengesFor(MODES[mode]);
    for (const teamId of ['alpha', 'beta']) {
      for (const challenge of challenges) { await recordSolve({ challenge, teamId, userId: 'u' }); }
    }
    expect(teamTotal('alpha')).toBe(maxOf(MODES[mode]));
    expect(teamTotal('beta')).toBe(maxOf(MODES[mode]));
  });

  it('parallel double submits of one code count once and award the same points', async () => {
    const [challenge] = challengesFor(MODES.easy);
    const results = await Promise.all(Array.from({ length: 8 }, () => recordSolve({ challenge, teamId: 'alpha', userId: 'u1' })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(store.solves).toHaveLength(1);
    expect(store.solves[0].points).toBe(challenge.points);
    expect(store.counts.get(String(challenge._id))).toBe(1);
  });

  it('parallel submits of every code across teams stay at the maximum per team', async () => {
    const challenges = challengesFor(MODES.easy);
    await Promise.all(['a', 'b', 'c'].flatMap((teamId) => challenges.flatMap((challenge) => [
      recordSolve({ challenge, teamId, userId: teamId }), recordSolve({ challenge, teamId, userId: teamId }),
    ])));
    for (const teamId of ['a', 'b', 'c']) { expect(teamTotal(teamId)).toBe(160); }
  });

  it('regular challenges keep the first-blood bonus', async () => {
    const challenge = { _id: 'web1', type: 'static', points: 100 };
    expect(await recordSolve({ challenge, teamId: 'alpha', userId: 'u' })).toMatchObject({ points: 110, firstBlood: true });
  });

  it('the mode views never report more than the listed points, even for old inflated rows', () => {
    const challenges = challengesFor(MODES.easy);
    const solves = challenges.map((c) => ({ challengeId: c._id, points: c.points + 4, firstBlood: true }));
    expect(summarizeMode(MODES.easy, challenges, solves)).toMatchObject({ points: 160, pointsEarned: 160 });
    const view = progressView(MODES.easy, challenges, solves);
    expect(view.solved.reduce((t, s) => t + s.points, 0)).toBe(160);
    expect(view.solved.some((s) => s.firstBlood)).toBe(false);
  });

  it('repairTerminalSolves resets inflated rows per challenge', async () => {
    Challenge.find.mockReturnValue({ lean: async () => [{ _id: 'c1', points: 40 }] });
    Solve.updateMany.mockResolvedValue({ modifiedCount: 3 });
    expect(await repairTerminalSolves()).toBe(3);
    expect(Solve.updateMany).toHaveBeenCalledWith(
      { challengeId: 'c1', $or: [{ points: { $ne: 40 } }, { firstBlood: true }] },
      { $set: { points: 40, firstBlood: false } },
    );
  });
});
