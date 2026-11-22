// Packet artefact: a simplified capture. The capture is a grid of half-second slots; slot i holds exactly one packet,
// either planned (DNS lookup, C2 beacons, tasking, exfil) or background noise derived from (seed, i).
import { createHash } from 'node:crypto';
import { int, pick } from '../terminal/gen.js';
import {
  WORDS, hostIpFor, pageBounds, place, publicIp, rngFor,
} from './core.js';

export const PACKET_PAGE_MAX = 250;
const SLOT = 0.5;
const MAX_PAYLOAD = 96;
const RESOLVER = '10.0.1.2';
const GATEWAY = '10.0.1.1';
const MONITOR = '10.0.1.5';

const LEVELS = {
  medium: { slots: 2400, hosts: 10, decoyBeacons: 0, periodic: 1 },
  insane: { slots: 4000, hosts: 14, decoyBeacons: 1, periodic: 3 },
};
export const packetLevel = (level) => LEVELS[level] ?? LEVELS.medium;

// Simulated hardware address of a host: a pure hash of its IP address (no rng), so one host has one MAC in every packet.
// 0x02 in the first byte marks it locally administered and unicast, so it can never be mistaken for a real vendor address.
export function macFor(ip) {
  const digest = createHash('sha256').update(`mac|${ip}`).digest();
  return [0x02, ...digest.subarray(0, 5)].map((b) => b.toString(16).padStart(2, '0')).join(':');
}

const toHex = (bytes) => Buffer.from(bytes).toString('hex');
const ascii = (text) => Buffer.from(text, 'latin1');
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

// DNS wire format: 12-byte header, QNAME labels, QTYPE A, QCLASS IN.
function dnsQuery(id, name, response = false) {
  const header = Buffer.from([id >> 8, id & 255, response ? 0x81 : 0x01, response ? 0x80 : 0x00, 0, 1, 0, response ? 1 : 0, 0, 0, 0, 0]);
  const labels = name.split('.').flatMap((label) => [Buffer.from([label.length]), ascii(label)]);
  return Buffer.concat([header, ...labels, Buffer.from([0, 0, 1, 0, 1])]);
}

const pkt = (src, sp, dst, dp, proto, info, payload = Buffer.alloc(0), off = 0) => ({ src, sp, dst, dp, proto, info, payload, off });
const dnsName = (r) => `${pick(r, WORDS)}${int(r, 1, 99)}.${pick(r, ['example.com', 'example.net', 'example.org'])}`;
const SITES = ['www.example.com', 'files.example.net', 'intranet.corp.local', 'updates.example.org'];

