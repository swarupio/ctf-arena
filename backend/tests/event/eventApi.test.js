// Scheduled event: GET /api/event, the 423 guard on every scoring submit path, and the admin settings that configure it.
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import { getTeamContext } from '../../src/services/teamContext.js';
import * as cipherlab from '../../src/games/cipherlab/service.js';
import * as crackme from '../../src/games/crackme/service.js';
import * as forensics from '../../src/services/forensicsService.js';
import * as osint from '../../src/services/osintService.js';
import * as weblab from '../../src/services/weblabService.js';
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
vi.mock('../../src/services/teamContext.js', () => ({ getTeamContext: vi.fn() }));
vi.mock('../../src/services/integrityService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, integrityService: { ...actual.integrityService, checkSubmittedFlag: vi.fn() } };
});
vi.mock('../../src/games/cipherlab/service.js', () => ({ loadGame: vi.fn(), findEntry: vi.fn(), submitAnswer: vi.fn() }));
vi.mock('../../src/games/crackme/service.js', () => ({ loadGame: vi.fn(), findEntry: vi.fn(), submitAnswer: vi.fn(), submitPatch: vi.fn() }));
vi.mock('../../src/services/forensicsService.js', () => ({ loadRows: vi.fn(), submitAnswer: vi.fn() }));
vi.mock('../../src/services/osintService.js', () => ({ loadRows: vi.fn(), submitAnswer: vi.fn() }));
vi.mock('../../src/services/weblabService.js', () => ({ loadRows: vi.fn(), teamProgress: vi.fn(), requireOpen: vi.fn(), submitFlag: vi.fn() }));

const HOUR = 3_600_000;
const offset = (hours) => new Date(Date.now() + hours * HOUR);
const stored = (startHours, endHours, freezeHours = null) => ({
  name: 'Winter Cup', startsAt: offset(startHours), endsAt: offset(endHours), freezeAt: freezeHours === null ? undefined : offset(freezeHours),
});
const PHASES = {
  upcoming: stored(1, 5), live: stored(-1, 4, 3), frozen: stored(-3, 2, -1), ended: stored(-5, -1, -2),
};
const setPlatform = (doc) => models.AppSetting.findOne.mockImplementation(() => chain(doc));

const api = (method, path, { as = 'admin', body } = {}) => {
  let call = request(app)[method](`/api${path}`);
  if (as) { call = call.set('Authorization', `Bearer ${as}`); }
  return body === undefined ? call : call.send(body);
};

beforeAll(() => {
  // The audit log and settings reads skip themselves without a database connection in tests; pretend to be connected.
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
});
afterAll(() => {
  delete mongoose.connection.readyState;
  replicaCounter.stop();
});

beforeEach(() => {
  vi.clearAllMocks();
  resetModels();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  models.User.findOne.mockImplementation(() => chain({ _id: oid(900) }));
  getTeamContext.mockResolvedValue({ user: { _id: 'u1' }, team: { _id: 't1' } });
  cipherlab.loadGame.mockResolvedValue([]);
  cipherlab.findEntry.mockReturnValue({});
  crackme.loadGame.mockResolvedValue([]);
  crackme.findEntry.mockReturnValue({});
  forensics.loadRows.mockResolvedValue(new Map());
  osint.loadRows.mockResolvedValue(new Map());
  weblab.loadRows.mockResolvedValue(new Map());
  weblab.teamProgress.mockResolvedValue(new Map());
  weblab.requireOpen.mockReturnValue({});
  for (const service of [cipherlab.submitAnswer, crackme.submitAnswer, crackme.submitPatch, forensics.submitAnswer, osint.submitAnswer, weblab.submitFlag]) {
    service.mockResolvedValue({ correct: true });
  }
});

describe('GET /api/event', () => {
  it('is public and reports "none" when no event is configured', async () => {
    const res = await api('get', '/event', { as: null }).expect(200);
    expect(res.body).toEqual({ name: '', phase: 'none', startsAt: null, endsAt: null, freezeAt: null, serverTime: expect.any(String) });
    expect(res.headers['cache-control']).toBe('public, max-age=3');
    expect(Number.isNaN(Date.parse(res.body.serverTime))).toBe(false);
  });

  it.each(Object.keys(PHASES))('derives the phase %s from the stored times and the clock', async (phase) => {
    setPlatform({ event: PHASES[phase], submissionsFrozen: true, announcement: { text: 'private?' }, updatedBy: 'x@y.z' });
    const { body } = await api('get', '/event', { as: null }).expect(200);
    expect(body.phase).toBe(phase);
    expect(Object.keys(body).sort()).toEqual(['endsAt', 'freezeAt', 'name', 'phase', 'serverTime', 'startsAt']);
    expect(body.startsAt).toBe(PHASES[phase].startsAt.toISOString());
  });

  it('treats a half-configured event as none', async () => {
    setPlatform({ event: { name: 'x', startsAt: offset(1) } });
    expect((await api('get', '/event', { as: null }).expect(200)).body.phase).toBe('none');
  });

  it('only exposes GET', async () => {
    await api('post', '/event', { as: 'admin', body: {} }).expect(404);
  });
});

