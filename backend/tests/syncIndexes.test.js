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

describe('admin list indexes', () => {
  it('are declared on the models that db:indexes loads', async () => {
    const models = Object.fromEntries((await loadModels()).map((model) => [model.modelName, model]));
    const keys = (name) => models[name].schema.indexes().map(([key]) => JSON.stringify(key));
    expect(keys('Solve')).toEqual(expect.arrayContaining([
      JSON.stringify({ userId: 1, solvedAt: -1 }), JSON.stringify({ challengeId: 1, solvedAt: 1 }),
    ]));
    // Time-ordered covering index (feed, frozen leaderboard, admin per-day series); it replaces the bare { solvedAt: 1 }.
    expect(keys('Solve')).toContain(JSON.stringify({ solvedAt: 1, adjustment: 1, teamId: 1, points: 1 }));
    expect(keys('Solve')).not.toContain(JSON.stringify({ solvedAt: 1 }));
    expect(keys('Submission')).toContain(JSON.stringify({ userId: 1, createdAt: -1 }));
    expect(keys('User')).toContain(JSON.stringify({ createdAt: -1 }));
  });
});
