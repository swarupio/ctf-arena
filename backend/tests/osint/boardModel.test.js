import { describe, expect, it } from 'vitest';
import { loadModels } from '../../src/scripts/syncIndexes.js';

describe('OsintBoard model', () => {
  it('is picked up by db:indexes and declares one board per team and case', async () => {
    const model = (await loadModels()).find((m) => m.modelName === 'OsintBoard');
    expect(model).toBeDefined();
    const unique = model.schema.indexes().filter(([, options]) => options.unique).map(([key]) => key);
    expect(unique).toEqual([{ teamId: 1, track: 1 }]);
    expect(model.collection.name).toBe('osintboards');
  });

  it('caps nothing by itself but keeps coordinates and ids bounded', async () => {
    const model = (await loadModels()).find((m) => m.modelName === 'OsintBoard');
    const doc = new model({ teamId: '0'.repeat(24), track: 'easy', pins: [{ id: 'feed:p001', x: 2000, y: -1 }], links: [{ a: 'x'.repeat(80), b: 'cast:c01', rel: 'linked' }] });
    const error = doc.validateSync();
    expect(Object.keys(error.errors).sort()).toEqual(['links.0.a', 'pins.0.x', 'pins.0.y']);
  });
});
