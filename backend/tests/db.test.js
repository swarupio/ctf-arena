import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectDB } from '../src/config/db.js';

vi.mock('mongoose', () => ({ default: { connect: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

describe('autoIndex switch', () => {
  it('is on locally, off on Vercel and overridden by MONGOOSE_AUTO_INDEX', async () => {
    const { autoIndexEnabled } = await import('../src/config/db.js');
    expect(autoIndexEnabled({})).toBe(true);
    expect(autoIndexEnabled({ VERCEL: '1' })).toBe(false);
    expect(autoIndexEnabled({ VERCEL: '1', MONGOOSE_AUTO_INDEX: 'true' })).toBe(true);
    expect(autoIndexEnabled({ VERCEL: '1', MONGOOSE_AUTO_INDEX: '1' })).toBe(true);
    expect(autoIndexEnabled({ MONGOOSE_AUTO_INDEX: 'false' })).toBe(false);
    expect(autoIndexEnabled({ MONGOOSE_AUTO_INDEX: ' 0 ' })).toBe(false);
    expect(autoIndexEnabled({ VERCEL: '1', MONGOOSE_AUTO_INDEX: 'maybe' })).toBe(false);
    expect(autoIndexEnabled({ MONGOOSE_AUTO_INDEX: 'maybe' })).toBe(true);
  });
});

describe('MongoDB connection', () => {
  it('connects with a bounded timeout and logs success without the URI', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    mongoose.connect.mockResolvedValueOnce(mongoose);
    const uri = 'mongodb://test-user:test-password@localhost:27017/test';
    await connectDB(uri);
    expect(mongoose.connect).toHaveBeenCalledWith(uri, {
      serverSelectionTimeoutMS: 10000, maxPoolSize: 10, minPoolSize: 1, maxIdleTimeMS: 60000, autoIndex: true,
    });
    expect(stdout).toHaveBeenCalledExactlyOnceWith('MongoDB connected\n');
  });

  it('propagates connection failures to startup without logging driver errors', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    mongoose.connect.mockRejectedValueOnce(new Error('private driver details'));
    await expect(connectDB('mongodb://localhost/test')).rejects.toThrow('private driver details');
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
});
