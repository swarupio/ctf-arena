// Per-team puzzle values behind {{seed:KIND[:SLOT]}} tokens (docs/TERMINAL_GAME.md section 16).
// Pure and deterministic: the same (seed, kind, slot) always gives the same value on every replica, and different
// seeds give different values. Nothing here reads the clock, the environment or Math.random().
import { createHmac } from 'node:crypto';
import { NAMES, WORDS } from './seedwords.js';

// Used when a ctx carries no seed (unit tests, stubs). Never a secret.
export const DEFAULT_SEED = 'arena-default-seed';

const FIRST_OCTETS = ['198.51.100', '203.0.113']; // documentation ranges (RFC 5737)
const digits4 = (n) => String(1000 + (n % 9000));

// Each kind turns the first 6 bytes of HMAC-SHA256(seed, `${kind}:${slot}`) into a value.
const KINDS = {
  word: (b) => WORDS[b[0]],
  pass: (b) => `${WORDS[b[0]]}-${WORDS[b[1]]}-${digits4(b.readUInt16BE(2))}`,
  ip: (b) => `${FIRST_OCTETS[b[0] & 1]}.${2 + (b[1] % 249)}`, // last octet 2..250
  num4: (b) => digits4(b.readUIntBE(0, 6)),
  hex8: (b) => b.subarray(0, 4).toString('hex'),
  user: (b) => NAMES[b[0] & 63],
};

export const SEED_KINDS = Object.freeze(Object.keys(KINDS));

// Returns the value, or null for an unknown kind (the renderer then prints the token literally).
export function seedValue(seed, kind, slot = 1) {
  if (typeof kind !== 'string' || !Object.hasOwn(KINDS, kind)) return null;
  const slotNumber = Number(slot);
  if (!Number.isInteger(slotNumber) || slotNumber < 0) return null;
  const key = typeof seed === 'string' && seed !== '' ? seed : DEFAULT_SEED;
  const digest = createHmac('sha256', key).update(`${kind}:${slotNumber}`).digest();
  return KINDS[kind](digest.subarray(0, 6));
}
