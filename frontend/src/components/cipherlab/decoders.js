// Pure decoder helpers behind the Cipher Lab toolbox. Everything runs in the browser; nothing here talks to the server
// and nothing knows an answer. Each function is small and has a node:test in tests/cipherlab.test.js.

const A = 65;
const isUpper = (code) => code >= 65 && code <= 90;
const mapLetters = (text, fn) => String(text).toUpperCase().replace(/[A-Z]/g, (ch) => String.fromCharCode(fn(ch.charCodeAt(0) - A) + A));

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
// Typical English letter frequencies in percent, A to Z.
export const ENGLISH_FREQ = [8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2.0, 6.1, 7.0, 0.15, 0.77, 4.0, 2.4, 6.7, 7.5, 1.9, 0.1, 6.0, 6.3, 9.1, 2.8, 0.98, 2.4, 0.15, 2.0, 0.07];

export const caesarShift = (text, shift) => mapLetters(text, (i) => (((i + shift) % 26) + 26) % 26);
export const rot13 = (text) => caesarShift(text, 13);
export const atbash = (text) => mapLetters(text, (i) => 25 - i);
export const reverseText = (text) => [...String(text)].reverse().join('');

export function vigenereDecode(text, key) {
  const clean = String(key).toUpperCase().replace(/[^A-Z]/g, '');
  if (!clean) { return String(text).toUpperCase(); }
  let index = 0;
  return mapLetters(text, (i) => {
    const shift = clean.charCodeAt(index % clean.length) - A;
    index += 1;
    return (((i - shift) % 26) + 26) % 26;
  });
}

// Key letters that turn the first crib.length letters of the cipher into the crib (known plaintext).
export function keyFromCrib(cipher, crib) {
  const letters = String(cipher).toUpperCase().replace(/[^A-Z]/g, '');
  const known = String(crib).toUpperCase().replace(/[^A-Z]/g, '');
  let key = '';
  for (let i = 0; i < Math.min(letters.length, known.length); i += 1) {
    key += String.fromCharCode((((letters.charCodeAt(i) - known.charCodeAt(i)) % 26) + 26) % 26 + A);
  }
  return key;
}

// The shortest repeating prefix of a recovered key (VIGVIGVI -> VIG), or the key itself.
export function shortestRepeat(key) {
  for (let size = 1; size < key.length; size += 1) {
    if ([...key].every((ch, i) => ch === key[i % size])) { return key.slice(0, size); }
  }
  return key;
}

const cleanHex = (value) => String(value).replace(/[^0-9a-fA-F]/g, '');

export function hexToText(hex) {
  const clean = cleanHex(hex);
  if (clean.length === 0 || clean.length % 2 !== 0) { return null; }
  const bytes = Uint8Array.from(clean.match(/../g), (pair) => parseInt(pair, 16));
  return new TextDecoder('utf-8').decode(bytes);
}

