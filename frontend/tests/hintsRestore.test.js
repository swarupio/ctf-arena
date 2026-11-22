import test from 'node:test';
import assert from 'node:assert/strict';
import { countToStore, isDefinitiveFailure, restoreHints } from '../src/hints/restore.js';

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
