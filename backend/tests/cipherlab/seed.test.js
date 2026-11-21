import { beforeEach, describe, expect, it, vi } from 'vitest';
import Challenge from '../../src/models/Challenge.js';
import Solve from '../../src/models/Solve.js';
import { LEVELS } from '../../src/games/cipherlab/levels.js';
import { cipherLabDefinitions, seedCipherLab } from '../../src/scripts/seedCipherLab.js';
import { recordSolve } from '../../src/services/scoringService.js';

vi.mock('../../src/models/Challenge.js', () => ({
  default: { findOne: vi.fn(), create: vi.fn(), updateOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));
vi.mock('../../src/models/Solve.js', () => ({ default: { create: vi.fn(), updateOne: vi.fn(), aggregate: vi.fn() } }));

describe('seed definitions', () => {
  it('has one valid, unique, game-typed definition per level', () => {
    const defs = cipherLabDefinitions();
    expect(defs).toHaveLength(LEVELS.length);
    expect(new Set(defs.map((d) => d.slug)).size).toBe(LEVELS.length);
    for (const def of defs) {
      expect(def).toMatchObject({ type: 'game', category: 'crypto' });
      expect(def.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(['easy', 'medium', 'hard']).toContain(def.difficulty);
      expect(def).not.toHaveProperty('flagHash');
    }
  });

  it('is idempotent: the second run updates and never creates', async () => {
    const rows = new Map();
    Challenge.findOne.mockImplementation(async ({ slug }) => rows.get(slug) ?? null);
    Challenge.create.mockImplementation(async (row) => { rows.set(row.slug, { ...row, _id: row.slug }); });
    Challenge.updateOne.mockResolvedValue({});
    expect(await seedCipherLab()).toEqual({ created: LEVELS.length, updated: 0 });
    expect(await seedCipherLab()).toEqual({ created: 0, updated: LEVELS.length });
    expect(rows.size).toBe(LEVELS.length);
    // solveCount and visible are never part of the update, so re-seeding keeps solves and admin choices.
    for (const [, update] of Challenge.updateOne.mock.calls.map((c) => [c[0], c[1].$set])) {
      expect(update).not.toHaveProperty('solveCount');
      expect(update).not.toHaveProperty('visible');
    }
  });
});

describe('scoring for games', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Solve.create.mockResolvedValue({});
    Solve.aggregate.mockResolvedValue([{ score: 50 }]);
  });

  it('gives the first solver of a game level exactly the fixed points', async () => {
    Challenge.findOneAndUpdate.mockResolvedValue({ solveCount: 1 });
    const result = await recordSolve({ challenge: { _id: 'c', type: 'game', points: 50 }, teamId: 't', userId: 'u' });
    expect(result).toMatchObject({ points: 50, firstBlood: false });
    expect(Solve.updateOne).not.toHaveBeenCalled();
  });

  it('still pays first blood on other types', async () => {
    Challenge.findOneAndUpdate.mockResolvedValue({ solveCount: 1 });
    const result = await recordSolve({ challenge: { _id: 'c', type: 'static', points: 50 }, teamId: 't', userId: 'u' });
    expect(result).toMatchObject({ points: 55, firstBlood: true });
  });
});
