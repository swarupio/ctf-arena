import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectDB } from '../src/config/db.js';

vi.mock('mongoose', () => ({ default: { connect: vi.fn(), set: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

describe('MongoDB connection retry at startup', () => {
  it('retries with exponential backoff and never logs the driver error', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    mongoose.connect.mockReset();
    mongoose.connect
      .mockRejectedValueOnce(new Error('mongodb://u:hunter2@host first'))
      .mockRejectedValueOnce(new Error('mongodb://u:hunter2@host second'))
      .mockResolvedValueOnce(mongoose);
    const sleep = vi.fn(async () => {});
    await connectDB('mongodb://localhost/test', { attempts: 5, baseDelayMs: 1000, sleep });
    expect(mongoose.connect).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    const log = stderr.mock.calls.map(([line]) => line).join('');
    expect(log).toContain('attempt 1/5 failed');
    expect(log).not.toContain('hunter2');
  });

  it('caps the delay and rethrows the last error after the final attempt', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    mongoose.connect.mockReset();
    mongoose.connect.mockRejectedValue(new Error('still down'));
    const sleep = vi.fn(async () => {});
    await expect(connectDB('mongodb://localhost/test', { attempts: 4, baseDelayMs: 4000, maxDelayMs: 6000, sleep }))
      .rejects.toThrow('still down');
    expect(mongoose.connect).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([4000, 6000, 6000]);
  });

  it('makes a single attempt by default (serverless fails fast)', async () => {
    mongoose.connect.mockReset();
    mongoose.connect.mockRejectedValue(new Error('down'));
    const sleep = vi.fn();
    await expect(connectDB('mongodb://localhost/test', { sleep })).rejects.toThrow('down');
    expect(mongoose.connect).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