// Every route that records points or progress for the team. Admins never reach them (player-only), so their preview is unaffected.
const SUBMIT_ROUTES = [
  ['challenges', `/challenges/${oid(5)}/submit`, { flag: 'CTF{x}' }, null],
  ['terminal', '/terminal/easy/submit', { flag: 'CTF{x}' }, null],
  ['cipherlab answer', '/cipherlab/levels/a1/answer', { answer: 'x' }, cipherlab.submitAnswer],
  ['crackme answer', '/crackme/levels/a1/answer', { answer: 'x' }, crackme.submitAnswer],
  ['crackme patch', '/crackme/levels/a1/patch', { edits: [{ index: 0, op: 'NOP' }] }, crackme.submitPatch],
  ['weblab submit', '/weblab/labs/weblab-cookie-tamper/submit', { flag: 'CTF{x}' }, weblab.submitFlag],
  ['forensics answer', '/forensics/tracks/easy/stages/1/answer', { answer: 'x' }, forensics.submitAnswer],
  ['osint answer', '/osint/cases/easy/questions/1/answer', { answer: 'x' }, osint.submitAnswer],
];

describe.each(SUBMIT_ROUTES)('event guard on %s', (name, path, body, service) => {
  const post = () => api('post', path, { as: 'p1', body });

  it('answers 423 EVENT_NOT_STARTED before the start and records nothing', async () => {
    setPlatform({ event: PHASES.upcoming });
    const res = await post();
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('EVENT_NOT_STARTED');
    expect(res.body.error.message).toMatch(/not started/);
    if (service) { expect(service).not.toHaveBeenCalled(); }
    expect(models.Submission.create).not.toHaveBeenCalled();
  });

  it('answers 423 EVENT_ENDED after the end and records nothing', async () => {
    setPlatform({ event: PHASES.ended });
    const res = await post();
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('EVENT_ENDED');
    if (service) { expect(service).not.toHaveBeenCalled(); }
    expect(models.Submission.create).not.toHaveBeenCalled();
  });

  it.each(['live', 'frozen'])('accepts submissions while the event is %s', async (phase) => {
    setPlatform({ event: PHASES[phase] });
    const res = await post();
    expect(res.status).not.toBe(423);
    if (service) { expect(res.status).toBe(200); expect(service).toHaveBeenCalledTimes(1); }
  });

  it.each([['no settings document', null], ['an unrelated document', { submissionsFrozen: false, registrationOpen: true }],
    ['a half-configured event', { event: { name: 'x', startsAt: offset(5) } }]])('is unchanged with %s', async (label, doc) => {
    setPlatform(doc);
    const res = await post();
    expect(res.status).not.toBe(423);
    if (service) { expect(res.status).toBe(200); }
  });

  it('fails CLOSED with a retryable 503 SETTINGS_UNAVAILABLE when the settings read errors, recording nothing', async () => {
    models.AppSetting.findOne.mockImplementation(() => { throw new Error('settings store down'); });
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SETTINGS_UNAVAILABLE');
    expect(res.body.error.message).toMatch(/retry/i);
    expect(JSON.stringify(res.body)).not.toContain('settings store down');
    if (service) { expect(service).not.toHaveBeenCalled(); }
    expect(models.Submission.create).not.toHaveBeenCalled();
  });

  it('keeps answering SUBMISSIONS_FROZEN first when an admin also froze submissions', async () => {
    setPlatform({ submissionsFrozen: true, event: PHASES.live });
    const res = await post();
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('SUBMISSIONS_FROZEN');
  });
});

describe('read-only routes stay open outside the event window', () => {
  it('serves the challenge list and the leaderboard before the start and after the end', async () => {
    for (const phase of ['upcoming', 'ended']) {
      setPlatform({ event: PHASES[phase] });
      await api('get', '/challenges', { as: 'p1' }).expect(200);
      await api('get', '/leaderboard', { as: 'p1' }).expect(200);
    }
  });
});

