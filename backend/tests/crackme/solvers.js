// Independent solvers: each one sees ONLY the program a player sees (the public instruction list), never the Rng, the answer
// or the level source. They stand in for a player who reads the listing. The three packed/self-modifying levels are first
// "unpacked" the way a player does it in the debugger: run the start-up code until the first INPUT.
import { createMachine, currentProgram, stepMachine } from '../../src/games/crackme/vm.js';

const letters = (from = 65, to = 90) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCharCode(from + i));
const LETTERS = letters();
const code = (char) => char.charCodeAt(0);
const u32 = (n) => n >>> 0;
const rol = (v, n) => { const k = n & 31; return k === 0 ? u32(v) : u32((v << k) | (v >>> (32 - k))); };
const ror = (v, n) => rol(v, 32 - (n & 31));

const at = (program, op) => program.flatMap(([name], i) => (name === op ? [i] : []));
const arg = (program, i) => program[i][1];

export function unpack(program) {
  const target = at(program, 'INPUT')[0];
  const machine = createMachine(program, '', { debugger: false });
  while (machine.status === 'running' && machine.pc !== target) { stepMachine(machine); }
  if (machine.pc !== target) { throw new Error('program never reached its first INPUT'); }
  return currentProgram(machine);
}

const SOLVERS = {
  e1(p) { return at(p, 'CMP').map((i) => String.fromCharCode(arg(p, i - 1))).join(''); },
  e2(p) { return at(p, 'CMP').map((i) => String.fromCharCode(arg(p, i - 1) ^ arg(p, i - 3))).join(''); },
  e3(p) {
    const cmps = at(p, 'CMP');
    const fixed = cmps.slice(0, 3).map((i) => String.fromCharCode(arg(p, i - 1))).join('');
    const last = cmps[3];
    const base = arg(p, last - 2);
    const mod = arg(p, last - 4);
    const five = `${fixed}AA`;
    const sum = [...five].reduce((total, char) => total + code(char), 0);
    return five + String.fromCharCode(base + (sum % mod));
  },
  e4(p) {
    const stores = at(p, 'STORE');
    const table = [];
    let key;
    for (const i of stores) {
      const addr = arg(p, i - 1);
      if (addr === 0 && key === undefined) { key = arg(p, i - 2); } else if (addr >= 10) { table[addr - 10] = arg(p, i - 2); }
    }
    const mulAt = at(p, 'MUL')[0];
    const mult = arg(p, mulAt - 1);
    const add = arg(p, mulAt + 1);
    const mod = arg(p, at(p, 'MOD')[0] - 1);
    let out = '';
    for (const t of table) { out += String.fromCharCode(t ^ key); key = (key * mult + add) % mod; }
    return out;
  },
  m1(p) {
    const cmps = at(p, 'CMP');
    const first = arg(p, cmps[0] - 1);
    const sum = arg(p, cmps[2] - 1);
    const mod = arg(p, cmps[2] - 3);
    const fold = arg(p, cmps[3] - 1);
    let one = null;
    for (const a of LETTERS) for (const b of LETTERS) for (const c of LETTERS) {
      if ((first + code(a) + code(b) + code(c)) % mod === sum) { one = String.fromCharCode(first) + a + b + c; }
      if (one) { break; }
    }
    let two = null;
    for (const a of LETTERS) for (const b of LETTERS) for (const c of LETTERS) {
      const d = fold ^ code(a) ^ code(b) ^ code(c);
      if (d >= 65 && d <= 90) { two = a + b + c + String.fromCharCode(d); }
      if (two) { break; }
    }
    return `${one}-${two}`;
  },
  m2(p) {
    const mult = arg(p, at(p, 'MUL')[0] - 1);
    const mod = arg(p, at(p, 'MOD')[0] - 1);
    const target = arg(p, at(p, 'CMP').at(-1) - 1);
    for (let n = 0; n < 10000; n += 1) {
      const pin = String(n).padStart(4, '0');
      let hash = 0;
      for (const char of pin) { hash = (code(char) + hash * mult) % mod; }
      if (hash === target) { return pin; }
    }
    return null;
  },
  m3(p) {
    return at(p, 'ROL').map((i) => String.fromCharCode(ror(arg(p, i + 3) ^ arg(p, i + 1), arg(p, i - 1)))).join('');
  },
  m4(p) {
    let prev = arg(p, 0);
    let out = '';
    for (const i of at(p, 'ROL')) {
      const rot = arg(p, i - 1);
      const add = arg(p, i + 1);
      const target = arg(p, i + 4);
      out += String.fromCharCode(ror(u32(target - add), rot) ^ prev);
      prev = target;
    }
    return out;
  },
  h1(p) {
    const mulAts = at(p, 'MUL');
    const weights = mulAts.map((i) => arg(p, i - 1));
    const cmps = at(p, 'CMP');
    const targets = cmps.slice(-3).map((i) => arg(p, i - 1));
    const mod = arg(p, at(p, 'MOD')[0] - 1);
    const shift = arg(p, at(p, 'ADD').find((i) => p[i + 1][0] === 'CMP') - 1);
    const sumOf = (group, k) => [...group].reduce((total, char, j) => total + code(char) * weights[k * 4 + j], 0) % mod;
    const quads = (prefix) => {
      const out = [];
      const rest = 4 - prefix.length;
      const walk = (text) => { if (text.length === 4) { out.push(text); } else { for (const l of LETTERS) { walk(text + l); } } };
      if (rest === 4) { walk(''); } else { for (const a of LETTERS) for (const b of LETTERS) for (const c of LETTERS) { out.push(prefix + a + b + c); } }
      return out;
    };
    const one = quads('').find((g) => sumOf(g, 0) === targets[0] && code(g[0]) + shift <= 90);
    const two = quads('').find((g) => sumOf(g, 1) === targets[1]);
    const lead = String.fromCharCode(code(one[0]) + shift);
    const three = quads(lead).find((g) => sumOf(g, 2) === targets[2]);
    return `${one}-${two}-${three}`;
  },
  h2(p) {
    const decoyAt = arg(p, 1);
    const key0 = arg(p, 2);
    const mulAt = at(p, 'MUL')[0];
    const mult = arg(p, mulAt - 1);
    const add = arg(p, mulAt + 1);
    const mod = arg(p, at(p, 'MOD')[0] - 1);
    let key = key0;
    let out = '';
    for (const i of at(p, 'CMP').filter((index) => index < decoyAt)) {
      out += String.fromCharCode(arg(p, i - 1) ^ key);
      key = (key * mult + add) % mod;
    }
    return out;
  },
  h3(p) {
    const cmps = at(p, 'CMP');
    const fixed = [arg(p, cmps[1] - 1), arg(p, cmps[2] - 1)].map((c) => c - 48);
    const cross = arg(p, cmps[3] - 2);
    const weightedTarget = arg(p, cmps[4] - 1);
    const weightedMod = arg(p, cmps[4] - 3);
    const plainTarget = arg(p, cmps[5] - 1);
    const plainMod = arg(p, cmps[5] - 3);
    const w0 = arg(p, 0);
    const flip = arg(p, at(p, 'SUB')[1] - 3);
    const weights = [w0];
    for (let i = 1; i < 10; i += 1) { weights.push(flip - weights[i - 1]); }
    const base = [fixed[0], fixed[1], 0, 0, 0, cross, 0, 0, 0, 0];
    for (let n = 0; n < 1000000; n += 1) {
      const d = [...base];
      [d[3], d[4], d[6], d[7], d[8], d[9]] = String(n).padStart(6, '0').split('').map(Number);
      const weighted = d.reduce((t, x, i) => t + x * weights[i], 0) % weightedMod;
      const plain = d.reduce((t, x) => t + x, 0) % plainMod;
      if (weighted === weightedTarget && plain === plainTarget) { return d.join(''); }
    }
    return null;
  },
  h4(p) { return keygen(p); },
  i1(p) { return packedChecks(unpack(p)); },
  i2(p) { return packedChecks(unpack(p)); },
  i3(p) {
    const seed = arg(p, 3);
    const muls = at(p, 'MUL');
    const mult = arg(p, muls[1] - 1);
    const mod = arg(p, at(p, 'MOD')[0] - 1);
    const cmps = at(p, 'CMP');
    const mod7 = arg(p, cmps[0] - 3);
    const want = arg(p, cmps[0] - 1);
    let first = null;
    let hash = 0;
    const walk = (text) => {
      if (first) { return; }
      if (text.length === 4) {
        let h = seed;
        for (const char of text) { h = (code(char) + h * mult) % mod; }
        if (h % mod7 === want) { first = text; hash = h; }
        return;
      }
      for (const l of LETTERS) { walk(text + l); }
    };
    walk('');
    let second = '';
    // muls[0] is the DBG seed, muls[1..4] the hash steps, the rest derive the second half.
    for (const i of muls.slice(5)) {
      const m = arg(p, i - 1);
      const a = arg(p, i + 1);
      second += String.fromCharCode(65 + ((hash * m + a) % 26));
    }
    return first + second;
  },
  i4(p) { return keygen(unpack(p)); },
};

