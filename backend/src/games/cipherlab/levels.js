// Cipher Lab content: four tracks, fifteen levels. Each level `build(rng)` returns the team's own puzzle:
//   { ciphertext, params, answer, hints? }
// `params` is public (shown to the player), `answer` never leaves the server. Hints may be a function of the built
// puzzle (so they can reference this team's values), and may only reveal PART of the answer.
import {
  applyLayers, atbash, caesar, gcd, modPow, primesBetween, railFence, reverse, substitute, toBase64, toHex, vigenere, xorHex,
} from './ciphers.js';
import {
  ADJECTIVES, HASH_WORDS, NOUNS, PLACES, TIMES, VERBS,
} from './words.js';
import { createHash } from 'node:crypto';

const MINUTE = 60_000;
const group = (text, size = 5) => text.match(new RegExp(`.{1,${size}}`, 'g')).join(' ');
const compact = (text) => text.replaceAll(' ', '');

function sentence(rng) {
  return `${rng.pick(VERBS)} THE ${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)} NEAR THE ${rng.pick(PLACES)} AT ${rng.pick(TIMES)}`;
}
const sentences = (rng, count) => Array.from({ length: count }, () => sentence(rng)).join(' THEN ');

// Letters that a team can reasonably be asked to type. Anything else is stripped on both sides.
export const normalizeAnswer = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const PRIMES = primesBetween(101, 400);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export const TRACKS = [
  {
    id: 'easy',
    title: 'Rookie Desk',
    difficulty: 'easy',
    story: 'Welcome to the Cipher Lab, rookie. The agency intern scrambled the coffee orders and the lobby memo. Warm up on classic ciphers.',
    hints: true,
    speedrun: [10 * MINUTE, 20 * MINUTE, 40 * MINUTE],
  },
  {
    id: 'medium',
    title: 'Field Agent',
    difficulty: 'medium',
    story: 'You are out in the field now. Intercepted notes use keyed ciphers and a few mathematical tricks. Use your toolbox wisely.',
    hints: true,
    speedrun: [20 * MINUTE, 40 * MINUTE, 90 * MINUTE],
  },
  {
    id: 'hard',
    title: 'Cipher Master',
    difficulty: 'hard',
    story: 'Command trusts you with the vault. Public-key math, salted hashes and stacked encodings stand between you and the archive.',
    hints: true,
    speedrun: [30 * MINUTE, 60 * MINUTE, 120 * MINUTE],
  },
  {
    id: 'insane',
    title: 'Black Chamber',
    difficulty: 'insane',
    story: 'The Black Chamber does not explain itself. Chained ciphers, no hints, no mercy. Every transmission opens with the word OPERATION.',
    hints: false,
    speedrun: [45 * MINUTE, 90 * MINUTE, 180 * MINUTE],
  },
];

// The decoder toolbox. `unlockedBy` is the level whose clearing opens the tool (null = open from the start).
export const TOOLS = [
  { id: 'shift', name: 'Shift slider', description: 'Caesar / ROT shifts and an Atbash flip.', unlockedBy: null },
  { id: 'frequency', name: 'Frequency chart', description: 'Letter counts of any text, against typical English.', unlockedBy: 'e1' },
  { id: 'codec', name: 'Codec bench', description: 'Base64, hex and reverse converters.', unlockedBy: 'e2' },
  { id: 'vigenere', name: 'Vigenere decoder', description: 'Decode with a key and recover a key from a crib.', unlockedBy: 'e3' },
  { id: 'xor', name: 'XOR bench', description: 'Repeating-key XOR on hex, plus key recovery from a crib.', unlockedBy: 'e4' },
  { id: 'rail', name: 'Rail fence', description: 'Unscramble a rail fence with any rail count.', unlockedBy: 'm1' },
  { id: 'substitution', name: 'Substitution mapper', description: 'Map cipher letters to plain letters and watch the text change.', unlockedBy: 'm2' },
  { id: 'rsa', name: 'RSA workbench', description: 'Factor n, find d and compute modular powers.', unlockedBy: 'm3' },
  { id: 'hash', name: 'Hash lab', description: 'SHA-256 of salt plus word, for every candidate.', unlockedBy: 'm4' },
  { id: 'pipeline', name: 'Pipeline', description: 'Chain several decoders and watch the text travel through them.', unlockedBy: 'h4' },
];

function insaneChain(rng, levelKind) {
  if (levelKind === 'wrap') {
    const text = rng.pick([[{ op: 'caesar', shift: rng.range(1, 25) }], [{ op: 'atbash' }], [{ op: 'reverse' }, { op: 'caesar', shift: rng.range(1, 25) }]]);
    return [...text, { op: 'hex' }, { op: 'base64' }];
  }
  if (levelKind === 'keyed') {
    return [{ op: 'vigenere', key: rng.letters(rng.range(5, 6)) }, { op: 'rail', rails: rng.range(3, 5) }, { op: 'hex' }, { op: 'base64' }];
  }
  return [
    { op: 'vigenere', key: rng.letters(rng.range(6, 7)) }, { op: 'rail', rails: rng.range(3, 5) },
    { op: 'reverse' }, { op: 'base64' }, { op: 'hex' },
  ];
}

