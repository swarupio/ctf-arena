// Per-team variation. Everything a lab needs (names, ids, secrets, token keys) derives from
// HMAC(FLAG_SECRET, teamId + labId), so every replica builds the same world and nothing is stored.
import { createHmac } from 'node:crypto';

export function makeContext({ secret, teamId, labId, flag }) {
  const base = createHmac('sha256', secret).update(`weblab:${teamId}:${labId}`).digest('hex');
  const key = (purpose) => createHmac('sha256', base).update(String(purpose)).digest('hex');
  const int = (purpose, min, max) => min + (parseInt(key(purpose).slice(0, 8), 16) % (max - min + 1));
  const pick = (purpose, list) => list[int(purpose, 0, list.length - 1)];
  // Deterministic Fisher-Yates driven by the key stream.
  const shuffle = (purpose, list) => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(`${purpose}:${i}`, 0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return Object.freeze({ labId, key, int, pick, shuffle, flag });
}
