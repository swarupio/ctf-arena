import test from 'node:test';
import assert from 'node:assert/strict';
import { safeLink } from '../src/api/safeUrl.js';

test('http, https and relative links pass through', () => {
  assert.equal(safeLink('http://127.0.0.1:20001'), 'http://127.0.0.1:20001');
  assert.equal(safeLink('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeLink('/files/note.txt'), '/files/note.txt');
  assert.equal(safeLink('files/note.txt'), 'files/note.txt');
});

test('script, data and other schemes are refused', () => {
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', 'blob:abc']) {
    assert.equal(safeLink(bad), '', bad);
  }
});

test('non-strings and blanks are refused', () => {
  for (const bad of [undefined, null, 5, {}, '', '   ']) assert.equal(safeLink(bad), '');
});
