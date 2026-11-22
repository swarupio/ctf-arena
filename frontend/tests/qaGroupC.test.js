import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeId, scopedKey } from '../src/storage/userScope.js';
import { throttleDelay } from '../src/a11y/timed.js';
import { afterCaseLoadFailure } from '../src/forensics/caseHelpers.js';
import { nextTabIndex } from '../src/components/crackme/analysis.js';
import {
  keyshortcutsAttr, readShortcuts, shortcutsKey, shortcutsLabel, writeShortcuts,
} from '../src/components/crackme/shortcuts.js';
import { a1z26Decode } from '../src/cipherlab/ops.js';

const memory = () => {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v) };
};

test('scoped keys use the lowercased email and give nothing when signed out', () => {
  assert.equal(scopeId('  Ann@Example.COM '), 'ann@example.com');
  assert.equal(scopedKey('p:', 'Ann@x.io', ':easy'), 'p:ann@x.io:easy');
  assert.notEqual(scopedKey('p:', 'a@x.io'), scopedKey('p:', 'b@x.io'));
  for (const none of [undefined, null, '', '   ', 5]) assert.equal(scopedKey('p:', none), '');
});

test('keyboard shortcuts default to on, are remembered per user and never persist signed out', () => {
  const storage = memory();
  assert.equal(readShortcuts(storage, 'a@x.io'), true);
  assert.equal(writeShortcuts(storage, 'a@x.io', false), true);
  assert.equal(readShortcuts(storage, 'A@x.io'), false);
  assert.equal(readShortcuts(storage, 'b@x.io'), true, 'another account keeps its own choice');
  assert.notEqual(shortcutsKey('a@x.io'), shortcutsKey('b@x.io'));
  assert.equal(writeShortcuts(storage, undefined, false), false);
  assert.equal(storage.map.size, 1);
  assert.equal(readShortcuts(storage, undefined), true);
  assert.equal(readShortcuts({ getItem() { throw new Error('blocked'); } }, 'a@x.io'), true);
  assert.equal(writeShortcuts({ setItem() { throw new Error('full'); } }, 'a@x.io', true), false);
  storage.setItem(shortcutsKey('c@x.io'), 'garbage');
  assert.equal(readShortcuts(storage, 'c@x.io'), true);
});

test('aria-keyshortcuts exists only while shortcuts are enabled', () => {
  assert.equal(keyshortcutsAttr(true, 'S'), 'S');
  assert.equal(keyshortcutsAttr(false, 'S'), undefined);
  assert.equal(shortcutsLabel(true), 'Keyboard shortcuts: on');
  assert.equal(shortcutsLabel(false), 'Keyboard shortcuts: off');
});

test('analysis tab keys move with wrap-around, Home and End', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 2), 1);
  assert.equal(nextTabIndex('ArrowRight', 1, 2), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 2), 1);
  assert.equal(nextTabIndex('Home', 1, 2), 0);
  assert.equal(nextTabIndex('End', 0, 2), 1);
  assert.equal(nextTabIndex('Enter', 0, 2), null);
  assert.equal(nextTabIndex('ArrowRight', 0, 0), null);
});

test('throttleDelay waits out the rest of the interval', () => {
  assert.equal(throttleDelay(1000, null, 500), 0);
  assert.equal(throttleDelay(1200, 1000, 500), 300);
  assert.equal(throttleDelay(2000, 1000, 500), 0);
});

test('a failed reload after a correct answer keeps the case on screen', () => {
  const current = { view: { id: 'easy' }, error: '' };
  assert.deepEqual(afterCaseLoadFailure(current, 'offline', true), { view: { id: 'easy' }, error: 'offline' });
  assert.deepEqual(afterCaseLoadFailure(current, 'offline', false), { view: null, error: 'offline' });
});

test('A1Z26 decode splits on slashes without a quadratic regex', () => {
  assert.equal(a1z26Decode('8 9 / 20 8 5 18 5'), 'HI THERE');
  assert.equal(a1z26Decode('8-9/20-8-5-18-5'), 'HI THERE');
  assert.equal(a1z26Decode('  8 9  /   20 8 5 18 5  '), 'HI THERE');
  assert.equal(a1z26Decode('1 / 2 / 3'), 'A B C');
  assert.equal(a1z26Decode('8 9 //  20'), 'HI  T');
  const long = '1' + ' '.repeat(20000) + '2';
  const start = performance.now();
  assert.equal(a1z26Decode(long), 'AB');
  assert.ok(performance.now() - start < 50, 'long whitespace runs decode in linear time');
  const spaces = '1' + ' '.repeat(20000) + '/' + ' '.repeat(20000) + '2';
  const begin = performance.now();
  assert.equal(a1z26Decode(spaces), 'A B');
  assert.ok(performance.now() - begin < 50);
});
