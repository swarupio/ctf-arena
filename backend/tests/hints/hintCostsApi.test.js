// Hint costs platform setting (PUT/GET /api/admin/settings) and the public GET /api/hint-costs.
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import { chain, models, oid, resetModels } from '../admin/harness.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', async () => (await import('../admin/harness.js')).mockModel('User'));
vi.mock('../../src/models/Team.js', async () => (await import('../admin/harness.js')).mockModel('Team'));
vi.mock('../../src/models/Challenge.js', async () => (await import('../admin/harness.js')).mockModel('Challenge'));
vi.mock('../../src/models/Instance.js', async () => (await import('../admin/harness.js')).mockModel('Instance', { ACTIVE_STATUSES: ['starting', 'running', 'stopping'] }));
vi.mock('../../src/models/Solve.js', async () => (await import('../admin/harness.js')).mockModel('Solve'));
vi.mock('../../src/models/Submission.js', async () => (await import('../admin/harness.js')).mockModel('Submission'));
vi.mock('../../src/models/ReplicaStat.js', async () => (await import('../admin/harness.js')).mockModel('ReplicaStat'));
vi.mock('../../src/models/CheatSignal.js', async () => (await import('../admin/harness.js')).mockModel('CheatSignal'));
vi.mock('../../src/models/TaintedFlag.js', async () => (await import('../admin/harness.js')).mockModel('TaintedFlag'));
vi.mock('../../src/models/TerminalActivity.js', async () => (await import('../admin/harness.js')).mockModel('TerminalActivity'));
vi.mock('../../src/models/AttemptCounter.js', async () => (await import('../admin/harness.js')).mockModel('AttemptCounter'));
vi.mock('../../src/models/AuditLog.js', async () => (await import('../admin/harness.js')).mockModel('AuditLog'));
vi.mock('../../src/models/AppSetting.js', async () => (await import('../admin/harness.js')).mockModel('AppSetting', { ANNOUNCEMENT_LEVELS: ['info', 'warning', 'critical'] }));
vi.mock('../../src/services/instanceService.js', async () => (await import('../admin/harness.js')).instanceModule());

const DEFAULTS = { enabled: true, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40 };
const api = (method, path, { as = 'admin', body } = {}) => {
  let call = request(app)[method](`/api${path}`);
  if (as) { call = call.set('Authorization', `Bearer ${as}`); }
  return body === undefined ? call : call.send(body);
};
const put = (body, as = 'admin') => api('put', '/admin/settings', { as, body });

beforeAll(() => { Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true }); });
afterAll(() => { delete mongoose.connection.readyState; replicaCounter.stop(); });
beforeEach(() => {
  vi.clearAllMocks();
  resetModels();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  models.User.findOne.mockImplementation(() => chain({ _id: oid(900) }));
});

describe('GET /api/hint-costs (public)', () => {
  it('needs no token, is cached for 10 s and returns the defaults when nothing is stored', async () => {
    const res = await api('get', '/hint-costs', { as: null }).expect(200);
    expect(res.body).toEqual(DEFAULTS);
    expect(res.headers['cache-control']).toBe('public, max-age=10');
  });

  it('returns exactly the five numbers, normalised, and nothing else of the settings document', async () => {
    models.AppSetting.findOne.mockImplementation(() => chain({
      announcement: { text: 'secret banner' }, updatedBy: 'admin@example.com', hintCosts: { enabled: false, nudge: 1, approach: 2, walkthrough: 3, maxPercent: 4, extra: 9 },
    }));
    const { body } = await api('get', '/hint-costs', { as: null }).expect(200);
    expect(body).toEqual({ enabled: false, nudge: 1, approach: 2, walkthrough: 3, maxPercent: 4 });
  });

  it('falls back to the defaults when the stored value is junk or the read fails', async () => {
    models.AppSetting.findOne.mockImplementation(() => chain({ hintCosts: { nudge: 'lots', approach: -5, walkthrough: 900 } }));
    expect((await api('get', '/hint-costs', { as: null }).expect(200)).body).toEqual({ ...DEFAULTS, approach: 0, walkthrough: 100 });
    models.AppSetting.findOne.mockImplementation(() => { throw new Error('down'); });
    expect((await api('get', '/hint-costs', { as: null }).expect(200)).body).toEqual(DEFAULTS);
  });

  it('only answers GET', async () => {
    await api('post', '/hint-costs', { as: null, body: {} }).expect(404);
  });
});

