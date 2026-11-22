// Pure operations behind the Cipher Lab "Recipe workbench". Everything runs in the browser, nothing here talks to the
// server, and nothing knows or searches for an answer: the heuristics only describe what a text looks like.
//
// Data model: a step takes a string and returns a string. Where an operation works on bytes, a string is read as UTF-8
// (or, when it holds only characters 0-255 with some above 127, as one byte per character) and results are shown as
// UTF-8 when valid, otherwise one byte per character. That keeps Base64 -> Hex -> XOR chains lossless for ASCII.

export const MAX_INPUT_CHARS = 20000; // longer input is refused with an error (every edit re-runs the chain)
export const MAX_CHAIN_STEPS = 12; // longer chains are refused
export const MAX_OUTPUT_CHARS = 100000; // a step that would grow past this fails (stops binary/hex blow-ups)
export const BRUTE_SCAN_BYTES = 4096; // single-byte XOR scores only this many leading bytes of the input
export const BRUTE_TOP = 5; // candidates kept and shown

export class OpError extends Error {}
const fail = (message) => { throw new OpError(message); };

// ---- bytes <-> strings

export function toBytes(text) {
  const s = String(text);
  let high = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c > 255) { return new TextEncoder().encode(s); }
    if (c > 127) { high = true; }
  }
  if (!high) { return new TextEncoder().encode(s); }
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

function latin1(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) { out += String.fromCharCode(...bytes.subarray(i, i + 8192)); }
  return out;
}

export function fromBytes(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return latin1(bytes); }
}

// ---- encodings

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function bitsToBytes(text, alphabet, bitsPer, what) {
  let buffer = 0;
  let bits = 0;
  const out = [];
  for (const ch of text) {
    const value = alphabet.indexOf(ch);
    if (value < 0) { fail(`"${ch}" is not a valid ${what} character.`); }
    buffer = (buffer << bitsPer) | value;
    bits += bitsPer;
    if (bits >= 8) { bits -= 8; out.push((buffer >> bits) & 255); buffer &= (1 << bits) - 1; }
  }
  return Uint8Array.from(out);
}

function bytesToBits(bytes, alphabet, bitsPer, pad) {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= bitsPer) { bits -= bitsPer; out += alphabet[(buffer >> bits) & ((1 << bitsPer) - 1)]; }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) { out += alphabet[(buffer << (bitsPer - bits)) & ((1 << bitsPer) - 1)]; }
  while (pad && out.length % pad !== 0) { out += '='; }
  return out;
}

export function fromBase64(input) {
  const clean = String(input).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (clean.length === 0) { fail('Nothing to decode.'); }
  if (clean.length % 4 === 1) { fail('That is not valid Base64 (the length is impossible).'); }
  return fromBytes(bitsToBytes(clean, B64, 6, 'Base64'));
}
export const toBase64 = (input) => bytesToBits(toBytes(input), B64, 6, 4);

export function fromBase32(input) {
  const clean = String(input).replace(/[\s=]+/g, '').toUpperCase();
  if (clean.length === 0) { fail('Nothing to decode.'); }
  return fromBytes(bitsToBytes(clean, B32, 5, 'Base32'));
}
export const toBase32 = (input) => bytesToBits(toBytes(input), B32, 5, 8);

export function fromHex(input) {
  const clean = String(input).replace(/0x/gi, '').replace(/[\s,:;-]+/g, '');
  if (clean.length === 0) { fail('Nothing to decode.'); }
  if (!/^[0-9a-fA-F]+$/.test(clean)) { fail('Hex may only contain 0-9 and a-f.'); }
  if (clean.length % 2 !== 0) { fail('Hex needs an even number of digits.'); }
  return fromBytes(Uint8Array.from(clean.match(/../g), (pair) => parseInt(pair, 16)));
}
export const toHex = (input) => [...toBytes(input)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function fromBinary(input) {
  const clean = String(input).replace(/\s+/g, '');
  if (clean.length === 0) { fail('Nothing to decode.'); }
  if (!/^[01]+$/.test(clean)) { fail('Binary may only contain 0 and 1.'); }
  if (clean.length % 8 !== 0) { fail('Binary needs groups of 8 bits.'); }
  return fromBytes(Uint8Array.from(clean.match(/.{8}/g), (byte) => parseInt(byte, 2)));
}
export const toBinary = (input) => [...toBytes(input)].map((b) => b.toString(2).padStart(8, '0')).join(' ');

export function urlDecode(input, { plus = 'yes' } = {}) {
  const text = plus === 'no' ? String(input) : String(input).replace(/\+/g, ' ');
  try { return decodeURIComponent(text); } catch { return fail('Malformed percent-encoding (a % is not followed by valid hex).'); }
}

// ---- letter ciphers (case kept, other characters pass through)

const mapLetters = (text, fn) => String(text).replace(/[A-Za-z]/g, (ch) => {
  const base = ch <= 'Z' ? 65 : 97;
  return String.fromCharCode(fn(ch.charCodeAt(0) - base) + base);
});
const mod = (n, m) => ((n % m) + m) % m;

function intParam(value, name, min, max) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isInteger(n)) { fail(`${name} must be a whole number.`); }
  if (n < min || n > max) { fail(`${name} must be between ${min} and ${max}.`); }
  return n;
}

