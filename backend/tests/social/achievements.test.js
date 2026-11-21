import { beforeEach, describe, expect, it, vi } from 'vitest';
import Achievement from '../../src/models/Achievement.js';
import Challenge from '../../src/models/Challenge.js';
import Solve from '../../src/models/Solve.js';
import Team from '../../src/models/Team.js';
import {
  BADGES, BADGE_KEYS, computeEarned, evaluate, safeEvaluate, streakInfo,
} from '../../src/services/achievementService.js';

vi.mock('../../src/models/Achievement.js', () => ({ default: { updateOne: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({ default: { find: vi.fn(), aggregate: vi.fn() } }));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn() } }));

// Chainable query double: select/sort/limit return itself, lean resolves the rows.
const query = (rows) => {
  const q = { select: () => q, sort: () => q, limit: () => q, lean: () => Promise.resolve(rows) };
  return q;
};
const at = (day, hour = 12, minute = 0) => new Date(Date.UTC(2026, 10, day, hour, minute));
const solve = (id, when, extra = {}) => ({ challengeId: id, solvedAt: when, firstBlood: false, ...extra });
const meta = {
  w: { category: 'web', difficulty: 'easy', type: 'static' },
  c: { category: 'crypto', difficulty: 'hard', type: 'static' },
  f: { category: 'forensics', difficulty: 'easy', type: 'static' },
  p: { category: 'pwn', difficulty: 'medium', type: 'docker' },
  m: { category: 'misc', difficulty: 'easy', type: 'static' },
  t1: { category: 'terminal', difficulty: 'easy', type: 'terminal', mode: 'easy' },
  t2: { category: 'terminal', difficulty: 'easy', type: 'terminal', mode: 'easy' },
  m1: { category: 'terminal', difficulty: 'medium', type: 'terminal', mode: 'medium' },
  h1: { category: 'terminal', difficulty: 'hard', type: 'terminal', mode: 'hard' },
};
const earned = (facts) => computeEarned({ challenges: meta, ...facts });

describe('catalog', () => {
  it('has about twenty unique badges with display text', () => {
    expect(BADGES.length).toBeGreaterThanOrEqual(20);
    expect(BADGE_KEYS.size).toBe(BADGES.length);
    for (const badge of BADGES) { expect(badge.name && badge.description && badge.icon).toBeTruthy(); }
  });
});

describe('computeEarned rules', () => {
  it('awards nothing without solves', () => {
    expect(earned({})).toEqual([]);
  });

  it('first-solve and first-blood', () => {
    expect(earned({ userSolves: [solve('w', at(3))] })).toEqual(expect.arrayContaining(['first-solve', 'category-web']));
    expect(earned({ userSolves: [solve('w', at(3))] })).not.toContain('first-blood');
    expect(earned({ userSolves: [solve('w', at(3), { firstBlood: true })] })).toContain('first-blood');
  });

  it.each([
    ['w', 'category-web'], ['c', 'category-crypto'], ['f', 'category-forensics'],
    ['p', 'category-pwn'], ['m', 'category-misc'], ['t1', 'category-terminal'],
  ])('category badge for %s', (id, key) => {
    expect(earned({ userSolves: [solve(id, at(3))] })).toContain(key);
  });

  it('ignores solves of unknown challenges for category rules, never guesses', () => {
    expect(earned({ userSolves: [solve('gone', at(3))] })).toEqual(['first-solve']);
  });

  it('hard-hitter needs a hard challenge', () => {
    expect(earned({ userSolves: [solve('w', at(3))] })).not.toContain('hard-hitter');
    expect(earned({ userSolves: [solve('c', at(3))] })).toContain('hard-hitter');
  });

  it('3, 5 and 10 solve milestones', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => solve('w', at(3 + i)));
    expect(earned({ userSolves: many(2) })).not.toContain('solves-3');
    expect(earned({ userSolves: many(3) })).toContain('solves-3');
    expect(earned({ userSolves: many(4) })).not.toContain('solves-5');
    expect(earned({ userSolves: many(5) })).toContain('solves-5');
    expect(earned({ userSolves: many(9) })).not.toContain('solves-10');
    expect(earned({ userSolves: many(10) })).toContain('solves-10');
  });

  it('terminal perfect badges need every visible code of the mode solved by the team', () => {
    const totals = { easy: 2, medium: 1, hard: 1 };
    const part = earned({ userSolves: [solve('t1', at(3))], teamSolves: [{ challengeId: 't1' }], terminalTotals: totals });
    expect(part).not.toContain('terminal-easy');
    const full = earned({
      userSolves: [solve('t1', at(3))], terminalTotals: totals,
      teamSolves: [{ challengeId: 't1' }, { challengeId: 't2' }, { challengeId: 'm1' }, { challengeId: 'h1' }],
    });
    expect(full).toEqual(expect.arrayContaining(['terminal-easy', 'terminal-medium', 'terminal-hard']));
    expect(earned({ teamSolves: [], terminalTotals: { easy: 0 } })).not.toContain('terminal-easy');
  });

  it('night owl only between 00:00 and 05:00 UTC', () => {
    expect(earned({ userSolves: [solve('w', at(3, 12))] })).not.toContain('night-owl');
    expect(earned({ userSolves: [solve('w', at(3, 5))] })).not.toContain('night-owl');
    expect(earned({ userSolves: [solve('w', at(3, 4, 59))] })).toContain('night-owl');
    expect(earned({ userSolves: [solve('w', at(3, 0))] })).toContain('night-owl');
  });

  it('speed-runner is three solves within one hour', () => {
    const slow = [solve('w', at(3, 12, 0)), solve('c', at(3, 12, 30)), solve('f', at(3, 13, 1))];
    expect(earned({ userSolves: slow })).not.toContain('speed-runner');
    const fast = [solve('w', at(3, 12, 0)), solve('c', at(3, 12, 30)), solve('f', at(3, 13, 0))];
    expect(earned({ userSolves: fast })).toContain('speed-runner');
  });

  it('streak badges follow consecutive UTC days', () => {
    const days = (list) => list.map((day) => solve('w', at(day)));
    expect(earned({ userSolves: days([3, 4]) })).not.toContain('streak-3');
    expect(earned({ userSolves: days([3, 4, 5]) })).toContain('streak-3');
    expect(earned({ userSolves: days([3, 4, 5, 7, 8]) })).not.toContain('streak-7');
    expect(earned({ userSolves: days([3, 4, 5, 6, 7, 8, 9]) })).toEqual(expect.arrayContaining(['streak-3', 'streak-7']));
  });

  it('team-of-three needs three members', () => {
    expect(earned({ userSolves: [solve('w', at(3))], memberCount: 2 })).not.toContain('team-of-three');
    expect(earned({ userSolves: [solve('w', at(3))], memberCount: 3 })).toContain('team-of-three');
  });

  it('comeback is a solve after a gap of three days or more', () => {
    expect(earned({ userSolves: [solve('w', at(3)), solve('c', at(5, 11))] })).not.toContain('comeback');
    expect(earned({ userSolves: [solve('w', at(3)), solve('c', at(6))] })).toContain('comeback');
  });

  it('only returns keys that are in the catalog', () => {
    const all = earned({
      userSolves: Array.from({ length: 12 }, (_, i) => solve(['w', 'c', 'f', 'p', 'm', 't1'][i % 6], at(3 + i, 2), { firstBlood: true })),
      teamSolves: [{ challengeId: 't1' }], terminalTotals: { easy: 1 }, memberCount: 3,
    });
    for (const key of all) { expect(BADGE_KEYS.has(key)).toBe(true); }
  });
});