describe('admin settings: hintCosts', () => {
  const saved = (hintCosts) => ({ registrationOpen: true, submissionsFrozen: false, announcement: { text: '', level: 'info' }, hintCosts, updatedAt: new Date('2026-11-22T10:00:00Z') });

  it('shows the defaults in the settings view', async () => {
    expect((await api('get', '/admin/settings').expect(200)).body.hintCosts).toEqual(DEFAULTS);
  });

  it('stores a valid object as a whole, fills missing fields with defaults, and writes an audit entry', async () => {
    const stored = { enabled: true, nudge: 0, approach: 15, walkthrough: 30, maxPercent: 50 };
    models.AppSetting.findOneAndUpdate.mockImplementation(() => chain(saved(stored)));
    const { body } = await put({ hintCosts: { nudge: 0, approach: 15, walkthrough: 30, maxPercent: 50 } }).expect(200);
    const [filter, update] = models.AppSetting.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ key: 'platform' });
    expect(update.$set.hintCosts).toEqual(stored);
    expect(update.$unset).toBeUndefined();
    expect(body.hintCosts).toEqual(stored);
    expect(models.AuditLog.create.mock.calls.at(-1)[0]).toMatchObject({
      action: 'settings.update', targetId: 'platform', before: { hintCosts: DEFAULTS }, after: { hintCosts: stored },
    });
  });

  it('accepts the free preset (all zero) and a disabled switch', async () => {
    const free = { enabled: true, nudge: 0, approach: 0, walkthrough: 0, maxPercent: 0 };
    models.AppSetting.findOneAndUpdate.mockImplementation(() => chain(saved(free)));
    await put({ hintCosts: free }).expect(200);
    await put({ hintCosts: { ...free, enabled: false } }).expect(200);
    expect(models.AppSetting.findOneAndUpdate.mock.calls[1][1].$set.hintCosts.enabled).toBe(false);
  });

  it('null resets to the defaults ($unset) and is audited', async () => {
    models.AppSetting.findOneAndUpdate.mockImplementation(() => chain(saved(undefined)));
    const { body } = await put({ hintCosts: null }).expect(200);
    const update = models.AppSetting.findOneAndUpdate.mock.calls[0][1];
    expect(update.$unset).toEqual({ hintCosts: 1 });
    expect(update.$set.hintCosts).toBeUndefined();
    expect(body.hintCosts).toEqual(DEFAULTS);
    expect(models.AuditLog.create.mock.calls.at(-1)[0]).toMatchObject({ action: 'settings.update', after: { hintCosts: DEFAULTS } });
  });

  it('can reset hint costs and clear the event in one request', async () => {
    models.AppSetting.findOneAndUpdate.mockImplementation(() => chain(saved(undefined)));
    await put({ hintCosts: null, event: null }).expect(200);
    expect(models.AppSetting.findOneAndUpdate.mock.calls[0][1].$unset).toEqual({ event: 1, hintCosts: 1 });
  });

  it.each([
    ['percent above 100', { nudge: 101 }],
    ['negative percent', { approach: -1 }],
    ['fraction', { walkthrough: 2.5 }],
    ['string number', { nudge: '5' }],
    ['null number', { maxPercent: null }],
    ['NaN-like text', { nudge: 'NaN' }],
    ['non-boolean enabled', { enabled: 'yes' }],
    ['unknown key', { surprise: 1 }],
    ['operator object', { nudge: { $gt: 0 } }],
  ])('rejects %s with 400 and writes nothing', async (label, hintCosts) => {
    const res = await put({ hintCosts }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(models.AppSetting.findOneAndUpdate).not.toHaveBeenCalled();
    expect(models.AuditLog.create).not.toHaveBeenCalled();
  });

  it.each([[[]], ['text'], [5]])('rejects a non-object hintCosts %j', async (value) => {
    await put({ hintCosts: value }).expect(400);
    expect(models.AppSetting.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('only admins may change it', async () => {
    await put({ hintCosts: DEFAULTS }, 'player').expect(403);
    await api('put', '/admin/settings', { as: null, body: { hintCosts: DEFAULTS } }).expect(401);
    expect(models.AppSetting.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not touch hintCosts when another setting changes', async () => {
    models.AppSetting.findOneAndUpdate.mockImplementation(() => chain(saved(undefined)));
    await put({ submissionsFrozen: true }).expect(200);
    const update = models.AppSetting.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.hintCosts).toBeUndefined();
    expect(update.$unset).toBeUndefined();
  });
});