export const caesarBack = (input, { shift = 3 } = {}) => {
  const n = intParam(shift, 'Shift', -25, 25);
  return mapLetters(input, (i) => mod(i - n, 26));
};
export const rot13 = (input) => mapLetters(input, (i) => mod(i + 13, 26));
export const atbash = (input) => mapLetters(input, (i) => 25 - i);
export const rot47 = (input) => String(input).replace(/[!-~]/g, (ch) => String.fromCharCode(33 + mod(ch.charCodeAt(0) - 33 + 47, 94)));
export const reverse = (input) => [...String(input)].reverse().join('');

export function railFenceDecode(input, { rails = 3 } = {}) {
  const count = intParam(rails, 'Rails', 2, 20);
  const text = [...String(input)];
  if (text.length === 0) { fail('Nothing to decode.'); }
  const pattern = [];
  let row = 0;
  let step = 1;
  for (let i = 0; i < text.length; i += 1) {
    pattern.push(row);
    if (count > 1) { if (row === 0) { step = 1; } else if (row === count - 1) { step = -1; } }
    row += step;
  }
  const order = pattern.map((r, i) => [r, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  order.forEach(([, position], k) => { out[position] = text[k]; });
  return out.join('');
}

export function vigenereDecode(input, { key = '' } = {}) {
  const letters = String(key).toUpperCase().replace(/[^A-Z]/g, '');
  if (!letters) { fail('Enter a key made of letters.'); }
  let index = 0;
  return mapLetters(input, (i) => { const shift = letters.charCodeAt(index % letters.length) - 65; index += 1; return mod(i - shift, 26); });
}

// ---- XOR

function xorKeyBytes(key, format) {
  if (String(key) === '') { fail('Enter a key.'); }
  if (format === 'hex') {
    const clean = String(key).replace(/0x/gi, '').replace(/[\s,:-]+/g, '');
    if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) { fail('A hex key needs an even number of hex digits.'); }
    return Uint8Array.from(clean.match(/../g), (pair) => parseInt(pair, 16));
  }
  return new TextEncoder().encode(String(key));
}

export function xorWithKey(input, { key = '', format = 'text' } = {}) {
  const k = xorKeyBytes(key, format);
  const bytes = toBytes(input);
  return fromBytes(bytes.map((b, i) => b ^ k[i % k.length]));
}

// How English-like a piece of text is: the mean log-probability per character (higher is better, 0 is the ceiling).
// A heuristic for ranking candidates only. Spaces, letters and common punctuation score well, control bytes very badly.
const LETTER_LOG = [8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2.0, 6.1, 7.0, 0.15, 0.77, 4.0, 2.4, 6.7, 7.5, 1.9, 0.1, 6.0, 6.3, 9.1, 2.8, 0.98, 2.4, 0.15, 2.0, 0.07]
  .map((p) => Math.log(p / 100));
export function englishScore(text) {
  const s = String(text);
  if (s.length === 0) { return -20; }
  let total = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 97 && c <= 122) { total += LETTER_LOG[c - 97]; }
    else if (c >= 65 && c <= 90) { total += LETTER_LOG[c - 65] - 0.7; }
    else if (c === 32) { total += -1.8; }
    else if (c === 10 || c === 13 || c === 9) { total += -4; }
    else if (c >= 48 && c <= 57) { total += -5.5; }
    else if (c >= 33 && c <= 126) { total += ('.,\'"!?;:-()'.includes(s[i]) ? -5 : -7.5); }
    else { total += -12; }
  }
  return total / s.length;
}

const preview = (text) => String(text).slice(0, 60).replace(/[^\x20-\x7e]/g, '.');

