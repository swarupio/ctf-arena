import { describe, expect, it, vi } from 'vitest';
import { loadModels, syncAllIndexes } from '../src/scripts/syncIndexes.js';

describe('db:indexes script', () => {
  it('finds every model file and only creates indexes unless --prune is given', async () => {
    const models = await loadModels();
    const names = models.map((model) => model.modelName);
    for (const expected of ['User', 'Team', 'Challenge', 'Solve', 'Submission', 'Instance']) { expect(names).toContain(expected); }

    const fake = (modelName) => ({ modelName, createIndexes: vi.fn(async () => {}), syncIndexes: vi.fn(async () => []) });
    const [a, b] = [fake('A'), fake('B')];
    expect(await syncAllIndexes([a, b])).toEqual(['A', 'B']);
    expect(a.createIndexes).toHaveBeenCalledOnce();
    expect(a.syncIndexes).not.toHaveBeenCalled();
    await syncAllIndexes([b], { prune: true });
    expect(b.syncIndexes).toHaveBeenCalledOnce();
  });
});
