import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPattern, compileSafeRegex } from '../src/forensics/safeRegex.js';
import { filterLines, highlightParts, makeLineMatcher, windowRange } from '../src/forensics/logFilter.js';
import { filterPackets, parseFilter } from '../src/forensics/packetFilter.js';
import { buildStream, conversationKey, indexConversations } from '../src/forensics/packetStream.js';
import { decodeBase64, decodeHexText, findMatches, hexRows, matchRows, hexToBytes, hexToText, rot13 } from '../src/forensics/hex.js';
import { extractLsb, renderPixels } from '../src/forensics/stego.js';
import {
  clearStart, describeForensicsError, earnedBadge, evidenceCards, formatElapsed, nextOpenStage, progressPercent, readStart, timerBadge, timerKey, writeStart,
} from '../src/forensics/caseHelpers.js';

test('safe regex accepts ordinary patterns and rejects catastrophic ones', () => {
  assert.equal(compileSafeRegex('Failed password.*from 1\\.2').ok, true);
  assert.equal(compileSafeRegex('^2026-03-14 0[1-3]:').ok, true);
  for (const bad of ['(a+)+$', '(.*)*x', '(a|aa)+b', '([a-z]+){2,}', '(a)\\1', 'x{1,500}', '(?=a)b', '(', 'a'.repeat(81), '']) {
    assert.equal(compileSafeRegex(bad).ok, false, bad);
  }
  assert.match(checkPattern('(a+)+').error, /too long|nested/i);
  assert.equal(compileSafeRegex('abc').regex.test('xABCx'), true);
  assert.equal(compileSafeRegex('abc', { caseSensitive: true }).regex.test('xABCx'), false);
});

test('a hostile regex is stopped before it runs, and clean ones stay fast on long lines', () => {
  const started = Date.now();
  assert.equal(compileSafeRegex('(a+)+$').ok, false);
  const ok = compileSafeRegex('a*b');
  assert.equal(ok.regex.test('a'.repeat(400)), false);
  assert.ok(Date.now() - started < 200);
});

test('line matcher: text, regex, invert and result limit', () => {
  const lines = ['Failed password for bob', 'Accepted password for bob', 'GET /index.html 200', 'failed password for amy'].map((text, n) => ({ n, text }));
  assert.equal(filterLines(lines, makeLineMatcher({ query: 'failed password' })).length, 2);
  assert.equal(filterLines(lines, makeLineMatcher({ query: 'failed password', caseSensitive: true })).length, 1);
  assert.equal(filterLines(lines, makeLineMatcher({ query: 'password for (bob|amy)', mode: 'regex' })).length, 3);
  assert.equal(filterLines(lines, makeLineMatcher({ query: 'password', invert: true })).length, 1);
  assert.equal(filterLines(lines, makeLineMatcher({ query: '' })).length, 4);
  assert.equal(filterLines(lines, makeLineMatcher({ query: 'a' }), 2).length, 2);
  assert.equal(makeLineMatcher({ query: '(a+)+', mode: 'regex' }).ok, false);
});

test('highlighting splits around matches and is capped', () => {
  assert.deepEqual(highlightParts('abcabc', { query: 'b' }).map((p) => p.text), ['a', 'b', 'ca', 'b', 'c']);
  assert.deepEqual(highlightParts('x', { query: '(a+)+', mode: 'regex' }), [{ text: 'x', hit: false }]);
  assert.ok(highlightParts('a'.repeat(200), { query: 'a' }).length <= 20);
});

test('virtual window covers the viewport with overscan and clamps to the list', () => {
  assert.deepEqual(windowRange({ scrollTop: 0, viewport: 100, rowHeight: 20, total: 1000, overscan: 2 }), { first: 0, last: 7 });
  assert.deepEqual(windowRange({ scrollTop: 400, viewport: 100, rowHeight: 20, total: 1000, overscan: 2 }), { first: 18, last: 27 });
  assert.deepEqual(windowRange({ scrollTop: 19900, viewport: 100, rowHeight: 20, total: 1000, overscan: 2 }), { first: 993, last: 1000 });
});

const packet = (over) => ({
  n: 1, t: '0.000', src: '10.0.1.21', sp: 40000, dst: '185.1.2.3', dp: 8443, proto: 'HTTP', len: 100, info: 'POST /beacon HTTP/1.1',
  hex: Buffer.from('POST /beacon HTTP/1.1\r\nHost: x\r\n\r\n').toString('hex'), ...over,
});

