// Synthesised Ethernet, IPv4 and TCP/UDP/ICMP header bytes for the packet viewer. Pure.
// The capture stores addresses, ports, the recorded length and the first payload bytes. The header bytes are BUILT from
// those fields so the viewer can show where each header field sits in a frame. Lengths, ports, addresses, TCP flags and the
// sequence number follow the packet. Time to live, window, acknowledgment number and identification are placeholders, and
// checksums are NOT computed (they are 0x0000), because the capture has no real header bytes.
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const MAC = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;
const FLAG_BITS = { FIN: 0x01, SYN: 0x02, RST: 0x04, PSH: 0x08, ACK: 0x10, URG: 0x20 };

export const ETH_LEN = 14;
export const IP_LEN = 20;
export const L4_LEN = { TCP: 20, UDP: 8, ICMP: 8 };

const macBytes = (mac) => (typeof mac === 'string' && MAC.test(mac) ? mac.split(':').map((h) => Number.parseInt(h, 16)) : [0, 0, 0, 0, 0, 0]);
const ipBytes = (ip) => (IPV4.test(ip) ? ip.split('.').map((n) => Math.min(255, Number(n))) : [0, 0, 0, 0]);
const u16 = (n) => [(n >> 8) & 255, n & 255];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

// Parses "[PSH, ACK]" style text into the TCP flag byte. Unknown words are ignored.
export const flagByte = (text) => String(text).split(/[^A-Z]+/).reduce((sum, word) => sum | (FLAG_BITS[word] ?? 0), 0);

// kind: 'TCP' | 'UDP' | 'ICMP'. tcp: { flags: 'PSH, ACK' | null, seq: number | null }. trueLength: payload length on the wire.
// Returns { bytes, length (headers only), ranges } with every range as [start, end) in frame bytes.
export function synthesiseHeaders(packet, kind, tcp, trueLength) {
  const l4Len = L4_LEN[kind] ?? L4_LEN.TCP;
  const bytes = [];
  const ranges = {};
  const put = (key, values) => { ranges[key] = [bytes.length, bytes.length + values.length]; bytes.push(...values); };
  put('ethDst', macBytes(packet.dm));
  put('ethSrc', macBytes(packet.sm));
  put('ethType', [0x08, 0x00]);
  put('ipVersion', [0x45]);
  put('ipTos', [0]);
  put('ipTotal', u16(Math.min(65535, IP_LEN + l4Len + trueLength)));
  put('ipId', [0, 0]);
  put('ipFlags', [0x40, 0]);
  put('ipTtl', [64]);
  put('ipProto', [{ TCP: 6, UDP: 17, ICMP: 1 }[kind] ?? 6]);
  put('ipChecksum', [0, 0]);
  put('ipSrc', ipBytes(packet.src));
  put('ipDst', ipBytes(packet.dst));
  if (kind === 'ICMP') {
    put('icmpType', [8]);
    put('icmpCode', [0]);
    put('icmpChecksum', [0, 0]);
    put('icmpRest', [0, 0, 0, 0]);
  } else {
    put('sp', u16(Number(packet.sp) & 0xffff));
    put('dp', u16(Number(packet.dp) & 0xffff));
    if (kind === 'UDP') {
      put('udpLength', u16(Math.min(65535, 8 + trueLength)));
      put('l4Checksum', [0, 0]);
    } else {
      put('tcpSeq', u32(tcp.seq ?? 0));
      put('tcpAck', [0, 0, 0, 0]);
      put('tcpOffset', [0x50]);
      put('tcpFlags', [tcp.flags === null ? FLAG_BITS.PSH | FLAG_BITS.ACK : flagByte(tcp.flags)]);
      put('tcpWindow', u16(65535));
      put('l4Checksum', [0, 0]);
      put('tcpUrgent', [0, 0]);
    }
  }
  const pad = ETH_LEN + IP_LEN + l4Len - bytes.length;
  if (pad !== 0) { throw new Error('header layout is out of step'); }
  return { bytes: Uint8Array.from(bytes), length: bytes.length, ranges };
}
