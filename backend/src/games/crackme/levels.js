// Crackme Arcade content: four tracks, sixteen cabinets (levels). Every cabinet is a small program for the Crackme VM
// (./vm.js). `build(rng)` returns this team's own copy of it:
//   { program, answer }      program is public (the player reads it), answer is one input the program accepts (server only).
// Constants, keys and serial parameters all come from the Rng, i.e. HMAC(FLAG_SECRET, 'crackme:' + teamId + ':' + levelId).
// The server verdict is always "run the program on the submitted input"; `answer` is only used by tests and hints.
import { assemble } from './asm.js';
import { CODE_BASE } from './vm.js';

const code = (char) => char.charCodeAt(0);
export const INPUT_LIMIT = 32;
export const SERVER_STEP_LIMIT = 20000;

const WORDS = ['PACMAN', 'GALAGA', 'QBERT', 'TEMPEST', 'JOUST', 'PENGO', 'DIGDUG', 'ASTRO', 'ZAXXON', 'FROGGY', 'BREAKOUT', 'ROBOTRON'];
const DECOYS = ['FREEPLAY', 'CREDITS9', 'INSERTCN', 'ATTRACTM'];
const PRIMES_SMALL = [101, 103, 107, 109, 113, 127, 131];
const PRIMES_BIG = [50021, 50033, 50047, 50051, 65521];

const rol32 = (value, count) => {
  const n = count & 31;
  return n === 0 ? value >>> 0 : ((value << n) | (value >>> (32 - n))) >>> 0;
};
const u32 = (value) => value >>> 0;

// Stack-balanced snippets. A cell accumulates into memory: [v] -> [].
const addTo = (cell) => [`PUSH ${cell}`, 'LOAD', 'ADD', `PUSH ${cell}`, 'STORE'];
const xorTo = (cell) => [`PUSH ${cell}`, 'LOAD', 'XOR', `PUSH ${cell}`, 'STORE'];
const endOfInput = ['INPUT', 'JNZ fail', 'ACCEPT'];
const failTail = ['fail:', 'REJECT'];
const make = (lines, answer) => ({ program: assemble(lines).program, answer });

export const TRACKS = [
  {
    id: 'easy',
    title: 'Coin Slot Corner',
    difficulty: 'easy',
    story: 'The arcade is closing for the night and every cabinet still wants a code before it will play. Read the listing, find what the program compares your input with, and walk in.',
    hints: true,
  },
  {
    id: 'medium',
    title: 'High Score Alley',
    difficulty: 'medium',
    story: 'These cabinets hide their codes behind checksums, hashes and rotating bits. Step through the debugger, write down what the stack does, then run the maths backwards.',
    hints: true,
  },
  {
    id: 'hard',
    title: 'Attract Mode Basement',
    difficulty: 'hard',
    story: 'Serial algorithms, key generators and cabinets that know when someone is watching. Nothing here is accepted by accident.',
    hints: true,
  },
  {
    id: 'insane',
    title: 'Warehouse of Lost ROMs',
    difficulty: 'insane',
    story: 'Self-rewriting code, encrypted routines and boards that lie to debuggers. The warehouse offers no hints and no mercy.',
    hints: false,
  },
];

const letterAnswer = (rng, length) => rng.letters(length);

// ---- easy ------------------------------------------------------------------------------------------------------------
function buildPlain(rng) {
  const answer = `${rng.pick(WORDS)}${rng.digits(2)}`;
  const lines = [];
  for (const char of answer) { lines.push('INPUT', `PUSH ${code(char)}`, 'CMP', 'JNZ fail'); }
  lines.push(...endOfInput, ...failTail);
  return make(lines, answer);
}

function buildXorKey(rng) {
  const key = rng.range(17, 120);
  const answer = `${rng.pick(WORDS)}${rng.digits(2)}`;
  const lines = [];
  for (const char of answer) { lines.push('INPUT', `PUSH ${key}`, 'XOR', `PUSH ${code(char) ^ key}`, 'CMP', 'JNZ fail'); }
  lines.push(...endOfInput, ...failTail);
  return make(lines, answer);
}