// Tries all 256 keys on the first BRUTE_SCAN_BYTES bytes and ranks them. `pick` (1..BRUTE_TOP) chooses which candidate
// becomes the step's output, so the chain stays under the player's control.
export function xorBruteForce(input, { pick = 1 } = {}) {
  const choice = intParam(pick, 'Candidate number', 1, BRUTE_TOP);
  const bytes = toBytes(input);
  if (bytes.length === 0) { fail('Nothing to analyse.'); }
  const sample = bytes.subarray(0, BRUTE_SCAN_BYTES);
  const ranked = [];
  for (let key = 0; key < 256; key += 1) {
    ranked.push({ key, score: englishScore(latin1(sample.map((b) => b ^ key))) });
  }
  ranked.sort((a, b) => b.score - a.score || a.key - b.key);
  const candidates = ranked.slice(0, BRUTE_TOP).map(({ key, score }, i) => ({
    rank: i + 1, key, keyHex: key.toString(16).padStart(2, '0'), score: Math.round(score * 100) / 100,
    preview: preview(latin1(sample.subarray(0, 60).map((b) => b ^ key))),
  }));
  const chosen = candidates[choice - 1].key;
  return { text: fromBytes(bytes.map((b) => b ^ chosen)), candidates, note: `Used key 0x${candidates[choice - 1].keyHex}${bytes.length > sample.length ? ` (ranked on the first ${BRUTE_SCAN_BYTES} bytes)` : ''}.` };
}

// ---- Morse and A1Z26

const MORSE = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I', '.---': 'J',
  '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T',
  '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y', '--..': 'Z', '-----': '0', '.----': '1', '..---': '2',
  '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
};

export function morseDecode(input) {
  const text = String(input).trim().replace(/[·•]/g, '.').replace(/[−–—_]/g, '-');
  if (text === '') { fail('Nothing to decode.'); }
  return text.split(/\s*\/\s*|\s{3,}|\n+/).map((word) => word.split(/\s+/).filter(Boolean).map((code) => {
    if (!MORSE[code]) { fail(`"${code}" is not a Morse letter. Use . and - with spaces between letters and / between words.`); }
    return MORSE[code];
  }).join('')).join(' ');
}

export function a1z26Decode(input) {
  const text = String(input).trim();
  if (text === '') { fail('Nothing to decode.'); }
  return text.split('/').map((part) => part.trim()).map((word) => word.split(/[^0-9]+/).filter(Boolean).map((token) => {
    const n = Number(token);
    if (n < 1 || n > 26) { fail(`${token} is outside 1-26.`); }
    return String.fromCharCode(64 + n);
  }).join('')).join(' ');
}

// ---- the operation table. `tool` is the existing Cipher Lab toolbox tool that must be unlocked before the operation is
// offered (ids come from backend/src/games/cipherlab/levels.js TOOLS). Groups with no matching tool use 'pipeline',
// the workbench's own tool.

export const WORKBENCH_TOOL = 'pipeline';
const YES_NO = [{ value: 'yes', label: 'Plus means space' }, { value: 'no', label: 'Keep plus signs' }];

export const OPS = [
  { id: 'fromBase64', label: 'From Base64', group: 'Encodings', tool: 'codec', params: [], run: fromBase64 },
  { id: 'toBase64', label: 'To Base64', group: 'Encodings', tool: 'codec', params: [], run: toBase64 },
  { id: 'fromHex', label: 'From Hex', group: 'Encodings', tool: 'codec', params: [], run: fromHex },
  { id: 'toHex', label: 'To Hex', group: 'Encodings', tool: 'codec', params: [], run: toHex },
  { id: 'reverse', label: 'Reverse', group: 'Encodings', tool: 'codec', params: [], run: reverse },
  { id: 'fromBinary', label: 'From Binary', group: 'Encodings', tool: 'pipeline', params: [], run: fromBinary },
  { id: 'toBinary', label: 'To Binary', group: 'Encodings', tool: 'pipeline', params: [], run: toBinary },
  { id: 'fromBase32', label: 'From Base32', group: 'Encodings', tool: 'pipeline', params: [], run: fromBase32 },
  { id: 'toBase32', label: 'To Base32', group: 'Encodings', tool: 'pipeline', params: [], run: toBase32 },
  { id: 'urlDecode', label: 'URL decode', group: 'Encodings', tool: 'pipeline', params: [{ key: 'plus', label: 'Plus sign', type: 'select', default: 'yes', options: YES_NO }], run: urlDecode },
  { id: 'morse', label: 'Morse decode', group: 'Encodings', tool: 'pipeline', params: [], run: morseDecode },
  { id: 'a1z26', label: 'A1Z26 decode', group: 'Encodings', tool: 'pipeline', params: [], run: a1z26Decode },
  { id: 'caesar', label: 'Caesar shift back', group: 'Letter ciphers', tool: 'shift', params: [{ key: 'shift', label: 'Shift back by', type: 'number', default: 3, min: -25, max: 25 }], run: caesarBack },
  { id: 'rot13', label: 'ROT13', group: 'Letter ciphers', tool: 'shift', params: [], run: rot13 },
  { id: 'rot47', label: 'ROT47', group: 'Letter ciphers', tool: 'shift', params: [], run: rot47 },
  { id: 'atbash', label: 'Atbash', group: 'Letter ciphers', tool: 'shift', params: [], run: atbash },
  { id: 'railFence', label: 'Rail fence decode', group: 'Letter ciphers', tool: 'rail', params: [{ key: 'rails', label: 'Rails', type: 'number', default: 3, min: 2, max: 20 }], run: railFenceDecode },
  { id: 'vigenere', label: 'Vigenere decode', group: 'Letter ciphers', tool: 'vigenere', params: [{ key: 'key', label: 'Key', type: 'text', default: '' }], run: vigenereDecode },
  {
    id: 'xor', label: 'XOR with key', group: 'XOR', tool: 'xor',
    params: [
      { key: 'key', label: 'Key', type: 'text', default: '' },
      { key: 'format', label: 'Key format', type: 'select', default: 'text', options: [{ value: 'text', label: 'Text' }, { value: 'hex', label: 'Hex' }] },
    ],
    run: xorWithKey,
  },
  { id: 'xorBrute', label: 'XOR single-byte brute force', group: 'XOR', tool: 'xor', params: [{ key: 'pick', label: 'Use candidate', type: 'number', default: 1, min: 1, max: BRUTE_TOP }], run: xorBruteForce },
];

