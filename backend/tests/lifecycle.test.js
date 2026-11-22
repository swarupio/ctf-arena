import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLifecycle } from '../src/lifecycle.js';

// Drives the shutdown logic with a fake process, server and collaborators: nothing real is stopped or closed.
function setup(options = {}) {
  const calls = [];
  const proc = Object.assign(new EventEmitter(), { exit: vi.fn(), stderr: { write: vi.fn() } });
  let finishClose;
  const server = {
    close: vi.fn((callback) => { calls.push('server.close'); finishClose = callback; }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  };
  const reaper = { stop: vi.fn(() => calls.push('reaper.stop')) };
  const counter = { stop: vi.fn(() => calls.push('counter.stop')), flush: vi.fn(async () => { calls.push('counter.flush'); }) };
  const mongoose = { disconnect: vi.fn(async () => { calls.push('mongo.disconnect'); }) };
  const lifecycle = createLifecycle({ server, reaper, counter, mongoose, proc, ...options });
  lifecycle.install();
  const log = () => proc.stderr.write.mock.calls.map(([line]) => line).join('');
  return { calls, proc, server, reaper, counter, mongoose, lifecycle, finish: () => finishClose(), log };
}

afterEach(() => vi.useRealTimers());

describe('graceful shutdown', () => {
  it('stops accepting, waits for in-flight requests, then flushes counts, closes Mongo and exits 0', async () => {
    const ctx = setup();
    ctx.proc.emit('SIGTERM');
    await Promise.resolve();
    expect(ctx.calls.slice(0, 3)).toEqual(['server.close', 'reaper.stop', 'counter.stop']);
    expect(ctx.server.closeIdleConnections).toHaveBeenCalled();
    // A request is still in flight: nothing after the drain happens yet.
    expect(ctx.mongoose.disconnect).not.toHaveBeenCalled();
    expect(ctx.proc.exit).not.toHaveBeenCalled();
    ctx.finish();
    await vi.waitFor(() => expect(ctx.proc.exit).toHaveBeenCalledWith(0));
    expect(ctx.calls).toEqual(['server.close', 'reaper.stop', 'counter.stop', 'counter.flush', 'mongo.disconnect']);
  });

  it('handles SIGINT the same way and only once for repeated shutdown calls', async () => {
    const ctx = setup();
    ctx.proc.emit('SIGINT');
    ctx.lifecycle.shutdown('again');
    ctx.finish();
    await vi.waitFor(() => expect(ctx.proc.exit).toHaveBeenCalledWith(0));
    expect(ctx.server.close).toHaveBeenCalledTimes(1);
    expect(ctx.mongoose.disconnect).toHaveBeenCalledTimes(1);
  });

  it('a second signal exits immediately without waiting', () => {
    const ctx = setup();
    ctx.proc.emit('SIGTERM');
    ctx.proc.emit('SIGTERM');
    expect(ctx.proc.exit).toHaveBeenCalledWith(1);
  });

  it('gives up draining after the limit, closes the remaining connections and still exits', async () => {
    vi.useFakeTimers();
    const ctx = setup({ timeoutMs: 1000 });
    ctx.proc.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(1001);
    expect(ctx.server.closeAllConnections).toHaveBeenCalled();
    expect(ctx.mongoose.disconnect).toHaveBeenCalled();
    expect(ctx.proc.exit).toHaveBeenCalledWith(0);
    expect(ctx.log()).toContain('drain limit reached');
  });

  it('survives collaborators that fail or are missing', async () => {
    const ctx = setup();
    ctx.counter.flush.mockRejectedValue(new Error('db gone'));
    ctx.mongoose.disconnect.mockRejectedValue(new Error('db gone'));
    ctx.proc.emit('SIGTERM');
    ctx.finish();
    await vi.waitFor(() => expect(ctx.proc.exit).toHaveBeenCalledWith(0));
    const bare = createLifecycle({ proc: ctx.proc });
    await bare.shutdown('manual');
    expect(ctx.proc.exit).toHaveBeenCalledTimes(2);
  });
});

describe('fatal errors', () => {
  it('logs only the error class and code on an unhandled rejection, then exits non-zero', async () => {
    const ctx = setup();
    const secret = 'mongodb://user:hunter2@cluster/db';
    ctx.proc.emit('unhandledRejection', Object.assign(new TypeError(secret), { code: 'ERR_X' }));
    ctx.finish();
    await vi.waitFor(() => expect(ctx.proc.exit).toHaveBeenCalledWith(1));
    expect(ctx.log()).toContain('[fatal] unhandledRejection TypeError code=ERR_X');
    expect(ctx.log()).not.toContain('hunter2');
    expect(ctx.log()).not.toContain(' at ');
  });

  it('does the same for an uncaught exception, also with a non-error value', async () => {
    const ctx = setup();
    ctx.proc.emit('uncaughtException', new RangeError('boom'));
    ctx.finish();
    await vi.waitFor(() => expect(ctx.proc.exit).toHaveBeenCalledWith(1));
    expect(ctx.log()).toContain('[fatal] uncaughtException RangeError');
    const other = setup();
    other.proc.emit('unhandledRejection', 'a string reason with a secret');
    other.finish();
    await vi.waitFor(() => expect(other.proc.exit).toHaveBeenCalledWith(1));
    expect(other.log()).toContain('[fatal] unhandledRejection string');
    expect(other.log()).not.toContain('secret');
  });

  it('exits 1 within the short fatal limit even when requests never finish', async () => {
    vi.useFakeTimers();
    const ctx = setup({ fatalTimeoutMs: 500 });
    ctx.proc.emit('uncaughtException', new Error('x'));
    await vi.advanceTimersByTimeAsync(501);
    expect(ctx.proc.exit).toHaveBeenCalledWith(1);
  });

  it('can start fatal handling before the HTTP server exists (startup failure)', async () => {
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn(), stderr: { write: vi.fn() } });
    const lifecycle = createLifecycle({ proc });
    lifecycle.install();
    proc.emit('unhandledRejection', new Error('early'));
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(1));
  });
});
