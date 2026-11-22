import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANALYSIS_TOOLS, BRUTE_TOP, MAX_CHAIN_STEPS, MAX_INPUT_CHARS, MAX_OUTPUT_CHARS, OPS, WORKBENCH_TOOL, a1z26Decode, atbash,
  availableOps, caesarBack, defaultParams, describeIC, englishScore, fromBase32, fromBase64, fromBinary, fromHex, indexOfCoincidence,
  isOpUnlocked, magic, morseDecode, opById, railFenceDecode, reverse, rot13, rot47, runChain, toBase32, toBase64, toBinary,
  toHex, toolForOp, urlDecode, vigenereDecode, xorBruteForce, xorWithKey,
} from '../src/cipherlab/ops.js';

const ALL = ['shift', 'frequency', 'codec', 'vigenere', 'xor', 'rail', 'substitution', 'rsa', 'hash', 'pipeline'];
const PASSAGE = 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness';
const SENTENCE = 'Attack at dawn! The quick brown fox jumps over the lazy dog near the old river bridge.';

test('Base64 known vectors, url-safe alphabet, missing padding and errors', () => {
  assert.equal(fromBase64('SGVsbG8='), 'Hello');
  assert.equal(fromBase64('SGVsbG8'), 'Hello');
  assert.equal(fromBase64('Zg=='), 'f');
  assert.equal(fromBase64('  SGVs\nbG8= '), 'Hello');
  assert.equal(fromBase64('Pz8_Pw'), '????');
  assert.equal(toBase64('Hello'), 'SGVsbG8=');
  assert.equal(toBase64('f'), 'Zg==');
  assert.equal(toBase64(''), '');
  assert.equal(fromBase64(toBase64('Cipher Lab: héllo ✓')), 'Cipher Lab: héllo ✓');
  assert.throws(() => fromBase64('SGVsb*8='), /valid Base64 character/);
  assert.throws(() => fromBase64('A'), /impossible/);
  assert.throws(() => fromBase64('   '), /Nothing/);
});

test('Hex, Binary and Base32 vectors', () => {
  assert.equal(fromHex('48656c6c6f'), 'Hello');
  assert.equal(fromHex('0x48 0x65, 6c:6c-6F'), 'Hello');
  assert.equal(toHex('Hello'), '48656c6c6f');
  assert.throws(() => fromHex('486'), /even/);
  assert.throws(() => fromHex('zz'), /0-9/);
  assert.equal(fromBinary('01001000 01101001'), 'Hi');
  assert.equal(toBinary('Hi'), '01001000 01101001');
  assert.throws(() => fromBinary('0100100'), /groups of 8/);
  assert.throws(() => fromBinary('0120'), /0 and 1/);
  assert.equal(fromBase32('MZXW6==='), 'foo');
  assert.equal(fromBase32('mzxw6ytboi'), 'foobar');
  assert.equal(toBase32('foo'), 'MZXW6===');
  assert.equal(toBase32('foobar'), 'MZXW6YTBOI======');
  assert.throws(() => fromBase32('MZXW1'), /Base32/);
});

test('raw bytes survive a Hex to Base64 round trip (one byte per character)', () => {
  const raw = fromHex('00ff80fe41');
  assert.equal(toHex(raw), '00ff80fe41');
  assert.equal(fromBase64(toBase64(raw)), raw);
});

test('URL decode', () => {
  assert.equal(urlDecode('a%20b+c%21'), 'a b c!');
  assert.equal(urlDecode('a+b', { plus: 'no' }), 'a+b');
  assert.equal(urlDecode('%E2%9C%93'), '✓');
  assert.throws(() => urlDecode('100%'), /Malformed/);
});

test('ROT13, Caesar, Atbash, ROT47 and reverse keep case and punctuation', () => {
  assert.equal(rot13('Hello, World!'), 'Uryyb, Jbeyq!');
  assert.equal(rot13(rot13('Round Trip')), 'Round Trip');
  assert.equal(caesarBack('Khoor, Zruog', { shift: 3 }), 'Hello, World');
  assert.equal(caesarBack('abc', { shift: -1 }), 'bcd');
  assert.equal(caesarBack('abc', { shift: '0' }), 'abc');
  assert.throws(() => caesarBack('abc', { shift: 'x' }), /whole number/);
  assert.throws(() => caesarBack('abc', { shift: 99 }), /between/);
  assert.throws(() => caesarBack('abc', { shift: '' }), /whole number/);
  assert.equal(atbash('Hello'), 'Svool');
  assert.equal(atbash(atbash('Hello 123')), 'Hello 123');
  assert.equal(rot47('Hello'), 'w6==@');
  assert.equal(rot47(rot47('Hello, World! ~')), 'Hello, World! ~');
  assert.equal(reverse('abc ✓'), '✓ cba');
});

