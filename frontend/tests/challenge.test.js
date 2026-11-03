import test from 'node:test';
import assert from 'node:assert/strict';
import {
  challengeErrorMessage, formatCountdown, groupByCategory, isExpired,
} from '../src/pages/challengeHelpers.js';

test('challenges group by category in a stable order, easiest first', () => {
  const groups = groupByCategory([
    { id: '1', category: 'misc', points: 25 }, { id: '2', category: 'web', points: 200 },
    { id: '3', category: 'web', points: 100 }, { id: '4', category: 'crypto', points: 75 },
  ]);
  assert.deepEqual(groups.map((group) => group.category), ['web', 'crypto', 'misc']);
  assert.deepEqual(groups[0].items.map((item) => item.id), ['3', '2']);
});

test('countdown formats as m:ss and never goes negative', () => {
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  assert.equal(formatCountdown(new Date(now + 90_000).toISOString(), now), '1:30');
  assert.equal(formatCountdown(new Date(now + 5_000).toISOString(), now), '0:05');
  assert.equal(formatCountdown(new Date(now - 5_000).toISOString(), now), '0:00');
  assert.equal(isExpired(new Date(now - 1).toISOString(), now), true);
  assert.equal(isExpired(new Date(now + 1000).toISOString(), now), false);
});

test('documented error codes map to friendly messages and unknown errors keep the server text', () => {
  for (const code of ['NO_TEAM', 'TEAM_BANNED', 'INSTANCE_LIMIT', 'ALREADY_RUNNING', 'NO_FREE_PORT', 'RATE_LIMITED']) {
    assert.match(challengeErrorMessage({ code }), /\w/);
  }
  assert.equal(challengeErrorMessage({ code: 'WEIRD', message: 'Server says no.' }), 'Server says no.');
  assert.match(challengeErrorMessage(undefined), /try again/i);
});
