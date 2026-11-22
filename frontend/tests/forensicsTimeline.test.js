import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PINS, addPin, dropPin, emptyTimeline, findContradictions, logPin, logTime, movePin, packetPin, pinTime, readTimeline, removePin,
  resortByTime, sanitizeTimeline, sortByTime, timelineKey, writeTimeline,
} from '../src/forensics/timeline.js';

const L = (n, text) => logPin({ n, text });
const P = (n, t, src, sp, dst, dp, proto, info) => packetPin({ n, t, src, sp, dst, dp, proto, info });
const memory = () => { const map = new Map(); return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), map }; };

const vpn = (time, what) => `2026-03-14 ${time} vpn01 openvpn[9]: dana/10.8.0.50 session ${what}`;
const login = (time) => `2026-03-14 ${time} srv01 sshd[10]: Accepted publickey for dana from 10.8.0.50 port 22222 ssh2`;

test('log times parse from both line formats', () => {
  assert.equal(logTime('2026-03-14 01:12:00 srv01 sshd[1]: x'), Date.UTC(2026, 2, 14, 1, 12, 0));
  assert.equal(logTime('1.2.3.4 - - [14/Mar/2026:01:30:05 +0000] "GET / HTTP/1.1" 200 1 "-" "x"'), Date.UTC(2026, 2, 14, 1, 30, 5));
  assert.equal(logTime('no time here'), null);
});

test('VPN login before the session opened is flagged, and names both times', () => {
  const found = findContradictions([L(10, login('01:12:00')), L(40, vpn('01:30:00', 'opened'))]);
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'login-before-session');
  assert.deepEqual([found[0].a, found[0].b], ['log:10', 'log:40']);
  assert.match(found[0].message, /01:12:00/);
  assert.match(found[0].message, /01:30:00/);
});

test('consistent VPN sessions and unrelated lines raise nothing', () => {
  const pins = [L(5, vpn('01:10:00', 'opened')), L(6, login('01:12:00')), L(9, vpn('01:20:00', 'closed')),
    L(12, '2026-03-14 01:25:00 srv01 CRON[4]: (root) CMD (x)')];
  assert.deepEqual(findContradictions(pins), []);
  // a different user or pool address is a different session
  const other = L(70, '2026-03-14 01:00:00 srv01 sshd[10]: Accepted publickey for eve from 10.8.0.51 port 1 ssh2');
  assert.deepEqual(findContradictions([other, L(80, vpn('01:30:00', 'opened'))]), []);
});

test('login after the session closed, closed before opened and a log clock that jumps back', () => {
  assert.equal(findContradictions([L(1, vpn('01:10:00', 'opened')), L(2, vpn('01:20:00', 'closed')), L(3, login('01:40:00'))])[0].rule, 'login-after-session');
  assert.equal(findContradictions([L(1, vpn('01:10:00', 'closed')), L(2, vpn('01:20:00', 'opened'))])[0].rule, 'closed-before-opened');
  assert.equal(findContradictions([L(1, '2026-03-14 01:20:00 srv01 CRON[1]: a'), L(2, '2026-03-14 01:10:00 srv01 CRON[2]: b')])[0].rule, 'line-order');
});

test('packets: reply before request, DNS answer before question, FIN before SYN, capture order', () => {
  const req = P(10, '5.300', '10.0.1.24', 41000, '10.0.1.1', 8080, 'HTTP', 'GET /time HTTP/1.1');
  const early = P(11, '5.100', '10.0.1.1', 8080, '10.0.1.24', 41000, 'HTTP', 'HTTP/1.1 200 OK');
  assert.equal(findContradictions([req, early])[0].rule, 'reply-before-request');
  const ok = P(11, '5.500', '10.0.1.1', 8080, '10.0.1.24', 41000, 'HTTP', 'HTTP/1.1 200 OK');
  assert.deepEqual(findContradictions([req, ok]), []);
  // a reply that is not the adjacent frame is only judged by capture order
  assert.deepEqual(findContradictions([req, { ...early, n: 30, id: 'packet:30' }]).map((f) => f.rule), ['packet-order']);
  const q = P(20, '9.000', '10.0.1.2', 40000, '10.0.1.3', 53, 'DNS', 'Standard query 0x1a2b A evil.top');
  const a = P(21, '8.500', '10.0.1.3', 53, '10.0.1.2', 40000, 'DNS', 'Standard query response 0x1a2b A evil.top A 1.2.3.4');
  assert.equal(findContradictions([q, a])[0].rule, 'reply-before-request');
  const syn = P(30, '7.000', '10.0.1.2', 49152, '8.8.8.8', 9001, 'TCP', '49152 > 9001 [SYN] Seq=0 Len=0');
  const fin = P(31, '6.000', '10.0.1.2', 49152, '8.8.8.8', 9001, 'TCP', '49152 > 9001 [FIN, ACK] Seq=9 Len=0');
  assert.equal(findContradictions([syn, fin])[0].rule, 'fin-before-syn');
  const one = P(40, '9.000', '1.1.1.1', 1, '2.2.2.2', 2, 'TCP', 'x');
  const two = P(41, '8.000', '1.1.1.1', 1, '2.2.2.2', 3, 'TCP', 'y');
  assert.equal(findContradictions([one, two])[0].rule, 'packet-order');
});

