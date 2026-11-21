// Pure cipher primitives (encrypt side). The browser has its own decoders; these only build puzzles.
const mapLetters = (text, fn) => text.replace(/[A-Z]/g, (ch) => String.fromCharCode(fn(ch.charCodeAt(0) - 65) + 65));

export const caesar = (text, shift) => mapLetters(text, (i) => (((i + shift) % 26) + 26) % 26);
export const atbash = (text) => mapLetters(text, (i) => 25 - i);
export const reverse = (text) => [...text].reverse().join('');

// Vigenere over letters only; other characters pass through and do not consume key letters.
export function vigenere(text, key, direction = 1) {
  let index = 0;
  return mapLetters(text, (i) => {
    const shift = key.charCodeAt(index % key.length) - 65;
    index += 1;
    return (((i + direction * shift) % 26) + 26) % 26;
  });
}

export const toHex = (text) => Buffer.from(text, 'utf8').toString('hex');
export const toBase64 = (text) => Buffer.from(text, 'utf8').toString('base64');

export function xorHex(text, key) {
  const data = Buffer.from(text, 'utf8');
  const pad = Buffer.from(key, 'utf8');
  return Buffer.from(data.map((byte, i) => byte ^ pad[i % pad.length])).toString('hex');
}

function railRows(length, rails) {
  const rows = [];
  let row = 0;
  let step = 1;
  for (let i = 0; i < length; i += 1) {
    rows.push(row);
    if (rails > 1) {
      if (row === 0) { step = 1; } else if (row === rails - 1) { step = -1; }
      row += step;
    }
  }
  return rows;
}

export function railFence(text, rails) {
  const rows = railRows(text.length, rails);
  const lines = Array.from({ length: rails }, () => []);
  [...text].forEach((ch, i) => lines[rows[i]].push(ch));
  return lines.map((line) => line.join('')).join('');
}

export function substitute(text, alphabet) {
  return mapLetters(text, (i) => alphabet.charCodeAt(i) - 65);
}

export function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = BigInt(base) % BigInt(modulus);
  let e = BigInt(exponent);
  const m = BigInt(modulus);
  while (e > 0n) {
    if (e & 1n) { result = (result * b) % m; }
    b = (b * b) % m;
    e >>= 1n;
  }
  return Number(result);
}

export const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

export function primesBetween(low, high) {
  const out = [];
  for (let n = Math.max(2, low); n <= high; n += 1) {
    let prime = true;
    for (let d = 2; d * d <= n; d += 1) { if (n % d === 0) { prime = false; break; } }
    if (prime) { out.push(n); }
  }
  return out;
}

// Applies named layers in order. Used by the multi-layer levels (hard boss and the whole insane track).
export function applyLayers(text, layers) {
  return layers.reduce((current, layer) => {
    switch (layer.op) {
      case 'caesar': return caesar(current, layer.shift);
      case 'atbash': return atbash(current);
      case 'reverse': return reverse(current);
      case 'vigenere': return vigenere(current, layer.key);
      case 'rail': return railFence(current, layer.rails);
      case 'hex': return toHex(current);
      case 'base64': return toBase64(current);
      default: throw new Error(`unknown layer ${layer.op}`);
    }
  }, text);
}
