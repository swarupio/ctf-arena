import { beforeEach, describe, expect, it, vi } from 'vitest';
import Challenge from '../../src/models/Challenge.js';
import { LEVELS } from '../../src/games/crackme/levels.js';
import { crackmeDefinitions, seedCrackme } from '../../src/scripts/seedCrackme.js';

vi.mock('../../src/models/Challenge.js', () => ({ default: { findOne: vi.fn(), create: vi.fn(), updateOne: vi.fn() } }));

describe('crackme definitions', () => {
  it('has one row per level, with unique slugs, reversing type and the level points', () => {
    const defs = crackmeDefinitions();
    expect(defs).toHaveLength(LEVELS.length);
    expect(new Set(defs.map((d) => d.slug)).size).toBe(LEVELS.length);
    for (const [i, def] of defs.entries()) {
      expect(def.slug).toBe(`crackme-${LEVELS[i].id}`);
      expect(def.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(def).toMatchObject({ type: 'reversing', points: LEVELS[i].points, category: 'pwn' });
      expect(['easy', 'medium', 'hard']).toContain(def.difficulty);
      expect(JSON.stringify(def)).not.toMatch(/flag|answer/i);
    }
    expect(defs.filter((d) => d.difficulty === 'hard')).toHaveLength(8);
  });

  it('validates against the Challenge model enum', async () => {
    const real = (await vi.importActual('../../src/models/Challenge.js')).default;
    for (const def of crackmeDefinitions()) {
      const error = new real({ ...def, visible: true }).validateSync();
      expect(error, def.slug).toBeUndefined();
    }
  });
});

describe('seedCrackme', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('creates missing rows and updates existing ones in place (idempotent)', async () => {
    Challenge.findOne.mockResolvedValueOnce(null).mockResolvedValue({ _id: 'x' });
    const summary = await seedCrackme();
    expect(summary).toEqual({ created: 1, updated: LEVELS.length - 1 });
    expect(Challenge.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'crackme-e1', visible: true }));
    const update = Challenge.updateOne.mock.calls[0][1].$set;
    expect(update).not.toHaveProperty('visible');
    expect(update).not.toHaveProperty('solveCount');
  });
});
