import { beforeEach, describe, expect, it, vi } from 'vitest';
import Challenge from '../../src/models/Challenge.js';
import { forensicsDefinitions, seedForensics } from '../../src/scripts/seedForensics.js';
import { TRACKS, TRACK_IDS } from '../../src/forensics/tracks.js';

vi.mock('../../src/models/Challenge.js', () => ({ default: { findOne: vi.fn(), create: vi.fn(), updateOne: vi.fn() } }));

describe('seedForensics', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('defines one forensics row per stage with the documented points and no secrets', () => {
    const defs = forensicsDefinitions();
    expect(defs).toHaveLength(20);
    expect(new Set(defs.map((d) => d.slug)).size).toBe(20);
    for (const id of TRACK_IDS) {
      const mine = defs.filter((d) => d.forensics.track === id);
      expect(mine.reduce((total, d) => total + d.points, 0)).toBe(TRACKS[id].maxPoints);
    }
    expect(defs.every((d) => d.type === 'forensics' && d.category === 'forensics')).toBe(true);
    expect(defs.every((d) => ['easy', 'medium', 'hard'].includes(d.difficulty))).toBe(true);
    expect(JSON.stringify(defs)).not.toContain('CTF{');
  });

  it('creates missing rows and updates existing ones in place (idempotent)', async () => {
    Challenge.findOne.mockResolvedValueOnce(null).mockResolvedValue({ _id: 'x' });
    const defs = forensicsDefinitions().slice(0, 3);
    expect(await seedForensics(defs)).toEqual({ created: 1, updated: 2 });
    expect(Challenge.create).toHaveBeenCalledWith({ ...defs[0], visible: true });
    const update = Challenge.updateOne.mock.calls[0][1].$set;
    expect(update).not.toHaveProperty('visible');
    expect(update).not.toHaveProperty('solveCount');
  });
});