test('packet filter language', () => {
  const p = packet({});
  const run = (source) => parseFilter(source).test?.(p);
  assert.equal(run('ip.addr == 185.1.2.3'), true);
  assert.equal(run('ip.src == 185.1.2.3'), false);
  assert.equal(run('ip.src != 185.1.2.3'), true);
  assert.equal(run('proto == http && port == 8443'), true);
  assert.equal(run('proto == dns or port == 8443'), true);
  assert.equal(run('not proto == http'), false);
  assert.equal(run('frame.len > 50 && frame.len < 200'), true);
  assert.equal(run('info contains "beacon"'), true);
  assert.equal(run('payload contains "host: x"'), true);
  assert.equal(run('(proto == dns || proto == http) && !port == 80'), true);
  assert.equal(run('beacon'), true);
  assert.equal(run('"nothing like this"'), false);
  assert.equal(parseFilter('').empty, true);
  for (const bad of ['ip.addr ==', 'nofield == 3', '((proto == http)', 'proto == http &&', 'a ; b', 'x'.repeat(300)]) {
    const parsed = parseFilter(bad);
    assert.equal(parsed.ok, false, bad);
    assert.equal(typeof parsed.error, 'string');
  }
});

test('follow stream returns the conversation in order, in both directions', () => {
  const a = packet({ n: 1 });
  const b = packet({ n: 2, src: '185.1.2.3', sp: 8443, dst: '10.0.1.21', dp: 40000, hex: Buffer.from('HTTP/1.1 200 OK\r\n').toString('hex') });
  const other = packet({ n: 3, sp: 41000 });
  assert.equal(conversationKey(a), conversationKey(b));
  assert.notEqual(conversationKey(a), conversationKey(other));
  const stream = buildStream(indexConversations([a, other, b]), a);
  assert.deepEqual(stream.segments.map((s) => [s.n, s.side]), [[1, 'client'], [2, 'server']]);
  assert.match(Buffer.from(stream.segments[1].bytes).toString('latin1'), /200 OK/);
  assert.equal(filterPackets([a, b, other], parseFilter('port == 41000')).length, 1);
  assert.equal(filterPackets([a, b, other], parseFilter(''), 2).length, 2);
});

test('hex helpers', () => {
  assert.deepEqual([...hexToBytes('ff d8 00 41')], [255, 216, 0, 65]);
  assert.equal(hexToText('4142430d0a00'), 'ABC\r\n.');
  const rows = hexRows('41'.repeat(20), 32);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].offset, rows[1].offset, rows[1].hex.length], [32, 48, 4]);
  assert.equal(rows[0].ascii, 'A'.repeat(16));
  assert.deepEqual(decodeBase64('cGFzc3BocmFzZTogeA=='), { ok: true, text: 'passphrase: x' });
  assert.equal(decodeBase64('***').ok, false);
  assert.deepEqual(decodeHexText('0x68616e646c65'), { ok: true, text: 'handle' });
  assert.equal(decodeHexText('abc').ok, false);
  assert.equal(rot13('Hello'), 'Uryyb');
});

function embed(message, { channel, lsbFirst, size = 16 }) {
  const bits = [];
  for (const byte of Buffer.from(`${message}\0`)) {
    for (let k = 0; k < 8; k += 1) { bits.push(lsbFirst ? (byte >> k) & 1 : (byte >> (7 - k)) & 1); }
  }
  const pixels = new Uint8Array(size * size * 3).fill(0x80);
  bits.forEach((bit, p) => { pixels[p * 3 + channel] = 0x80 | bit; });
  return pixels;
}

test('LSB extraction recovers the message only with the right channel and bit order', () => {
  for (const channel of [0, 1, 2]) {
    for (const lsbFirst of [true, false]) {
      const pixels = embed('KEY=otter-123', { channel, lsbFirst });
      assert.equal(extractLsb(pixels, { channel, lsbFirst }), 'KEY=otter-123');
      assert.notEqual(extractLsb(pixels, { channel: (channel + 1) % 3, lsbFirst }), 'KEY=otter-123');
      assert.notEqual(extractLsb(pixels, { channel, lsbFirst: !lsbFirst }), 'KEY=otter-123');
    }
  }
  assert.equal(extractLsb(embed('A'.repeat(30), { channel: 0, lsbFirst: false }), { channel: 0, maxChars: 5 }).length, 5);
});

test('pixel rendering for the canvas views', () => {
  const pixels = Uint8Array.from([200, 101, 50, 1, 2, 3]);
  assert.deepEqual([...renderPixels(pixels)], [200, 101, 50, 255, 1, 2, 3, 255]);
  assert.deepEqual([...renderPixels(pixels, { view: 'plane', channel: 1 })], [255, 255, 255, 255, 0, 0, 0, 255]);
  assert.deepEqual([...renderPixels(pixels, { view: 'amplify' })], [0, 255, 0, 255, 255, 0, 255, 255]);
});

