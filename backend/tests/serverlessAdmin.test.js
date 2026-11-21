import mongoose from 'mongoose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Serverless correctness of the admin features: on Vercel mongoose.connect runs with bufferCommands false (config/db.js),
// and api/index.js connects before any route. This file runs the REAL models with that option and no connection, to prove
// the audit writer and the settings reads fail or fall open immediately instead of buffering for 10 s.
// dbOffline() (a test-only shortcut) is forced to false so the real code path is exercised.
vi.mock('../src/services/adminCommon.js', async (importOriginal) => ({ ...(await importOriginal()), dbOffline: () => false }));

const FAST_MS = 1500;
let recordAudit;
let assertSubmissionsOpen;
let getSettings;
let updateSettings;

async function timed(work) {
  const start = Date.now();
  const settled = await Promise.allSettled([work()]);
  return { elapsed: Date.now() - start, result: settled[0] };
}

beforeAll(async () => {
  mongoose.set('bufferCommands', false);
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  expect(mongoose.connection.readyState).toBe(0);
  ({ recordAudit } = await import('../src/services/adminAudit.js'));
  ({ assertSubmissionsOpen, getSettings, updateSettings } = await import('../src/services/adminSettings.js'));
});

describe('admin features without a live connection (bufferCommands false)', () => {
  it('the audit writer rejects immediately instead of hanging for 10 s', async () => {
    const req = { user: { cognitoSub: 'admin', email: 'admin@example.com' }, get: () => undefined, socket: {}, adminActor: null };
    const { elapsed, result } = await timed(() => recordAudit(req, { action: 'team.ban', targetType: 'team', targetId: 'x' }));
    expect(result.status).toBe('rejected');
    expect(elapsed).toBeLessThan(FAST_MS);
  });

  it('the submission freeze guard fails open immediately', async () => {
    const { elapsed, result } = await timed(() => assertSubmissionsOpen());
    expect(result.status).toBe('fulfilled');
    expect(elapsed).toBeLessThan(FAST_MS);
  });

  it('settings reads and writes reject immediately (no buffering)', async () => {
    for (const work of [() => getSettings(), () => updateSettings({ registrationOpen: false }, 'admin@example.com')]) {
      const { elapsed, result } = await timed(work);
      expect(result.status).toBe('rejected');
      expect(elapsed).toBeLessThan(FAST_MS);
    }
  });
});
