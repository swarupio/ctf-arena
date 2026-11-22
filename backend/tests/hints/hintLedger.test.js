// Hint ledger + solve-time deduction (services/hintLedger.js, services/scoringService.js recordSolve with `hint`).
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { database, models } from '../security/helpers/fakeDb.js';

vi.mock('../../src/models/Solve.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('Solve'));
vi.mock('../../src/models/Challenge.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('Challenge'));
vi.mock('../../src/models/HintOpen.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('HintOpen'));
vi.mock('../../src/models/CipherHint.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('CipherHint'));
vi.mock('../../src/models/CrackmeHint.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('CrackmeHint'));
vi.mock('../../src/models/OsintHint.js', async () => (await import('../security/helpers/fakeDb.js')).modelModule('OsintHint'));
const platform = { doc: null, reads: 0, fail: false };
vi.mock('../../src/models/AppSetting.js', () => ({
  default: {
    findOne: () => ({
      lean: async () => {
        platform.reads += 1;
        if (platform.fail) { throw new Error('settings down'); }
        return platform.doc;
      },
    }),
  },
  ANNOUNCEMENT_LEVELS: ['info', 'warning', 'critical'],
}));

const { recordSolve } = await import('../../src/services/scoringService.js');
const { openedIndexes, recordHintOpen, registerHintScope, spentForLevel } = await import('../../src/services/hintLedger.js');

const TEAM = 'a'.repeat(24);
const OTHER = 'b'.repeat(24);
const USER = 'c'.repeat(24);

beforeAll(() => { Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true }); });
afterAll(() => { delete mongoose.connection.readyState; });
beforeEach(() => {
  database.reset();
  platform.doc = null;
  platform.reads = 0;
  platform.fail = false;
});

let counter = 0;
const challenge = (points, type = 'game') => models.Challenge.insertRaw({ title: 'c', slug: `c${counter += 1}`, points, type, solveCount: 0 });
const cipher = (levelId, count, teamId = TEAM) => {
  for (let index = 0; index < count; index += 1) { models.CipherHint.insertRaw({ teamId, userId: USER, levelId, index }); }
};
const solve = (row, hint, teamId = TEAM) => recordSolve({ challenge: row, teamId, userId: USER, hint });
const stored = (teamId = TEAM) => models.Solve.all().filter((row) => String(row.teamId) === teamId);

describe('recordHintOpen / openedIndexes (HintOpen ledger)', () => {
  it('writes one row per (team, scope, key, index): a repeated open never costs twice', async () => {
    const open = { teamId: TEAM, userId: USER, scope: 'weblab', key: 'sqli', index: 0 };
    expect((await recordHintOpen(open)).created).toBe(true);
    expect((await recordHintOpen(open)).created).toBe(false);
    await Promise.all([recordHintOpen(open), recordHintOpen(open)]);
    expect(models.HintOpen.all()).toHaveLength(1);
    expect(await openedIndexes({ teamId: TEAM, scope: 'weblab', key: 'sqli' })).toEqual([0]);
  });

  it('keeps teams, scopes and keys apart and returns sorted distinct indexes', async () => {
    for (const index of [2, 0, 1]) { await recordHintOpen({ teamId: TEAM, userId: USER, scope: 'weblab', key: 'a', index }); }
    await recordHintOpen({ teamId: OTHER, userId: USER, scope: 'weblab', key: 'a', index: 0 });
    await recordHintOpen({ teamId: TEAM, userId: USER, scope: 'forensics', key: 'a', index: 0 });
    await recordHintOpen({ teamId: TEAM, userId: USER, scope: 'weblab', key: 'b', index: 0 });
    expect(await openedIndexes({ teamId: TEAM, scope: 'weblab', key: 'a' })).toEqual([0, 1, 2]);
  });

  it('turns a concurrent duplicate-key error into the same open', async () => {
    const spy = vi.spyOn(models.HintOpen, 'updateOne').mockImplementationOnce(() => Promise.reject(Object.assign(new Error('dup'), { code: 11000 })));
    expect(await recordHintOpen({ teamId: TEAM, userId: USER, scope: 'weblab', key: 'a', index: 0 })).toMatchObject({ created: false });
    spy.mockRestore();
  });
});

describe('spentForLevel', () => {
  it('unions the ledger and the legacy collections, every index once', async () => {
    cipher('e1', 2);
    // A scope that reads both sources: index 1 sits in both, index 2 only in the ledger.
    registerHintScope('both', { legacy: async () => [0, 1], ledger: true });
    await recordHintOpen({ teamId: TEAM, userId: USER, scope: 'both', key: 'k', index: 1 });
    await recordHintOpen({ teamId: TEAM, userId: USER, scope: 'both', key: 'k', index: 2 });
    expect(await openedIndexes({ teamId: TEAM, scope: 'both', key: 'k' })).toEqual([0, 1, 2]);
    expect(await openedIndexes({ teamId: TEAM, scope: 'cipherlab', key: 'e1' })).toEqual([0, 1]);
    const result = await spentForLevel({ teamId: TEAM, scope: 'both', key: 'k', base: 100 });
    expect(result).toMatchObject({ spent: 40, openedCount: 3 });
    expect(result.costs).toMatchObject({ enabled: true, maxPercent: 40 });
  });

  it('reads the legacy collections of crackme and osint with their own keys', async () => {
    models.CrackmeHint.insertRaw({ teamId: TEAM, userId: USER, levelId: 'k1', index: 0 });
    models.OsintHint.insertRaw({ teamId: TEAM, userId: USER, key: 'easy:2', index: 0 });
    models.OsintHint.insertRaw({ teamId: TEAM, userId: USER, key: 'easy:2', index: 1 });
    expect((await spentForLevel({ teamId: TEAM, scope: 'crackme', key: 'k1', base: 100 })).spent).toBe(5);
    expect((await spentForLevel({ teamId: TEAM, scope: 'osint', key: 'easy:2', base: 100 })).spent).toBe(15);
    expect((await spentForLevel({ teamId: TEAM, scope: 'osint', key: 'easy:3', base: 100 })).spent).toBe(0);
  });

  it('reads no settings and reports costs: null when nothing was opened', async () => {
    expect(await spentForLevel({ teamId: TEAM, scope: 'weblab', key: 'x', base: 100 })).toEqual({ spent: 0, openedCount: 0, costs: null });
  });
});

describe('recordSolve deduction', () => {
  it('without hints (or without a hint scope) the solve is unchanged', async () => {
    const row = challenge(100);
    expect(await solve(row, { scope: 'cipherlab', key: 'e1' })).toEqual({ points: 100, firstBlood: false });
    expect(stored()[0].points).toBe(100);
    const other = challenge(60);
    expect(await solve(other)).toEqual({ points: 60, firstBlood: false });
  });

  it.each([
    [1, 95, 5], [2, 85, 15], [3, 60, 40], [5, 60, 40],
  ])('%i opened hint(s): awards %i (spent %i, capped at 40%%)', async (count, awarded, spent) => {
    const row = challenge(100);
    cipher('e1', count);
    const result = await solve(row, { scope: 'cipherlab', key: 'e1' });
    expect(result).toEqual({ points: awarded, firstBlood: false, hintCost: { spent, openedCount: count, base: 100, awarded } });
    expect(stored()[0].points).toBe(awarded);
  });

  it('charges only the hints of its own level and its own team', async () => {
    const row = challenge(100);
    cipher('e2', 3);
    cipher('e1', 3, OTHER);
    expect((await solve(row, { scope: 'cipherlab', key: 'e1' })).points).toBe(100);
  });

  it('never awards less than 1 point', async () => {
    platform.doc = { hintCosts: { enabled: true, nudge: 100, approach: 100, walkthrough: 100, maxPercent: 100 } };
    const row = challenge(30);
    cipher('e1', 3);
    const result = await solve(row, { scope: 'cipherlab', key: 'e1' });
    expect(result.points).toBe(1);
    expect(result.hintCost).toEqual({ spent: 29, openedCount: 3, base: 30, awarded: 1 });
  });

  it('a repeated hint open counts once (ledger scope)', async () => {
    const row = challenge(100);
    for (let i = 0; i < 3; i += 1) { await recordHintOpen({ teamId: TEAM, userId: USER, scope: 'weblab', key: 'sqli', index: 0 }); }
    expect((await solve(row, { scope: 'weblab', key: 'sqli' })).points).toBe(95);
  });

  it('uses the configured percentages; the free preset or a disabled switch leaves totals unchanged', async () => {
    const hint = { scope: 'cipherlab', key: 'e1' };
    cipher('e1', 2);
    platform.doc = { hintCosts: { enabled: true, nudge: 10, approach: 20, walkthrough: 30, maxPercent: 50 } };
    expect((await solve(challenge(200), hint)).points).toBe(140); // 20 + 40
    database.reset();
    cipher('e1', 3);
    platform.doc = { hintCosts: { enabled: true, nudge: 0, approach: 0, walkthrough: 0, maxPercent: 40 } };
    expect(await solve(challenge(200), hint)).toEqual({ points: 200, firstBlood: false });
    database.reset();
    cipher('e1', 3);
    platform.doc = { hintCosts: { enabled: false, nudge: 50, approach: 50, walkthrough: 50, maxPercent: 100 } };
    expect((await solve(challenge(200), hint)).points).toBe(200);
  });

  it('a solve that was already captured is not charged again and keeps its points', async () => {
    const row = challenge(100);
    const hint = { scope: 'cipherlab', key: 'e1' };
    cipher('e1', 1);
    expect((await solve(row, hint)).points).toBe(95);
    models.CipherHint.insertRaw({ teamId: TEAM, userId: USER, levelId: 'e1', index: 1 });
    expect(await solve(row, hint)).toBeNull();
    expect(stored()).toHaveLength(1);
    expect(stored()[0].points).toBe(95);
    expect(models.Challenge.all()[0].solveCount).toBe(1);
  });

  it('keeps the first blood bonus rules (static challenges, no hints, are unchanged)', async () => {
    expect(await solve(challenge(100, 'static'))).toEqual({ points: 110, firstBlood: true });
    expect(stored()[0]).toMatchObject({ points: 110, firstBlood: true });
  });
});

describe('price fixed at open time', () => {
  const weblab = { scope: 'weblab', key: 'sqli' };
  const open = (index) => recordHintOpen({ teamId: TEAM, userId: USER, ...weblab, index });
  const changeCosts = (hintCosts) => { platform.doc = { hintCosts }; };

  it('stores the percent and the cap on the ledger row', async () => {
    await open(0);
    expect(models.HintOpen.all()[0]).toMatchObject({ percent: 5, capPercent: 40 });
  });

  it('keeps what was agreed when an admin changes the costs afterwards', async () => {
    await open(0);
    await open(1);
    changeCosts({ enabled: true, nudge: 50, approach: 50, walkthrough: 50, maxPercent: 90 });
    const result = await solve(challenge(100), weblab);
    expect(result).toMatchObject({ points: 85, hintCost: { spent: 15, openedCount: 2, base: 100, awarded: 85 } });
  });

  it('a hint opened after the change is charged the new price, the earlier one keeps the old', async () => {
    await open(0);
    changeCosts({ enabled: true, nudge: 50, approach: 20, walkthrough: 50, maxPercent: 90 });
    await open(1);
    expect(models.HintOpen.all().map((row) => [row.index, row.percent, row.capPercent])).toEqual([[0, 5, 40], [1, 20, 90]]);
    expect((await solve(challenge(100), weblab)).points).toBe(75); // 5 + 20, under the lowest agreed cap (40)
  });

  it('needs no settings read at solve time when every opened hint has its price: a failed or disabled read changes nothing', async () => {
    await open(0);
    await open(1);
    platform.reads = 0;
    platform.fail = true;
    const result = await spentForLevel({ teamId: TEAM, ...weblab, base: 100 });
    expect(result).toMatchObject({ spent: 15, openedCount: 2, costs: null });
    expect(platform.reads).toBe(0);
    changeCosts({ enabled: false, nudge: 0, approach: 0, walkthrough: 0, maxPercent: 0 });
    platform.fail = false;
    platform.reads = 0;
    expect((await solve(challenge(100), weblab)).points).toBe(85);
    expect(platform.reads).toBe(0);
  });

  it('reads the settings only for rows without a stored price (older rows) and charges the current rates for them', async () => {
    cipher('e1', 2); // no percent stored: the current rates apply
    platform.reads = 0;
    const result = await spentForLevel({ teamId: TEAM, scope: 'cipherlab', key: 'e1', base: 100 });
    expect(result.spent).toBe(15);
    expect(platform.reads).toBe(1);
  });

  it('prices the in-order legacy collections at open time too (percent stored on the row)', async () => {
    models.CipherHint.insertRaw({ teamId: TEAM, userId: USER, levelId: 'p1', index: 0, percent: 5, capPercent: 40 });
    models.CipherHint.insertRaw({ teamId: TEAM, userId: USER, levelId: 'p1', index: 1, percent: 10, capPercent: 40 });
    changeCosts({ enabled: true, nudge: 90, approach: 90, walkthrough: 90, maxPercent: 100 });
    platform.reads = 0;
    expect((await solve(challenge(100), { scope: 'cipherlab', key: 'p1' })).points).toBe(85);
    expect(platform.reads).toBe(0);
  });

  it('a repeated open keeps the original percent and does not write again', async () => {
    expect(await open(0)).toMatchObject({ created: true, percent: 5 });
    changeCosts({ enabled: true, nudge: 50, approach: 50, walkthrough: 50, maxPercent: 90 });
    const spy = vi.spyOn(models.HintOpen, 'updateOne');
    expect(await open(0)).toMatchObject({ created: false, percent: 5 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(models.HintOpen.all()).toHaveLength(1);
    expect(models.HintOpen.all()[0]).toMatchObject({ percent: 5, capPercent: 40 });
  });

  it('a concurrent open that slips past the read never overwrites the stored percent (upsert is $setOnInsert)', async () => {
    await open(0);
    changeCosts({ enabled: true, nudge: 50, approach: 50, walkthrough: 50, maxPercent: 90 });
    // Force the write path: the read does not see the row, the upsert hits the existing one.
    const find = vi.spyOn(models.HintOpen, 'find').mockImplementationOnce(() => ({ lean: async () => [] }));
    expect(await open(0)).toMatchObject({ created: false, percent: 5 }); // answers with the stored price
    find.mockRestore();
    expect(models.HintOpen.all()).toHaveLength(1);
    expect(models.HintOpen.all()[0]).toMatchObject({ percent: 5, capPercent: 40 });
  });
});

describe('cumulative tiers', () => {
  const weblab = { scope: 'weblab', key: 'sqli' };
  const open = (index) => recordHintOpen({ teamId: TEAM, userId: USER, ...weblab, index });

  it('opening the third hint first costs the nudge, the approach and the walkthrough, capped as before', async () => {
    expect(await open(2)).toMatchObject({ created: true, percent: 40, tier: 'walkthrough' });
    const result = await solve(challenge(100), weblab);
    expect(result).toMatchObject({ points: 60, hintCost: { spent: 40, openedCount: 1 } });
  });

  it('skipping a tier charges the tiers below it once: nudge, then walkthrough adds approach + walkthrough', async () => {
    await open(0);
    expect(await open(2)).toMatchObject({ percent: 35 });
    expect((await solve(challenge(100), weblab)).hintCost.spent).toBe(40);
  });

  it('opening the cheaper hints after a higher one is free', async () => {
    await open(1); // 15
    expect(await open(0)).toMatchObject({ percent: 0 });
    expect((await solve(challenge(100), weblab)).hintCost.spent).toBe(15);
  });

  it('is capped at maxPercent: a cap of 30 limits the walkthrough-first open', async () => {
    platform.doc = { hintCosts: { enabled: true, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 30 } };
    await open(2);
    expect((await solve(challenge(100), weblab)).points).toBe(70);
  });

  it('charges nothing when costs are off at open time', async () => {
    platform.doc = { hintCosts: { enabled: false, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40 } };
    expect(await open(2)).toMatchObject({ percent: 0 });
    expect(await solve(challenge(100), weblab)).toEqual({ points: 100, firstBlood: false });
  });

  it('keeps the in-order legacy categories unchanged (rows 0..n-1 cost each tier once)', async () => {
    cipher('e1', 3);
    expect((await spentForLevel({ teamId: TEAM, scope: 'cipherlab', key: 'e1', base: 100 })).spent).toBe(40);
    cipher('e2', 2);
    expect((await spentForLevel({ teamId: TEAM, scope: 'cipherlab', key: 'e2', base: 100 })).spent).toBe(15);
  });
});

describe('free-hint race at solve time', () => {
  const weblab = { scope: 'weblab', key: 'sqli' };
  // A hint is opened (on "another replica") after the solve read the ledger but before its insert finished.
  const openMeanwhile = (index) => {
    const original = models.Solve.create.bind(models.Solve);
    return vi.spyOn(models.Solve, 'create').mockImplementationOnce(async (doc) => {
      await recordHintOpen({ teamId: TEAM, userId: USER, ...weblab, index });
      return original(doc);
    });
  };

  it('lowers the stored points once when a hint was opened between the first read and the insert', async () => {
    const create = openMeanwhile(0);
    const update = vi.spyOn(models.Solve, 'updateOne');
    const result = await solve(challenge(100), weblab);
    expect(result).toEqual({ points: 95, firstBlood: false, hintCost: { spent: 5, openedCount: 1, base: 100, awarded: 95 } });
    expect(stored()[0].points).toBe(95);
    expect(update).toHaveBeenCalledTimes(1);
    create.mockRestore();
    update.mockRestore();
  });

  it('never lowers below 1', async () => {
    platform.doc = { hintCosts: { enabled: true, nudge: 100, approach: 100, walkthrough: 100, maxPercent: 100 } };
    const create = openMeanwhile(2);
    expect((await solve(challenge(30), weblab)).points).toBe(1);
    expect(stored()[0].points).toBe(1);
    create.mockRestore();
  });

  it('applies the first blood bonus to the corrected points', async () => {
    const create = openMeanwhile(0);
    const result = await solve(challenge(100, 'static'), weblab);
    expect(result).toMatchObject({ points: 104, firstBlood: true, hintCost: { spent: 5, awarded: 95 } });
    expect(stored()[0]).toMatchObject({ points: 104, firstBlood: true });
    create.mockRestore();
  });

  it('does not touch the Solve when no hint was opened meanwhile', async () => {
    const update = vi.spyOn(models.Solve, 'updateOne');
    expect(await solve(challenge(100), weblab)).toEqual({ points: 100, firstBlood: false });
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
  });
});
