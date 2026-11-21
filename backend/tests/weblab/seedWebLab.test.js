import { beforeEach, describe, expect, it, vi } from 'vitest';
import Challenge from '../../src/models/Challenge.js';
import { LABS } from '../../src/games/weblab/index.js';
import { seedWebLab, weblabDefinitions } from '../../src/scripts/seedWebLab.js';

vi.mock('../../src/models/Challenge.js', () => ({ default: { findOne: vi.fn(), create: vi.fn(), updateOne: vi.fn() } }));

describe('seedWebLab is idempotent', () => {
  let store;
  beforeEach(() => {
    vi.resetAllMocks();
    store = new Map();
    Challenge.findOne.mockImplementation(async ({ slug }) => store.get(slug) ?? null);
    Challenge.create.mockImplementation(async (doc) => { store.set(doc.slug, { _id: doc.slug, solveCount: 0, ...doc }); });
    Challenge.updateOne.mockImplementation(async ({ _id }, { $set }) => { Object.assign(store.get(_id), $set); });
  });

  it('creates every lab once and only updates on the second run, keeping solveCount and visible', async () => {
    expect(await seedWebLab()).toEqual({ created: LABS.length, updated: 0 });
    const first = store.get('weblab-sqli-login');
    first.solveCount = 7;
    first.visible = false;
    expect(await seedWebLab()).toEqual({ created: 0, updated: LABS.length });
    expect(store.size).toBe(LABS.length);
    expect(store.get('weblab-sqli-login')).toMatchObject({ solveCount: 7, visible: false, points: 30, type: 'weblab' });
    expect(Challenge.create).toHaveBeenCalledTimes(LABS.length);
  });

  it('definitions never carry flags or hashes', () => {
    const text = JSON.stringify(weblabDefinitions());
    expect(text).not.toMatch(/flagHash|flagSalt|CTF\{/);
  });
});
