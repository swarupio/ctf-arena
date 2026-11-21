// Solvers used by the tests: they derive every answer from the PUBLIC artefact data only (what the browser gets),
// the way a player would, and never look at the scenario. If they agree with the server's answer, the stage is solvable.
import { answerOf, artefactData, makeContext } from '../../src/forensics/tracks.js';

export const SECRET = 'f'.repeat(40);

export function ctxFor(track, teamId = 'team-a') {
  return makeContext(track, SECRET, teamId);
}

export function allLog(ctx) {
  const lines = [];
  for (let offset = 0; ; offset += 500) {
    const page = artefactData(ctx, 'log', { offset, limit: 500 });
    lines.push(...page.lines);
    if (page.lines.length === 0 || lines.length >= page.total) { return lines; }
  }
}

export function allPackets(ctx) {
  const packets = [];
  for (let offset = 0; ; offset += 250) {
    const page = artefactData(ctx, 'capture', { offset, limit: 250 });
    packets.push(...page.packets);
    if (page.packets.length === 0 || packets.length >= page.total) { return packets; }
  }
}

const FAIL = /Failed password for (?:invalid user )?\S+ from (\S+)/;
const OK = /^(\S+ \S+) srv01 sshd\[\d+\]: Accepted password for (\S+) from (\S+)/;

// Attacker = the address with the most failed logins among those that eventually got in.
export function solveLog(ctx) {
  const lines = allLog(ctx);
  const fails = new Map();
  const accepted = [];
  for (const line of lines) {
    const fail = FAIL.exec(line);
    if (fail) { fails.set(fail[1], (fails.get(fail[1]) ?? 0) + 1); }
    const ok = OK.exec(line);
    if (ok) { accepted.push({ time: ok[1], user: ok[2], ip: ok[3] }); }
  }
  const candidates = [...new Set(accepted.map((a) => a.ip))].sort((a, b) => (fails.get(b) ?? 0) - (fails.get(a) ?? 0));
  const ip = candidates[0];
  const first = accepted.find((a) => a.ip === ip);
  let exfil = null;
  let biggest = 0;
  for (const line of lines) {
    const m = new RegExp(`^${ip.replaceAll('.', '\\.')} .*"GET /download\\?file=(\\S+) HTTP/1.1" 200 (\\d+)`).exec(line);
    if (m && Number(m[2]) > biggest) { biggest = Number(m[2]); exfil = m[1]; }
  }
  // Back door: the useradd that follows a sudo line of the account the attacker compromised.
  let backdoor = null;
  lines.forEach((line, i) => {
    const m = /sudo\[\d+\]: (\S+) : .*COMMAND=\/usr\/sbin\/useradd -m (\S+)/.exec(line);
    if (m && m[1] === first.user && /new user: name=/.test(lines[i + 1] ?? '')) { backdoor = m[2]; }
  });
  return { ip, user: first.user, time: first.time.slice(11), exfil, backdoor };
}

const text = (hex) => Buffer.from(hex, 'hex').toString('latin1');

export function solvePackets(ctx, c2Ip) {
  const packets = allPackets(ctx);
  const beacons = packets.filter((p) => p.proto === 'HTTP' && text(p.hex).startsWith('POST /beacon'));
  const byServer = new Map();
  for (const p of beacons) { byServer.set(p.dst, [...(byServer.get(p.dst) ?? []), p]); }
  const server = c2Ip ?? [...byServer.keys()][0];
  const mine = byServer.get(server);
  const host = mine[0].src;
  const domain = /Host: (\S+)/.exec(text(mine[0].hex))[1];
  const interval = Math.round(Number(mine[1].t) - Number(mine[0].t));
  let task = null;
  for (const p of packets) {
    const m = /X-Task: (\S+)/.exec(text(p.hex));
    if (p.src === server && m && m[1] !== 'none') { task = Buffer.from(m[1], 'base64').toString().replace('get /srv/share/', ''); }
  }
  const stream = packets.filter((p) => p.dp === 9001 && p.hex).map((p) => text(p.hex)).join('');
  const codename = /CODENAME: (\w+)/.exec(Buffer.from(stream, 'base64').toString())[1].toLowerCase();
  return { host, domain, interval, task, codename, intervals: [...byServer.values()].map((l) => Math.round(Number(l[1].t) - Number(l[0].t))) };
}

export function solveHex(ctx) {
  const size = artefactData(ctx, 'hexfile', { offset: 0, limit: 1024 }).size;
  let hex = '';
  for (let offset = 0; offset < size; offset += 1024) { hex += artefactData(ctx, 'hexfile', { offset, limit: 1024 }).hex; }
  const bytes = Buffer.from(hex, 'hex');
  const end = bytes.lastIndexOf(Buffer.from([0xff, 0xd9]));
  const trailer = bytes.subarray(end + 2).toString('latin1').split('\r\n').filter(Boolean).pop();
  return /passphrase: (.+)/.exec(Buffer.from(trailer, 'base64').toString())[1];
}

export function solveExif(ctx) {
  const comment = artefactData(ctx, 'exif', {}).tags.find((t) => t.tag === 'UserComment').value;
  return /handle: (.+)/.exec(Buffer.from(comment.slice(2), 'hex').toString())[1];
}

// Reads the LSB of every channel in both bit orders and returns the messages that start with KEY= or VOID=.
export function decodeStego(data) {
  const pixels = Buffer.from(data.pixels, 'base64');
  const found = [];
  for (let channel = 0; channel < 3; channel += 1) {
    for (const lsbFirst of [true, false]) {
      let out = '';
      for (let p = 0; p + 8 <= data.width * data.height; p += 8) {
        let byte = 0;
        for (let k = 0; k < 8; k += 1) {
          const bit = pixels[(p + k) * 3 + channel] & 1;
          byte = lsbFirst ? byte | (bit << k) : (byte << 1) | bit;
        }
        if (byte === 0) { break; }
        out += String.fromCharCode(byte);
      }
      if (/^(KEY|VOID)=[a-z0-9-]+$/.test(out)) { found.push(out); }
    }
  }
  return found;
}

export function solveStego(ctx, image = 1) {
  const messages = decodeStego(artefactData(ctx, 'stego', { image }));
  return messages.map((m) => m.split('=')[1])[0] && messages[0];
}

export function readDeleted(ctx, predicate) {
  const listing = artefactData(ctx, 'disk', {});
  const entry = listing.entries.filter((e) => e.deleted).filter(predicate).sort((a, b) => b.mtime.localeCompare(a.mtime))[0];
  const { clusters } = artefactData(ctx, 'disk', { cluster: entry.cluster, count: 1 });
  const note = Buffer.from(clusters[0].hex, 'hex').toString('latin1');
  return { entry, token: /TOKEN=(\S+)/.exec(note)?.[1], img: /IMG=img-(\d)/.exec(note)?.[1] };
}

export const expected = (ctx, n) => answerOf(ctx, n);
