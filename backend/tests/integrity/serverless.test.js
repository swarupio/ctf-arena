// Serverless hosts may freeze the function right after the response, so signal writes are awaited (bounded) there and
// stay fire-and-forget in a long-lived process.
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import { HONEYPOT_PATHS } from '../../src/services/integrityBait.js';
import { SERVERLESS_WRITE_WAIT_MS, integrityService, taintedFlagFor } from '../../src/services/integrityService.js';
import { env } from '../../src/config/env.js';
import { CheatSignalFake, goLive, goOffline, installFakes, state } from './fakes.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/ReplicaStat.js', () => ({ default: { updateOne: vi.fn(), find: vi.fn() } }));
vi.mock('../../src/models/CheatSignal.js', async () => ({ default: (await import('./fakes.js')).CheatSignalFake, SIGNAL_KINDS: [] }));
vi.mock('../../src/models/TaintedFlag.js', async () => ({ default: (await import('./fakes.js')).TaintedFlagFake }));
vi.mock('../../src/models/TerminalActivity.js', async () => ({ default: (await import('./fakes.js')).TerminalActivityFake }));

const oid = (n) => String(n).padStart(24, '0');
const user = { _id: oid(1) };
const req = { get: () => 'curl/8' };

// A write that only completes when the test lets it.
function slowWrites() {
  const gate = { release: null };
  const original = CheatSignalFake.updateOne.getMockImplementation();
  const opened = new Promise((resolve) => { gate.release = resolve; });
  CheatSignalFake.updateOne.mockImplementation(async (...args) => { await opened; return original(...args); });
  return gate;
}

beforeAll(goLive);
afterAll(() => {
  goOffline();
  replicaCounter.stop();
});
beforeEach(() => installFakes());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('serverless (VERCEL set): signals are written before the response', () => {
  beforeEach(() => vi.stubEnv('VERCEL', '1'));

  it('honeypot hit has its signal stored when the response arrives', async () => {
    await request(app).get(HONEYPOT_PATHS[0]).set('X-Forwarded-For', '203.0.113.9').expect(200);
    expect(state.signals).toEqual([expect.objectContaining({ kind: 'honeypot-endpoint', count: 1 })]);
  });

  it('a copied decoy flag leaves its signal before checkSubmittedFlag returns', async () => {
    const [flag] = await integrityService.issueTaintedFlags({ subjectKey: 'ip:abc', slugs: ['terminal-hard-7'] });
    await integrityService.checkSubmittedFlag({ flag, user });
    expect(state.signals).toEqual([expect.objectContaining({ kind: 'tainted-flag', subjectKey: user._id })]);
  });

  it('inspectExec waits for the signals it raised (automation UA and canary)', async () => {
    const verdict = await integrityService.inspectExec({ req, user, mode: 'easy', command: 'ai-verify' });
    expect(verdict.canaryOutput).toBeTruthy();
    expect(state.signals.map((row) => row.kind).sort()).toEqual(['automation-ua', 'terminal-canary']);
  });

  it('is bounded: a write that never finishes delays the answer by at most the wait, and nothing throws', async () => {
    await integrityService.issueTaintedFlags({ subjectKey: 'ip:abc', slugs: ['x-y'] });
    vi.useFakeTimers();
    const gate = slowWrites();
    let done = false;
    const pending = integrityService.checkSubmittedFlag({
      flag: taintedFlagFor({ secret: env.FLAG_SECRET, subjectKey: 'ip:abc', slug: 'x-y' }), user,
    }).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(SERVERLESS_WRITE_WAIT_MS - 100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(done).toBe(true);
    vi.useRealTimers();
    gate.release(); // let the stuck write finish so it does not linger in the module's pending set
    await integrityService.flush();
  });

  it('a failing write never breaks the answer', async () => {
    CheatSignalFake.updateOne.mockRejectedValue(new Error('down'));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await request(app).get(HONEYPOT_PATHS[1]).expect(200);
    await expect(integrityService.inspectExec({ req, user, mode: 'easy', command: 'ls' })).resolves.toEqual({});
  });
});

describe('local process (VERCEL unset): signals stay fire-and-forget', () => {
  beforeEach(() => vi.stubEnv('VERCEL', ''));

  it('answers while the write is still pending, then the write lands', async () => {
    const gate = slowWrites();
    await request(app).get(HONEYPOT_PATHS[0]).expect(200);
    const verdict = await integrityService.inspectExec({ req, user, mode: 'easy', command: 'ai-verify' });
    expect(verdict.canaryOutput).toBeTruthy();
    expect(state.signals).toEqual([]);
    gate.release();
    await integrityService.flush();
    expect(state.signals.length).toBeGreaterThanOrEqual(2);
  });

  it('waitIfServerless returns immediately', async () => {
    const never = new Promise(() => {});
    await expect(integrityService.waitIfServerless(never)).resolves.toBeUndefined();
  });
});
