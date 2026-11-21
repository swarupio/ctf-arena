// Deterministic randomness for Cipher Lab. Everything a team sees (plaintext, keys, shifts, primes) comes from
// HMAC(FLAG_SECRET, teamId + levelId), so nothing is stored and every replica recomputes the same puzzle.
import { createHmac } from 'node:crypto';

export const hmacHex = (secret, message) => createHmac('sha256', secret).update(message).digest('hex');

export class Rng {
  constructor(secret, teamId, levelId) {
    this.key = Buffer.from(hmacHex(secret, `cipherlab:${teamId}:${levelId}`), 'hex');
    this.counter = 0;
    this.pool = Buffer.alloc(0);
  }

  byte() {
    if (this.pool.length === 0) {
      this.pool = createHmac('sha256', this.key).update(`block:${this.counter}`).digest();
      this.counter += 1;
    }
    const value = this.pool[0];
    this.pool = this.pool.subarray(1);
    return value;
  }

  // Uniform integer in [0, max) using rejection sampling over 32 bits (no modulo bias).
  int(max) {
    const limit = 0x100000000 - (0x100000000 % max);
    for (;;) {
      const value = ((this.byte() * 2 ** 24) + (this.byte() << 16) + (this.byte() << 8) + this.byte()) >>> 0;
      if (value < limit) { return value % max; }
    }
  }

  range(min, max) { return min + this.int(max - min + 1); }

  pick(items) { return items[this.int(items.length)]; }

  shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  sample(items, count) { return this.shuffle(items).slice(0, count); }

  letters(length) {
    return Array.from({ length }, () => String.fromCharCode(65 + this.int(26))).join('');
  }
}
