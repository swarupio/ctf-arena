import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStep, applySubstitution, atbash, base64ToText, caesarShift, factorSemiprime, hexToText, keyFromCrib, letterFrequency,
  mappingConflicts, modInverse, modPow, railDecode, reverseText, rot13, runPipeline, sha256Hex, shortestRepeat, textToBase64,
  textToHex, vigenereDecode, xorHexDecode, xorKeyFromCrib,
} from '../src/components/cipherlab/decoders.js';
import {
  blocks, cipherErrorMessage, confettiPieces, formatDuration, nextLevel, percent, speedrunText, missText, streakText,
} from '../src/components/cipherlab/helpers.js';

test('caesar, rot13 and atbash invert correctly and keep non-letters', () => {
  assert.equal(caesarShift('HELLO, WORLD', 3), 'KHOOR, ZRUOG');
  assert.equal(caesarShift('KHOOR', -3), 'HELLO');
  assert.equal(caesarShift('abc', 27), 'BCD');
  assert.equal(rot13(rot13('Secret')), 'SECRET');
  assert.equal(atbash('ABC XYZ'), 'ZYX CBA');
  assert.equal(atbash(atbash('HELLO')), 'HELLO');
  assert.equal(reverseText('abc'), 'cba');
});

test('vigenere decodes, and a crib recovers the key', () => {
  assert.equal(vigenereDecode('LXFOPVEFRNHR', 'LEMON'), 'ATTACKATDAWN');
  assert.equal(keyFromCrib('LXFOPVEFRNHR', 'ATTAC'), 'LEMON');
  assert.equal(shortestRepeat('LEMLEMLE'), 'LEM');
  assert.equal(shortestRepeat('LEMON'), 'LEMON');
  assert.equal(vigenereDecode('ABC', ''), 'ABC');
});

test('hex and base64 round-trip and reject garbage', () => {
  assert.equal(hexToText('4869'), 'Hi');
  assert.equal(hexToText('486'), null);
  assert.equal(hexToText(''), null);
  assert.equal(textToHex('Hi'), '4869');
  assert.equal(base64ToText('SGk='), 'Hi');
  assert.equal(base64ToText('not base64!'), null);
  assert.equal(base64ToText(textToBase64('Cipher Lab')), 'Cipher Lab');
});

test('xor decodes with a repeating key and recovers the key from a crib', () => {
  const key = 'kzq';
  const plain = 'AGENT MEET AT DAWN';
  const cipher = textToHex(String.fromCharCode(...[...plain].map((ch, i) => ch.charCodeAt(0) ^ key.charCodeAt(i % key.length))));
  // textToHex encodes UTF-8, so only use ASCII results here.
  assert.equal(xorHexDecode(cipher, key), plain);
  assert.equal(xorKeyFromCrib(cipher, 'AGENT ').startsWith('kzq'), true);
  assert.equal(xorHexDecode('zz', key), null);
  assert.equal(xorHexDecode('4869', ''), null);
});

test('rail fence decodes the classic example', () => {
  assert.equal(railDecode('WECRERDSOEEAIVD', 3), 'WEAREDISCOVERED');
  assert.equal(railDecode('WECRE RDSOE EAIVD', 3), 'WEAREDISCOVERED');
  assert.equal(railDecode('ABC', 1), 'ABC');
  assert.equal(railDecode('', 3), '');
});

test('frequency counts letters only and totals to 100 percent', () => {
  const { counts, total, percent: pct } = letterFrequency('Hello, World 123');
  assert.equal(total, 10);
  assert.equal(counts['L'.charCodeAt(0) - 65], 3);
  assert.ok(Math.abs(pct.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  assert.equal(letterFrequency('123').total, 0);
});

test('substitution mapping shows unmapped letters as dots and flags duplicates', () => {
  assert.equal(applySubstitution('ABA CD', { A: 'x', B: 'y' }), 'xyx ..');
  assert.deepEqual(mappingConflicts({ A: 'e', B: 'E', C: 't' }), ['A', 'B']);
  assert.deepEqual(mappingConflicts({ A: 'e', B: '' }), []);
});

test('rsa helpers factor, invert and exponentiate', () => {
  assert.deepEqual(factorSemiprime(3233), [53, 61]);
  assert.equal(factorSemiprime(13), null);
  assert.equal(factorSemiprime('x'), null);
  assert.equal(modInverse(17, 3120), 2753);
  assert.equal(modInverse(2, 4), null);
  assert.equal(modPow(65, 17, 3233), 2790);
  assert.equal(modPow(2790, 2753, 3233), 65);
});

test('sha256 matches the known vector', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('pipeline applies steps in order and stops at a failing step', () => {
  const encoded = textToBase64(textToHex(caesarShift('HELLO', 3)));
  const trail = runPipeline(encoded, [{ op: 'base64' }, { op: 'hex' }, { op: 'caesar', arg: -3 }]);
  assert.equal(trail.at(-1).text, 'HELLO');
  const broken = runPipeline('zzz', [{ op: 'hex' }, { op: 'reverse' }]);
  assert.equal(broken.length, 2);
  assert.equal(broken.at(-1).text, null);
  assert.equal(applyStep('abc', { op: 'nope' }), null);
});

test('helpers format durations, progress, streaks and speed-run text', () => {
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(125_000), '2m 05s');
  assert.equal(formatDuration(3_900_000), '1h 05m');
  assert.equal(formatDuration(-1), '0s');
  assert.equal(percent(1, 4), 25);
  assert.equal(percent(5, 4), 100);
  assert.equal(percent(0, 0), 0);
  assert.equal(streakText(0), 'No streak yet');
  assert.equal(missText(3, 0), 'Streak lost.');
  assert.equal(missText(0, 0), '');
  assert.equal(missText(2, 2), '');
  assert.equal(streakText(3), '3 in a row');
  assert.equal(speedrunText(null), null);
  assert.match(speedrunText({ ms: 60_000, badge: 'gold' }), /Gold.*1m 00s/);
  assert.match(speedrunText({ ms: 60_000, badge: null }), /Cleared in 1m 00s/);
  assert.equal(blocks('ABCDEFGHIJK'), 'ABCDE FGHIJ K');
  assert.equal(confettiPieces(5).length, 5);
});

test('nextLevel picks the first open level and error codes map to friendly text', () => {
  const overview = { tracks: [
    { levels: [{ id: 'e1', status: 'solved' }, { id: 'e2', status: 'open' }] },
    { levels: [{ id: 'm1', status: 'open' }] },
  ] };
  assert.equal(nextLevel(overview).id, 'e2');
  assert.equal(nextLevel({ tracks: [{ levels: [{ id: 'x', status: 'solved' }] }] }), null);
  assert.equal(nextLevel(null), null);
  for (const code of ['NO_TEAM', 'LEVEL_LOCKED', 'RATE_LIMITED', 'CIPHERLAB_NOT_SEEDED', 'NO_HINTS']) {
    assert.match(cipherErrorMessage({ code }), /\w/);
  }
  assert.equal(cipherErrorMessage({ code: 'WEIRD', message: 'Server says no.' }), 'Server says no.');
  assert.match(cipherErrorMessage(undefined), /try again/i);
});