// Three fixed letters, two free ones and a check letter: 'A' + (sum of the five mod 26).
function buildChecksum(rng) {
  const fixed = rng.letters(3);
  const free = rng.letters(2);
  const five = fixed + free;
  const sum = [...five].reduce((total, char) => total + code(char), 0);
  const answer = five + String.fromCharCode(65 + (sum % 26));
  const lines = [];
  for (const char of fixed) { lines.push('INPUT', 'DUP', `PUSH ${code(char)}`, 'CMP', 'JNZ fail', ...addTo(0)); }
  for (let i = 0; i < 2; i += 1) { lines.push('INPUT', ...addTo(0)); }
  lines.push('INPUT', 'PUSH 0', 'LOAD', 'PUSH 26', 'MOD', 'PUSH 65', 'ADD', 'CMP', 'JNZ fail', ...endOfInput, ...failTail);
  return make(lines, answer);
}

// Boss: expected bytes sit in a table in memory, the key changes after every character.
function buildRollingKey(rng) {
  const length = 8;
  const answer = letterAnswer(rng, length);
  const start = rng.range(1, 255);
  const mult = rng.pick([3, 5, 7, 9, 11]);
  const add = rng.range(1, 200);
  const lines = [`PUSH ${start}`, 'PUSH 0', 'STORE'];
  let key = start;
  for (let i = 0; i < length; i += 1) {
    lines.push(`PUSH ${code(answer[i]) ^ key}`, `PUSH ${10 + i}`, 'STORE');
    key = (key * mult + add) % 256;
  }
  lines.push(
    'loop:',
    'INPUT', 'PUSH 0', 'LOAD', 'XOR',
    'PUSH 1', 'LOAD', 'PUSH 10', 'ADD', 'LOAD',
    'CMP', 'JNZ fail',
    'PUSH 0', 'LOAD', `PUSH ${mult}`, 'MUL', `PUSH ${add}`, 'ADD', 'PUSH 256', 'MOD', 'PUSH 0', 'STORE',
    'PUSH 1', 'LOAD', 'PUSH 1', 'ADD', 'DUP', 'PUSH 1', 'STORE', `PUSH ${length}`, 'CMP', 'JNZ loop',
    ...endOfInput, ...failTail,
  );
  return make(lines, answer);
}

// ---- medium ----------------------------------------------------------------------------------------------------------
// XXXX-XXXX: group one is summed mod 97 (first letter fixed), group two is XOR folded.
function buildGroups(rng) {
  const one = rng.letters(4);
  const two = rng.letters(4);
  const sum = [...one].reduce((total, char) => total + code(char), 0) % 97;
  const fold = [...two].reduce((total, char) => total ^ code(char), 0);
  const lines = ['INPUT', 'DUP', `PUSH ${code(one[0])}`, 'CMP', 'JNZ fail', ...addTo(0)];
  for (let i = 1; i < 4; i += 1) { lines.push('INPUT', ...addTo(0)); }
  lines.push('INPUT', 'PUSH 45', 'CMP', 'JNZ fail');
  for (let i = 0; i < 4; i += 1) { lines.push('INPUT', ...xorTo(1)); }
  lines.push(
    'INPUT', 'JNZ fail',
    'PUSH 0', 'LOAD', 'PUSH 97', 'MOD', `PUSH ${sum}`, 'CMP', 'JNZ fail',
    'PUSH 1', 'LOAD', `PUSH ${fold}`, 'CMP', 'JNZ fail',
    'ACCEPT', ...failTail,
  );
  return make(lines, `${one}-${two}`);
}

// A four digit PIN run through hash = (hash * m + c) mod p.
function buildHashPin(rng) {
  const answer = rng.digits(4);
  const mult = rng.range(31, 97);
  const prime = rng.pick(PRIMES_BIG);
  let hash = 0;
  const lines = [];
  for (const char of answer) {
    hash = (code(char) + hash * mult) % prime;
    lines.push('INPUT', 'PUSH 0', 'LOAD', `PUSH ${mult}`, 'MUL', 'ADD', `PUSH ${prime}`, 'MOD', 'PUSH 0', 'STORE');
  }
  lines.push('INPUT', 'JNZ fail', 'PUSH 0', 'LOAD', `PUSH ${hash}`, 'CMP', 'JNZ fail', 'ACCEPT', ...failTail);
  return make(lines, answer);
}

