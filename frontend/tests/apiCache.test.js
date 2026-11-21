import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiCache } from '../src/api/cache.js';
import { backoffDelay, startPolling } from '../src/pages/poller.js';

function setup(options = {}) {
  const calls = [];
  const clock = { time: 0 };
  const cache = createApiCache({
    request: (path) => new Promise((resolve, reject) => { calls.push({ path, resolve, reject }); }),
    now: () => clock.time,
    ...options,
  });
  return { cache, calls, clock };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('concurrent identical GETs share one request', async () => {
  const { cache, calls } = setup();
  const a = cache.get('/me');
  const b = cache.get('/me');
  assert.equal(calls.length, 1);
  calls[0].resolve({ id: 1 });
  assert.deepEqual(await a, { id: 1 });
  assert.deepEqual(await b, { id: 1 });
  // ttl 0 never serves from cache: the next call asks again.
  const c = cache.get('/me');
  assert.equal(calls.length, 2);
  calls[1].resolve({ id: 2 });
  assert.deepEqual(await c, { id: 2 });
});

test('a fresh entry is served from the cache until the ttl passes', async () => {
  const { cache, calls, clock } = setup();
  const first = cache.get('/challenges', { ttl: 1000 });
  calls[0].resolve(['a']);
  await first;
  clock.time = 999;
  assert.deepEqual(await cache.get('/challenges', { ttl: 1000 }), ['a']);
  assert.equal(calls.length, 1);
  clock.time = 1000;
  const refetch = cache.get('/challenges', { ttl: 1000 });
  assert.equal(calls.length, 2);
  calls[1].resolve(['b']);
  assert.deepEqual(await refetch, ['b']);
});

test('a stale entry is returned at once and revalidated in the background', async () => {
  const { cache, calls, clock } = setup();
  const first = cache.get('/challenges', { ttl: 100, swr: 1000 });
  calls[0].resolve(['old']);
  await first;
  clock.time = 500;
  const updates = [];
  const stale = await cache.get('/challenges', { ttl: 100, swr: 1000, onRevalidate: (data) => updates.push(data) });
  assert.deepEqual(stale, ['old']);
  assert.equal(calls.length, 2);
  calls[1].resolve(['new']);
  await flush();
  assert.deepEqual(updates, [['new']]);
  clock.time = 510;
  assert.deepEqual(await cache.get('/challenges', { ttl: 100, swr: 1000 }), ['new']);
  assert.equal(calls.length, 2);
});

test('beyond ttl plus swr the caller waits for a fresh answer', async () => {
  const { cache, calls, clock } = setup();
  const first = cache.get('/x', { ttl: 10, swr: 10 });
  calls[0].resolve(1);
  await first;
  clock.time = 25;
  const next = cache.get('/x', { ttl: 10, swr: 10 });
  calls[1].resolve(2);
  assert.equal(await next, 2);
});

test('errors are not cached and the next call retries', async () => {
  const { cache, calls } = setup();
  const failing = cache.get('/x', { ttl: 1000 });
  calls[0].reject(new Error('down'));
  await assert.rejects(failing, /down/);
  const retry = cache.get('/x', { ttl: 1000 });
  assert.equal(calls.length, 2);
  calls[1].resolve('ok');
  assert.equal(await retry, 'ok');
});

test('an aborted caller rejects without cancelling the shared request', async () => {
  const { cache, calls } = setup();
  const controller = new AbortController();
  const aborted = cache.get('/x', { signal: controller.signal });
  const other = cache.get('/x');
  controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  calls[0].resolve('data');
  assert.equal(await other, 'data');
  await assert.rejects(cache.get('/x', { signal: controller.signal }), { name: 'AbortError' });
});

test('clear drops entries and ignores answers that were requested before it', async () => {
  const { cache, calls } = setup();
  const pending = cache.get('/me', { ttl: 1000 });
  cache.clear();
  calls[0].resolve('old user');
  assert.equal(await pending, 'old user');
  assert.equal(cache.size(), 0);
  const next = cache.get('/me', { ttl: 1000 });
  assert.equal(calls.length, 2);
  calls[1].resolve('new user');
  await next;
  cache.clear();
  assert.equal(cache.size(), 0);
});

test('the cache is bounded and evicts the oldest entry', async () => {
  const { cache, calls } = setup({ maxEntries: 2 });
  for (const path of ['/a', '/b', '/c']) {
    const request = cache.get(path, { ttl: 1000 });
    calls.at(-1).resolve(path);
    await request;
  }
  assert.equal(cache.size(), 2);
  void cache.get('/a', { ttl: 1000 });
  assert.equal(calls.length, 4, '/a was evicted and is requested again');
});

test('backoffDelay doubles per failure and is capped', () => {
  assert.equal(backoffDelay(10_000, 0), 10_000);
  assert.equal(backoffDelay(10_000, 1), 20_000);
  assert.equal(backoffDelay(10_000, 2), 40_000);
  assert.equal(backoffDelay(10_000, 3), 60_000);
  assert.equal(backoffDelay(10_000, 50), 60_000);
});

test('the poller backs off while the task fails and recovers after a success', async () => {
  const delays = [];
  const results = [false, false, true];
  const poller = startPolling(async () => results.shift(), {
    intervalMs: 1000,
    doc: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    schedule: (fn, ms) => { delays.push(ms); return delays.length; },
    cancel() {},
  });
  await flush();
  await poller.refresh();
  await poller.refresh();
  await poller.refresh();
  poller.stop();
  assert.deepEqual(delays, [2000, 4000, 1000, 1000]);
});
