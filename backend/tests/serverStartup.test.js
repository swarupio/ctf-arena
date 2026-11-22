import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';

vi.mock('../src/config/env.js', () => ({
  env: { PORT: 4000, MONGODB_URI: 'mongodb://test-user:test-password@localhost/test', DOCKER_ENABLED: false },
}));
vi.mock('../src/config/db.js', () => ({ connectDB: vi.fn() }));
vi.mock('../src/app.js', () => ({ default: { listen: vi.fn() } }));
vi.mock('../src/services/reaper.js', () => ({ reaper: { start: vi.fn(), stop: vi.fn() } }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function boot() {
  vi.resetModules();
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
  const handlers = {};
  const server = { on: vi.fn((event, handler) => { handlers[event] = handler; }) };
  connectDB.mockResolvedValue(undefined);
  app.listen.mockImplementation((port, callback) => { callback(); return server; });
  await import('../src/server.js');
  return { server, handlers, stderr, exit };
}

describe('server startup hardening', () => {
  it('retries the first database connection and sets slow-client and keep-alive limits', async () => {
    const { server } = await boot();
    expect(connectDB).toHaveBeenCalledWith('mongodb://test-user:test-password@localhost/test', { attempts: 5 });
    expect(server.requestTimeout).toBeGreaterThan(0);
    expect(server.headersTimeout).toBeGreaterThan(0);
    expect(server.headersTimeout).toBeLessThanOrEqual(server.requestTimeout);
    expect(server.keepAliveTimeout).toBeGreaterThan(60_000);
  });

  it('explains EADDRINUSE and EACCES in plain words and exits 1', async () => {
    const { handlers, stderr, exit } = await boot();
    handlers.error({ code: 'EADDRINUSE' });
    expect(stderr).toHaveBeenLastCalledWith(expect.stringContaining('port 4000 is already in use'));
    handlers.error({ code: 'EACCES' });
    expect(stderr).toHaveBeenLastCalledWith(expect.stringContaining('no permission to listen on port 4000'));
    handlers.error(new Error('mongodb://secret'));
    expect(stderr).toHaveBeenLastCalledWith('Backend could not start listening. Check PORT and whether it is already in use.\n');
    expect(exit).toHaveBeenCalledTimes(3);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not install process-level handlers under the test runner', async () => {
    const before = process.listenerCount('unhandledRejection');
    await boot();
    expect(process.listenerCount('unhandledRejection')).toBe(before);
  });
});