test('Rail fence decode, Vigenere decode', () => {
  assert.equal(railFenceDecode('WECRLTEERDSOEEFEAOCAIVDEN', { rails: 3 }), 'WEAREDISCOVEREDFLEEATONCE');
  assert.equal(railFenceDecode('abc', { rails: 5 }), 'abc');
  assert.throws(() => railFenceDecode('abc', { rails: 1 }), /between/);
  assert.throws(() => railFenceDecode('', { rails: 3 }), /Nothing/);
  assert.equal(vigenereDecode('LXFOPVEFRNHR', { key: 'LEMON' }), 'ATTACKATDAWN');
  assert.equal(vigenereDecode('Lxfop vefrnhr!', { key: 'lemon' }), 'Attac katdawn!');
  assert.throws(() => vigenereDecode('abc', { key: '123' }), /letters/);
});

test('XOR with a text or hex key, and single-byte brute force ranks the true key first', () => {
  assert.equal(xorWithKey('Hello', { key: 'K' }), String.fromCharCode(...[...'Hello'].map((c) => c.charCodeAt(0) ^ 75)));
  assert.equal(xorWithKey(xorWithKey('Secret message', { key: 'ab' }), { key: 'ab' }), 'Secret message');
  assert.equal(xorWithKey(xorWithKey('Secret', { key: '6162', format: 'hex' }), { key: 'ab' }), 'Secret');
  assert.throws(() => xorWithKey('x', { key: '' }), /key/);
  assert.throws(() => xorWithKey('x', { key: 'abc', format: 'hex' }), /hex/);
  const cipher = String.fromCharCode(...[...SENTENCE].map((c) => c.charCodeAt(0) ^ 0x37));
  const result = xorBruteForce(cipher);
  assert.equal(result.candidates.length, BRUTE_TOP);
  assert.equal(result.candidates[0].key, 0x37);
  assert.equal(result.candidates[0].keyHex, '37');
  assert.equal(result.text, SENTENCE);
  assert.ok(result.candidates[0].score > result.candidates[1].score);
  assert.equal(xorBruteForce(cipher, { pick: 2 }).note.includes(result.candidates[1].keyHex), true);
  assert.throws(() => xorBruteForce(cipher, { pick: 9 }), /between/);
  assert.throws(() => xorBruteForce(''), /Nothing/);
});

test('single-byte brute force only scans a capped prefix', () => {
  const big = 'e'.repeat(50000);
  const started = Date.now();
  const result = xorBruteForce(big);
  assert.ok(Date.now() - started < 2000);
  assert.equal(result.text.length, 50000);
  assert.match(result.note, /first 4096 bytes/);
});

test('Morse and A1Z26 decode', () => {
  assert.equal(morseDecode('... --- ...'), 'SOS');
  assert.equal(morseDecode('.... . .-.. .-.. --- / .-- --- .-. .-.. -..'), 'HELLO WORLD');
  assert.equal(morseDecode('.... ..   .-- --- .-. .-.. -..'), 'HI WORLD');
  assert.equal(morseDecode('··· −−− ···'), 'SOS');
  assert.throws(() => morseDecode('.......... .'), /not a Morse letter/);
  assert.equal(a1z26Decode('8-5-12-12-15'), 'HELLO');
  assert.equal(a1z26Decode('8 9 / 20 8 5 18 5'), 'HI THERE');
  assert.throws(() => a1z26Decode('8 27'), /outside 1-26/);
  assert.throws(() => a1z26Decode('0'), /outside 1-26/);
});

test('chain runner: Base64, Hex, Caesar and per-step results', () => {
  const input = toBase64(toHex('Khoor'));
  const run = runChain(input, [{ op: 'fromBase64' }, { op: 'fromHex' }, { op: 'caesar', params: { shift: 3 } }], { unlockedTools: ALL });
  assert.deepEqual(run.results.map((r) => r.ok), [true, true, true]);
  assert.deepEqual(run.results.map((r) => r.text), [toHex('Khoor'), 'Khoor', 'Hello']);
  assert.equal(run.inputError, '');
});

