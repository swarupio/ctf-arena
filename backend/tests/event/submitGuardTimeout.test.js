// The submit guard reads the platform settings with a 2 s bound and fails CLOSED: a slow or failing read is a retryable
// 503 SETTINGS_UNAVAILABLE, never "submissions are open".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppSetting from '../../src/models/AppSetting.js';
import { SETTINGS_TIMEOUT_MS, assertSubmissionsOpen } from '../../src/services/adminSettings.js';

vi.mock('../../src/services/adminCommon.js', async (importOriginal) => ({ ...(await importOriginal()), dbOffline: () => false }));
vi.mock('../../src/models/AppSetting.js', () => ({ default: { findOne: vi.fn() }, ANNOUNCEMENT_LEVELS: ['info', 'warning', 'critical'] }));

const lean = (value) => ({ lean: () => value });
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('assertSubmissionsOpen without a usable settings read', () => {
  it('answers 503 SETTINGS_UNAVAILABLE when the read hangs past the timeout', async () => {
    vi.useFakeTimers();
    AppSetting.findOne.mockReturnValue(lean(new Promise(() => {})));
    const outcome = assertSubmissionsOpen().then(() => 'open', (error) => error);
    await vi.advanceTimersByTimeAsync(SETTINGS_TIMEOUT_MS + 1);
    expect(await outcome).toMatchObject({ status: 503, code: 'SETTINGS_UNAVAILABLE' });
  });

  it('answers 503 SETTINGS_UNAVAILABLE when the read rejects, and when it throws synchronously', async () => {
    AppSetting.findOne.mockReturnValue(lean(Promise.reject(new Error('boom'))));
    await expect(assertSubmissionsOpen()).rejects.toMatchObject({ status: 503, code: 'SETTINGS_UNAVAILABLE' });
    AppSetting.findOne.mockImplementation(() => { throw new Error('boom'); });
    await expect(assertSubmissionsOpen()).rejects.toMatchObject({ status: 503, code: 'SETTINGS_UNAVAILABLE' });
  });

  it('still allows when the read works and nothing blocks, and still refuses a freeze with 423', async () => {
    AppSetting.findOne.mockReturnValue(lean(Promise.resolve(null)));
    await expect(assertSubmissionsOpen()).resolves.toBeUndefined();
    AppSetting.findOne.mockReturnValue(lean(Promise.resolve({ submissionsFrozen: true })));
    await expect(assertSubmissionsOpen()).rejects.toMatchObject({ status: 423, code: 'SUBMISSIONS_FROZEN' });
  });
});