export function textToHex(text) {
  return [...new TextEncoder().encode(String(text))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64ToText(value) {
  const clean = String(value).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) { return null; }
  try {
    const binary = atob(clean);
    return new TextDecoder('utf-8').decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function textToBase64(text) {
  const bytes = new TextEncoder().encode(String(text));
  return btoa(String.fromCharCode(...bytes));
}

export function xorHexDecode(hex, key) {
  const clean = cleanHex(hex);
  const pad = new TextEncoder().encode(String(key));
  if (clean.length === 0 || clean.length % 2 !== 0 || pad.length === 0) { return null; }
  const bytes = Uint8Array.from(clean.match(/../g), (pair, i) => parseInt(pair, 16) ^ pad[i % pad.length]);
  return new TextDecoder('utf-8').decode(bytes);
}

// Key bytes (as text) that turn the first bytes of the cipher into the crib.
export function xorKeyFromCrib(hex, crib) {
  const clean = cleanHex(hex);
  const known = new TextEncoder().encode(String(crib));
  const count = Math.min(known.length, Math.floor(clean.length / 2));
  const bytes = Array.from({ length: count }, (_, i) => parseInt(clean.slice(i * 2, i * 2 + 2), 16) ^ known[i]);
  return String.fromCharCode(...bytes);
}

export function railDecode(text, rails) {
  const input = String(text).replace(/\s+/g, '');
  const count = Math.floor(rails);
  if (!Number.isFinite(count) || count < 2 || input.length === 0) { return input; }
  const rows = [];
  let row = 0;
  let step = 1;
  for (let i = 0; i < input.length; i += 1) {
    rows.push(row);
    if (row === 0) { step = 1; } else if (row === count - 1) { step = -1; }
    row += step;
  }
  const order = rows.map((r, i) => [r, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
  const out = [];
  order.forEach((position, k) => { out[position] = input[k]; });
  return out.join('');
}

// Letter counts in percent (A to Z) plus the total number of letters.
export function letterFrequency(text) {
  const counts = Array(26).fill(0);
  let total = 0;
  for (const ch of String(text).toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (isUpper(code)) { counts[code - A] += 1; total += 1; }
  }
  return { counts, total, percent: counts.map((c) => (total === 0 ? 0 : (c * 100) / total)) };
}

// mapping: { CIPHERLETTER: 'p' }. Unmapped letters stay as a dot so progress is easy to see.
export function applySubstitution(text, mapping) {
  return String(text).toUpperCase().replace(/[A-Z]/g, (ch) => (mapping[ch] ? String(mapping[ch]).toLowerCase() : '.'));
}

// Cipher letters mapped to the same plain letter twice (a substitution must be one-to-one).
export function mappingConflicts(mapping) {
  const seen = new Map();
  const dupes = new Set();
  for (const [cipher, plain] of Object.entries(mapping)) {
    if (!plain) { continue; }
    const key = String(plain).toUpperCase();
    if (seen.has(key)) { dupes.add(cipher); dupes.add(seen.get(key)); } else { seen.set(key, cipher); }
  }
  return [...dupes].sort();
}

export function factorSemiprime(n) {
  const value = Number(n);
  if (!Number.isInteger(value) || value < 4) { return null; }
  for (let d = 2; d * d <= value; d += 1) { if (value % d === 0) { return [d, value / d]; } }
  return null;
}

export function modInverse(e, phi) {
  let [oldR, r] = [BigInt(e), BigInt(phi)];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) { return null; }
  return Number(((oldS % BigInt(phi)) + BigInt(phi)) % BigInt(phi));
}

export function modPow(base, exponent, modulus) {
  const m = BigInt(modulus);
  let result = 1n;
  let b = BigInt(base) % m;
  let e = BigInt(exponent);
  while (e > 0n) {
    if (e & 1n) { result = (result * b) % m; }
    b = (b * b) % m;
    e >>= 1n;
  }
  return Number(result);
}

export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Pipeline tool: each step is { op, arg }. A step that cannot be applied returns null and stops the chain.
export const PIPELINE_OPS = [
  { id: 'base64', label: 'Base64 decode', arg: null },
  { id: 'hex', label: 'Hex decode', arg: null },
  { id: 'reverse', label: 'Reverse', arg: null },
  { id: 'atbash', label: 'Atbash', arg: null },
  { id: 'caesar', label: 'Caesar shift', arg: 'number' },
  { id: 'rail', label: 'Rail fence', arg: 'number' },
  { id: 'vigenere', label: 'Vigenere key', arg: 'text' },
];

export function applyStep(text, { op, arg }) {
  switch (op) {
    case 'base64': return base64ToText(text);
    case 'hex': return hexToText(text);
    case 'reverse': return reverseText(text);
    case 'atbash': return atbash(text);
    case 'caesar': return caesarShift(text, Number(arg) || 0);
    case 'rail': return railDecode(text, Number(arg));
    case 'vigenere': return vigenereDecode(text, arg ?? '');
    default: return null;
  }
}

export function runPipeline(text, steps) {
  const trail = [{ label: 'input', text: String(text) }];
  let current = String(text);
  for (const step of steps) {
    const next = applyStep(current, step);
    if (next === null) { trail.push({ label: step.op, text: null }); break; }
    current = next;
    trail.push({ label: step.op, text: next });
  }
  return trail;
}