test('chain runner: an error stops the chain without throwing, later steps are skipped', () => {
  const run = runChain('not hex!', [{ op: 'rot13' }, { op: 'fromHex' }, { op: 'reverse' }], { unlockedTools: ALL });
  assert.equal(run.results[0].ok, true);
  assert.equal(run.results[1].ok, false);
  assert.match(run.results[1].error, /Hex/);
  assert.equal(run.results[2].skipped, true);
  const unknown = runChain('x', [{ op: 'nope' }, { op: 'reverse' }], { unlockedTools: ALL });
  assert.match(unknown.results[0].error, /Unknown/);
  assert.equal(runChain('x', null).results.length, 0);
  assert.equal(runChain(undefined, [{ op: 'reverse' }], { unlockedTools: ALL }).results[0].text, '');
});

test('chain runner: unexpected exceptions become a generic step error', () => {
  const op = opById('reverse');
  const original = op.run;
  op.run = () => { throw new TypeError('boom internal detail'); };
  try {
    const run = runChain('abc', [{ op: 'reverse' }], { unlockedTools: ALL });
    assert.equal(run.results[0].ok, false);
    assert.equal(run.results[0].error.includes('boom'), false);
  } finally { op.run = original; }
});

test('chain runner caps: input length, chain length, output growth', () => {
  const long = runChain('a'.repeat(MAX_INPUT_CHARS + 1), [{ op: 'reverse' }], { unlockedTools: ALL });
  assert.match(long.inputError, /at most 20000/);
  assert.equal(long.results.length, 0);
  assert.equal(runChain('a'.repeat(MAX_INPUT_CHARS), [{ op: 'reverse' }], { unlockedTools: ALL }).inputError, '');
  const many = runChain('abc', Array.from({ length: MAX_CHAIN_STEPS + 3 }, () => ({ op: 'reverse' })), { unlockedTools: ALL });
  assert.equal(many.results.length, MAX_CHAIN_STEPS);
  assert.equal(many.truncated, 3);
  const grow = runChain('a'.repeat(MAX_INPUT_CHARS), Array.from({ length: 4 }, () => ({ op: 'toBinary' })), { unlockedTools: ALL });
  assert.ok(grow.results.some((r) => !r.ok && /longer than/.test(r.error)));
  assert.ok(MAX_OUTPUT_CHARS > MAX_INPUT_CHARS);
});

test('chain runner passes default parameters and a brute force step exposes candidates', () => {
  const cipher = String.fromCharCode(...[...SENTENCE].map((c) => c.charCodeAt(0) ^ 0x21));
  const run = runChain(cipher, [{ op: 'xorBrute' }], { unlockedTools: ALL });
  assert.equal(run.results[0].text, SENTENCE);
  assert.equal(run.results[0].candidates.length, BRUTE_TOP);
  assert.deepEqual(defaultParams(opById('caesar')), { shift: 3 });
});

