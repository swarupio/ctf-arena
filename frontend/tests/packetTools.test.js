import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPackets, parseFilter } from '../src/forensics/packetFilter.js';
import { buildLayers, combineFilter, flattenTree, transportOf } from '../src/forensics/packetLayers.js';
import {
  STREAM_CAP_BYTES, buildStream, conversationKey, conversationNeighbours, indexConversations, segmentHexRows, segmentText, streamAsText,
} from '../src/forensics/packetStream.js';
import { makeContext, artefactData } from '../../backend/src/forensics/tracks.js';

const hex = (text) => Buffer.from(text, 'latin1').toString('hex');
const pkt = (over) => ({
  n: 1, t: '1.000', src: '10.0.1.21', sp: 40000, dst: '185.1.2.3', dp: 8443, proto: 'HTTP', len: 100, info: 'POST /beacon HTTP/1.1',
  hex: hex('POST /beacon HTTP/1.1\r\nHost: c2.example.com\r\nX-Id: 0001\r\n\r\n'), ...over,
});
const dnsQuery = Buffer.concat([
  Buffer.from([0x1a, 0x2b, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]), Buffer.from([3]), Buffer.from('abc'), Buffer.from([3]), Buffer.from('com'), Buffer.from([0, 0, 1, 0, 1]),
]);
const allIds = (n) => [n.id, ...(n.children ?? []).flatMap(allIds)];
const flat = (nodes) => flattenTree(nodes, new Set(nodes.flatMap(allIds))).map((v) => v.node);

test('layer tree has Frame, Ethernet, IP, TCP and HTTP with byte ranges', () => {
  const { nodes, bytes, hasOffsets } = buildLayers(pkt({}));
  assert.deepEqual(nodes.map((n) => n.id), ['frame', 'eth', 'ip', 'l4', 'app']);
  assert.match(nodes[0].label, /Frame 1/);
  assert.match(nodes[3].label, /Transmission Control Protocol/);
  assert.equal(hasOffsets, true);
  const all = flat(nodes);
  const host = all.find((n) => n.label === 'Host');
  assert.equal(host.value, 'c2.example.com');
  const [s, e] = host.range;
  assert.equal(Buffer.from(bytes.subarray(s, e)).toString('latin1'), 'Host: c2.example.com');
  assert.equal(all.find((n) => n.id === 'http.method').value, 'POST');
  assert.equal(all.find((n) => n.id === 'ip.src').filter, 'ip.src == 10.0.1.21');
  assert.equal(all.find((n) => n.id === 'l4.dp').filter, 'tcp.port == 8443');
  // Header layers carry no byte offsets: the capture does not store header bytes.
  assert.equal(nodes[2].range, undefined);
  assert.equal(all.find((n) => n.id === 'ip.src').range, undefined);
  for (const n of all) { if (n.range) { assert.ok(n.range[0] >= 0 && n.range[1] <= bytes.length && n.range[0] < n.range[1], n.id); } }
});

test('layer tree decodes DNS, TLS, TCP flags, ICMP and empty payloads', () => {
  const dns = buildLayers(pkt({ proto: 'DNS', dp: 53, hex: dnsQuery.toString('hex'), info: 'Standard query 0x1a2b A abc.com' }));
  assert.equal(transportOf({ proto: 'DNS' }), 'UDP');
  assert.match(dns.nodes[3].label, /User Datagram/);
  const nodes = flat(dns.nodes);
  const name = nodes.find((n) => n.id === 'dns.q0.name');
  assert.equal(name.value, 'abc.com');
  assert.deepEqual(name.range, [12, 21]);
  assert.equal(name.filter, 'frame contains "abc.com"');
  assert.equal(nodes.find((n) => n.id === 'dns.qr').value, 'Query');
  const tls = buildLayers(pkt({ proto: 'TLS', dp: 443, hex: '1703030004deadbeef' }));
  assert.equal(flat(tls.nodes).find((n) => n.id === 'tls.length').value, '4');
  const syn = buildLayers(pkt({ proto: 'TCP', info: '49152 > 9001 [PSH, ACK] Seq=57 Len=56', hex: hex('QUJD') }));
  const f = flat(syn.nodes);
  assert.equal(f.find((n) => n.id === 'tcp.flags').value, '[PSH, ACK]');
  assert.equal(f.find((n) => n.id === 'tcp.seq').value, '57');
  assert.equal(f.find((n) => n.id === 'data.all').range[1], 4);
  const icmp = buildLayers(pkt({ proto: 'ICMP', sp: 0, dp: 0, info: 'Echo (ping) request', hex: '6162' }));
  assert.equal(icmp.nodes[3].id, 'l4');
  assert.match(icmp.nodes[3].label, /Control Message/);
  const empty = buildLayers(pkt({ proto: 'TCP', info: '1 > 2 [SYN] Seq=0 Len=0', hex: '' }));
  assert.equal(empty.hasOffsets, false);
  assert.equal(empty.nodes.at(-1).id, 'l4');
});

