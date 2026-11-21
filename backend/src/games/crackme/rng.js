// Deterministic randomness for Crackme Arcade. Every constant, key and serial rule a team sees comes from
// HMAC(FLAG_SECRET, 'crackme:' + teamId + ':' + levelId), so nothing is stored and every replica rebuilds the same cabinet.
import { createHmac } from 'node:crypto';

export const hmacHex = (secret, message) => createHmac('sha256', secret).update(message).digest('hex');

export class Rng {
  constructor(secret, teamId, levelId) {
    this.key = Buffer.from(hmacHex(secret, `crackme:${teamId}:${levelId}`), 'hex');
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

  letters(length) {
    return Array.from({ length }, () => String.fromCharCode(65 + this.int(26))).join('');
  }

  digits(length) {
    return Array.from({ length }, () => String(this.int(10))).join('');
  }
}