describe('streakInfo', () => {
  const now = at(10, 15);
  it('is alive until the end of the day after the last solve', () => {
    expect(streakInfo([at(9), at(8)], now)).toEqual({ current: 2, best: 2 });
    expect(streakInfo([at(10), at(9)], now)).toEqual({ current: 2, best: 2 });
    expect(streakInfo([at(7), at(8)], now)).toEqual({ current: 0, best: 2 });
    expect(streakInfo([], now)).toEqual({ current: 0, best: 0 });
  });
});

describe('evaluate (idempotent awarding)', () => {
  const store = new Set();
  beforeEach(() => {
    vi.resetAllMocks();
    store.clear();
    Solve.find.mockImplementation(() => query([solve('w', at(3, 2), { firstBlood: true })]));
    Challenge.find.mockImplementation(() => query([{ _id: 'w', ...meta.w }]));
    Challenge.aggregate.mockResolvedValue([]);
    Team.findById.mockImplementation(() => query({ memberIds: ['a', 'b', 'c'] }));
    Achievement.updateOne.mockImplementation(async ({ userId, key }) => {
      const id = `${userId}:${key}`;
      if (store.has(id)) { return { upsertedCount: 0 }; }
      store.add(id);
      return { upsertedCount: 1 };
    });
  });

  it('reports new badges once, then nothing on the second run', async () => {
    const first = await evaluate({ userId: 'u1', teamId: 't1' });
    expect(first.map((badge) => badge.key)).toEqual(expect.arrayContaining(['first-solve', 'first-blood', 'category-web', 'night-owl', 'team-of-three']));
    expect(await evaluate({ userId: 'u1', teamId: 't1' })).toEqual([]);
    expect(store.size).toBe(first.length);
  });

  it('uses an upsert on {userId,key} with setOnInsert so existing rows are never rewritten', async () => {
    await evaluate({ userId: 'u1', teamId: 't1' });
    const [filter, update, options] = Achievement.updateOne.mock.calls[0];
    expect(Object.keys(filter).sort()).toEqual(['key', 'userId']);
    expect(Object.keys(update)).toEqual(['$setOnInsert']);
    expect(options).toEqual({ upsert: true });
  });

  it('never counts manual score adjustments as solves (user and team reads exclude them)', async () => {
    await evaluate({ userId: 'u1', teamId: 't1' });
    const filters = Solve.find.mock.calls.map(([filter]) => filter);
    expect(filters).toEqual([
      { userId: 'u1', adjustment: { $ne: true } },
      { teamId: 't1', adjustment: { $ne: true } },
    ]);
  });

  it('treats a duplicate key race as already awarded', async () => {
    Achievement.updateOne.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    expect(await evaluate({ userId: 'u1', teamId: 't1' })).toEqual([]);
  });
});

describe('safeEvaluate hook tolerance', () => {
  const on = () => true;
  it('does nothing without a database connection', async () => {
    const run = vi.fn();
    expect(await safeEvaluate({}, { run, connected: () => false })).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('swallows a synchronous throw and a rejection', async () => {
    expect(await safeEvaluate({}, { run: () => { throw new Error('boom'); }, connected: on })).toEqual([]);
    expect(await safeEvaluate({}, { run: () => Promise.reject(new Error('boom')), connected: on })).toEqual([]);
  });

  it('gives up after the timeout so a slow evaluation cannot slow a solve', async () => {
    const started = Date.now();
    const result = await safeEvaluate({}, { run: () => new Promise(() => {}), timeoutMs: 30, connected: on });
    expect(result).toEqual([]);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('returns the new badges on success', async () => {
    expect(await safeEvaluate({}, { run: async () => [{ key: 'first-solve' }], connected: on })).toEqual([{ key: 'first-solve' }]);
  });
});