test('layer builder survives truncated and hostile payloads', () => {
  const hostile = ['', '00', '1a2b0100', dnsQuery.subarray(0, 14).toString('hex'), dnsQuery.subarray(0, 20).toString('hex'),
    'c0'.repeat(300), 'ff'.repeat(300), hex('GET '), hex('GET /x HTTP/1.1\r\nHost'), hex('HTTP/1.1 200 OK\r\n\r\nbody'), hex('POST / HTTP/1.1\r\n'.repeat(500))];
  for (const h of hostile) {
    for (const proto of ['DNS', 'HTTP', 'TLS', 'TCP']) {
      const { nodes, bytes } = buildLayers(pkt({ proto, hex: h }));
      assert.ok(nodes.length >= 4);
      for (const n of flat(nodes)) { if (n.range) { assert.ok(n.range[1] <= bytes.length, `${proto} ${n.id}`); } }
    }
  }
  assert.equal(buildLayers(pkt({ hex: undefined })).bytes.length, 0);
});

test('flattenTree honours the expanded set and combineFilter keeps within the limit', () => {
  const { nodes } = buildLayers(pkt({}));
  assert.equal(flattenTree(nodes, new Set()).length, 5);
  assert.ok(flattenTree(nodes, new Set(['ip'])).length > 5);
  assert.equal(combineFilter('', 'dns'), 'dns');
  assert.equal(combineFilter('dns', 'dns'), 'dns');
  assert.equal(combineFilter('a || b', 'http'), '(a || b) && http');
  assert.equal(combineFilter('x'.repeat(199), 'http'), 'http');
  assert.equal(parseFilter(combineFilter('ip.src == 1.2.3.4 || dns', 'frame contains "x"')).ok, true);
});

test('display filter: protocol words, frame contains, boolean logic', () => {
  const dns = pkt({ n: 1, proto: 'DNS', dst: '10.0.1.2', dp: 53, hex: dnsQuery.toString('hex'), info: 'Standard query 0x1a2b A abc.com' });
  const http = pkt({ n: 2 });
  const tls = pkt({ n: 3, proto: 'TLS', dp: 443, hex: '1703030004deadbeef', info: 'Application Data' });
  const icmp = pkt({ n: 4, proto: 'ICMP', sp: 0, dp: 0, info: 'Echo (ping) request', hex: '6162' });
  const all = [dns, http, tls, icmp];
  const nums = (source) => filterPackets(all, parseFilter(source)).map((p) => p.n);
  assert.deepEqual(nums('dns'), [1]);
  assert.deepEqual(nums('http'), [2]);
  assert.deepEqual(nums('udp'), [1]);
  assert.deepEqual(nums('tcp'), [2, 3]);
  assert.deepEqual(nums('icmp'), [4]);
  assert.deepEqual(nums('dns || http'), [1, 2]);
  assert.deepEqual(nums('!(dns || http) && tcp'), [3]);
  assert.deepEqual(nums('tcp && !tls'), [2]);
  assert.deepEqual(nums('frame contains "C2.EXAMPLE"'), [2]);
  assert.deepEqual(nums('frame contains "echo"'), [4]);
  assert.deepEqual(nums('udp.port == 53'), [1]);
  assert.deepEqual(nums('tcp.port == 443'), [3]);
  assert.deepEqual(nums('ip.addr==10.0.1.2'), [1]);
  assert.deepEqual(nums('ip.dst == 185.1.2.3 && http'), [2]);
  assert.deepEqual(nums('ip.src == 10.0.1.21 and not dns'), [2, 3, 4]);
  assert.deepEqual(nums(''), [1, 2, 3, 4]);
});

