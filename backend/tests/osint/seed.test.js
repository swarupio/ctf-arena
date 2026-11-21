import { beforeEach, describe, expect, it, vi } from 'vitest';
import Challenge from '../../src/models/Challenge.js';
import { osintDefinitions, seedOsint } from '../../src/scripts/seedOsint.js';
import { TRACKS, TRACK_IDS } from '../../src/osint/cases.js';

vi.mock('../../src/models/Challenge.js', () => ({ default: { findOne: vi.fn(), create: vi.fn(), updateOne: vi.fn() } }));

describe('seedOsint', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('defines one osint row per question with the documented points and no secrets', () => {
    const defs = osintDefinitions();
    expect(defs).toHaveLength(22);
    expect(new Set(defs.map((d) => d.slug)).size).toBe(22);
    for (const id of TRACK_IDS) {
      const mine = defs.filter((d) => d.osint.track === id);
      expect(mine.reduce((total, d) => total + d.points, 0)).toBe(TRACKS[id].maxPoints);
    }
    expect(defs.every((d) => d.type === 'osint' && d.category === 'misc')).toBe(true);
    expect(defs.every((d) => ['easy', 'medium', 'hard'].includes(d.difficulty))).toBe(true);
    expect(JSON.stringify(defs)).not.toContain('CTF{');
  });

  it('creates missing rows and updates existing ones in place (idempotent)', async () => {
    Challenge.findOne.mockResolvedValueOnce(null).mockResolvedValue({ _id: 'x' });
    const defs = osintDefinitions().slice(0, 3);
    expect(await seedOsint(defs)).toEqual({ created: 1, updated: 2 });
    expect(Challenge.create).toHaveBeenCalledWith({ ...defs[0], visible: true });
    const update = Challenge.updateOne.mock.calls[0][1].$set;
    expect(update).not.toHaveProperty('visible');
    expect(update).not.toHaveProperty('solveCount');
  });
});
