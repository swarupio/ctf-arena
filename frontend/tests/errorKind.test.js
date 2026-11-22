import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackCopy, isChunkLoadError } from '../src/components/errorKind.js';

test('lazy chunk failures are recognised', () => {
  assert.equal(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' })), true);
  assert.equal(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://a/b.js')), true);
  assert.equal(isChunkLoadError(new Error('error loading dynamically imported module')), true);
  assert.equal(isChunkLoadError(new Error('Importing a module script failed.')), true);
  assert.equal(isChunkLoadError(new Error('Loading chunk 12 failed.')), true);
});

test('ordinary errors are not chunk errors', () => {
  assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError(undefined), false);
});

test('fallback copy offers reload for chunks and retry otherwise, never the message', () => {
  const chunk = fallbackCopy(new Error('Failed to fetch dynamically imported module'));
  assert.equal(chunk.action, 'Reload the page');
  assert.equal(chunk.reload, true);
  const other = fallbackCopy(new Error('secret detail at /src/x.js:1'));
  assert.equal(other.title, 'Something went wrong on this page');
  assert.equal(other.action, 'Try again');
  assert.ok(!JSON.stringify(other).includes('secret'));
});
