import test from 'node:test';
import assert from 'node:assert/strict';
import { initialsOf, nameSource, nameWords } from '../src/layout/userInitials.js';

test('two words give two initials: the first word and the last word', () => {
  assert.deepEqual(initialsOf({ displayName: 'Ada Lovelace' }), { text: 'AL', solo: false });
  assert.deepEqual(initialsOf({ displayName: 'Mary Jane Watson' }), { text: 'MW', solo: false });
  assert.deepEqual(initialsOf({ displayName: '  grace   hopper  ' }), { text: 'GH', solo: false });
});

test('one word, however creative, gives one initial and solo', () => {
  assert.deepEqual(initialsOf({ displayName: 'zer0cool' }), { text: 'Z', solo: true });
  assert.deepEqual(initialsOf({ displayName: 'x' }), { text: 'X', solo: true });
  assert.deepEqual(initialsOf({ displayName: '__ghost__' }), { text: 'G', solo: true });
});

test('without a display name the part before the @ is used, without a +tag', () => {
  assert.equal(nameSource({ email: 'ada+work@example.org' }), 'ada');
  assert.deepEqual(initialsOf({ email: 'ada.lovelace@example.org' }), { text: 'AL', solo: false });
  assert.deepEqual(initialsOf({ email: 'ada_lovelace@example.org' }), { text: 'AL', solo: false });
  assert.deepEqual(initialsOf({ email: 'AdaLovelace@example.org' }), { text: 'AL', solo: false });
  assert.deepEqual(initialsOf({ email: 'patilswarup110@gmail.com' }), { text: 'P', solo: true });
});

test('a display name wins over the address, an empty one falls back to it', () => {
  assert.deepEqual(initialsOf({ displayName: 'Grace Hopper', email: 'x@y.z' }), { text: 'GH', solo: false });
  assert.deepEqual(initialsOf({ displayName: '   ', email: 'ada.lovelace@example.org' }), { text: 'AL', solo: false });
});

test('digits do not count as initials and are not words', () => {
  assert.deepEqual(nameWords('agent 007 smith'), ['agent', 'smith']);
  assert.deepEqual(initialsOf({ displayName: 'agent 007 smith' }), { text: 'AS', solo: false });
});

test('letters from other alphabets work and uppercase correctly', () => {
  assert.deepEqual(initialsOf({ displayName: 'élodie durand' }), { text: 'ÉD', solo: false });
  assert.deepEqual(initialsOf({ displayName: 'Åsa' }), { text: 'Å', solo: true });
  assert.deepEqual(initialsOf({ displayName: 'ананас' }), { text: 'А', solo: true });
});

test('names without letters use their first visible character, nothing at all gives U', () => {
  assert.deepEqual(initialsOf({ displayName: '🚩 ' }), { text: '🚩', solo: true });
  assert.deepEqual(initialsOf({ displayName: '12345' }), { text: '1', solo: true });
  assert.deepEqual(initialsOf({}), { text: 'U', solo: true });
  assert.deepEqual(initialsOf(), { text: 'U', solo: true });
  assert.deepEqual(initialsOf({ displayName: null, email: null }), { text: 'U', solo: true });
});

test('the result is never more than two characters', () => {
  for (const displayName of ['Ada Lovelace', 'a', 'Dr. Ada B. Lovelace III', 'AB CD EF', '🚩🚩 🚩']) {
    assert.ok(Array.from(initialsOf({ displayName }).text).length <= 2, displayName);
  }
});
