import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_PATHS, REFRESH_MS, adminErrorMessage, banPrompt, challengeLabel, formatNumber, formatPercent,
  formatTimeLeft, killPrompt, nameOrDeleted, replicaRows, requestTotal, startPolling,
} from '../src/pages/adminHelpers.js';

test('admin endpoints match the API contract and escape ids', () => {
  assert.equal(ADMIN_PATHS.stats, '/admin/stats');
  assert.equal(ADMIN_PATHS.instances, '/admin/instances');
  assert.equal(ADMIN_PATHS.teams, '/admin/teams');
  assert.equal(ADMIN_PATHS.kill('abc123'), '/admin/instances/abc123/kill');
  assert.equal(ADMIN_PATHS.ban('abc123'), '/admin/teams/abc123/ban');
  assert.equal(ADMIN_PATHS.kill('a/../b'), '/admin/instances/a%2F..%2Fb/kill');
});

test('wrong-flag rate formats as a short percentage and is safe for bad input', () => {
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(0.25), '25%');
  assert.equal(formatPercent(1 / 3), '33.3%');
  assert.equal(formatPercent(1), '100%');
  assert.equal(formatPercent(1.5), '100%');
  for (const bad of [undefined, null, NaN, -1, 'abc']) assert.equal(formatPercent(bad), '0%');
});

test('numbers get thousands separators and bad values fall back to 0', () => {
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(undefined), '0');
});

test('replica rows are sorted by traffic with each replica\'s share of the total', () => {
  const rows = replicaRows({ 'backend-2': 30, 'backend-1': 60, 'backend-3': 30 });
  assert.deepEqual(rows.map((row) => row.replica), ['backend-1', 'backend-2', 'backend-3']);
  assert.deepEqual(rows.map((row) => row.share), [0.5, 0.25, 0.25]);
  assert.equal(requestTotal(rows), 120);
});

test('replica rows cope with no replicas, zero traffic and junk values', () => {
  assert.deepEqual(replicaRows({}), []);
  assert.deepEqual(replicaRows(undefined), []);
  assert.deepEqual(replicaRows({ a: 0, b: 0 }).map((row) => row.share), [0, 0]);
  assert.deepEqual(replicaRows({ a: 'x', b: -5, c: 10 }).map((row) => [row.replica, row.requests, row.share]), [['c', 10, 1], ['a', 0, 0], ['b', 0, 0]]);
});

test('time left is coarse, never negative and marks expired instances', () => {
  const now = Date.UTC(2026, 10, 4, 12, 0, 0);
  const at = (ms) => new Date(now + ms).toISOString();
  assert.equal(formatTimeLeft(at(-1), now), 'expired');
  assert.equal(formatTimeLeft(at(0), now), 'expired');
  assert.equal(formatTimeLeft('not a date', now), 'expired');
  assert.equal(formatTimeLeft(at(1_000), now), '1 min');
  assert.equal(formatTimeLeft(at(45 * 60_000), now), '45 min');
  assert.equal(formatTimeLeft(at(60 * 60_000), now), '1 h');
  assert.equal(formatTimeLeft(at(75 * 60_000 - 5_000), now), '1 h 15 min');
});

test('deleted teams and challenges get a readable label', () => {
  assert.equal(nameOrDeleted(null), '(deleted)');
  assert.equal(nameOrDeleted('Rustaceans'), 'Rustaceans');
  assert.equal(challengeLabel({ title: 'Cookie Monster', slug: 'cookie-monster' }), 'Cookie Monster');
  assert.equal(challengeLabel({ title: null, slug: 'cookie-monster' }), 'cookie-monster');
  assert.equal(challengeLabel({ title: null, slug: null }), '(deleted)');
  assert.equal(challengeLabel(undefined), '(deleted)');
});