// Plans the beacon, tasking and exfil traffic. Returns the slot map plus facts about the plan.
export function packetPlan(seed, level, scn) {
  const cfg = packetLevel(level);
  const r = rngFor(seed, 'packetplan');
  const slots = new Map();
  const host = hostIpFor(scn.hostNo);
  const decoyHostNo = scn.decoyHostNo === scn.hostNo ? (scn.hostNo + 1) % cfg.hosts : scn.decoyHostNo;
  const t0 = int(r, 60, 120);
  const seconds = cfg.slots * SLOT;
  const beaconSlots = (start, period) => {
    const list = [];
    for (let t = start; t + 2 < seconds; t += period) { list.push(Math.round(t / SLOT)); }
    return list;
  };
  const beacons = beaconSlots(t0, scn.interval);
  const taskAt = Math.max(1, Math.floor(beacons.length / 3));
  const reservedSlots = new Set(beacons.flatMap((s) => [s, s + 1]));

  // Real beacons first: they must keep their exact slot (and therefore their exact interval).
  beacons.forEach((slot, k) => {
    const sp = int(r, 40000, 60000);
    const reply = k === taskAt ? `get /srv/share/${scn.exfilFile}` : 'none';
    slots.set(slot, pkt(host, sp, scn.attackerIp, 8443, 'HTTP',
      `POST /beacon HTTP/1.1`, ascii(`POST /beacon HTTP/1.1\r\nHost: ${scn.c2Domain}\r\nX-Id: ${k.toString(16).padStart(4, '0')}\r\n\r\n`)));
    slots.set(slot + 1, pkt(scn.attackerIp, 8443, host, sp, 'HTTP', 'HTTP/1.1 200 OK',
      ascii(`HTTP/1.1 200 OK\r\nX-Task: ${reply === 'none' ? 'none' : b64(reply)}\r\n\r\n`), 0.1));
  });
  // Decoy beacon of another host to another server, on its own interval (insane only).
  for (let d = 0; d < cfg.decoyBeacons; d += 1) {
    const decoyHost = hostIpFor(decoyHostNo);
    for (const slot of beaconSlots(t0 + 17, scn.interval2)) {
      if (reservedSlots.has(slot) || reservedSlots.has(slot + 1)) { continue; }
      const sp = int(r, 40000, 60000);
      slots.set(slot, pkt(decoyHost, sp, scn.decoyIp, 8443, 'HTTP', 'POST /beacon HTTP/1.1',
        ascii(`POST /beacon HTTP/1.1\r\nHost: ${scn.decoyDomain}\r\nX-Id: ${slot.toString(16).padStart(4, '0')}\r\n\r\n`)));
      if (!slots.has(slot + 1)) {
        slots.set(slot + 1, pkt(scn.decoyIp, 8443, decoyHost, sp, 'HTTP', 'HTTP/1.1 200 OK', ascii('HTTP/1.1 200 OK\r\nX-Task: none\r\n\r\n'), 0.1));
      }
    }
  }
  // Benign periodic traffic (monitoring scrapes, NTP, update checks).
  const periodic = [[MONITOR, 9100, 'HTTP', 'GET /metrics HTTP/1.1', 30], ['10.0.1.3', 123, 'NTP', 'NTP Version 4, client', 64], [GATEWAY, 8080, 'HTTP', 'GET /status HTTP/1.1', 45]];
  periodic.slice(0, cfg.periodic).forEach(([dst, dp, proto, info, every], k) => {
    const src = hostIpFor((decoyHostNo + 3 + k) % cfg.hosts);
    for (const slot of beaconSlots(5 + k * 3, every)) {
      if (!slots.has(slot) && !reservedSlots.has(slot)) {
        slots.set(slot, pkt(src, 40000 + k, dst, dp, proto, info, ascii(`${info}\r\n\r\n`)));
      }
    }
  });

  // Lookup of the C2 domain just before the first beacon, plus noise lookups of look-alike names.
  const dnsAt = beacons[0] - 6;
  // The reply goes back to the port the question came from (a real exchange), so both packets are one conversation.
  const dnsPort = int(r, 40000, 60000);
  place(slots, dnsAt, pkt(host, dnsPort, RESOLVER, 53, 'DNS', `Standard query 0x1a2b A ${scn.c2Domain}`, dnsQuery(0x1a2b, scn.c2Domain)), cfg.slots);
  place(slots, dnsAt + 1, pkt(RESOLVER, 53, host, dnsPort, 'DNS', `Standard query response 0x1a2b A ${scn.c2Domain} A ${scn.attackerIp}`, dnsQuery(0x1a2b, scn.c2Domain, true), 0.2), cfg.slots);
  if (cfg.decoyBeacons > 0) {
    const decoyHost = hostIpFor(decoyHostNo);
    place(slots, beacons[0] - 4, pkt(decoyHost, 51000, RESOLVER, 53, 'DNS', `Standard query 0x3c4d A ${scn.decoyDomain}`, dnsQuery(0x3c4d, scn.decoyDomain)), cfg.slots);
  }

  // Exfil: a TCP stream to the drop server, base64 chunks of the stolen file, after the tasking beacon.
  const secret = `FILE: /srv/share/${scn.exfilFile}\nCODENAME: ${scn.codename.toUpperCase()}\nCLASSIFICATION: INTERNAL ONLY\nCOPY: 1 of 1\n`;
  const body = b64(secret);
  const chunks = body.match(/.{1,56}/g);
  const exfilFrom = (beacons[taskAt + 1] ?? beacons[taskAt]) + 8;
  const sp = int(r, 40000, 60000);
  const flow = (at, info, payload = Buffer.alloc(0)) => place(slots, at, pkt(host, sp, scn.dropIp, 9001, 'TCP', info, payload), cfg.slots);
  flow(exfilFrom, '49152 > 9001 [SYN] Seq=0 Len=0');
  chunks.forEach((chunk, k) => flow(exfilFrom + 4 + k * 3, `49152 > 9001 [PSH, ACK] Seq=${1 + k * 56} Len=${chunk.length}`, ascii(chunk)));
  flow(exfilFrom + 6 + chunks.length * 3, '49152 > 9001 [FIN, ACK] Seq=999 Len=0');

  // Clock-skew clue for the timeline board (drawn last: no earlier draw, beacon or answer moves). Two workstations ask the
  // gateway for the time. The first reply is stamped after its request; the second reply is stamped 0.2 s BEFORE the request
  // it answers (a tap with a skewed clock), which cannot be true. Both pairs sit in free adjacent slots.
  const skew = {};
  const timePair = (key, hostNo, from, reqOff, replyDelta) => {
    let s = Math.floor(cfg.slots * from);
    while (slots.has(s) || slots.has(s + 1)) { s += 1; }
    const src = hostIpFor(hostNo % cfg.hosts);
    const port = int(r, 40000, 60000);
    slots.set(s, pkt(src, port, GATEWAY, 8080, 'HTTP', 'GET /time HTTP/1.1', ascii('GET /time HTTP/1.1\r\nHost: gw.corp.local\r\n\r\n'), reqOff));
    slots.set(s + 1, pkt(GATEWAY, 8080, src, port, 'HTTP', 'HTTP/1.1 200 OK', ascii('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n'),
      reqOff + replyDelta - SLOT));
    skew[key] = { request: s, reply: s + 1 };
  };
  timePair('consistent', decoyHostNo + 4, 0.3, 0.1, 0.2);
  timePair('skewed', decoyHostNo + 6, 0.62, 0.3, -0.2);
  return { slots, host, interval: scn.interval, skew };
}

