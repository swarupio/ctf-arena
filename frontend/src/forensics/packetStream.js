// "Follow stream": rebuilds one conversation from the packets already loaded in the viewer. Pure.
// A conversation is every packet with the same transport family and the same two endpoints (address:port), in CAPTURE
// order (the packet number) by default. The time stamp is shown per segment; it only re-orders the view when the player
// switches the order to 'time'. Nothing is flagged: a packet stamped out of order simply moves, and the packet numbers show it.
import { bytesToAscii, hexToBytes } from './hex.js';
import { transportOf } from './packetLayers.js';

export const STREAM_CAP_BYTES = 4096;
export const STREAM_CAP_PACKETS = 500;
const HEX_PER_ROW = 16;

export function conversationKey(p) {
  const a = `${p.src}:${p.sp}`;
  const b = `${p.dst}:${p.dp}`;
  return `${transportOf(p)}|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
}

// Map of conversation key -> packets (ascending packet number). One pass over the capture.
export function indexConversations(packets) {
  const map = new Map();
  for (const packet of packets) {
    const key = conversationKey(packet);
    const list = map.get(key);
    if (list) { list.push(packet); } else { map.set(key, [packet]); }
  }
  for (const list of map.values()) { list.sort((x, y) => x.n - y.n); }
  return map;
}

// Where a packet sits in its conversation: { position (1-based), count, prev, next } with packet numbers or null.
export function conversationNeighbours(index, packet) {
  const list = index.get(conversationKey(packet)) ?? [packet];
  const at = Math.max(0, list.findIndex((p) => p.n === packet.n));
  return { position: at + 1, count: list.length, prev: list[at - 1]?.n ?? null, next: list[at + 1]?.n ?? null };
}

const synSender = (packets) => packets.find((p) => /\[SYN\]/.test(p.info ?? ''));

// Orders a conversation: 'capture' keeps the packet number order, 'time' sorts by the time stamp (ties by packet number).
// Time stamps are what the capture recorded and may disagree with capture order; the viewer never decides which one is right.
export const STREAM_ORDERS = ['capture', 'time'];
export const sortConversation = (list, order) => (order === 'time'
  ? [...list].sort((x, y) => (Number(x.t) - Number(y.t)) || (x.n - y.n))
  : list);

// Returns { order, endpoints:{client,server}, segments, packetCount, payloadBytes, shownBytes, truncated, omittedPackets, clipped }.
// segment = { n, t, side: 'client'|'server', bytes: Uint8Array, control: string|null }.
// The client is decided from CAPTURE order whatever the display order is.
export function buildStream(index, packet, { capBytes = STREAM_CAP_BYTES, capPackets = STREAM_CAP_PACKETS, order = 'capture' } = {}) {
  const inCapture = index.get(conversationKey(packet)) ?? [packet];
  const first = synSender(inCapture) ?? inCapture[0];
  const all = sortConversation(inCapture, order);
  const clientAddr = `${first.src}:${first.sp}`;
  const side = (p) => (`${p.src}:${p.sp}` === clientAddr ? 'client' : 'server');
  const endpoints = { client: clientAddr, server: `${first.dst}:${first.dp}` };
  const segments = [];
  let payloadBytes = 0;
  let shownBytes = 0;
  let truncated = false;
  let omittedPackets = 0;
  let clipped = false;
  for (const p of all) {
    const bytes = hexToBytes(p.hex ?? '');
    payloadBytes += bytes.length;
    if (bytes.length >= 96) { clipped = true; }
    if (truncated || segments.length >= capPackets) { truncated = true; omittedPackets += 1; continue; }
    const room = capBytes - shownBytes;
    if (bytes.length > room) {
      truncated = true;
      segments.push({ n: p.n, t: p.t, side: side(p), bytes: bytes.subarray(0, Math.max(0, room)), control: null, cut: true });
      shownBytes += Math.max(0, room);
      continue;
    }
    shownBytes += bytes.length;
    segments.push({ n: p.n, t: p.t, side: side(p), bytes, control: bytes.length === 0 ? p.info : null });
  }
  return { order: order === 'time' ? 'time' : 'capture', endpoints, segments, packetCount: all.length, payloadBytes, shownBytes, truncated, omittedPackets, clipped };
}

// Text of one segment: printable ASCII, line breaks kept, everything else '.'.
export function segmentText(bytes) {
  let out = '';
  for (const byte of bytes) { out += byte === 10 || byte === 13 ? String.fromCharCode(byte) : bytesToAscii([byte]); }
  return out;
}

export function segmentHexRows(bytes) {
  const rows = [];
  for (let i = 0; i < bytes.length; i += HEX_PER_ROW) {
    const chunk = bytes.subarray(i, i + HEX_PER_ROW);
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ');
    rows.push(`${i.toString(16).padStart(4, '0')}  ${hex.padEnd(HEX_PER_ROW * 3 - 1)}  ${bytesToAscii(chunk)}`);
  }
  return rows;
}

// Plain text of the whole view, for the Copy button.
export function streamAsText(stream, mode = 'ascii') {
  const label = (s) => (s.side === 'client' ? 'CLIENT >' : 'SERVER <');
  const lines = [`Client ${stream.endpoints.client}  <->  Server ${stream.endpoints.server}`, `Order: ${stream.order ?? 'capture'}`];
  for (const s of stream.segments) {
    if (s.control) { lines.push(`-- packet ${s.n}: ${s.control} (no data) --`); continue; }
    lines.push(`${label(s)} packet ${s.n}, ${s.bytes.length} bytes`);
    lines.push(mode === 'hex' ? segmentHexRows(s.bytes).join('\n') : segmentText(s.bytes));
  }
  if (stream.truncated) { lines.push(`[truncated: ${stream.payloadBytes - stream.shownBytes} more payload bytes, ${stream.omittedPackets} more packets not shown]`); }
  return lines.join('\n');
}
