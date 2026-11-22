import test from 'node:test';
import assert from 'node:assert/strict';
import { countToStore, isDefinitiveFailure, restoreHints, restoreTarget } from '../src/hints/restore.js';

const failing = (status) => Object.assign(new Error('x'), { status });

test('definitive failures are 4xx except timeout and rate limit', () => {
  assert.equal(isDefinitiveFailure(failing(404)), true);
  assert.equal(isDefinitiveFailure(failing(403)), true);
  assert.equal(isDefinitiveFailure(failing(408)), false);
  assert.equal(isDefinitiveFailure(failing(429)), false);
  assert.equal(isDefinitiveFailure(failing(502)), false);
  assert.equal(isDefinitiveFailure(new TypeError('Failed to fetch')), false);
});

test('a full restore writes nothing', async () => {
  const result = await restoreHints(async (level) => `hint ${level}`, 3);
  assert.deepEqual(result, { texts: ['hint 1', 'hint 2', 'hint 3'], failure: null });
  assert.equal(countToStore(result, 3), null);
});

test('a transient error part-way never lowers the stored count', async () => {
  const result = await restoreHints(async (level) => { if (level === 2) throw failing(503); return `hint ${level}`; }, 3);
  assert.equal(result.texts.length, 1);
  assert.equal(result.failure, 'transient');
  assert.equal(countToStore(result, 3), null);
});

test('a network failure on the first hint writes nothing', async () => {
  const result = await restoreHints(async () => { throw new TypeError('Failed to fetch'); }, 2);
  assert.equal(countToStore(result, 2), null);
});

test('a definitive 4xx lowers the count to what was restored', async () => {
  const result = await restoreHints(async (level) => { if (level === 2) throw failing(404); return `hint ${level}`; }, 3);
  assert.equal(result.failure, 'definitive');
  assert.equal(countToStore(result, 3), 1);
});

test('restoreTarget restores up to the highest level the server says was opened', () => {
  assert.equal(restoreTarget([], 3), 0);
  assert.equal(restoreTarget([2], 3), 2);
  assert.equal(restoreTarget([1, 3, 2], 3), 3);
  assert.equal(restoreTarget([5, 'x', 0, -1, 1.5], 3), 0);
  assert.equal(restoreTarget([2, 9], 3), 2);
});

test('restoreTarget is null without a server list (admin previews use the stored count)', () => {
  assert.equal(restoreTarget(undefined, 3), null);
  assert.equal(restoreTarget(null, 3), null);
  assert.equal(restoreTarget('1', 3), null);
});
