// Shared, pure building blocks of the Forensics Desk game (docs/FORENSICS_DESK.md).
// Everything here is deterministic: the same (secret, teamId, trackId) gives the same case file on every replica,
// and nothing is stored. No Math.random(), no clock reads.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { int, pick, rng } from '../terminal/gen.js';
import { NAMES, WORDS } from '../terminal/seedwords.js';

export const PREVIEW_TEAM = 'admin-preview';

// HMAC(FLAG_SECRET, teamId + trackId): the only input of every generator. Never sent to the browser.
export function trackSeed(secret, teamId, trackId) {
  return createHmac('sha256', secret).update(`forensics:${teamId}:${trackId}`).digest('hex');
}

export const rngFor = (seed, label) => rng(`${seed}|${label}`);

// Cheap 32-bit mixer for per-index jitter (no allocation, no hashing).
export function mix(seed, index) {
  let x = (Number.parseInt(seed.slice(0, 8), 16) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

const sha = (text) => createHash('sha256').update(text).digest();

// Compares digests, so lengths never differ and nothing leaks through timing.
export function safeEqualText(a, b) {
  return timingSafeEqual(sha(`forensics-answer:${a}`), sha(`forensics-answer:${b}`));
}

// Draws `count` distinct items (partial Fisher-Yates on a copy of at most a few hundred entries).
export function pickDistinct(r, items, count) {
  const pool = [...items];
  const out = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    out.push(pool.splice(int(r, 0, pool.length - 1), 1)[0]);
  }
  return out;
}

const FIRST_OCTETS = [24, 31, 62, 73, 81, 86, 92, 96, 104, 121, 129, 141, 150, 163, 176, 201, 212];
export const publicIp = (r) => `${pick(r, FIRST_OCTETS)}.${int(r, 0, 255)}.${int(r, 0, 255)}.${int(r, 1, 254)}`;
export const hostIpFor = (n) => `10.0.1.${20 + n}`;
const octets = (r, first) => `${first}.${int(r, 1, 254)}.${int(r, 0, 255)}.${int(r, 1, 254)}`;

const SURNAMES = ['Okafor', 'Lindqvist', 'Moreau', 'Castellano', 'Brandt', 'Nakamura', 'Haddad', 'Kowalski', 'Ibarra', 'Novak',
  'Fitzgerald', 'Santoro', 'Petrov', 'Adeyemi', 'Varga', 'Mendes', 'Ostrowski', 'Delacroix', 'Sorensen', 'Bhatt',
  'Quinn', 'Rahimi', 'Tanaka', 'Whitlock'];
export const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);
export const fullName = (first, last) => `${capital(first)} ${last}`;
export { NAMES, WORDS, SURNAMES };

const TLDS = ['top', 'xyz', 'info', 'biz', 'cc'];
const FILE_STEMS = ['customer', 'payroll', 'invoices', 'roadmap', 'contracts', 'ledger'];

// Every secret value of the case, drawn once and in a fixed order so that adding a field never moves the others.
export function buildScenario(seed) {
  const r = rngFor(seed, 'scenario');
  const word = () => pick(r, WORDS);
  const users = pickDistinct(r, NAMES, 14);
  const [victim, lateral, admin, vpnUser] = users;
  const exfilFile = `${pick(r, FILE_STEMS)}_${word()}.tar.gz`;
  const interval = int(r, 20, 119);
  let interval2 = int(r, 20, 119);
  if (interval2 === interval) { interval2 = ((interval2 - 20 + 7) % 100) + 20; }
  return {
    users, victim, lateral, admin, vpnUser,
    attackerIp: octets(r, 185),
    scannerIp: octets(r, 45),
    decoyIp: octets(r, 91),
    decoyIp2: octets(r, 77),
    dropIp: octets(r, 194),
    backdoor: `svc-${word()}`,
    exfilFile,
    c2Domain: `cdn-${word()}${int(r, 2, 98)}.${pick(r, TLDS)}`,
    decoyDomain: `update-${word()}${int(r, 2, 98)}.${pick(r, TLDS)}`,
    hostNo: int(r, 0, 9),
    decoyHostNo: int(r, 0, 9),
    interval,
    interval2,
    codename: word(),
    handle: `${word()}${int(r, 10, 99)}`,
    hexPass: `${word()}-${word()}-${int(r, 100, 999)}`,
    stegoKey: `${word()}-${int(r, 100, 999)}`,
    stegoChannel: int(r, 0, 2),
    stegoLsbFirst: r() < 0.5,
    deletedToken: `${int(r, 0x1000, 0xffff).toString(16)}-${int(r, 0x1000, 0xffff).toString(16)}`,
    imageNo: int(r, 1, 4),
    exifCity: pick(r, ['Lisbon', 'Gdansk', 'Rotterdam', 'Valencia', 'Bergen']),
  };
}

// Home address of a user: stable per (seed, name), never in the attacker ranges.
export function homeIp(seed, name) {
  return publicIp(rngFor(seed, `home:${name}`));
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const clockText = (date) => `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
export const isoText = (date) => date.toISOString().replace('T', ' ').slice(0, 19);

// Clamps `offset` and `limit` of a page request.
export function pageBounds(total, offset, limit, maxLimit) {
  const start = Math.min(Math.max(offset, 0), total);
  const size = Math.max(0, Math.min(limit, maxLimit, total - start));
  return { start, size };
}

// Places `value` at `index`, moving it forward past occupied slots so that planned events never overwrite each other.
export function place(map, index, value, limit) {
  let at = Math.max(0, Math.min(index, limit - 1));
  while (map.has(at)) { at += 1; }
  if (at >= limit) { at = limit - 1; while (map.has(at)) { at -= 1; } }
  map.set(at, value);
  return at;
}