function noisePacket(seed, scn, cfg, index) {
  const r = rngFor(seed, `P:${index}`);
  const src = hostIpFor(int(r, 0, cfg.hosts - 1));
  const kind = r();
  const sport = int(r, 32768, 60999);
  if (kind < 0.22) {
    const name = dnsName(r);
    const id = int(r, 0, 65535);
    return pkt(src, sport, RESOLVER, 53, 'DNS', `Standard query 0x${id.toString(16).padStart(4, '0')} A ${name}`, dnsQuery(id, name));
  }
  if (kind < 0.34) {
    const name = dnsName(r);
    const id = int(r, 0, 65535);
    return pkt(RESOLVER, 53, src, sport, 'DNS', `Standard query response 0x${id.toString(16).padStart(4, '0')} A ${name} A ${publicIp(r)}`, dnsQuery(id, name, true));
  }
  if (kind < 0.62) {
    const length = int(r, 16, 48);
    const data = Buffer.from(Array.from({ length }, () => int(r, 0, 255)));
    return pkt(src, sport, publicIp(r), 443, 'TLS', 'Application Data', Buffer.concat([Buffer.from([0x17, 0x03, 0x03, 0, length]), data]));
  }
  if (kind < 0.8) {
    const site = pick(r, SITES);
    const text = `GET ${pick(r, ['/', '/index.html', '/news', '/docs/readme.txt', '/img/logo.png'])} HTTP/1.1\r\nHost: ${site}\r\n\r\n`;
    return pkt(src, sport, publicIp(r), 80, 'HTTP', text.split('\r\n')[0], ascii(text));
  }
  if (kind < 0.87) {
    return pkt(src, 0, hostIpFor(int(r, 0, cfg.hosts - 1)), 0, 'ICMP', 'Echo (ping) request', Buffer.from(Array.from({ length: 32 }, (_, k) => 0x61 + (k % 23))));
  }
  const flags = pick(r, ['[ACK]', '[SYN]', '[SYN, ACK]', '[FIN, ACK]']);
  return pkt(src, sport, publicIp(r), 443, 'TCP', `${sport} > 443 ${flags} Seq=${int(r, 0, 9999)} Len=0`);
}

export function packetPage(seed, level, scn, offset, limit, plan = packetPlan(seed, level, scn)) {
  const cfg = packetLevel(level);
  const { start, size } = pageBounds(cfg.slots, offset, limit, PACKET_PAGE_MAX);
  const packets = [];
  for (let i = start; i < start + size; i += 1) {
    const jitter = (rngFor(seed, `pj:${i}`)() * 0.4);
    const p = plan.slots.get(i) ?? { ...noisePacket(seed, scn, cfg, i), off: jitter };
    const payload = p.payload.subarray(0, MAX_PAYLOAD);
    packets.push({
      n: i + 1,
      t: (i * SLOT + p.off).toFixed(3),
      src: p.src, sp: p.sp, dst: p.dst, dp: p.dp, sm: macFor(p.src), dm: macFor(p.dst), proto: p.proto,
      len: 42 + p.payload.length,
      info: p.info,
      hex: toHex(payload),
    });
  }
  return { total: cfg.slots, offset: start, packets, start: '2026-03-14 03:00:00' };
}