function buildRotate(rng) {
  const answer = letterAnswer(rng, 6);
  const lines = [];
  for (const char of answer) {
    const rot = rng.range(1, 31);
    const key = rng.range(0x1000, 0xffffff);
    lines.push('INPUT', `PUSH ${rot}`, 'ROL', `PUSH ${key}`, 'XOR', `PUSH ${u32(rol32(code(char), rot) ^ key)}`, 'CMP', 'JNZ fail');
  }
  lines.push(...endOfInput, ...failTail);
  return make(lines, answer);
}

// Boss: a running accumulator checked after every character: acc = rol(acc ^ c, r) + a.
function buildChain(rng) {
  const answer = letterAnswer(rng, 8);
  let acc = rng.range(1000, 0x7fffffff);
  const lines = [`PUSH ${acc}`];
  for (const char of answer) {
    const rot = rng.range(1, 31);
    const add = rng.range(1, 0xffff);
    acc = u32(rol32(u32(acc ^ code(char)), rot) + add);
    lines.push('INPUT', 'XOR', `PUSH ${rot}`, 'ROL', `PUSH ${add}`, 'ADD', 'DUP', `PUSH ${acc}`, 'CMP', 'JNZ fail');
  }
  lines.push(...endOfInput, ...failTail);
  return make(lines, answer);
}

// ---- hard ------------------------------------------------------------------------------------------------------------
// XXXX-XXXX-XXXX. Each group is a weighted sum mod M; the third group starts with (first letter + d).
function buildSegments(rng) {
  const modulus = rng.pick(PRIMES_SMALL);
  const shift = rng.range(1, 9);
  const first = String.fromCharCode(65 + rng.int(26 - shift));
  const groups = [first + rng.letters(3), '', ''];
  groups[1] = rng.letters(4);
  groups[2] = String.fromCharCode(code(first) + shift) + rng.letters(3);
  const weights = groups.map(() => Array.from({ length: 4 }, () => rng.range(1, 9)));
  const lines = [];
  groups.forEach((group, k) => {
    for (let j = 0; j < 4; j += 1) {
      if (k === 0 && j === 0) { lines.push('INPUT', 'DUP', 'PUSH 5', 'STORE'); }
      else if (k === 2 && j === 0) { lines.push('INPUT', 'DUP', 'PUSH 5', 'LOAD', `PUSH ${shift}`, 'ADD', 'CMP', 'JNZ fail'); }
      else { lines.push('INPUT'); }
      lines.push(`PUSH ${weights[k][j]}`, 'MUL', ...addTo(k));
    }
    if (k < 2) { lines.push('INPUT', 'PUSH 45', 'CMP', 'JNZ fail'); }
  });
  lines.push('INPUT', 'JNZ fail');
  groups.forEach((group, k) => {
    const total = [...group].reduce((sum, char, j) => sum + code(char) * weights[k][j], 0);
    lines.push(`PUSH ${k}`, 'LOAD', `PUSH ${modulus}`, 'MOD', `PUSH ${total % modulus}`, 'CMP', 'JNZ fail');
  });
  lines.push('ACCEPT', ...failTail);
  return make(lines, groups.join('-'));
}

// The cabinet asks whether a debugger is attached. With one attached it takes the FREEPLAY decoy path.
function buildDebugCheck(rng) {
  const length = 8;
  const answer = letterAnswer(rng, length);
  let decoy = rng.pick(DECOYS);
  if (decoy === answer) { decoy = 'FREEPLAY'; }
  const mult = rng.range(3, 14);
  const add = rng.range(1, 200);
  let key = rng.range(1, 250);
  const lines = ['DBG', 'JNZ decoy', `PUSH ${key}`, 'PUSH 0', 'STORE'];
  for (const char of answer) {
    lines.push(
      'INPUT', 'PUSH 0', 'LOAD', 'XOR', `PUSH ${code(char) ^ key}`, 'CMP', 'JNZ fail',
      'PUSH 0', 'LOAD', `PUSH ${mult}`, 'MUL', `PUSH ${add}`, 'ADD', 'PUSH 251', 'MOD', 'PUSH 0', 'STORE',
    );
    key = (key * mult + add) % 251;
  }
  lines.push(...endOfInput, 'decoy:');
  for (const char of decoy) { lines.push('INPUT', `PUSH ${code(char)}`, 'CMP', 'JNZ fail'); }
  lines.push(...endOfInput, ...failTail);
  return make(lines, answer);
}