function insane(levelKind) {
  return (rng) => {
    const plain = levelKind === 'wrap' ? sentence(rng) : `OPERATION ${compact(sentence(rng))}`;
    const layers = insaneChain(rng, levelKind);
    const input = levelKind === 'wrap' ? plain : compact(plain);
    return { ciphertext: applyLayers(input, layers), params: {}, answer: plain };
  };
}

export const LEVELS = [
  {
    id: 'e1', track: 'easy', n: 1, title: 'Caesar\'s Coffee Order', points: 10,
    briefing: 'The intern shifted every letter of the coffee order by the same amount. Julius would be proud.',
    hints: ['A Caesar cipher moves every letter the same number of places along the alphabet.', 'The shift is between 1 and 25. Try the shift slider until real words appear.'],
    build(rng) {
      const plain = sentence(rng);
      return { ciphertext: caesar(plain, rng.range(1, 25)), params: {}, answer: plain };
    },
  },
  {
    id: 'e2', track: 'easy', n: 2, title: 'Mirror, Mirror', points: 10,
    briefing: 'Someone wrote the lobby memo backwards through the looking glass: A became Z, B became Y.',
    hints: ['Atbash swaps the alphabet with its mirror image: A with Z, B with Y, and so on.', 'Atbash is its own inverse. Running it twice gives back the original.'],
    build(rng) {
      const plain = sentence(rng);
      return { ciphertext: atbash(plain), params: {}, answer: plain };
    },
  },
  {
    id: 'e3', track: 'easy', n: 3, title: 'Wrapped Twice', points: 20,
    briefing: 'This message was packed in two layers of wrapping paper. Unwrap the outside first.',
    hints: ['The outer layer is Base64. Decode it to get a string of hexadecimal digits.', 'Decode the hex pairs as text to read the message.'],
    build(rng) {
      const plain = sentence(rng);
      return { ciphertext: toBase64(toHex(plain)), params: {}, answer: plain };
    },
  },
  {
    id: 'e4', track: 'easy', n: 4, title: 'Boss: The Doorman', points: 40, boss: true,
    briefing: 'The Doorman only lets in people who can undo a flip and a shift. He is grumpy, but fair.',
    hints: ['Two simple steps were applied: a Caesar shift, then the whole text was reversed.', 'Undo them in the opposite order: reverse first, then shift back by the right amount.'],
    build(rng) {
      const plain = sentence(rng);
      return { ciphertext: reverse(caesar(plain, rng.range(2, 24))), params: {}, answer: plain };
    },
  },
  {
    id: 'm1', track: 'medium', n: 1, title: 'The Keyed Note', points: 60,
    briefing: 'A Vigenere note: every letter moves by a different amount, set by a repeating key word.',
    hints: [
      'A Vigenere cipher repeats a key over the text. Letters with the same key letter share one Caesar shift.',
      'Every agent message starts with the known word AGENT (a crib). Line it up with the first ciphertext letters to reveal the key.',
    ],
    build(rng) {
      const keyLength = rng.range(4, 5);
      const plain = `AGENT ${sentence(rng)}`;
      const key = rng.letters(keyLength);
      return {
        ciphertext: group(vigenere(compact(plain), key)), params: { keyLength, crib: 'AGENT' }, answer: plain,
      };
    },
  },
  {
    id: 'm2', track: 'medium', n: 2, title: 'XOR Marks the Spot', points: 70,
    briefing: 'Bytes, not letters. A short key was XORed over the message again and again and printed as hex.',
    hints: [
      'XOR is reversible: plain XOR key = cipher, cipher XOR key = plain. The key repeats every few bytes.',
      'The message starts with the text "AGENT " (with the space). XOR those bytes with the first cipher bytes to recover the key.',
    ],
    build(rng) {
      const keyLength = rng.range(3, 4);
      const key = Array.from({ length: keyLength }, () => String.fromCharCode(97 + rng.int(26))).join('');
      const plain = `AGENT ${sentence(rng)}`;
      return { ciphertext: xorHex(plain, key), params: { keyLength, crib: 'AGENT ' }, answer: plain };
    },
  },
  {
    id: 'm3', track: 'medium', n: 3, title: 'Zig-Zag Fence', points: 70,
    briefing: 'The letters were written in a zig-zag across a fence and read off row by row.',
    hints: ['Write the message along a zig-zag over the given number of rails, then read each rail from the top.', 'Use the rail fence tool with the rail count from the briefing.'],
    build(rng) {
      const rails = rng.range(3, 5);
      const plain = sentence(rng);
      return { ciphertext: group(railFence(compact(plain), rails)), params: { rails }, answer: plain };
    },
  },
  {
    id: 'm4', track: 'medium', n: 4, title: 'Boss: The Scrambler', points: 130, boss: true,
    briefing: 'Every letter of the alphabet was swapped for another, once and for all. Count them, guess them, win.',
    hints: [
      'In a substitution cipher each letter always maps to the same other letter. E and T are the most common English letters.',
      'Word shapes help: THE, AT and NEAR are common words in these messages. Use the frequency chart.',
      (built) => `The first cipher word decodes to ${built.answer.split(' ')[0]}.`,
    ],
    build(rng) {
      const alphabet = rng.shuffle([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']).join('');
      const plain = sentences(rng, 2);
      return { ciphertext: substitute(plain, alphabet), params: {}, answer: plain };
    },
  },
  {
    id: 'h1', track: 'hard', n: 1, title: 'Tiny Primes, Big Secrets', points: 120,
    briefing: 'RSA with primes so small a laptop yawns. The message is a number below n.',
    hints: [
      'Factor n into its two primes p and q (trial division is enough).',
      'phi = (p-1)(q-1). The private exponent d is the inverse of e modulo phi.',
      'The message is m = c^d mod n. Answer with that number.',
    ],
    build(rng) {
      const p = rng.pick(PRIMES);
      let q = rng.pick(PRIMES);
      while (q === p) { q = rng.pick(PRIMES); }
      const n = p * q;
      const phi = (p - 1) * (q - 1);
      const e = rng.pick([3, 5, 7, 11, 13, 17].filter((value) => gcd(value, phi) === 1));
      const m = rng.range(1000, n - 1);
      return { ciphertext: String(modPow(m, e, n)), params: { n, e }, answer: String(m) };
    },
  },
  {
    id: 'h2', track: 'hard', n: 2, title: 'The Salted Password', points: 130,
    briefing: 'A leaked database holds only salted SHA-256 hashes. The password is one of the words on the suspect list.',
    hints: ['hash = SHA-256(salt + word), the salt written directly in front of the word.', 'Hash every candidate with the hash lab until one matches. The answer is the word.'],
    build(rng) {
      const candidates = rng.sample(HASH_WORDS, 40);
      const word = candidates[rng.int(candidates.length)];
      const salt = rng.letters(8).toLowerCase();
      return {
        ciphertext: sha256(`${salt}${word}`), params: { salt, algorithm: 'sha256', candidates }, answer: word,
      };
    },
  },
  {
    id: 'h3', track: 'hard', n: 3, title: 'Keyed and Hexed', points: 150,
    briefing: 'A keyed Vigenere cipher, then printed as hex. Two problems at once.',
    hints: [
      'Peel the hex off first. What remains is a Vigenere ciphertext (letters only).',
      'The message always starts with OPERATION. That crib is longer than the key, so it reveals the whole key.',
    ],
    build(rng) {
      const keyLength = rng.range(5, 6);
      const plain = `OPERATION ${sentence(rng)}`;
      const ciphertext = toHex(vigenere(compact(plain), rng.letters(keyLength)));
      return { ciphertext, params: { keyLength, crib: 'OPERATION' }, answer: plain };
    },
  },
  {
    id: 'h4', track: 'hard', n: 4, title: 'Boss: The Onion', points: 250, boss: true,
    briefing: 'Four layers: peel from the outside in. Each layer is something you already know how to beat.',
    hints: [
      'From outside to inside: Base64, then hex, then a rail fence (3 to 5 rails), then a Caesar shift.',
      'Try the pipeline tool: base64 decode, hex decode, rail fence 3, 4 or 5, then every Caesar shift.',
    ],
    build(rng) {
      const plain = sentence(rng);
      const layers = [{ op: 'caesar', shift: rng.range(1, 25) }, { op: 'rail', rails: rng.range(3, 5) }, { op: 'hex' }, { op: 'base64' }];
      return { ciphertext: applyLayers(compact(plain), layers), params: {}, answer: plain };
    },
  },
  {
    id: 'i1', track: 'insane', n: 1, title: 'Triple Wrap', points: 200,
    briefing: 'No hints. Three transmissions, three layers each. Recognise the wrapping on sight.',
    hints: [],
    build: insane('wrap'),
  },
  {
    id: 'i2', track: 'insane', n: 2, title: 'The Keyed Fence', points: 300,
    briefing: 'No hints. Keyed, fenced, encoded. Remember how every transmission begins.',
    hints: [],
    build: insane('keyed'),
  },
  {
    id: 'i3', track: 'insane', n: 3, title: 'Boss: The Black Chamber', points: 500, boss: true,
    briefing: 'No hints. Five layers, one unbreakable reputation. Break it anyway.',
    hints: [],
    build: insane('boss'),
  },
];

export const levelById = (id) => LEVELS.find((level) => level.id === id) ?? null;
export const trackById = (id) => TRACKS.find((track) => track.id === id) ?? null;
export const levelsOfTrack = (trackId) => LEVELS.filter((level) => level.track === trackId);
export const sumPoints = (levels) => levels.reduce((total, level) => total + level.points, 0);
export const MAX_POINTS = sumPoints(LEVELS);
export const trackMaxPoints = (trackId) => sumPoints(levelsOfTrack(trackId));
