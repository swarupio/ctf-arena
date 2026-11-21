import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatest } from '../src/api/latest.js';
import { capEntries, entrySize } from '../src/terminal/scrollback.js';
import { highlightParts, makeHighlighter } from '../src/forensics/logFilter.js';

test('capEntries keeps everything that fits and returns the same array', () => {
  const list = [{ kind: 'out', text: 'a' }, { kind: 'out', text: 'b' }];
  assert.equal(capEntries(list), list);
});

test('capEntries drops the oldest entries beyond the entry limit', () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ kind: 'out', text: String(i) }));
  const kept = capEntries(list, { maxEntries: 4, maxChars: 1e9 });
  assert.deepEqual(kept.map((entry) => entry.text), ['6', '7', '8', '9']);
});

test('capEntries also enforces a character budget and always keeps the newest entry', () => {
  const big = (text) => ({ kind: 'out', text: text.repeat(1000) });
  const list = [big('a'), big('b'), big('c'), big('d')];
  const kept = capEntries(list, { maxEntries: 600, maxChars: 2500 });
  assert.deepEqual(kept.map((entry) => entry.text[0]), ['c', 'd']);
  const huge = capEntries([big('a'), big('z')], { maxChars: 10 });
  assert.deepEqual(huge.map((entry) => entry.text[0]), ['z']);
});

test('entrySize counts text, headline, lines and items', () => {
  assert.ok(entrySize({ text: 'abcd' }) >= 4);
  assert.ok(entrySize({ headline: 'abc', lines: ['de', 'f'] }) >= 6);
  assert.ok(entrySize({ items: ['ab', 'cd'] }) >= 4);
  assert.equal(entrySize(null), 0);
});

test('createLatest lets only the newest request write', () => {
  const latest = createLatest();
  const first = latest.begin();
  const second = latest.begin();
  assert.equal(first(), false);
  assert.equal(second(), true);
  latest.cancel();
  assert.equal(second(), false);
});

test('makeHighlighter compiles once and matches highlightParts', () => {
  const options = { query: 'fail', mode: 'text', caseSensitive: false };
  const highlight = makeHighlighter(options);
  for (const line of ['Failed password for root', 'nothing here', 'FAIL fail fail']) {
    assert.deepEqual(highlight(line), highlightParts(line, options));
  }
  assert.deepEqual(makeHighlighter({ query: '(a+)+', mode: 'regex' })('x'), [{ text: 'x', hit: false }]);
  assert.deepEqual(makeHighlighter({ query: '' })('abc'), [{ text: 'abc', hit: false }]);
  // Reusing the same highlighter on many rows keeps working (a shared global regex must not carry state).
  const regex = makeHighlighter({ query: 'b.', mode: 'regex' });
  assert.deepEqual(regex('abc abd').filter((part) => part.hit).map((part) => part.text), ['bc', 'bd']);
  assert.deepEqual(regex('abc abd').filter((part) => part.hit).map((part) => part.text), ['bc', 'bd']);
});
