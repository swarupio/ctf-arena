import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePacket, normalizePackets } from '../src/forensics/packetRows.js';
import { filterPackets, parseFilter } from '../src/forensics/packetFilter.js';
import { buildLayers, flattenTree } from '../src/forensics/packetLayers.js';
import { buildStream, indexConversations } from '../src/forensics/packetStream.js';

const ODD = [
  { n: 1, t: 0, src: '10.0.0.1', sp: 1000, dst: '10.0.0.2', dp: 80, proto: null, len: 60, info: null, hex: null },
  { n: '2', t: '0.5', src: undefined, sp: null, dst: 7, dp: 'x', proto: undefined, len: '1e400', info: undefined },
  null,
  'junk',
  {},
];

test('normalizePacket turns null, undefined and odd fields into strings and finite numbers', () => {
  for (const raw of ODD) {
    const p = normalizePacket(raw);
    for (const key of ['src', 'dst', 'proto', 'info', 'hex']) { assert.equal(typeof p[key], 'string', key); }
    for (const key of ['n', 't', 'len', 'sp', 'dp']) { assert.equal(Number.isFinite(Number(p[key])), true, key); }
  }
  const p = normalizePacket(ODD[1]);
  assert.deepEqual([p.n, Number(p.t), p.dst, p.len, p.proto], [2, 0.5, '7', 0, '']);
  assert.equal(normalizePacket({ t: '0.012' }).t, '0.012');
  assert.deepEqual(normalizePackets(undefined), []);
  assert.equal(normalizePackets(ODD).length, ODD.length);
});

test('filter, layers and stream never throw on normalised or even raw odd packets', () => {
  const rows = normalizePackets(ODD);
  for (const source of ['dns', 'tcp', 'proto == http', 'info contains "x"', 'frame contains "x"', 'beacon', 'port == 80']) {
    assert.doesNotThrow(() => filterPackets(rows, parseFilter(source)), source);
    assert.doesNotThrow(() => filterPackets(ODD.filter((x) => x && typeof x === 'object'), parseFilter(source)), source);
  }
  for (const packet of rows) {
    assert.doesNotThrow(() => flattenTree(buildLayers(packet).nodes, new Set()));
    assert.doesNotThrow(() => buildStream(indexConversations(rows), packet));
  }
  assert.doesNotThrow(() => buildLayers({ n: 1, proto: null, info: null, hex: null }));
});