describe('platform settings: event', () => {
  const put = (body, as = 'admin') => api('put', '/admin/settings', { as, body });
  const good = { name: '  Winter Cup ', startsAt: '2030-12-05T18:00:00.000Z', endsAt: '2030-12-05T22:00:00.000Z', freezeAt: '2030-12-05T21:00:00.000Z' };
  const savedDoc = {
    registrationOpen: true, submissionsFrozen: false, announcement: { text: '', level: 'info' }, updatedAt: new Date('2026-11-22T10:00:00Z'),
    event: { name: 'Winter Cup', startsAt: new Date(good.startsAt), endsAt: new Date(good.endsAt), freezeAt: new Date(good.freezeAt) },
  };

  it('defaults to no event, additively (existing keys unchanged)', async () => {
    const { body } = await api('get', '/admin/settings').expect(200);
    expect(body).toEqual({ registrationOpen: true, submissionsFrozen: false, announcement: { text: '', level: 'info' }, event: null, hintCosts: { enabled: true, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40 }, updatedAt: null });
  });

  it('stores a valid schedule as dates, returns the phase, and writes an audit entry', async () => {
    models.AppSetting.findOneAndUpdate.mockImplementation(() => chain(savedDoc));
    const { body } = await put({ event: good }).expect(200);
    const [filter, update] = models.AppSetting.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ key: 'platform' });
    expect(update.$set.event).toEqual({ name: 'Winter Cup', startsAt: new Date(good.startsAt), endsAt: new Date(good.endsAt), freezeAt: new Date(good.freezeAt) });
    expect(update.$unset).toBeUndefined();
    expect(body.event).toEqual({ name: 'Winter Cup', startsAt: good.startsAt, endsAt: good.endsAt, freezeAt: good.freezeAt, phase: 'upcoming' });
    const entry = models.AuditLog.create.mock.calls.at(-1)[0];
    expect(entry).toMatchObject({ action: 'settings.update', targetId: 'platform', after: { event: { name: 'Winter Cup', startsAt: good.startsAt } } });
  });

  it('accepts offsets (converted to the same instant) and an event without a freeze or a name', async () => {
    models.AppSetting.findOneAndUpdate.mockImplementation(() => chain(savedDoc));
    await put({ event: { startsAt: '2030-12-05T19:00:00+01:00', endsAt: '2030-12-05T22:00:00Z' } }).expect(200);
    expect(models.AppSetting.findOneAndUpdate.mock.calls[0][1].$set.event).toEqual({
      name: '', startsAt: new Date('2030-12-05T18:00:00.000Z'), endsAt: new Date('2030-12-05T22:00:00.000Z'), freezeAt: null,
    });
  });

  it('clears the event with null ($unset) and audits it', async () => {
    models.AppSetting.findOneAndUpdate.mockImplementation(() => chain({ ...savedDoc, event: undefined }));
    const { body } = await put({ event: null }).expect(200);
    const update = models.AppSetting.findOneAndUpdate.mock.calls[0][1];
    expect(update.$unset).toEqual({ event: 1 });
    expect(update.$set.event).toBeUndefined();
    expect(body.event).toBeNull();
    expect(models.AuditLog.create.mock.calls.at(-1)[0]).toMatchObject({ action: 'settings.update', after: { event: null } });
  });

  it.each([
    ['end before start', { ...good, startsAt: good.endsAt, endsAt: good.startsAt, freezeAt: null }],
    ['end equals start', { ...good, endsAt: good.startsAt, freezeAt: null }],
    ['freeze before the start', { ...good, freezeAt: '2030-12-05T17:00:00.000Z' }],
    ['freeze equals the start', { ...good, freezeAt: good.startsAt }],
    ['freeze equals the end', { ...good, freezeAt: good.endsAt }],
    ['freeze after the end', { ...good, freezeAt: '2030-12-05T23:00:00.000Z' }],
    ['bad start date', { ...good, startsAt: 'tomorrow' }],
    ['date without a zone', { ...good, startsAt: '2030-12-05T18:00:00' }],
    ['absurd year', { ...good, endsAt: '9999-12-05T22:00:00.000Z' }],
    ['missing start', { endsAt: good.endsAt }],
    ['missing end', { startsAt: good.startsAt }],
    ['name too long', { ...good, name: 'x'.repeat(81) }],
    ['unknown field', { ...good, extra: true }],
    ['numbers instead of ISO text', { ...good, startsAt: 1 }],
    ['an empty object', {}],
  ])('rejects %s with 400 and writes nothing', async (label, event) => {
    const res = await put({ event }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(models.AppSetting.findOneAndUpdate).not.toHaveBeenCalled();
    expect(models.AuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects top-level eventName style keys (strict body)', async () => {
    await put({ eventStartsAt: good.startsAt }).expect(400);
    expect(models.AppSetting.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('only admins may change it', async () => {
    await put({ event: good }, 'player').expect(403);
    await api('put', '/admin/settings', { as: null, body: { event: good } }).expect(401);
    expect(models.AppSetting.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not touch the event when only another setting changes', async () => {
    models.AppSetting.findOneAndUpdate.mockImplementation(() => chain(savedDoc));
    await put({ submissionsFrozen: true }).expect(200);
    const update = models.AppSetting.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.event).toBeUndefined();
    expect(update.$unset).toBeUndefined();
  });
});
