import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventStore } from '../src/event/store.js';

// A poller double: runs the task once on start and exposes stop/refresh counts.
function harness(fetchEvent) {
  const log = { starts: 0, stops: 0 };
  const startPolling = (task) => {
    log.starts += 1;
    const first = task();
    return { stop: () => { log.stops += 1; }, refresh: () => task(), first };
  };
  return { log, store: createEventStore({ fetchEvent, startPolling, now: () => 1_000 }) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('two subscribers share one poller and one request', async () => {
  let requests = 0;
  const { store, log } = harness(async () => { requests += 1; return { phase: 'live', serverTime: new Date(5_000).toISOString() }; });
  const a = store.subscribe(() => {});
  const b = store.subscribe(() => {});
  await flush();
  assert.equal(log.starts, 1);
  assert.equal(requests, 1);
  assert.equal(store.subscriberCount(), 2);
  assert.equal(store.getSnapshot().event.phase, 'live');
  assert.equal(store.getSnapshot().offset, 4_000);
  a(); b();
});

test('the poller stops with the last unsubscribe and restarts for a new subscriber', () => {
  const { store, log } = harness(async () => ({ phase: 'none' }));
  const a = store.subscribe(() => {});
  const b = store.subscribe(() => {});
  a();
  assert.equal(log.stops, 0);
  a(); // a second call of the same unsubscribe is harmless
  assert.equal(log.stops, 0);
  b();
  assert.equal(log.stops, 1);
  assert.equal(store.subscriberCount(), 0);
  const c = store.subscribe(() => {});
  assert.equal(log.starts, 2);
  c();
});

test('listeners are told about each response; phase none reads as no event', async () => {
  const { store } = harness(async () => ({ phase: 'none' }));
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  await flush();
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().event, null);
  off();
});

test('a failed request keeps the last state and reports failure to the poller', async () => {
  let fail = false;
  let task;
  const store = createEventStore({
    fetchEvent: async () => { if (fail) throw new Error('down'); return { phase: 'live', serverTime: new Date(0).toISOString() }; },
    startPolling: (fn) => { task = fn; return { stop() {} }; },
    now: () => 0,
  });
  const off = store.subscribe(() => {});
  assert.equal(await task(), true);
  fail = true;
  assert.equal(await task(), false);
  assert.equal(store.getSnapshot().event.phase, 'live');
  off();
});
