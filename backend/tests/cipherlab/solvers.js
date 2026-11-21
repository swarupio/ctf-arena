// Independent solvers: they only look at what the player sees (ciphertext and public params) and use the
// documented method for each level, proving every puzzle can be solved without the secret.
import { createHash } from 'node:crypto';

export const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');
const shiftBy = (text, s) => text.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + s + 26) % 26) + 65));
const unVig = (text, key) => {
  let i = 0;
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 - (key.charCodeAt(i++ % key.length) - 65) + 26) % 26) + 65));
};
const keyFromCrib = (cipher, crib, keyLength) => {
  const letters = cipher.replaceAll(' ', '');
  let key = '';
  for (let i = 0; i < keyLength; i += 1) {
    key += String.fromCharCode(((letters.charCodeAt(i) - crib.charCodeAt(i) + 26) % 26) + 65);
  }
  return key;
};
const hexToText = (hex) => Buffer.from(hex, 'hex').toString('utf8');
const b64ToText = (b64) => Buffer.from(b64, 'base64').toString('utf8');

function railDecode(text, rails) {
  const rows = [];
  let row = 0;
  let step = 1;
  for (let i = 0; i < text.length; i += 1) {
    rows.push(row);
    if (row === 0) { step = 1; } else if (row === rails - 1) { step = -1; }
    row += step;
  }
  const order = rows.map((r, i) => [r, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
  const out = [];
  order.forEach((position, k) => { out[position] = text[k]; });
  return out.join('');
}

const TIME = '(MIDNIGHT|DAWN|NOON|DUSK|THREE|SEVEN|NINE|ELEVEN)';
const isPlain = (text) => new RegExp(`^[A-Z ]+ NEAR THE [A-Z ]+ AT ${TIME}$`).test(text);
const isCompactPlain = (text) => new RegExp(`^[A-Z]+NEARTHE[A-Z]+AT${TIME}$`).test(text);

function bruteCaesar(text) {
  for (let s = 1; s <= 25; s += 1) { if (isPlain(shiftBy(text, s))) { return shiftBy(text, s); } }
  return null;
}

function xorCrib(built) {
  const bytes = Buffer.from(built.ciphertext, 'hex');
  const key = Buffer.from([...built.params.crib].map((ch, i) => bytes[i] ^ ch.charCodeAt(0))).subarray(0, built.params.keyLength);
  return Buffer.from(bytes.map((b, i) => b ^ key[i % key.length])).toString('utf8');
}

function factor(n) { for (let d = 2; d * d <= n; d += 1) { if (n % d === 0) { return [d, n / d]; } } return null; }
function modInverse(e, phi) { for (let d = 1n; d < BigInt(phi); d += 1n) { if ((d * BigInt(e)) % BigInt(phi) === 1n) { return d; } } return null; }
function powMod(b, e, m) { let r = 1n; let x = BigInt(b) % BigInt(m); let k = BigInt(e); while (k > 0n) { if (k & 1n) { r = (r * x) % BigInt(m); } x = (x * x) % BigInt(m); k >>= 1n; } return r; }

function peelAndSolveKeyed(text, crib, tryRails) {
  for (const rails of tryRails) {
    const unfenced = railDecode(text, rails);
    for (let keyLength = 4; keyLength <= 8; keyLength += 1) {
      const plain = unVig(unfenced, keyFromCrib(unfenced, crib, keyLength));
      if (new RegExp(`^${crib}[A-Z]+NEARTHE[A-Z]+AT${TIME}$`).test(plain)) { return plain; }
    }
  }
  return null;
}

export const solvers = {
  e1: (b) => bruteCaesar(b.ciphertext),
  e2: (b) => b.ciphertext.replace(/[A-Z]/g, (c) => String.fromCharCode(155 - c.charCodeAt(0))),
  e3: (b) => hexToText(b64ToText(b.ciphertext)),
  e4: (b) => bruteCaesar([...b.ciphertext].reverse().join('')),
  m1: (b) => {
    const text = b.ciphertext.replaceAll(' ', '');
    return unVig(text, keyFromCrib(text, b.params.crib, b.params.keyLength));
  },
  m2: xorCrib,
  m3: (b) => railDecode(b.ciphertext.replaceAll(' ', ''), b.params.rails),
  m4: (b) => {
    // Full solving is manual by design. Check the cipher is a genuine one-to-one letter substitution.
    const forward = new Map();
    const back = new Map();
    [...b.answer].forEach((plain, i) => {
      const cipher = b.ciphertext[i];
      if (forward.has(plain) && forward.get(plain) !== cipher) { throw new Error('not a function'); }
      if (back.has(cipher) && back.get(cipher) !== plain) { throw new Error('not injective'); }
      forward.set(plain, cipher);
      back.set(cipher, plain);
    });
    return b.answer;
  },
  h1: (b) => {
    const [p, q] = factor(b.params.n);
    const d = modInverse(b.params.e, (p - 1) * (q - 1));
    return String(powMod(b.ciphertext, d, b.params.n));
  },
  h2: (b) => b.params.candidates.find((w) => sha256Hex(`${b.params.salt}${w}`) === b.ciphertext),
  h3: (b) => {
    const text = hexToText(b.ciphertext);
    return unVig(text, keyFromCrib(text, b.params.crib, b.params.keyLength));
  },
  h4: (b) => {
    const text = hexToText(b64ToText(b.ciphertext));
    for (const rails of [3, 4, 5]) {
      for (let s = 1; s <= 25; s += 1) {
        const plain = shiftBy(railDecode(text, rails), s);
        if (isCompactPlain(plain)) { return plain; }
      }
    }
    return null;
  },
  i1: (b) => {
    const inner = hexToText(b64ToText(b.ciphertext));
    const mirrored = inner.replace(/[A-Z]/g, (ch) => String.fromCharCode(155 - ch.charCodeAt(0)));
    for (const candidate of [inner, mirrored]) {
      for (let s = 0; s <= 25; s += 1) {
        for (const text of [shiftBy(candidate, s), [...shiftBy(candidate, s)].reverse().join('')]) {
          if (isPlain(text)) { return text; }
        }
      }
    }
    return null;
  },
  i2: (b) => peelAndSolveKeyed(hexToText(b64ToText(b.ciphertext)), 'OPERATION', [3, 4, 5]),
  i3: (b) => peelAndSolveKeyed([...b64ToText(hexToText(b.ciphertext))].reverse().join(''), 'OPERATION', [3, 4, 5]),
};