// Ten digits, a loop, three rules: weighted sum (weights 1,3,1,3..) mod 11, plain digit sum mod 7, and a cross rule.
function buildLoopSerial(rng) {
  const length = 10;
  const digits = [rng.int(10), rng.int(10), rng.int(7)];
  for (let i = 3; i < length; i += 1) { digits.push(rng.int(10)); }
  digits[5] = digits[2] + 3;
  const weighted = digits.reduce((total, digit, i) => total + digit * (i % 2 === 0 ? 1 : 3), 0) % 11;
  const plain = digits.reduce((total, digit) => total + digit, 0) % 7;
  const answer = digits.join('');
  const lines = [
    'PUSH 1', 'PUSH 3', 'STORE',
    'loop:',
    'INPUT', 'DUP', 'PUSH 2', 'LOAD', 'PUSH 10', 'ADD', 'STORE',
    'PUSH 48', 'SUB',
    'DUP', 'PUSH 1', 'LOAD', 'ADD', 'PUSH 1', 'STORE',
    'PUSH 3', 'LOAD', 'MUL', ...addTo(0),
    'PUSH 4', 'PUSH 3', 'LOAD', 'SUB', 'PUSH 3', 'STORE',
    'PUSH 2', 'LOAD', 'PUSH 1', 'ADD', 'DUP', 'PUSH 2', 'STORE', `PUSH ${length}`, 'CMP', 'JNZ loop',
    'PUSH 10', 'LOAD', `PUSH ${code(answer[0])}`, 'CMP', 'JNZ fail',
    'PUSH 11', 'LOAD', `PUSH ${code(answer[1])}`, 'CMP', 'JNZ fail',
    'PUSH 15', 'LOAD', 'PUSH 12', 'LOAD', 'PUSH 3', 'ADD', 'CMP', 'JNZ fail',
    'PUSH 0', 'LOAD', 'PUSH 11', 'MOD', `PUSH ${weighted}`, 'CMP', 'JNZ fail',
    'PUSH 1', 'LOAD', 'PUSH 7', 'MOD', `PUSH ${plain}`, 'CMP', 'JNZ fail',
    ...endOfInput, ...failTail,
  ];
  return make(lines, answer);
}

// The keygen. Input is NAME-SERIAL: the name (exactly `length` characters) is mixed into a hash and the serial is that
// hash mod 100000 written in decimal. Shared by the Warden boss and the final boss.
function keygenParams(rng) {
  const length = rng.range(4, 6);
  const name = letterAnswer(rng, length);
  const seed = rng.range(1000, 0x7fffffff);
  const rot = rng.range(1, 31);
  const add = rng.range(1, 0xffff);
  let hash = seed;
  for (const char of name) { hash = u32(rol32(u32(code(char) ^ hash), rot) + add); }
  return {
    length, seed, rot, add, answer: `${name}-${hash % 100000}`,
  };
}

const keygenBody = ({
  length, seed, rot, add,
}) => [
  `PUSH ${seed}`, 'PUSH 0', 'STORE',
  'nameloop:',
  'INPUT', 'DUP', 'JZ fail',
  'DUP', 'PUSH 45', 'CMP', 'JZ gotdash',
  'PUSH 0', 'LOAD', 'XOR', `PUSH ${rot}`, 'ROL', `PUSH ${add}`, 'ADD', 'PUSH 0', 'STORE',
  'PUSH 1', 'LOAD', 'PUSH 1', 'ADD', 'PUSH 1', 'STORE',
  'JMP nameloop',
  'gotdash:',
  'POP',
  'PUSH 1', 'LOAD', `PUSH ${length}`, 'CMP', 'JNZ fail',
  'serialloop:',
  'INPUT', 'DUP', 'JZ done',
  'PUSH 48', 'SUB', 'PUSH 2', 'LOAD', 'PUSH 10', 'MUL', 'ADD', 'PUSH 2', 'STORE',
  'JMP serialloop',
  'done:',
  'POP',
  'PUSH 2', 'LOAD', 'PUSH 0', 'LOAD', 'PUSH 100000', 'MOD', 'CMP', 'JNZ fail',
  'ACCEPT',
];

function buildKeygen(rng) {
  const params = keygenParams(rng);
  return make([...keygenBody(params), ...failTail], params.answer);
}

