import os from 'node:os';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRequestCounter, installShutdownFlush, replicaCounter,
} from '../src/middleware/requestCounter.js';

vi.mock('../src/models/ReplicaStat.js', () => ({ default: { updateOne: vi.fn() } }));

let model;
let log;

const hit = (counter, path) => {
  const next = vi.fn();
  counter.middleware({ path }, {}, next);
  return next;
};
const make = (options = {}) => createRequestCounter({ model, replica: 'backend-1', intervalMs: 5000, log, ...options });

beforeEach(() => {
  vi.useFakeTimers();
  model = { updateOne: vi.fn().mockResolvedValue({}) };
  log = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('request counter buffering', () => {
  it('counts /api requests but skips health checks and non-api paths', async () => {
    const counter = make();
    for (const path of ['/api/teams/me', '/api/admin/stats', '/api/challenges/123/submit', '/api/missing']) { hit(counter, path); }
    for (const path of ['/api/health', '/api/health/', '/API/Health', '/', '/assets/app.js', '/apix']) { hit(counter, path); }
    expect(counter.pending()).toBe(4);
    counter.stop();
  });

  it('always lets the request continue', () => {
    const counter = make();
    expect(hit(counter, '/api/teams/me')).toHaveBeenCalledOnce();
    expect(hit(counter, '/api/health')).toHaveBeenCalledOnce();
    counter.stop();
  });

  it('does not write to MongoDB per request, only one $inc upsert per interval', async () => {
    const counter = make();
    for (let i = 0; i < 50; i += 1) { hit(counter, '/api/teams/me'); }
    expect(model.updateOne).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4999);
    expect(model.updateOne).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    expect(model.updateOne).toHaveBeenCalledWith({ replica: 'backend-1' }, { $inc: { requests: 50 } }, { upsert: true });
    expect(counter.pending()).toBe(0);
    counter.stop();
  });

  it('adds only new requests on the next interval and writes nothing when idle', async () => {
    const counter = make();
    hit(counter, '/api/a');
    hit(counter, '/api/b');
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    hit(counter, '/api/c');
    await vi.advanceTimersByTimeAsync(5000);
    expect(model.updateOne).toHaveBeenCalledTimes(2);
    expect(model.updateOne.mock.calls[1][1]).toEqual({ $inc: { requests: 1 } });
    counter.stop();
  });

  it('uses the hostname as the replica name by default, like X-Served-By', () => {
    vi.useRealTimers();
    const counter = createRequestCounter({ model, log });
    hit(counter, '/api/teams/me');
    return counter.flush().then(() => {
      expect(model.updateOne.mock.calls[0][0]).toEqual({ replica: os.hostname() });
      counter.stop();
    });
  });

  it('does not start a timer until the first counted request, and unrefs it', () => {
    const unref = vi.fn();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref });
    const counter = make();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    hit(counter, '/api/health');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    hit(counter, '/api/teams/me');
    hit(counter, '/api/teams/me');
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(unref).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });

  it('runs the onStart hook once, when counting begins', () => {
    const onStart = vi.fn();
    const counter = make({ onStart });
    expect(onStart).not.toHaveBeenCalled();
    hit(counter, '/api/a');
    hit(counter, '/api/b');
    expect(onStart).toHaveBeenCalledTimes(1);
    counter.stop();
  });

  it('never breaks a request, even if reading the path throws', () => {
    const counter = make();
    const next = vi.fn();
    const request = { get path() { throw new Error('boom'); } };
    expect(() => counter.middleware(request, {}, next)).not.toThrow();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('request counter failures', () => {
  it('keeps the counts and retries on the next interval when MongoDB fails, logging once', async () => {
    model.updateOne.mockRejectedValueOnce(new Error('mongodb://user:pass@secret-host unreachable'));
    const counter = make();
    hit(counter, '/api/a');
    hit(counter, '/api/b');
    await vi.advanceTimersByTimeAsync(5000);
    expect(counter.pending()).toBe(2);
    hit(counter, '/api/c');
    await vi.advanceTimersByTimeAsync(5000);
    expect(model.updateOne).toHaveBeenCalledTimes(2);
    expect(model.updateOne.mock.calls[1][1]).toEqual({ $inc: { requests: 3 } });
    expect(counter.pending()).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).not.toContain('secret-host');
    counter.stop();
  });

  it('does not repeat the log line while failures continue, and logs again after a recovery', async () => {
    model.updateOne.mockRejectedValue(new Error('down'));
    const counter = make();
    hit(counter, '/api/a');
    await vi.advanceTimersByTimeAsync(15000);
    expect(log).toHaveBeenCalledTimes(1);
    model.updateOne.mockResolvedValueOnce({});
    await vi.advanceTimersByTimeAsync(5000);
    expect(counter.pending()).toBe(0);
    model.updateOne.mockRejectedValue(new Error('down again'));
    hit(counter, '/api/b');
    await vi.advanceTimersByTimeAsync(5000);
    expect(log).toHaveBeenCalledTimes(2);
    counter.stop();
  });

  it('survives a model that is not usable at all and keeps the count', async () => {
    const counter = make({ model: {} });
    hit(counter, '/api/a');
    await expect(counter.flush()).resolves.toBeUndefined();
    expect(counter.pending()).toBe(1);
    counter.stop();
  });

  it('writes concurrent flushes once without losing or double counting requests', async () => {
    let finish;
    model.updateOne.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const counter = make();
    hit(counter, '/api/a');
    hit(counter, '/api/b');
    const first = counter.flush();
    hit(counter, '/api/c');
    const second = counter.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    finish({});
    await Promise.all([first, second]);
    expect(model.updateOne).toHaveBeenCalledTimes(2);
    const written = model.updateOne.mock.calls.reduce((sum, call) => sum + call[1].$inc.requests, 0);
    expect(written).toBe(3);
    expect(counter.pending()).toBe(0);
    counter.stop();
  });
});

describe('flush on SIGTERM', () => {
  const fakeProcess = () => Object.assign(new EventEmitter(), { pid: 4321, kill: vi.fn() });

  it('saves the buffered counts and then re-raises SIGTERM so the process still exits', async () => {
    const counter = make();
    const proc = fakeProcess();
    installShutdownFlush(counter, { proc });
    hit(counter, '/api/a');
    hit(counter, '/api/b');
    proc.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(model.updateOne).toHaveBeenCalledWith({ replica: 'backend-1' }, { $inc: { requests: 2 } }, { upsert: true });
    expect(proc.kill).toHaveBeenCalledWith(4321, 'SIGTERM');
    counter.stop();
  });

  it('listens once and leaves shutdown to other SIGTERM handlers when there are any', async () => {
    const counter = make();
    const proc = fakeProcess();
    const other = vi.fn();
    proc.on('SIGTERM', other);
    installShutdownFlush(counter, { proc });
    hit(counter, '/api/a');
    proc.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
    expect(proc.kill).not.toHaveBeenCalled();
    expect(proc.listenerCount('SIGTERM')).toBe(1);
    counter.stop();
  });

  it('does not hang shutdown when MongoDB never answers', async () => {
    model.updateOne.mockReturnValue(new Promise(() => {}));
    const counter = make();
    const proc = fakeProcess();
    installShutdownFlush(counter, { proc, timeoutMs: 2000 });
    hit(counter, '/api/a');
    proc.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(1999);
    expect(proc.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(proc.kill).toHaveBeenCalledWith(4321, 'SIGTERM');
    counter.stop();
  });

  it('still exits when the final flush fails', async () => {
    model.updateOne.mockRejectedValue(new Error('down'));
    const counter = make();
    const proc = fakeProcess();
    installShutdownFlush(counter, { proc });
    hit(counter, '/api/a');
    proc.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(proc.kill).toHaveBeenCalledWith(4321, 'SIGTERM');
    counter.stop();
  });

  it('is installed by the app counter only once counting starts', () => {
    const before = process.listeners('SIGTERM');
    hit(replicaCounter, '/api/health');
    expect(process.listenerCount('SIGTERM')).toBe(before.length);
    hit(replicaCounter, '/api/teams/me');
    hit(replicaCounter, '/api/teams/me');
    const added = process.listeners('SIGTERM').filter((listener) => !before.includes(listener));
    expect(added).toHaveLength(1);
    added.forEach((listener) => process.off('SIGTERM', listener));
    replicaCounter.stop();
  });
});
