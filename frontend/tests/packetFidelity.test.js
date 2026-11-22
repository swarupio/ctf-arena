import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPackets, parseFilter } from '../src/forensics/packetFilter.js';
import { buildLayers, flattenTree, markOf } from '../src/forensics/packetLayers.js';
import {
  buildStream, conversationKey, conversationNeighbours, indexConversations, sortConversation, streamAsText,
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

const MAC_A = '02:aa:bb:cc:dd:01';
const MAC_B = '02:aa:bb:cc:dd:02';
const withMac = (over) => pkt({ sm: MAC_A, dm: MAC_B, ...over });
const loadCapture = (track = 'medium', team = 'team-a') => {
  const ctx = makeContext(track, 'x'.repeat(32), team);
  const first = artefactData(ctx, 'capture', { offset: 0, limit: 250 });
  const packets = [...first.packets];
  for (let offset = 250; offset < first.total; offset += 250) { packets.push(...artefactData(ctx, 'capture', { offset, limit: 250 }).packets); }
  return { ctx, packets };
};
const slice = (frame, range) => Buffer.from(frame.subarray(range[0], range[1]));

test('DNS query and response are one conversation (real capture), client is the asker', () => {
  for (const team of ['team-a', 'team-b', 'team-c']) {
    const { ctx, packets } = loadCapture('medium', team);
    const query = packets.find((p) => p.info === `Standard query 0x1a2b A ${ctx.scn.c2Domain}`);
    const reply = packets.find((p) => p.info.startsWith(`Standard query response 0x1a2b A ${ctx.scn.c2Domain} `));
    assert.equal(conversationKey(query), conversationKey(reply));
    const idx = indexConversations(packets);
    const stream = buildStream(idx, reply);
    assert.deepEqual(stream.segments.map((s) => [s.n, s.side]), [[query.n, 'client'], [reply.n, 'server']]);
    assert.equal(stream.endpoints.client, `${query.src}:${query.sp}`);
    assert.deepEqual(conversationNeighbours(idx, query), { position: 1, count: 2, prev: null, next: reply.n });
    assert.equal(conversationNeighbours(idx, reply).prev, query.n);
  }
});

test('Ethernet layer shows the MAC addresses and highlights their header bytes', () => {
  const packet = withMac({});
  const { nodes, frame, headerLength, bytes } = buildLayers(packet);
  const all = flat(nodes);
  const at = (id) => slice(frame, markOf(all.find((n) => n.id === id), headerLength));
  assert.equal(all.find((n) => n.id === 'eth.src').value, MAC_A);
  assert.equal(all.find((n) => n.id === 'eth.dst').value, MAC_B);
  assert.equal(all.find((n) => n.id === 'eth.src').filter, `eth.src == ${MAC_A}`);
  assert.match(nodes[1].label, /Src: 02:aa:bb:cc:dd:01, Dst: 02:aa:bb:cc:dd:02/);
  assert.equal(headerLength, 14 + 20 + 20);
  assert.equal(frame.length, headerLength + bytes.length);
  assert.equal(at('eth.dst').toString('hex'), '02aabbccdd02');
  assert.equal(at('eth.src').toString('hex'), '02aabbccdd01');
  assert.equal(at('eth.type').toString('hex'), '0800');
  assert.equal(at('ip.src').toString('hex'), '0a000115');
  assert.equal(at('ip.dst').toString('hex'), 'b9010203');
  assert.equal(at('l4.sp').readUInt16BE(0), 40000);
  assert.equal(at('l4.dp').readUInt16BE(0), 8443);
  assert.equal(at('ip.total').readUInt16BE(0), 20 + 20 + (packet.len - 42));
  assert.equal(frame[14], 0x45);
  assert.equal(frame[23], 6);
  assert.match(all.find((n) => n.id === 'ip.sum').value, /not computed/);
  assert.equal(at('ip.sum').toString('hex'), '0000');
  // Payload fields sit behind the headers.
  const host = all.find((n) => n.label === 'Host');
  assert.equal(slice(frame, markOf(host, headerLength)).toString('latin1'), 'Host: c2.example.com');
  // Layers highlight their whole header; the frame layer has no bytes of its own.
  assert.deepEqual(markOf(nodes[1], headerLength), [0, 14]);
  assert.deepEqual(markOf(nodes[2], headerLength), [14, 34]);
  assert.deepEqual(markOf(nodes[3], headerLength), [34, 54]);
  assert.equal(markOf(nodes[0], headerLength), null);
  assert.equal(markOf(null, 54), null);
});

test('synthesised headers for UDP, ICMP and TCP flags carry the packet values', () => {
  const dns = buildLayers(withMac({ proto: 'DNS', sp: 41234, dp: 53, len: 42 + dnsQuery.length, hex: dnsQuery.toString('hex'), info: 'Standard query 0x1a2b A abc.com' }));
  const dnsAll = flat(dns.nodes);
  const dnsAt = (id) => slice(dns.frame, markOf(dnsAll.find((n) => n.id === id), dns.headerLength));
  assert.equal(dns.headerLength, 14 + 20 + 8);
  assert.equal(dns.frame[23], 17);
  assert.equal(dnsAt('udp.len').readUInt16BE(0), 8 + dnsQuery.length);
  assert.equal(dnsAt('l4.sp').readUInt16BE(0), 41234);
  assert.deepEqual(markOf(dnsAll.find((n) => n.id === 'dns.id'), dns.headerLength), [42, 44]);
  assert.equal(dnsAt('dns.id').toString('hex'), '1a2b');
  const icmp = buildLayers(withMac({ proto: 'ICMP', sp: 0, dp: 0, info: 'Echo (ping) request', hex: '6162' }));
  assert.equal(icmp.headerLength, 14 + 20 + 8);
  assert.equal(icmp.frame[23], 1);
  assert.equal(icmp.frame[34], 8);
  const tcp = buildLayers(withMac({ proto: 'TCP', info: '49152 > 9001 [SYN, ACK] Seq=77 Len=0', hex: '' }));
  assert.equal(tcp.frame[47], 0x12);
  assert.equal(Buffer.from(tcp.frame.subarray(38, 42)).readUInt32BE(0), 77);
  assert.equal(tcp.frame.length, tcp.headerLength);
  // A packet from an older capture without MACs still builds and says not recorded.
  assert.equal(flat(buildLayers(pkt({})).nodes).find((n) => n.id === 'eth.note').value, 'not recorded in this capture');
});

test('every packet of a real capture builds consistent frame bytes', () => {
  const { packets } = loadCapture('insane');
  for (const p of packets) {
    const { nodes, frame, headerLength, bytes } = buildLayers(p);
    assert.equal(frame.length, headerLength + bytes.length);
    for (const n of flat(nodes)) {
      const mark = markOf(n, headerLength);
      if (mark) { assert.ok(mark[0] >= 0 && mark[0] < mark[1] && mark[1] <= frame.length, `${p.n} ${n.id}`); }
    }
    assert.equal(slice(frame, [0, 6]).toString('hex').replace(/(..)(?!$)/g, '$1:'), p.dm);
    assert.equal(slice(frame, [6, 12]).toString('hex').replace(/(..)(?!$)/g, '$1:'), p.sm);
  }
});

test('display filter: eth.src, eth.dst and eth.addr', () => {
  const a = withMac({ n: 1 });
  const b = withMac({ n: 2, sm: MAC_B, dm: MAC_A });
  const c = pkt({ n: 3 });
  const nums = (source) => filterPackets([a, b, c], parseFilter(source)).map((p) => p.n);
  assert.deepEqual(nums(`eth.src == ${MAC_A}`), [1]);
  assert.deepEqual(nums(`eth.dst == ${MAC_A.toUpperCase()}`), [2]);
  assert.deepEqual(nums(`eth.addr == ${MAC_B}`), [1, 2]);
  assert.deepEqual(nums(`eth.addr == ${MAC_A} && eth.src != ${MAC_A}`), [2]);
  assert.deepEqual(nums('eth.src contains "aa:bb"'), [1, 2]);
  assert.equal(parseFilter('eth.addr').ok, false);
  assert.equal(parseFilter('eth.foo == 1').ok, false);
  const { packets } = loadCapture();
  const host = packets.find((p) => p.src === '10.0.1.21') ?? packets[0];
  const hits = filterPackets(packets, parseFilter(`eth.src == ${host.sm}`), 99999);
  assert.ok(hits.length > 0 && hits.every((p) => p.src === host.src));
});

test('stream order: capture order is the default, time order re-sorts, the client does not change', () => {
  const syn = pkt({ n: 5, proto: 'TCP', info: '40000 > 8443 [SYN] Seq=0 Len=0', hex: '', t: '2.0' });
  const req = pkt({ n: 6, t: '2.5' });
  const rep = pkt({ n: 7, src: '185.1.2.3', sp: 8443, dst: '10.0.1.21', dp: 40000, hex: hex('HTTP/1.1 200 OK\r\n\r\n'), t: '2.1' });
  const idx = indexConversations([syn, req, rep]);
  const byCapture = buildStream(idx, req);
  const byTime = buildStream(idx, req, { order: 'time' });
  assert.equal(byCapture.order, 'capture');
  assert.deepEqual(byCapture.segments.map((s) => s.n), [5, 6, 7]);
  assert.equal(buildStream(idx, req, { order: 'nonsense' }).order, 'capture');
  assert.equal(byTime.order, 'time');
  assert.deepEqual(byTime.segments.map((s) => s.n), [5, 7, 6]);
  assert.deepEqual(byTime.endpoints, byCapture.endpoints);
  assert.equal(byTime.packetCount, byCapture.packetCount);
  assert.equal(byTime.payloadBytes, byCapture.payloadBytes);
  assert.match(streamAsText(byCapture), /Order: capture/);
  assert.match(streamAsText(byTime), /Order: time/);
  assert.deepEqual(sortConversation([req, rep], 'capture').map((p) => p.n), [6, 7]);
  // Previous and Next always follow capture order.
  assert.deepEqual(conversationNeighbours(idx, req), { position: 2, count: 3, prev: 5, next: 7 });
  // Ties on the time stamp keep packet-number order.
  assert.deepEqual(sortConversation([pkt({ n: 9, t: '1.0' }), pkt({ n: 8, t: '1.0' })], 'time').map((p) => p.n), [8, 9]);
});

test('stream order on the real capture: the skewed reply follows its request in capture order, precedes it in time order', () => {
  const { ctx, packets } = loadCapture('medium');
  const { skew } = ctx.packet();
  const request = packets[skew.skewed.request];
  const idx = indexConversations(packets);
  const names = (order) => buildStream(idx, request, { order }).segments.map((s) => s.n);
  assert.deepEqual(names('capture'), [request.n, request.n + 1]);
  assert.deepEqual(names('time'), [request.n + 1, request.n]);
  const fine = packets[skew.consistent.request];
  assert.deepEqual(buildStream(idx, fine, { order: 'time' }).segments.map((s) => s.n), [fine.n, fine.n + 1]);
  // The result carries no anomaly flag: the player has to notice the disagreement.
  assert.equal(JSON.stringify(buildStream(idx, request, { order: 'time' })).toLowerCase().includes('skew'), false);
});