test('timer helpers format, badge and persist without touching the server', () => {
  assert.equal(formatElapsed(65_000), '1:05');
  assert.equal(formatElapsed(3_725_000), '1:02:05');
  assert.equal(formatElapsed(-5), '0:00');
  assert.equal(timerBadge('easy', 5 * 60_000).id, 'ace');
  assert.equal(timerBadge('easy', 14 * 60_000).id, 'sharp');
  assert.equal(timerBadge('easy', 25 * 60_000).id, 'steady');
  assert.equal(timerBadge('insane', 9 * 3_600_000).id, 'cold-case');
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const me = 'Ann@Example.com';
  assert.equal(readStart(storage, me, 'easy', 1000), null);
  writeStart(storage, me, 'easy', 500);
  assert.equal(readStart(storage, me, 'easy', 1000), 500);
  assert.equal(readStart(storage, 'ann@example.com', 'easy', 1000), 500, 'the email is case-insensitive');
  assert.equal(readStart(storage, 'bob@example.com', 'easy', 1000), null, 'a second account does not see the first clock');
  assert.notEqual(timerKey(me, 'easy'), timerKey('bob@example.com', 'easy'));
  assert.equal(readStart(storage, me, 'easy', 100), null);
  clearStart(storage, me, 'easy');
  assert.equal(readStart(storage, me, 'easy', 1000), null);
  assert.equal(timerKey('', 'easy'), '');
  assert.equal(timerKey(undefined, 'easy'), '');
  const before = store.size;
  assert.equal(writeStart(storage, undefined, 'easy', 500), 500);
  assert.equal(store.size, before, 'signed out writes nothing');
  assert.equal(readStart(storage, undefined, 'easy', 1000), null);
  assert.equal(readStart({ getItem() { throw new Error('blocked'); } }, me, 'easy'), null);
});

test('progress, next stage, evidence cards and error messages', () => {
  assert.equal(progressPercent(2, 5), 40);
  assert.equal(progressPercent(9, 5), 100);
  assert.equal(progressPercent(0, 0), 0);
  const stages = [{ n: 1, solved: true }, { n: 2, solved: false, locked: false }, { n: 5, solved: false, locked: true, whodunit: true }];
  assert.equal(nextOpenStage(stages), 2);
  assert.equal(nextOpenStage([{ n: 5, solved: false, locked: true }]), null);
  const cards = evidenceCards([{ n: 1, value: '1.2.3.4' }], stages);
  assert.deepEqual(cards.map((c) => [c.n, c.confirmed, c.value]), [[1, true, '1.2.3.4'], [2, false, null]]);
  assert.match(describeForensicsError({ code: 'STAGE_LOCKED' }), /other stages/);
  assert.match(describeForensicsError({ status: 429 }), /Too many/);
  assert.match(describeForensicsError({ code: 'FORENSICS_NOT_SEEDED' }), /seed:forensics/);
  assert.equal(describeForensicsError({ message: 'boom' }), 'boom');
});

test('a rank is only earned by closing the case in this session with a genuine start', () => {
  const base = { trackId: 'easy', closed: true, reviewed: false, hasStart: true, elapsed: 60_000 };
  assert.equal(earnedBadge(base).id, 'ace');
  assert.equal(earnedBadge({ ...base, closed: false }), null);
  assert.equal(earnedBadge({ ...base, reviewed: true }), null);
  assert.equal(earnedBadge({ ...base, hasStart: false }), null);
  assert.equal(earnedBadge({ ...base, elapsed: 0 }), null);
  assert.equal(earnedBadge({ ...base, elapsed: Number.NaN }), null);
});

test('hex find searches the whole file, so matches may straddle a row', () => {
  const bytes = new Uint8Array(40).fill(0x41);
  bytes.set([0x4a, 0x46, 0x49, 0x46], 14); // JFIF across the 16-byte boundary
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const text = findMatches(hex, 'jfif');
  assert.deepEqual(text, [{ offset: 14, length: 4 }]);
  assert.deepEqual(matchRows(text[0]), [0, 1]);
  assert.deepEqual(findMatches(hex, '4a 46 49 46'), [{ offset: 14, length: 4 }]);
  assert.equal(findMatches(hex, 'AA').length, 34);
  assert.deepEqual(findMatches(hex, 'x'), []);
  assert.deepEqual(findMatches(hex, 'zzzz'), []);
});