// INPUT, PUSH key, XOR, PUSH rot, ROL, PUSH target, CMP: used by i1 (after unpacking) and i2.
function packedChecks(p) {
  return at(p, 'ROL').filter((i) => p[i + 2][0] === 'CMP').map((i) => String.fromCharCode(ror(arg(p, i + 1), arg(p, i - 1)) ^ arg(p, i - 3))).join('');
}

function keygen(p) {
  const start = at(p, 'INPUT')[0];
  let hash = arg(p, start - 3);
  const rolAt = at(p, 'ROL')[0];
  const rot = arg(p, rolAt - 1);
  const add = arg(p, rolAt + 1);
  // Skip the packer's own loop compare (it sits before the first INPUT).
  const cmps = at(p, 'CMP').filter((i) => i > start);
  const length = arg(p, cmps[1] - 1);
  const modulus = arg(p, at(p, 'MOD')[0] - 1);
  const name = LETTERS.slice(0, length).join('');
  for (const char of name) { hash = u32(rol(u32(code(char) ^ hash), rot) + add); }
  return `${name}-${hash % modulus}`;
}

export const solveLevel = (id, program) => SOLVERS[id](program);

// Patch Bay solver: what a player does after reading the (unpacked) listing. Every conditional jump that goes straight to a
// REJECT or HALT is a check; turn each one into POP so it still consumes its value but never rejects. Keygen cabinets (NAME-SERIAL) also need the dash test flipped
// (`PUSH 45`, `CMP`, `JZ`): with it inverted the first character already leaves the name loop, so any input reaches the end.
export function patchSolution(program) {
  const listing = unpack(program);
  const stops = new Set(listing.flatMap(([name], i) => (name === 'REJECT' || name === 'HALT' ? [i] : [])));
  const isDash = ([name], index) => name === 'JZ' && listing[index - 1]?.[0] === 'CMP' && listing[index - 2]?.[0] === 'PUSH' && listing[index - 2][1] === 45;
  const keygen = listing.some(isDash);
  const edits = [];
  listing.forEach((item, index) => {
    const [name, target] = item;
    if (name !== 'JNZ' && name !== 'JZ') { return; }
    if (isDash(item, index)) { edits.push({ index, op: 'JNZ' }); return; }
    // In a keygen the name loop only ends at the dash, so its end-of-input guard must stay.
    if (stops.has(target) && !(keygen && listing[index - 1]?.[0] === 'DUP')) { edits.push({ index, op: 'POP' }); }
  });
  return edits;
}
