// Layer tree for the packet detail pane. Pure: it only reads the fields a listed packet has
// ({ n, t, src, sp, dst, dp, proto, len, info, hex, sm, dm }). The capture stores the MAC and IP addresses, the ports, the
// length and the first payload bytes. The header bytes are synthesised from those fields (see packetHeaders.js).
//
// A node is { id, label, value, filter?, range?, hrange?, children? }.  `range` is [start, end) in PAYLOAD bytes (the hex of
// the packet) and only exists for fields decoded from those bytes (DNS, HTTP, TLS, raw data). `hrange` is [start, end) in
// the synthesised HEADER bytes (Ethernet, IP, TCP/UDP/ICMP fields). `markOf` turns either into frame offsets.
import { hexToBytes } from './hex.js';
import { ETH_LEN, IP_LEN, L4_LEN, synthesiseHeaders } from './packetHeaders.js';

const UDP_PROTOS = new Set(['DNS', 'NTP']);
const MAX_NAME = 255;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export const transportOf = (packet) => {
  if (packet.proto === 'ICMP') { return 'ICMP'; }
  return UDP_PROTOS.has(packet.proto) || packet.proto === 'UDP' ? 'UDP' : 'TCP';
};

const quote = (text) => `"${String(text).replaceAll('\\', '').replaceAll('"', '')}"`;
const containsFilter = (text) => {
  const clean = String(text).trim();
  return clean === '' || clean.length > 60 ? undefined : `frame contains ${quote(clean)}`;
};
const range = (start, end) => (end > start ? [start, end] : undefined);
const hex2 = (n, width = 2) => `0x${n.toString(16).padStart(width, '0')}`;
const latin1 = (bytes, start, end) => {
  let out = '';
  for (let i = start; i < end; i += 1) { out += String.fromCharCode(bytes[i]); }
  return out;
};
const span = (children) => {
  const ranges = children.map((c) => c.range).filter(Boolean);
  return ranges.length ? [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))] : undefined;
};

// ---- application layers -------------------------------------------------------------------------------------------