test('display filter: clear messages for malformed input', () => {
  const cases = {
    'ip.addr ==': /Missing value/,
    'ip.addr': /needs a comparison/,
    'ip.foo == 1': /Unknown field/,
    'dns &&': /ends too early/,
    '(dns': /closing parenthesis/,
    'dns)': /Unexpected/,
    'dns & http': /&&/,
    'dns | http': /\|\|/,
    'ip.src = 1.2.3.4': /==/,
    'frame contains "abc': /Unterminated/,
    'frame contains "a\\qb"': /escape/,
    '&& dns': /Unexpected/,
    'frame contains': /Missing value/,
    'dns dns': /Unexpected/,
    '!': /ends too early/,
  };
  for (const [source, pattern] of Object.entries(cases)) {
    const parsed = parseFilter(source);
    assert.equal(parsed.ok, false, source);
    assert.match(parsed.error, pattern, source);
  }
});

test('display filter: huge and nasty input stays fast and safe', () => {
  const started = Date.now();
  const nasty = ['('.repeat(100), `${'('.repeat(99)}dns${')'.repeat(99)}`, '!'.repeat(199), 'dns||'.repeat(40), 'a'.repeat(199), 'x'.repeat(1e6),
    '"'.repeat(199), '\\'.repeat(199), `${'dns && '.repeat(30)}http`, `frame contains "${'a'.repeat(190)}"`, '&|'.repeat(100), '\u0000'.repeat(100)];
  for (const source of nasty) {
    const parsed = parseFilter(source);
    assert.equal(typeof parsed.ok, 'boolean');
    if (parsed.ok) { parsed.test(pkt({})); }
  }
  assert.equal(parseFilter('!'.repeat(199)).ok, false);
  assert.equal(parseFilter(`${'('.repeat(30)}dns${')'.repeat(30)}`).ok, true);
  assert.equal(parseFilter('('.repeat(100)).ok, false);
  assert.ok(Date.now() - started < 2000, 'parsing is not exponential');
  // Evaluating a large capture with a combined filter is one pass.
  const big = Array.from({ length: 4000 }, (_, i) => pkt({ n: i + 1 }));
  const t0 = Date.now();
  assert.equal(filterPackets(big, parseFilter('http && (frame contains "beacon" || dns) && !tls')).length, 4000);
  assert.ok(Date.now() - t0 < 2000);
});

test('stream: both directions, capture order, client first, control packets kept', () => {
  const syn = pkt({ n: 5, proto: 'TCP', info: '40000 > 8443 [SYN] Seq=0 Len=0', hex: '', t: '2.0' });
  const req = pkt({ n: 6, t: '2.5' });
  const rep = pkt({ n: 7, src: '185.1.2.3', sp: 8443, dst: '10.0.1.21', dp: 40000, hex: hex('HTTP/1.1 200 OK\r\n\r\n'), t: '2.1' });
  const other = pkt({ n: 8, sp: 41000 });
  const idx = indexConversations([other, rep, req, syn]);
  assert.equal(conversationKey(req), conversationKey(rep));
  assert.notEqual(conversationKey(req), conversationKey(other));
  const stream = buildStream(idx, req);
  assert.deepEqual(stream.segments.map((s) => [s.n, s.side]), [[5, 'client'], [6, 'client'], [7, 'server']]);
  assert.equal(stream.segments[0].control, '40000 > 8443 [SYN] Seq=0 Len=0');
  assert.equal(stream.endpoints.client, '10.0.1.21:40000');
  assert.equal(stream.truncated, false);
  assert.match(segmentText(stream.segments[2].bytes), /200 OK/);
  assert.match(segmentHexRows(stream.segments[2].bytes)[0], /^0000 {2}48 54 54 50/);
  const text = streamAsText(stream, 'ascii');
  assert.match(text, /CLIENT > packet 6/);
  assert.match(text, /SERVER < packet 7/);
  assert.match(streamAsText(stream, 'hex'), /48 54 54 50/);
  // Without a SYN the client is the first sender in capture order.
  assert.equal(buildStream(indexConversations([rep]), rep).endpoints.client, '185.1.2.3:8443');
});