test('confirm prompts name the team and challenge', () => {
  const text = killPrompt({ team: { name: 'Rustaceans' }, challenge: { title: 'Cookie Monster' } });
  assert.match(text, /Cookie Monster/);
  assert.match(text, /Rustaceans/);
  assert.match(killPrompt({ team: { name: null }, challenge: {} }), /\(deleted\)/);
  assert.match(banPrompt({ name: 'Rustaceans' }), /Rustaceans.*instances are stopped/);
});

test('error messages are friendly for auth and network problems and keep other server text', () => {
  assert.match(adminErrorMessage({ code: 'UNAUTHENTICATED' }), /sign in/i);
  assert.match(adminErrorMessage({ code: 'FORBIDDEN' }), /admins/i);
  assert.match(adminErrorMessage(new TypeError('Failed to fetch')), /cannot reach the server/i);
  assert.equal(adminErrorMessage({ code: 'VALIDATION_ERROR', message: 'banned: expected boolean' }), 'banned: expected boolean');
  assert.equal(adminErrorMessage(undefined, 'Could not load.'), 'Could not load.');
  assert.match(adminErrorMessage(null), /try again/i);
});

function fakeEnvironment(visibilityState = 'visible') {
  const listeners = new Set();
  const timers = new Map();
  let nextId = 1;
  const doc = {
    visibilityState,
    addEventListener: (type, listener) => { if (type === 'visibilitychange') listeners.add(listener); },
    removeEventListener: (type, listener) => { if (type === 'visibilitychange') listeners.delete(listener); },
  };
  return {
    doc,
    listeners,
    timers,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    fire: () => { for (const { fn } of timers.values()) fn(); },
    setVisibility(state) { doc.visibilityState = state; for (const listener of [...listeners]) listener(); },
  };
}

test('polling runs every 10 s while the page is visible and stops completely on cleanup', () => {
  assert.equal(REFRESH_MS, 10_000);
  const env = fakeEnvironment();
  let ticks = 0;
  const stop = startPolling(() => { ticks += 1; }, { doc: env.doc, setTimer: env.setTimer, clearTimer: env.clearTimer });
  assert.equal(env.timers.size, 1);
  assert.equal([...env.timers.values()][0].ms, 10_000);
  env.fire();
  env.fire();
  assert.equal(ticks, 2);
  stop();
  assert.equal(env.timers.size, 0);
  assert.equal(env.listeners.size, 0);
});

test('polling pauses while the tab is hidden and refreshes immediately when it returns', () => {
  const env = fakeEnvironment();
  let ticks = 0;
  const stop = startPolling(() => { ticks += 1; }, { doc: env.doc, setTimer: env.setTimer, clearTimer: env.clearTimer });
  env.setVisibility('hidden');
  assert.equal(env.timers.size, 0);
  env.fire();
  assert.equal(ticks, 0);
  env.setVisibility('visible');
  assert.equal(ticks, 1);
  assert.equal(env.timers.size, 1);
  env.setVisibility('visible');
  assert.equal(env.timers.size, 1);
  stop();
  assert.equal(env.timers.size, 0);
});

test('a page that starts hidden does not poll until it becomes visible, and cleanup works while hidden', () => {
  const env = fakeEnvironment('hidden');
  let ticks = 0;
  const stop = startPolling(() => { ticks += 1; }, { doc: env.doc, setTimer: env.setTimer, clearTimer: env.clearTimer });
  assert.equal(env.timers.size, 0);
  env.setVisibility('visible');
  assert.equal(ticks, 1);
  assert.equal(env.timers.size, 1);
  env.setVisibility('hidden');
  stop();
  assert.equal(env.timers.size, 0);
  assert.equal(env.listeners.size, 0);
  env.setVisibility('visible');
  assert.equal(env.timers.size, 0);
  assert.equal(ticks, 1);
});

test('polling works without a document (server-side or tests) and still cleans up', () => {
  const env = fakeEnvironment();
  const stop = startPolling(() => {}, { doc: null, setTimer: env.setTimer, clearTimer: env.clearTimer });
  assert.equal(env.timers.size, 1);
  stop();
  assert.equal(env.timers.size, 0);
});