// ---- insane ----------------------------------------------------------------------------------------------------------
// Self-modifying: each compare constant is a placeholder `PUSH 0` that the start-up code rewrites with STORE into the
// code region. The static listing therefore shows the wrong constants.
function buildPatched(rng) {
  const answer = letterAnswer(rng, 6);
  const key = rng.range(0x10000, 0x3fffffff);
  const mask = rng.range(0x1000, 0xffffff);
  const patches = [];
  const body = [];
  [...answer].forEach((char, i) => {
    const rot = rng.range(1, 31);
    const target = u32(rol32(u32(code(char) ^ key), rot));
    const offset = rng.range(1, 0xffffff);
    patches.push(`PUSH ${u32(u32(target - offset) ^ mask)}`, `PUSH ${mask}`, 'XOR', `PUSH ${offset}`, 'ADD', `PUSH &p${i}`, 'STORE');
    body.push('INPUT', `PUSH ${key}`, 'XOR', `PUSH ${rot}`, 'ROL', `p${i}:`, 'PUSH 0', 'CMP', 'JNZ fail');
  });
  return make([...patches, ...body, ...endOfInput, ...failTail], answer);
}

// Wraps `body` (lines that end by ACCEPT/REJECT-ing, may jump to `fail`) so that its operands are stored encrypted and a
// start-up loop decrypts them in place with LOAD/XOR/STORE. A debugger attached (DBG) is sent to a decoy check instead.
function encryptedProgram(rng, body, decoy) {
  const lines = (symbols) => [
    'DBG', 'JNZ decoy',
    `PUSH ${symbols.lo}`, 'PUSH 63', 'STORE',
    'dloop:',
    'PUSH 63', 'LOAD', `PUSH ${CODE_BASE}`, 'ADD', 'DUP', 'LOAD', `PUSH ${symbols.key}`, 'XOR', 'SWAP', 'STORE',
    'PUSH 63', 'LOAD', 'PUSH 1', 'ADD', 'DUP', 'PUSH 63', 'STORE', `PUSH ${symbols.hi}`, 'CMP', 'JNZ dloop',
    'body:', ...body, 'bodyEnd:',
    'decoy:',
    ...[...decoy].flatMap((char) => ['INPUT', `PUSH ${code(char)}`, 'CMP', 'JNZ fail']),
    ...endOfInput, ...failTail,
  ];
  const { labels } = assemble(lines({ lo: 0, hi: 0, key: 0 }));
  const key = rng.range(0x100, 0x3fffffff);
  const { program } = assemble(lines({ lo: labels.body, hi: labels.bodyEnd, key }));
  for (let i = labels.body; i < labels.bodyEnd; i += 1) {
    if (program[i].length === 2) { program[i][1] = u32(program[i][1] ^ key); }
  }
  return program;
}

function buildEncrypted(rng) {
  const answer = letterAnswer(rng, 8);
  const body = [];
  for (const char of answer) {
    const rot = rng.range(1, 31);
    const key = rng.range(0x1000, 0xffffff);
    body.push('INPUT', `PUSH ${key}`, 'XOR', `PUSH ${rot}`, 'ROL', `PUSH ${u32(rol32(u32(code(char) ^ key), rot))}`, 'CMP', 'JNZ fail');
  }
  body.push(...endOfInput);
  let decoy = rng.pick(DECOYS);
  if (decoy === answer) { decoy = 'FREEPLAY'; }
  return { program: encryptedProgram(rng, body, decoy), answer };
}

// First half free (hash mod 7 fixed), second half derived from the hash. The hash seed silently depends on DBG.
function buildDependent(rng) {
  const seed = rng.range(1, 60000);
  const debugDelta = rng.range(1, 60000);
  const first = letterAnswer(rng, 4);
  let hash = seed;
  for (const char of first) { hash = (code(char) + hash * 33) % 65521; }
  const lines = ['DBG', `PUSH ${debugDelta}`, 'MUL', `PUSH ${seed}`, 'ADD', 'PUSH 0', 'STORE'];
  for (let i = 0; i < 4; i += 1) {
    lines.push('INPUT', 'PUSH 0', 'LOAD', 'PUSH 33', 'MUL', 'ADD', 'PUSH 65521', 'MOD', 'PUSH 0', 'STORE');
  }
  lines.push('PUSH 0', 'LOAD', 'PUSH 7', 'MOD', `PUSH ${hash % 7}`, 'CMP', 'JNZ fail');
  let second = '';
  for (let i = 0; i < 4; i += 1) {
    const mult = rng.range(2, 60);
    const add = rng.range(1, 100);
    const char = String.fromCharCode(65 + ((hash * mult + add) % 26));
    second += char;
    lines.push('INPUT', 'PUSH 0', 'LOAD', `PUSH ${mult}`, 'MUL', `PUSH ${add}`, 'ADD', 'PUSH 26', 'MOD', 'PUSH 65', 'ADD', 'CMP', 'JNZ fail');
  }
  lines.push(...endOfInput, ...failTail);
  return make(lines, first + second);
}