test('stream: neighbours and the size cap with a truncated marker', () => {
  const list = [1, 2, 3].map((n) => pkt({ n }));
  const idx = indexConversations([list[2], list[0], list[1], pkt({ n: 9, sp: 1 })]);
  assert.deepEqual(conversationNeighbours(idx, list[1]), { position: 2, count: 3, prev: 1, next: 3 });
  assert.deepEqual(conversationNeighbours(idx, list[0]), { position: 1, count: 3, prev: null, next: 2 });
  assert.deepEqual(conversationNeighbours(new Map(), list[0]), { position: 1, count: 1, prev: null, next: null });
  const chunk = 'A'.repeat(96);
  const many = Array.from({ length: 80 }, (_, i) => pkt({ n: i + 1, hex: hex(chunk) }));
  const capped = buildStream(indexConversations(many), many[0]);
  assert.equal(capped.truncated, true);
  assert.equal(capped.shownBytes, STREAM_CAP_BYTES);
  assert.equal(capped.payloadBytes, 80 * 96);
  assert.equal(capped.clipped, true);
  assert.ok(capped.omittedPackets > 0);
  assert.match(streamAsText(capped), /truncated/);
  const byPackets = buildStream(indexConversations(many), many[0], { capPackets: 3, capBytes: 1e6 });
  assert.equal(byPackets.segments.length, 3);
  assert.equal(byPackets.omittedPackets, 77);
  // 20000 packets of one conversation are processed in one pass.
  const huge = Array.from({ length: 20000 }, (_, i) => pkt({ n: i + 1, hex: hex('hi') }));
  const t0 = Date.now();
  assert.equal(buildStream(indexConversations(huge), huge[5]).packetCount, 20000);
  assert.ok(Date.now() - t0 < 2000);
});

test('real generated capture: every packet builds a tree, streams and filters work', () => {
  const ctx = makeContext('medium', 'x'.repeat(32), 'team-a');
  const first = artefactData(ctx, 'capture', { offset: 0, limit: 250 });
  const packets = [...first.packets];
  for (let offset = 250; offset < first.total; offset += 250) { packets.push(...artefactData(ctx, 'capture', { offset, limit: 250 }).packets); }
  assert.equal(packets.length, first.total);
  let withRange = 0;
  for (const p of packets) {
    const { nodes, bytes } = buildLayers(p);
    assert.equal(nodes.length >= 4, true);
    for (const n of flat(nodes)) { if (n.range) { withRange += 1; assert.ok(n.range[1] <= bytes.length); } }
  }
  assert.ok(withRange > 1000);
  const idx = indexConversations(packets);
  const exfil = packets.find((p) => p.dp === 9001 && p.hex);
  const stream = buildStream(idx, exfil);
  assert.ok(stream.packetCount > 3);
  assert.ok(stream.segments.every((s) => s.side === 'client'));
  assert.ok(filterPackets(packets, parseFilter('dns')).length > 100);
  assert.ok(filterPackets(packets, parseFilter('http && frame contains "beacon"')).length > 0);
  assert.equal(filterPackets(packets, parseFilter('tcp.port == 9001')).length, stream.packetCount);
  assert.equal(filterPackets(packets, parseFilter('dns || http || tls || icmp || tcp'), 99999).length, packets.length);
});