test('gating: every op maps to a real toolbox tool, and locked tools lock their operations', () => {
  const levels = readFileSync(new URL('../../backend/src/games/cipherlab/levels.js', import.meta.url), 'utf8');
  const toolIds = [...levels.matchAll(/\{ id: '(\w+)', name: '[^']+', description: '[^']+', unlockedBy/g)].map((m) => m[1]);
  assert.deepEqual(toolIds, ALL);
  for (const op of OPS) { assert.ok(toolIds.includes(op.tool), `${op.id} -> ${op.tool}`); }
  for (const tool of Object.values(ANALYSIS_TOOLS)) { assert.ok(toolIds.includes(tool)); }
  assert.equal(new Set(OPS.map((o) => o.id)).size, OPS.length);

  const expected = {
    fromBase64: 'codec', toBase64: 'codec', fromHex: 'codec', toHex: 'codec', reverse: 'codec',
    fromBinary: 'pipeline', toBinary: 'pipeline', fromBase32: 'pipeline', toBase32: 'pipeline', urlDecode: 'pipeline', morse: 'pipeline', a1z26: 'pipeline',
    caesar: 'shift', rot13: 'shift', rot47: 'shift', atbash: 'shift', railFence: 'rail', vigenere: 'vigenere', xor: 'xor', xorBrute: 'xor',
  };
  assert.deepEqual(Object.fromEntries(OPS.map((o) => [o.id, o.tool])), expected);
  assert.equal(toolForOp('xor'), 'xor');
  assert.equal(toolForOp('missing'), null);

  assert.equal(availableOps([]).length, 0);
  assert.equal(availableOps(['codec', 'shift']).length, 0, 'workbench itself must be unlocked');
  assert.deepEqual(availableOps([WORKBENCH_TOOL]).map((o) => o.id), OPS.filter((o) => o.tool === 'pipeline').map((o) => o.id));
  assert.equal(availableOps(ALL).length, OPS.length);
  assert.equal(isOpUnlocked('xor', [WORKBENCH_TOOL, 'codec']), false);
  assert.equal(isOpUnlocked('xor', [WORKBENCH_TOOL, 'xor']), true);
});

test('gating is enforced by the runner too, not only by the menu', () => {
  const run = runChain('SGk=', [{ op: 'fromBase64' }], { unlockedTools: [WORKBENCH_TOOL, 'shift'] });
  assert.equal(run.results[0].ok, false);
  assert.match(run.results[0].error, /locked/);
  assert.equal(runChain('SGk=', [{ op: 'fromBase64' }]).results[0].ok, false);
  assert.equal(runChain('SGk=', [{ op: 'fromBase64' }], { unlockedTools: [WORKBENCH_TOOL, 'codec'] }).results[0].text, 'Hi');
});

test('index of coincidence and its reading', () => {
  assert.ok(indexOfCoincidence(PASSAGE) > 0.06);
  assert.ok(indexOfCoincidence('ABCDEFGHIJKLMNOPQRSTUVWXYZ') < 0.01);
  assert.equal(indexOfCoincidence('a'), null);
  assert.equal(indexOfCoincidence('1234'), null);
  assert.match(describeIC(0.066), /English/);
  assert.match(describeIC(0.04), /random/);
  assert.match(describeIC(null), /Not enough/);
});

test('englishScore prefers text over noise', () => {
  assert.ok(englishScore(SENTENCE) > englishScore('\u0001\u0002\u0003qzx'));
  assert.ok(englishScore(SENTENCE) > -3.6);
  assert.equal(englishScore(''), -20);
});

test('magic looks at the text and proposes operations, never an answer', () => {
  const ops = (text) => magic(text).map((m) => m.op);
  assert.equal(ops('SGVsbG8gV29ybGQh')[0], 'fromBase64');
  assert.equal(ops('48656c6c6f20576f726c64')[0], 'fromHex');
  assert.equal(ops('01001000 01101001')[0], 'fromBinary');
  assert.equal(ops('.... . .-.. .-.. ---')[0], 'morse');
  assert.equal(ops('a%20b%21')[0], 'urlDecode');
  assert.equal(ops('JBSWY3DPEBLW64TMMQ======')[0], 'fromBase32');
  assert.equal(ops('8 5 12 12 15')[0], 'a1z26');
  assert.equal(ops('\u0001\u0002\u0003\u0004\u0005\u0006').includes('xorBrute'), true);
  // Shifted English: high IC, unreadable.
  assert.deepEqual(ops(rot13(PASSAGE).replace(/\s/g, '')).slice(0, 3), ['caesar', 'atbash', 'railFence']);
  // Plain English: no decoder suggestions.
  assert.equal(ops(SENTENCE).includes('caesar'), false);
  assert.deepEqual(ops(SENTENCE), [null]);
  // Flat letter statistics point at a polyalphabetic cipher.
  const flat = 'LXFOPVEFRNHRLXFOPVEFRNHRKJHGFDSAPOIUYTREWQMNBVCXZLKJHGFDSAQWERTYUIOPZXCVBNM';
  assert.ok(indexOfCoincidence(flat) < 0.05);
  assert.equal(ops(flat)[0], 'vigenere');
  assert.deepEqual(magic(''), []);
  assert.ok(magic('SGVsbG8gV29ybGQh').every((m) => typeof m.reason === 'string' && m.reason.length > 0));
  assert.ok(magic('SGVsbG8gV29ybGQh').length <= 5);
  // Magic never contains decoded text or anything flag-shaped.
  assert.equal(JSON.stringify(magic('SGVsbG8gV29ybGQh')).includes('Hello'), false);
  assert.equal(JSON.stringify(magic('Q1RGe3NlY3JldH0=')).includes('CTF{'), false);
});