test('the result depends on the pins, not on their order, and a pair is reported once', () => {
  const pins = [L(40, vpn('01:30:00', 'opened')), L(10, login('01:12:00')), L(50, vpn('01:50:00', 'closed'))];
  assert.deepEqual(findContradictions(pins), findContradictions([...pins].reverse()));
  assert.equal(findContradictions(pins).length, 1);
});

test('sorting, moving and dropping pins', () => {
  let state = emptyTimeline();
  for (const pin of [L(30, '2026-03-14 01:30:00 srv01 a'), L(10, '2026-03-14 01:10:00 srv01 b'), L(20, '2026-03-14 01:20:00 srv01 c')]) { state = addPin(state, pin); }
  assert.deepEqual(state.pins.map((p) => p.n), [10, 20, 30]);
  assert.equal(addPin(state, L(10, 'dup')), state);
  state = movePin(state, 'log:10', 1);
  assert.deepEqual(state.pins.map((p) => p.n), [20, 10, 30]);
  assert.equal(state.manual, true);
  state = addPin(state, L(5, '2026-03-14 01:05:00 srv01 d'));
  assert.deepEqual(state.pins.map((p) => p.n), [20, 10, 30, 5]); // manual order is kept
  state = dropPin(state, 'log:5', 'log:20');
  assert.deepEqual(state.pins.map((p) => p.n), [5, 20, 10, 30]);
  assert.equal(movePin(state, 'log:5', -1), state);
  state = resortByTime(state);
  assert.deepEqual(state.pins.map((p) => p.n), [5, 10, 20, 30]);
  assert.equal(state.manual, false);
  assert.deepEqual(removePin(state, 'log:5').pins.map((p) => p.n), [10, 20, 30]);
});

test('log lines and packets share one timeline (capture starts at 03:00)', () => {
  const sorted = sortByTime([P(2, '1.000', 'a', 1, 'b', 2, 'TCP', 'x'), L(9, '2026-03-14 01:00:00 srv01 z'), L(1, 'no time')]);
  assert.deepEqual(sorted.map((p) => p.id), ['log:9', 'packet:2', 'log:1']);
  assert.equal(pinTime(P(1, '60.000', 'a', 1, 'b', 2, 'TCP', 'x')), Date.UTC(2026, 2, 14, 3, 1, 0));
});

test('the board is capped', () => {
  let state = emptyTimeline();
  for (let i = 1; i <= MAX_PINS + 5; i += 1) { state = addPin(state, L(i, `2026-03-14 01:00:00 srv01 ${i}`)); }
  assert.equal(state.pins.length, MAX_PINS);
});

test('storage is per user and case, and anything odd in it is dropped', () => {
  assert.notEqual(timelineKey('A@x.io', 'easy'), timelineKey('b@x.io', 'easy'));
  assert.notEqual(timelineKey('a@x.io', 'easy'), timelineKey('a@x.io', 'hard'));
  assert.equal(timelineKey('A@x.io', 'easy'), timelineKey('a@x.io', 'easy'));
  const storage = memory();
  const key = timelineKey('a@x.io', 'easy');
  const state = addPin(addPin(emptyTimeline(), L(3, '2026-03-14 01:00:00 srv01 q')), P(4, '1.000', 'a', 1, 'b', 2, 'TCP', 'x'));
  writeTimeline(storage, key, { ...state, hunter: true });
  assert.deepEqual(readTimeline(storage, key), { ...state, hunter: true });
  assert.deepEqual(readTimeline(storage, 'other'), emptyTimeline());
  storage.setItem(key, '{not json');
  assert.deepEqual(readTimeline(storage, key), emptyTimeline());
  const dirty = sanitizeTimeline({
    v: 1, manual: 'yes', hunter: 1,
    pins: [null, 5, { kind: 'log', n: 1, id: 'log:2', text: 'x' }, { kind: 'log', n: -1, id: 'log:-1', text: 'x' },
      { kind: 'log', n: 7, id: 'log:7', text: 'y'.repeat(900), evil: '<script>' }, { kind: 'log', n: 7, id: 'log:7', text: 'dup' },
      { kind: 'packet', n: 2, id: 'packet:2', t: 1 }],
  });
  assert.equal(dirty.pins.length, 1);
  assert.equal(dirty.pins[0].text.length, 400);
  assert.equal('evil' in dirty.pins[0], false);
  assert.equal(dirty.manual, false);
  assert.equal(dirty.hunter, false);
  assert.deepEqual(sanitizeTimeline({ v: 2, pins: [] }), emptyTimeline());
});