function buildFinalBoss(rng) {
  const params = keygenParams(rng);
  let decoy = rng.pick(DECOYS);
  if (decoy === params.answer) { decoy = 'FREEPLAY'; }
  return { program: encryptedProgram(rng, keygenBody(params), decoy), answer: params.answer };
}

// ---- level table -----------------------------------------------------------------------------------------------------
const first = (built) => built.answer[0];

export const LEVELS = [
  {
    id: 'e1', track: 'easy', n: 1, title: 'Pong Plus', points: 20, build: buildPlain,
    briefing: 'The Pong Plus cabinet wants a service password. The programmer was in a hurry and left it right in the listing.',
    hints: [
      'Each INPUT / PUSH / CMP / JNZ group checks one character. The PUSH holds an ASCII code (65 is A, 48 is 0).',
      (built) => `The password has ${built.answer.length} characters.`,
      (built) => `It starts with ${first(built)}.`,
    ],
  },
  {
    id: 'e2', track: 'easy', n: 2, title: 'Snake Byte', points: 25, build: buildXorKey,
    briefing: 'Snake Byte no longer stores its password in the clear. Each character is scrambled with a key before the compare.',
    hints: [
      'XOR is its own undo: if input XOR key = t, then input = t XOR key.',
      'The key is the PUSH right before each XOR. The expected value is the PUSH right before each CMP.',
      (built) => `The first character is ${first(built)}.`,
    ],
  },
  {
    id: 'e3', track: 'easy', n: 3, title: 'Galaga Gate', points: 30, build: buildChecksum,
    briefing: 'Galaga Gate checks a six character code: some letters are fixed, and the last one is a checksum of the first five.',
    hints: [
      'Memory cell 0 collects a running sum of the first five characters (the ADD and STORE groups).',
      'The last character must be the letter A (65) plus the sum modulo 26. The two middle letters can be anything.',
      (built) => `The code starts with ${first(built)}.`,
    ],
  },
  {
    id: 'e4', track: 'easy', n: 4, title: 'Boss: Dr. Pixel', points: 60, boss: true, build: buildRollingKey,
    briefing: 'Dr. Pixel guards the corner with a rolling key: it changes after every character. The expected bytes are stored in memory first.',
    hints: [
      'The first STOREs fill a table from address 10. The key lives in memory cell 0 and is updated as key = (key * M + A) mod 256.',
      'Follow the key for each position, then XOR it with the table entry: that gives the character.',
      (built) => `The password starts with ${first(built)}.`,
    ],
  },
  {
    id: 'm1', track: 'medium', n: 1, title: 'Tetris Lock', points: 40, build: buildGroups,
    briefing: 'Serials look like XXXX-XXXX. The first group is added up, the second is XOR folded, and many different serials are valid.',
    hints: [
      'The first group is summed into memory cell 0, then taken modulo 97. The second group is XORed into memory cell 1.',
      'Position 4 must be a hyphen (45). Choose any letters that give the two required values.',
      (built) => `The first letter of the serial is ${first(built)}.`,
    ],
  },
  {
    id: 'm2', track: 'medium', n: 2, title: 'Pac-Maze', points: 50, build: buildHashPin,
    briefing: 'The maintenance PIN is four digits, but the cabinet only stores a hash of it.',
    hints: [
      'The hash is rebuilt as hash = (hash * m + character) mod p. Both m and p appear in the listing.',
      'There are only 10000 four digit PINs. A short script (or the VM) can try them all offline.',
      (built) => `The first digit is ${first(built)}.`,
    ],
  },
  {
    id: 'm3', track: 'medium', n: 3, title: 'Frogger Key', points: 60, build: buildRotate,
    briefing: 'Frogger rotates every character by a different amount and masks it before the compare.',
    hints: [
      'ROL rotates the 32-bit value left. To undo a left rotation by n, rotate right by n (left by 32 - n).',
      'Undo in reverse order: XOR with the key first, then rotate back. The result is the character.',
      (built) => `The first character is ${first(built)}.`,
    ],
  },
  {
    id: 'm4', track: 'medium', n: 4, title: 'Boss: Chip Hacker', points: 120, boss: true, build: buildChain,
    briefing: 'Chip Hacker keeps a running accumulator and checks it after every single character. Break it one step at a time.',
    hints: [
      'The stack holds the accumulator. Each step is acc = rol(acc XOR character, r) + a, then compared with a constant.',
      'Undo one character: subtract a, rotate right by r, XOR with the previous accumulator (the first PUSH is the starting value).',
      (built) => `The first character is ${first(built)}.`,
    ],
  },
  {
    id: 'h1', track: 'hard', n: 1, title: 'Fortress Serial', points: 80, build: buildSegments,
    briefing: 'XXXX-XXXX-XXXX. Every group is a weighted sum, and the third group quietly depends on the first.',
    hints: [
      'Each character is multiplied by its own weight before it is added into its group cell. All weights and the modulus are in the listing.',
      'Memory cell 5 remembers the first character. The third group starts with that letter plus a constant.',
    ],
  },
  {
    id: 'h2', track: 'hard', n: 2, title: 'Anti-Debug Alley', points: 100, build: buildDebugCheck,
    briefing: 'This cabinet checks who is watching. In the debugger it happily accepts a password the real cabinet will refuse.',
    hints: [
      'Find the instruction that asks whether a debugger is attached. Then switch on Hide debugger in the debugger panel and step again.',
      'The real path uses a key that changes after every character: key = (key * M + A) mod 251.',
    ],
  },
  {
    id: 'h3', track: 'hard', n: 3, title: 'Tape Loop', points: 120, build: buildLoopSerial,
    briefing: 'A ten digit serial processed in a loop. Read the weights, the modulo checks and the one rule that links two positions.',
    hints: [
      'The loop saves each character at address 10 + i and keeps two sums: a weighted one (weights 1, 3, 1, 3 ...) and a plain one.',
      'After the loop: the first two digits are fixed, digit 5 is digit 2 plus 3 (as characters), weighted sum mod 11 and plain sum mod 7 are fixed.',
    ],
  },
  {
    id: 'h4', track: 'hard', n: 4, title: 'Boss: The Warden', points: 200, boss: true, build: buildKeygen,
    briefing: 'The Warden wants NAME-SERIAL. Write a keygen: the name is mixed into a hash and the serial is that hash modulo 100000.',
    hints: [
      'The name must have the exact length compared after the hyphen. Every name character updates the hash held in memory cell 0.',
      'Each step is hash = rol(character XOR hash, r) + a. The serial is the final hash modulo 100000, written in decimal.',
    ],
  },
  {
    id: 'i1', track: 'insane', n: 1, title: 'Self-Modifying Cabinet', points: 150, build: buildPatched,
    briefing: 'The constants you see in the compares are not the constants the cabinet uses.',
    hints: [],
  },
  {
    id: 'i2', track: 'insane', n: 2, title: 'Two-Face Cabinet', points: 200, build: buildEncrypted,
    briefing: 'Half of this cabinet is gibberish until it unpacks itself. And it does not like being watched.',
    hints: [],
  },
  {
    id: 'i3', track: 'insane', n: 3, title: 'Ghost in the Machine', points: 250, build: buildDependent,
    briefing: 'The second half of the serial depends on the first. The cabinet seeds its hash from something odd.',
    hints: [],
  },
  {
    id: 'i4', track: 'insane', n: 4, title: 'Final Boss: MEGA-ROM', points: 400, boss: true, build: buildFinalBoss,
    briefing: 'The MEGA-ROM combines everything: packed code, a debugger trap and a keygen check. NAME-SERIAL.',
    hints: [],
  },
];

export const levelById = (id) => LEVELS.find((level) => level.id === id);
export const sumPoints = (levels) => levels.reduce((total, level) => total + level.points, 0);
export const trackMaxPoints = (trackId) => sumPoints(LEVELS.filter((level) => level.track === trackId));
export const MAX_POINTS = sumPoints(LEVELS);
