import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';

vi.mock('../src/config/env.js', () => ({
  env: { PORT: 4000, MONGODB_URI: 'mongodb://test-user:test-password@localhost/test' },
}));
vi.mock('../src/config/db.js', () => ({ connectDB: vi.fn() }));
vi.mock('../src/app.js', () => ({ default: { listen: vi.fn() } }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('startup', () => {
  it('waits for MongoDB before listening for requests', async () => {
    vi.resetModules();
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const on = vi.fn();
    let finishConnection;
    const connecting = new Promise((resolve) => { finishConnection = resolve; });
    const called = new Promise((resolve) => {
      connectDB.mockImplementation(() => { resolve(); return connecting; });
    });
    app.listen.mockImplementation((port, callback) => { callback(); return { on }; });
    const startup = import('../src/server.js');
    await called;
    expect(app.listen).not.toHaveBeenCalled();
    finishConnection();
    await startup;
    expect(app.listen).toHaveBeenCalledWith(4000, expect.any(Function));
    expect(stdout).toHaveBeenCalledWith('Backend listening on port 4000\n');
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('exits on connection failure without exposing credentials or starting HTTP', async () => {
    vi.resetModules();
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('startup refused'); });
    connectDB.mockRejectedValueOnce(new Error('mongodb://test-user:test-password@localhost/test'));
    await expect(import('../src/server.js')).rejects.toThrow('startup refused');
    expect(exit).toHaveBeenCalledWith(1);
    expect(app.listen).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      'MongoDB connection failed. Check MONGODB_URI, credentials, and network access.\n',
    );
  });
});