export const ANALYSIS_TOOLS = { frequency: 'frequency', indexOfCoincidence: 'frequency', magic: WORKBENCH_TOOL };

export const opById = (id) => OPS.find((op) => op.id === id) ?? null;
export const toolForOp = (id) => opById(id)?.tool ?? null;
export const isOpUnlocked = (id, unlockedTools) => {
  const tool = toolForOp(id);
  return Boolean(tool) && unlockedTools.includes(tool) && unlockedTools.includes(WORKBENCH_TOOL);
};
export const availableOps = (unlockedTools) => OPS.filter((op) => isOpUnlocked(op.id, unlockedTools));
export const defaultParams = (op) => Object.fromEntries(op.params.map((p) => [p.key, p.default]));

// ---- the chain runner

// steps: [{ op, params }]. Returns { inputError, truncated, results: [{ op, ok, text, error, note, candidates, skipped }] }.
// Never throws: any failure becomes an error on that step and later steps are marked skipped.
export function runChain(input, steps, { unlockedTools = [] } = {}) {
  const text = String(input ?? '');
  const list = Array.isArray(steps) ? steps : [];
  const out = { inputError: '', truncated: Math.max(0, list.length - MAX_CHAIN_STEPS), results: [] };
  if (text.length > MAX_INPUT_CHARS) {
    out.inputError = `Input is ${text.length} characters; the workbench takes at most ${MAX_INPUT_CHARS}.`;
    return out;
  }
  let current = text;
  let failed = false;
  for (const step of list.slice(0, MAX_CHAIN_STEPS)) {
    const op = opById(step?.op);
    if (failed) { out.results.push({ op: step?.op, ok: false, skipped: true, error: 'Skipped because an earlier step failed.' }); continue; }
    try {
      if (!op) { fail('Unknown operation.'); }
      if (!isOpUnlocked(op.id, unlockedTools)) { fail('This operation is locked: its toolbox tool has not been unlocked yet.'); }
      const raw = op.run(current, { ...defaultParams(op), ...(step.params ?? {}) });
      const result = typeof raw === 'string' ? { text: raw } : raw;
      if (result.text.length > MAX_OUTPUT_CHARS) { fail(`Output would be longer than ${MAX_OUTPUT_CHARS} characters.`); }
      current = result.text;
      out.results.push({ op: op.id, ok: true, text: current, note: result.note ?? '', candidates: result.candidates ?? null });
    } catch (error) {
      failed = true;
      out.results.push({ op: step?.op, ok: false, error: error instanceof OpError ? error.message : 'This operation could not be applied to that text.' });
    }
  }
  return out;
}

// ---- analysis helpers (not chainable)

export function indexOfCoincidence(text) {
  const counts = Array(26).fill(0);
  let total = 0;
  for (const ch of String(text).toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) { counts[code - 65] += 1; total += 1; }
  }
  if (total < 2) { return null; }
  return counts.reduce((sum, n) => sum + n * (n - 1), 0) / (total * (total - 1));
}