const DNS_TYPES = { 1: 'A', 2: 'NS', 5: 'CNAME', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA' };

function dnsName(bytes, start) {
  const labels = [];
  let i = start;
  let total = 0;
  for (let guard = 0; guard < 128; guard += 1) {
    if (i >= bytes.length) { return { name: labels.join('.'), end: i, broken: 'name runs past the captured bytes' }; }
    const length = bytes[i];
    if (length === 0) { return { name: labels.join('.') || '<Root>', end: i + 1 }; }
    if ((length & 0xc0) !== 0) { return { name: labels.join('.'), end: i + 2, broken: 'compressed name (pointer not followed)' }; }
    total += length + 1;
    if (i + 1 + length > bytes.length || total > MAX_NAME) { return { name: labels.join('.'), end: bytes.length, broken: 'name runs past the captured bytes' }; }
    labels.push(latin1(bytes, i + 1, i + 1 + length));
    i += 1 + length;
  }
  return { name: labels.join('.'), end: i, broken: 'too many labels' };
}

function dnsLayer(bytes) {
  if (bytes.length < 12) { return null; }
  const u16 = (at) => (bytes[at] << 8) | bytes[at + 1];
  const flags = u16(2);
  const response = (flags & 0x8000) !== 0;
  const counts = { questions: u16(4), answers: u16(6), authority: u16(8), additional: u16(10) };
  const flagText = [(flags & 0x0400) ? 'authoritative' : null, (flags & 0x0200) ? 'truncated' : null, (flags & 0x0100) ? 'recursion desired' : null,
    (flags & 0x0080) ? 'recursion available' : null].filter(Boolean).join(', ') || 'none set';
  const fields = [
    { id: 'dns.id', label: 'Transaction ID', value: hex2(u16(0), 4), range: range(0, 2) },
    { id: 'dns.flags', label: 'Flags', value: `${hex2(flags, 4)} (${response ? 'response' : 'query'})`, range: range(2, 4), children: [
      { id: 'dns.qr', label: 'Message type', value: response ? 'Response' : 'Query', range: range(2, 3) },
      { id: 'dns.opcode', label: 'Opcode', value: `${(flags >> 11) & 15} (${((flags >> 11) & 15) === 0 ? 'standard query' : 'other'})`, range: range(2, 3) },
      { id: 'dns.fl', label: 'Flag bits', value: flagText, range: range(2, 4) },
      { id: 'dns.rcode', label: 'Reply code', value: `${flags & 15} (${(flags & 15) === 0 ? 'no error' : 'error'})`, range: range(3, 4) },
    ] },
    { id: 'dns.qd', label: 'Questions', value: String(counts.questions), range: range(4, 6) },
    { id: 'dns.an', label: 'Answer RRs', value: String(counts.answers), range: range(6, 8) },
    { id: 'dns.ns', label: 'Authority RRs', value: String(counts.authority), range: range(8, 10) },
    { id: 'dns.ar', label: 'Additional RRs', value: String(counts.additional), range: range(10, 12) },
  ];
  let at = 12;
  const queries = [];
  for (let q = 0; q < Math.min(counts.questions, 8) && at < bytes.length; q += 1) {
    const { name, end, broken } = dnsName(bytes, at);
    const hasTail = end + 4 <= bytes.length && !broken;
    const type = hasTail ? u16(end) : null;
    const klass = hasTail ? u16(end + 2) : null;
    const kids = [
      { id: `dns.q${q}.name`, label: 'Name', value: name, range: range(at, end), filter: containsFilter(name) },
      ...(hasTail ? [
        { id: `dns.q${q}.type`, label: 'Type', value: `${DNS_TYPES[type] ?? 'type'} (${type})`, range: range(end, end + 2) },
        { id: `dns.q${q}.class`, label: 'Class', value: klass === 1 ? 'IN (1)' : String(klass), range: range(end + 2, end + 4) },
      ] : []),
      ...(broken ? [{ id: `dns.q${q}.note`, label: 'Note', value: broken }] : []),
    ];
    queries.push({ id: `dns.q${q}`, label: hasTail ? `${name}: type ${DNS_TYPES[type] ?? type}, class ${klass === 1 ? 'IN' : klass}` : name, value: '', range: span(kids), children: kids });
    at = hasTail ? end + 4 : bytes.length;
  }
  if (queries.length) { fields.push({ id: 'dns.queries', label: 'Queries', value: String(queries.length), range: span(queries), children: queries }); }
  if (counts.answers > 0 && at >= bytes.length) {
    fields.push({ id: 'dns.an.note', label: 'Answers', value: `${counts.answers} announced, record bytes are not part of the captured payload` });
  } else if (at < bytes.length) {
    fields.push({ id: 'dns.rest', label: 'Remaining bytes', value: `${bytes.length - at}`, range: range(at, bytes.length) });
  }
  return { id: 'app', title: `Domain Name System (${response ? 'response' : 'query'})`, fields };
}

const HTTP_START = /^(?:GET|POST|PUT|HEAD|DELETE|OPTIONS|PATCH|HTTP\/1\.[01]) /;

function httpLayer(bytes) {
  const head = latin1(bytes, 0, Math.min(bytes.length, 12));
  if (!HTTP_START.test(head)) { return null; }
  // Walk the lines with indexOf (linear), keeping the byte offset of each.
  const lines = [];
  let at = 0;
  let bodyStart = bytes.length;
  while (at < bytes.length) {
    let end = at;
    while (end < bytes.length && !(bytes[end] === 13 && bytes[end + 1] === 10)) { end += 1; }
    if (end === at) { bodyStart = Math.min(bytes.length, at + 2); break; }
    lines.push({ start: at, end, text: latin1(bytes, at, end) });
    at = end >= bytes.length ? bytes.length : end + 2;
    if (lines.length > 64) { break; }
  }
  const first = lines[0];
  const fields = [];
  const response = first.text.startsWith('HTTP/');
  const parts = first.text.split(' ');
  const offsetOf = (k) => first.start + parts.slice(0, k).reduce((sum, part) => sum + part.length + 1, 0);
  const kids = response
    ? [
      { id: 'http.version', label: 'Version', value: parts[0], range: range(offsetOf(0), offsetOf(0) + parts[0].length) },
      { id: 'http.status', label: 'Status code', value: parts[1] ?? '', range: range(offsetOf(1), offsetOf(1) + (parts[1] ?? '').length), filter: containsFilter(first.text) },
      { id: 'http.reason', label: 'Reason', value: parts.slice(2).join(' '), range: range(offsetOf(2), first.end) },
    ]
    : [
      { id: 'http.method', label: 'Method', value: parts[0], range: range(offsetOf(0), offsetOf(0) + parts[0].length), filter: containsFilter(`${parts[0]} `) },
      { id: 'http.uri', label: 'Request URI', value: parts[1] ?? '', range: range(offsetOf(1), offsetOf(1) + (parts[1] ?? '').length), filter: containsFilter(parts[1] ?? '') },
      { id: 'http.version', label: 'Version', value: parts.slice(2).join(' '), range: range(offsetOf(2), first.end) },
    ];
  fields.push({ id: 'http.first', label: response ? 'Status line' : 'Request line', value: first.text, range: range(first.start, first.end), children: kids.filter((k) => k.value !== '') });
  lines.slice(1).forEach((line, k) => {
    const colon = line.text.indexOf(':');
    if (colon < 1) { fields.push({ id: `http.h${k}`, label: 'Line', value: line.text, range: range(line.start, line.end) }); return; }
    const name = line.text.slice(0, colon);
    const value = line.text.slice(colon + 1).trim();
    fields.push({ id: `http.h${k}`, label: name, value, range: range(line.start, line.end), filter: containsFilter(value) });
  });
  if (bodyStart < bytes.length) { fields.push({ id: 'http.body', label: 'Message body', value: `${bytes.length - bodyStart} bytes`, range: range(bodyStart, bytes.length) }); }
  return { id: 'app', title: 'Hypertext Transfer Protocol', fields };
}

function tlsLayer(bytes) {
  if (bytes.length < 5 || bytes[0] < 20 || bytes[0] > 23) { return null; }
  const types = { 20: 'Change Cipher Spec', 21: 'Alert', 22: 'Handshake', 23: 'Application Data' };
  const version = (bytes[1] << 8) | bytes[2];
  const length = (bytes[3] << 8) | bytes[4];
  return { id: 'app', title: 'Transport Layer Security', fields: [
    { id: 'tls.type', label: 'Content type', value: `${types[bytes[0]]} (${bytes[0]})`, range: range(0, 1) },
    { id: 'tls.version', label: 'Version', value: `${hex2(version, 4)}${version === 0x0303 ? ' (TLS 1.2)' : ''}`, range: range(1, 3) },
    { id: 'tls.length', label: 'Length', value: String(length), range: range(3, 5) },
    { id: 'tls.data', label: 'Encrypted data', value: `${Math.max(0, bytes.length - 5)} bytes captured`, range: range(5, bytes.length) },
  ] };
}

// ---- header layers -------------------------------------------------------------------------------------------------

const TCP_INFO = /^(\d+) > (\d+) \[([A-Z, ]+)\] Seq=(\d+) Len=(\d+)$/;

const tcpInfo = (packet) => {
  const match = TCP_INFO.exec(packet.info ?? '');
  return match ? { flags: match[3], seq: Number(match[4]) } : { flags: null, seq: null };
};

// Payload bytes on the wire (the stored payload is clipped at 96 bytes, the recorded length is not).
const trueLength = (packet) => Math.max(0, Number(packet.len) - 42);

function transportLayer(packet, at) {
  const kind = transportOf(packet);
  const start = ETH_LEN + IP_LEN;
  if (kind === 'ICMP') {
    return { id: 'l4', title: 'Internet Control Message Protocol', hrange: [start, start + L4_LEN.ICMP], fields: [
      { id: 'icmp.type', label: 'Type', value: packet.info, filter: 'icmp', hrange: at.icmpType },
      { id: 'icmp.code', label: 'Code', value: '0 (placeholder)', hrange: at.icmpCode },
      { id: 'icmp.sum', label: 'Checksum', value: '0x0000 (not computed)', hrange: at.icmpChecksum },
    ] };
  }
  const udp = kind === 'UDP';
  const port = (side, value) => ({
    id: `l4.${side}`, label: `${side === 'sp' ? 'Source' : 'Destination'} port`, value: String(value), filter: `${udp ? 'udp' : 'tcp'}.port == ${value}`, hrange: at[side],
  });
  const fields = [port('sp', packet.sp), port('dp', packet.dp)];
  if (!udp) {
    const match = TCP_INFO.exec(packet.info ?? '');
    if (match) {
      fields.push({ id: 'tcp.flags', label: 'Flags', value: `[${match[3]}]`, filter: `info contains ${quote(`[${match[3]}]`)}`, hrange: at.tcpFlags });
      fields.push({ id: 'tcp.seq', label: 'Sequence number', value: match[4], hrange: at.tcpSeq });
      fields.push({ id: 'tcp.len', label: 'Segment length', value: match[5] });
    } else {
      fields.push({ id: 'tcp.flags', label: 'Flags', value: '[PSH, ACK] (placeholder)', hrange: at.tcpFlags });
      fields.push({ id: 'tcp.seq', label: 'Sequence number', value: '0 (placeholder)', hrange: at.tcpSeq });
    }
    fields.push({ id: 'tcp.win', label: 'Window size', value: '65535 (placeholder)', hrange: at.tcpWindow });
    fields.push({ id: 'tcp.sum', label: 'Checksum', value: '0x0000 (not computed)', hrange: at.l4Checksum });
  } else {
    fields.push({ id: 'udp.len', label: 'Length', value: `${8 + trueLength(packet)} bytes`, hrange: at.udpLength });
    fields.push({ id: 'udp.sum', label: 'Checksum', value: '0x0000 (not computed)', hrange: at.l4Checksum });
  }
  return {
    id: 'l4', title: `${udp ? 'User Datagram Protocol' : 'Transmission Control Protocol'}, Src Port: ${packet.sp}, Dst Port: ${packet.dp}`,
    hrange: [start, start + L4_LEN[kind]], fields,
  };
}

const toLayer = (layer) => ({
  id: layer.id, label: layer.title, value: '', range: span(layer.fields), hrange: layer.hrange, children: layer.fields,
});

// Frame offsets [start, end) that a node highlights: header fields use their header range, payload fields sit behind the headers.
export const markOf = (node, headerLength) => {
  if (!node) { return null; }
  if (node.hrange) { return node.hrange; }
  return node.range ? [node.range[0] + headerLength, node.range[1] + headerLength] : null;
};

// Returns the layer nodes of a packet (Frame, Ethernet, IP, TCP/UDP/ICMP, application) and what the byte view can do.
export function buildLayers(packet) {
  const bytes = hexToBytes(packet.hex ?? '');
  const layers = [];
  layers.push({ id: 'frame', title: `Frame ${packet.n}: ${packet.len} bytes on the wire`, fields: [
    { id: 'frame.number', label: 'Frame number', value: String(packet.n), filter: `frame.number == ${packet.n}` },
    { id: 'frame.time', label: 'Seconds since capture start', value: String(packet.t) },
    { id: 'frame.len', label: 'Frame length', value: `${packet.len} bytes`, filter: `frame.len == ${packet.len}` },
    { id: 'frame.cap', label: 'Payload bytes captured', value: String(bytes.length) },
    { id: 'frame.proto', label: 'Protocol label', value: packet.proto, filter: String(packet.proto ?? '').toLowerCase() },
  ] });
  const kind = transportOf(packet);
  const head = synthesiseHeaders(packet, kind, tcpInfo(packet), trueLength(packet));
  const at = head.ranges;
  const hasMac = Boolean(packet.sm && packet.dm);
  layers.push({ id: 'eth', title: hasMac ? `Ethernet II, Src: ${packet.sm}, Dst: ${packet.dm}` : 'Ethernet II', hrange: [0, ETH_LEN], fields: hasMac ? [
    { id: 'eth.dst', label: 'Destination', value: packet.dm, filter: `eth.dst == ${packet.dm}`, hrange: at.ethDst },
    { id: 'eth.src', label: 'Source', value: packet.sm, filter: `eth.src == ${packet.sm}`, hrange: at.ethSrc },
    { id: 'eth.type', label: 'Type', value: 'IPv4 (0x0800)', hrange: at.ethType },
    { id: 'eth.note', label: 'Address kind', value: 'locally administered, derived from the host address (simulated)' },
  ] : [
    { id: 'eth.note', label: 'Link-layer addresses', value: 'not recorded in this capture' },
  ] });
  layers.push({ id: 'ip', title: `Internet Protocol${IPV4.test(packet.src) ? ' Version 4' : ''}, Src: ${packet.src}, Dst: ${packet.dst}`, hrange: [ETH_LEN, ETH_LEN + IP_LEN], fields: [
    { id: 'ip.version', label: 'Version and header length', value: '4, 20 bytes', hrange: at.ipVersion },
    { id: 'ip.total', label: 'Total length', value: String(IP_LEN + L4_LEN[kind] + trueLength(packet)), hrange: at.ipTotal },
    { id: 'ip.ttl', label: 'Time to live', value: '64 (placeholder)', hrange: at.ipTtl },
    { id: 'ip.proto', label: 'Protocol', value: { TCP: 'TCP (6)', UDP: 'UDP (17)', ICMP: 'ICMP (1)' }[kind], filter: kind.toLowerCase(), hrange: at.ipProto },
    { id: 'ip.sum', label: 'Header checksum', value: '0x0000 (not computed)', hrange: at.ipChecksum },
    { id: 'ip.src', label: 'Source address', value: packet.src, filter: `ip.src == ${packet.src}`, hrange: at.ipSrc },
    { id: 'ip.dst', label: 'Destination address', value: packet.dst, filter: `ip.dst == ${packet.dst}`, hrange: at.ipDst },
  ] });
  layers.push(transportLayer(packet, at));
  let app = null;
  if (bytes.length > 0) {
    if (packet.proto === 'DNS') { app = dnsLayer(bytes); }
    else if (packet.proto === 'TLS') { app = tlsLayer(bytes); }
    else { app = httpLayer(bytes); }
    if (!app) {
      app = { id: 'app', title: `Data (${bytes.length} bytes)`, fields: [{ id: 'data.all', label: 'Data', value: `${bytes.length} bytes`, range: range(0, bytes.length) }] };
    }
  }
  if (app) { layers.push(app); }
  const nodes = layers.map(toLayer);
  nodes.forEach((node) => { if (node.id !== 'app') { node.range = undefined; } });
  const frame = new Uint8Array(head.length + bytes.length);
  frame.set(head.bytes, 0);
  frame.set(bytes, head.length);
  return { nodes, bytes, frame, headerLength: head.length, hasOffsets: bytes.length > 0 };
}

// Visible nodes in tree order, given the set of expanded ids. Each entry keeps its depth and parent for key handling.
export function flattenTree(nodes, expanded) {
  const out = [];
  const walk = (list, depth, parent) => {
    for (const node of list) {
      out.push({ node, depth, parent });
      if (node.children?.length && expanded.has(node.id)) { walk(node.children, depth + 1, node.id); }
    }
  };
  walk(nodes, 1, null);
  return out;
}

// Merges a new filter expression into the current one. Fits the 200 character filter limit, otherwise replaces it.
export function combineFilter(current, expression) {
  const old = String(current ?? '').trim();
  if (old === '' || old === expression) { return expression; }
  const joined = `(${old}) && ${expression}`;
  return joined.length <= 200 ? joined : expression;
}
