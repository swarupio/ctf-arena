// Seeded, deterministic helpers for building noise (logs, junk files) in mode definitions.
// Every replica must produce identical bytes, so never use Math.random() or Date.now() in puzzle data.
import { createHash } from 'node:crypto';

export function rng(seed) {
  const hash = createHash('sha256').update(String(seed)).digest();
  let state = hash.readUInt32LE(0) || 0x9e3779b9;
  return function next() { // mulberry32
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (r, min, max) => min + Math.floor(r() * (max - min + 1));
export const pick = (r, items) => items[Math.floor(r() * items.length)];
export const hex = (r, length) => Array.from({ length }, () => '0123456789abcdef'[int(r, 0, 15)]).join('');
export const ip = (r) => `${int(r, 10, 223)}.${int(r, 0, 255)}.${int(r, 0, 255)}.${int(r, 1, 254)}`;

// 'YYYY-MM-DD HH:MM:SS' somewhere within `spreadMinutes` after baseIso.
export function timestamp(r, baseIso, spreadMinutes = 600) {
  const when = new Date(Date.parse(baseIso) + int(r, 0, spreadMinutes * 60) * 1000);
  return when.toISOString().replace('T', ' ').slice(0, 19);
}

// Joins `count` generated lines with newlines (trailing newline included).
export function repeatLines(count, makeLine) {
  return `${Array.from({ length: count }, (_, index) => makeLine(index)).join('\n')}\n`;
}