// Typical values: English ~0.066, random letters ~0.038. Returns a short reading of the number.
export function describeIC(ic) {
  if (ic === null) { return 'Not enough letters to say.'; }
  if (ic >= 0.06) { return 'Close to English: a single-alphabet substitution or a transposition (the letters were only moved or swapped one-for-one).'; }
  if (ic >= 0.05) { return 'Between English and random: could be a short Vigenere key or mixed text.'; }
  return 'Close to random: a longer polyalphabetic key (Vigenere), XOR or encoded data.';
}

// Magic: purely heuristic hints about what the text LOOKS like and which operation to try next. It never decodes
// anything for the player, never scores a flag and never searches for one. Returns up to five
// { op, params, reason } (op is null for a plain remark), ordered from most to least likely.
export function magic(text) {
  const s = String(text);
  const t = s.trim();
  const out = [];
  const add = (op, reason, params) => { if (!out.some((x) => x.op === op)) { out.push({ op, reason, params: params ?? {} }); } };
  if (t.length === 0) { return []; }
  const compact = t.replace(/\s+/g, '');
  const letters = (s.match(/[A-Za-z]/g) ?? []).length;
  const nonPrintable = [...s].filter((ch) => ch.charCodeAt(0) < 32 && !'\n\r\t'.includes(ch)).length + (s.match(/[\u0080-ÿ]/g) ?? []).length;

  if (/^[01\s]+$/.test(t) && compact.length >= 8 && compact.length % 8 === 0) { add('fromBinary', 'Only 0s and 1s in groups of 8: looks like binary text.'); }
  if (/^[.\-\s/_·•]+$/.test(t) && /[.-]/.test(t) && compact.length >= 3) { add('morse', 'Only dots, dashes, spaces and slashes: looks like Morse code.'); }
  if (/%[0-9a-fA-F]{2}/.test(t)) { add('urlDecode', 'Contains %XX sequences: looks URL-encoded.'); }
  const nums = t.match(/\d+/g);
  if (nums && nums.length >= 3 && /^[\d\s,./-]+$/.test(t) && nums.every((n) => Number(n) >= 1 && Number(n) <= 26)) {
    add('a1z26', 'Numbers from 1 to 26: could be letter positions (A1Z26).');
  }
  const hexDigits = compact.replace(/0x/gi, '').replace(/[:,-]/g, '');
  if (/^(0x)?[0-9a-fA-F\s:,-]+$/.test(t) && hexDigits.length >= 4 && hexDigits.length % 2 === 0 && (/[a-fA-F]/.test(t) || !/\s/.test(t))) {
    add('fromHex', 'Only hex digits in pairs: looks like hex-encoded bytes.');
  }
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact) && compact.length >= 8 && (compact.length % 4 === 0 || /=$/.test(compact)) && /[a-z]/.test(compact) && /[A-Z0-9+/]/.test(compact)) {
    add('fromBase64', 'Base64 alphabet, length fits: looks like Base64.');
  }
  if ((/^[A-Z2-7\s]+=*$/.test(t) && compact.replace(/=+$/, '').length >= 8 && !/^[A-Z\s]+$/.test(t)) || /^[A-Z2-7]+={1,6}$/.test(compact)) {
    add('fromBase32', 'Uppercase letters and the digits 2-7 (maybe = padding): looks like Base32.');
  }
  if (nonPrintable > s.length * 0.3 && s.length >= 4) {
    add('xorBrute', 'Mostly unprintable bytes: could be XOR-ed or binary data. Try single-byte XOR first.');
  }
  if (letters >= 20 && letters >= compact.length * 0.8) {
    const ic = indexOfCoincidence(s);
    const readable = englishScore(s) > -3.6 && /\s/.test(s);
    if (readable) {
      add(null, 'Already reads like English words; there is probably nothing left to decode.');
    } else if (ic !== null && ic >= 0.06) {
      add('caesar', 'Letter statistics look like English that was shifted or swapped one-for-one (high index of coincidence). Try a Caesar shift.');
      add('atbash', 'A mirrored alphabet (Atbash) also keeps this pattern.');
      add('railFence', 'If the letter frequencies look right but the words do not, the letters may only be reordered (rail fence).');
    } else if (ic !== null && ic < 0.05 && letters >= 40) {
      add('vigenere', 'Low index of coincidence: several alphabets are mixed, which is typical of a Vigenere key. You need the key.');
    }
  }
  if (s.length >= 4 && out.length === 0 && /^[\x21-\x7e]+$/.test(compact) && /[^A-Za-z0-9\s]/.test(s) && letters < compact.length * 0.7) {
    add('rot47', 'Mixed punctuation and letters over printable ASCII: ROT47 shifts that whole range.');
  }
  return out.slice(0, 5);
}
