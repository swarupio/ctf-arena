import mongoose from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { replicaCounter } from '../src/middleware/requestCounter.js';
import {
  CRITICAL_INDEXES, INDEX_TTL_MS, checkIndexes, findMissingIndexes, indexStatus, missingMessage, resetIndexGuard,
  resetIndexWarning, warnIfIndexesMissing,
} from '../src/services/indexGuard.js';

const names = [...new Set(CRITICAL_INDEXES.map(({ model }) => model))];
const goLive = () => Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
const goOffline = () => { delete mongoose.connection.readyState; };

// Fake models whose collections list the indexes of the given specs (all of them by default).
const fakeModels = ({ skip = [], reject = {} } = {}) => Object.fromEntries(names.map((name) => [name, {
  collection: {
    indexes: vi.fn(async () => {
      if (reject[name]) { throw reject[name]; }
      return [{ key: { _id: 1 } }, ...CRITICAL_INDEXES
        .filter((spec) => spec.model === name && !skip.includes(spec.model + Object.keys(spec.key)[0]))
        .map((spec) => ({ key: spec.key, unique: true, ...(spec.partial ? { partialFilterExpression: { status: 'active' } } : {}) }))];
    }),
  },
}]));

beforeEach(() => {
  resetIndexGuard();
  resetIndexWarning();
});
afterEach(() => {
  goOffline();
  vi.restoreAllMocks();
});

describe('findMissingIndexes', () => {
  it('reports nothing when every critical unique index exists', async () => {
    expect(await findMissingIndexes(fakeModels())).toEqual([]);
  });

  it('names each missing index, including a non-unique or non-partial look-alike', async () => {
    const models = fakeModels({ skip: ['SolveteamId', 'Teamname'] });
    expect(await findMissingIndexes(models)).toEqual(['Solve(teamId,challengeId)', 'Team(name)']);
    const weak = fakeModels();
    weak.User.collection.indexes.mockResolvedValue([{ key: { cognitoSub: 1 } }]);
    weak.Instance.collection.indexes.mockResolvedValue([{ key: { port: 1 }, unique: true }]);
    expect(await findMissingIndexes(weak)).toEqual(['User(cognitoSub)', 'Instance(port)']);
  });

  it('treats a collection that does not exist yet as missing all of its indexes', async () => {
    const models = fakeModels({ reject: { Team: Object.assign(new Error('ns not found'), { code: 26 }) } });
    expect(await findMissingIndexes(models)).toEqual(['Team(name)', 'Team(inviteCode)']);
  });

  it('propagates other driver errors', async () => {
    await expect(findMissingIndexes(fakeModels({ reject: { Solve: new Error('boom') } }))).rejects.toThrow('boom');
  });
});

describe('checkIndexes (cached, bounded, never throws)', () => {
  it('is unknown without a live connection and does not load models', async () => {
    const loadModels = vi.fn();
    expect(await checkIndexes({ loadModels })).toBeNull();
    expect(loadModels).not.toHaveBeenCalled();
  });

  it('queries once and serves the cache until the TTL passes', async () => {
    goLive();
    const models = fakeModels();
    const loadModels = vi.fn(async () => models);
    const t0 = 1_000_000;
    expect(await checkIndexes({ now: t0, loadModels })).toEqual([]);
    expect(await checkIndexes({ now: t0 + INDEX_TTL_MS - 1, loadModels })).toEqual([]);
    expect(models.Solve.collection.indexes).toHaveBeenCalledTimes(1);
    await checkIndexes({ now: t0 + INDEX_TTL_MS + 1, loadModels });
    expect(models.Solve.collection.indexes).toHaveBeenCalledTimes(2);
  });

  it('returns null on error or timeout instead of throwing', async () => {
    goLive();
    expect(await checkIndexes({ loadModels: async () => { throw new Error('x'); } })).toBeNull();
    resetIndexGuard();
    expect(await checkIndexes({ timeoutMs: 20, loadModels: () => new Promise(() => {}) })).toBeNull();
  });

  it('shares one in-flight check between concurrent callers', async () => {
    goLive();
    const models = fakeModels();
    const loadModels = vi.fn(async () => models);
    await Promise.all([checkIndexes({ loadModels }), checkIndexes({ loadModels }), checkIndexes({ loadModels })]);
    expect(loadModels).toHaveBeenCalledTimes(1);
  });

  it('indexStatus maps to ok, missing or null', async () => {
    expect(await indexStatus()).toBeNull();
    goLive();
    expect(await indexStatus({ loadModels: async () => fakeModels() })).toBe('ok');
    resetIndexGuard();
    expect(await indexStatus({ loadModels: async () => fakeModels({ skip: ['Teamname'] }) })).toBe('missing');
  });
});

describe('startup warning', () => {
  it('writes one line naming the fix when indexes are missing, outside the test environment', async () => {
    goLive();
    vi.stubEnv('NODE_ENV', 'production');
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const loadModels = async () => fakeModels({ skip: ['Teamname'] });
    await warnIfIndexesMissing({ loadModels });
    await warnIfIndexesMissing({ loadModels });
    expect(out).toHaveBeenCalledTimes(1);
    expect(String(out.mock.calls[0][0])).toContain('npm run db:indexes');
    expect(String(out.mock.calls[0][0])).toContain('Team(name)');
    expect(String(out.mock.calls[0][0]).trim().split('\n')).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it('is silent when indexes are present, and in the test environment', async () => {
    goLive();
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await warnIfIndexesMissing({ loadModels: async () => fakeModels({ skip: ['Teamname'] }) });
    expect(out).not.toHaveBeenCalled();
    resetIndexWarning();
    vi.stubEnv('NODE_ENV', 'production');
    await warnIfIndexesMissing({ loadModels: async () => fakeModels() });
    expect(out).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    expect(missingMessage(['A(b)'])).toContain('A(b)');
  });
});

describe('GET /api/health', () => {
  afterEach(() => replicaCounter.stop());

  it('keeps the old shape (no indexes field) when the database is down', async () => {
    const { body } = await request(app).get('/api/health').expect(200);
    expect(Object.keys(body).sort()).toEqual(['db', 'replica', 'status']);
  });

  it('adds indexes: ok, and never leaks index names when missing', async () => {
    goLive();
    const models = fakeModels();
    // Seed the cache through the real module with fake models, then call the route.
    await checkIndexes({ loadModels: async () => models });
    let { body } = await request(app).get('/api/health').expect(200);
    expect(body).toMatchObject({ status: 'ok', db: 'up', indexes: 'ok' });

    resetIndexGuard();
    await checkIndexes({ loadModels: async () => fakeModels({ skip: ['Teamname'] }) });
    ({ body } = await request(app).get('/api/health').expect(200));
    expect(body.indexes).toBe('missing');
    expect(JSON.stringify(body)).not.toContain('Team(');
  });
});
