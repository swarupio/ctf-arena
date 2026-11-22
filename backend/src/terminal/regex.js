// Safe regular expressions for grep / sed / awk / find. See docs/ARENA_TERMINAL.md section 6.
//
// Player patterns are NEVER run by V8's backtracking RegExp (that is the ReDoS hole: `.*.*.*.*.*.*Z` is
// O(n^7) there, and the work Budget does not count regex time). Instead:
//   1. lex + parse: reject patterns that are too long, use backreferences, lookarounds, nested
//      quantifiers or ambiguous alternation under a repeat (unchanged rules);
//   2. compile the tree to a small instruction program (CHAR, SPLIT, JMP, SAVE, ASSERT, MATCH), at most
//      LIMITS.MAX_PROGRAM instructions, so `{n,m}` expansion cannot blow up;
//   3. run it on a Pike VM (Thompson NFA simulation with capture slots). Every input position visits each
//      instruction at most once (the `mark` array), so one match call costs O(|text| * |program|) steps
//      no matter what the pattern is. There is no backtracking and no exponential or polynomial blow-up.
// Time bound: steps <= (|text| + 1) * MAX_PROGRAM (each step is O(1), a capture copy is charged 3), a
// match call is additionally aborted at LIMITS.MAX_REGEX_STEPS (ResourceLimitError, "resource limit
// exceeded"), and inside `execute()` every 64 steps are charged to the command line's work Budget
// (withRegexMeter), so a whole command line is bounded by MAX_WORK * 64 steps in total.
// Semantics are Perl/JS leftmost-first (greedy and lazy quantifiers, first alternative wins), matching
// what the previous translator produced.
import { AsyncLocalStorage } from 'node:async_hooks';
import { LIMITS, ResourceLimitError } from './limits.js';

export class PatternError extends Error {
  constructor(message = 'unsupported pattern') {
    super(message);
    this.name = 'PatternError';
  }
}

const CLASSES = {
  alpha: 'A-Za-z', digit: '0-9', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f',
  cntrl: '\\x00-\\x1f\\x7f', print: ' -~', graph: '!-~',
};
const WORD = 'A-Za-z0-9_';
const UNMATCHED_BRACKET = 'Unmatched [, [^, [:, [., or [=';

const escapeLiteral = (ch) => (/[\\^$.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch);
const escapeClassChar = (ch) => (/[\\\]^[-]/.test(ch) ? `\\${ch}` : ch);

function parseBracket(src, start, pcre) {
  let i = start + 1;
  let negate = false;
  if (src[i] === '^') { negate = true; i += 1; }
  const items = [];
  let first = true;
  for (;;) {
    if (i >= src.length) throw new PatternError(UNMATCHED_BRACKET);
    const ch = src[i];
    if (ch === ']' && !first) { i += 1; break; }
    first = false;
    if (ch === '[' && src[i + 1] === ':') {
      const close = src.indexOf(':]', i + 2);
      if (close > 0) {
        const cls = CLASSES[src.slice(i + 2, close)];
        if (!cls) throw new PatternError(UNMATCHED_BRACKET);
        items.push(cls);
        i = close + 2;
        continue;
      }
    }
    if (ch === '[' && (src[i + 1] === '.' || src[i + 1] === '=')) throw new PatternError();
    if (pcre && ch === '\\' && i + 1 < src.length) {
      const next = src[i + 1];
      const shorthand = { d: '0-9', w: WORD, s: ' \\t\\n\\r\\f\\v' }[next];
      i += 2;
      items.push(shorthand ?? escapeClassChar(next === 't' ? '\t' : next === 'n' ? '\n' : next));
      continue;
    }
    i += 1;
    if (src[i] === '-' && i + 1 < src.length && src[i + 1] !== ']') {
      const hi = src[i + 1];
      if (hi === '[' && src[i + 2] === ':') throw new PatternError('Invalid range end');
      if (hi < ch) throw new PatternError('Invalid range end');
      items.push(`${escapeClassChar(ch)}-${escapeClassChar(hi)}`);
      i += 2;
    } else {
      items.push(escapeClassChar(ch));
    }
  }
  return { src: `[${negate ? '^' : ''}${items.join('')}]`, next: i };
}

function parseInterval(src, start, bre) {
  // `start` points just after `{` (or `\{`). Returns null when it is not a valid interval.
  const match = /^(\d*)(?:(,)(\d*))?/.exec(src.slice(start));
  const closer = bre ? '\\}' : '}';
  const after = start + match[0].length;
  if (!src.startsWith(closer, after)) return null;
  if (match[1] === '' && match[2] === undefined) return null;
  const min = match[1] === '' ? 0 : Number(match[1]);
  let max = min;
  if (match[2] !== undefined) max = match[3] === '' ? Infinity : Number(match[3]);
  if (min > 1000 || (max !== Infinity && max > 1000) || max < min) throw new PatternError();
  return { min, max, next: after + closer.length };
}

function lex(src, flavor) {
  const bre = flavor === 'bre';
  const pcre = flavor === 'pcre';
  const toks = [];
  const n = src.length;
  let i = 0;
  const startish = () => toks.length === 0 || ['lparen', 'alt', 'bol'].includes(toks[toks.length - 1].k);
  const lit = (ch) => toks.push({ k: 'atom', src: escapeLiteral(ch), lit: ch });
  const quant = (min, max) => {
    const token = { k: 'quant', min, max, lazy: false };
    if (pcre && src[i] === '?') { token.lazy = true; i += 1; }
    toks.push(token);
  };
  while (i < n) {
    const ch = src[i];
    if (ch === '\\') {
      if (i + 1 >= n) throw new PatternError('Trailing backslash');
      const next = src[i + 1];
      i += 2;
      if (/[1-9]/.test(next)) throw new PatternError(); // backreference
      if (bre) {
        if (next === '(') { toks.push({ k: 'lparen' }); continue; }
        if (next === ')') { toks.push({ k: 'rparen' }); continue; }
        if (next === '|') { toks.push({ k: 'alt' }); continue; }
        if (next === '+' && !startish()) { quant(1, Infinity); continue; }
        if (next === '?' && !startish()) { quant(0, 1); continue; }
        if (next === '{' && !startish()) {
          const interval = parseInterval(src, i, true);
          if (!interval) throw new PatternError('Invalid content of \\{\\}');
          i = interval.next;
          quant(interval.min, interval.max);
          continue;
        }
      }
      switch (next) {
        case 'w': toks.push({ k: 'atom', src: `[${WORD}]` }); continue;
        case 'W': toks.push({ k: 'atom', src: `[^${WORD}]` }); continue;
        case 's': toks.push({ k: 'atom', src: '[ \\t\\n\\r\\f\\v]' }); continue;
        case 'S': toks.push({ k: 'atom', src: '[^ \\t\\n\\r\\f\\v]' }); continue;
        case 'b': toks.push({ k: 'anchor', src: '\\b' }); continue;
        case 'B': toks.push({ k: 'anchor', src: '\\B' }); continue;
        case '<': toks.push({ k: 'anchor', src: `\\b(?=[${WORD}])` }); continue;
        case '>': toks.push({ k: 'anchor', src: `\\b(?<=[${WORD}])` }); continue;
        default: break;
      }
      if (pcre) {
        if (next === 'd') { toks.push({ k: 'atom', src: '[0-9]' }); continue; }
        if (next === 'D') { toks.push({ k: 'atom', src: '[^0-9]' }); continue; }
        if (next === 't') { lit('\t'); continue; }
        if (next === 'n') { lit('\n'); continue; }
        if (next === 'r') { lit('\r'); continue; }
        if (next === 'x') {
          const hex = /^[0-9A-Fa-f]{2}/.exec(src.slice(i));
          if (!hex) throw new PatternError();
          lit(String.fromCharCode(parseInt(hex[0], 16)));
          i += 2;
          continue;
        }
      }
      lit(next);
      continue;
    }
    i += 1;
    if (ch === '[') {
      const bracket = parseBracket(src, i - 1, pcre);
      toks.push({ k: 'atom', src: bracket.src });
      i = bracket.next;
    } else if (ch === '.') {
      toks.push({ k: 'atom', src: '[^\\n]' });
    } else if (ch === '*') {
      if (startish()) lit('*'); else quant(0, Infinity);
    } else if (ch === '^') {
      if (!bre || startish()) toks.push({ k: 'bol', src: '^' }); else lit('^');
    } else if (ch === '$') {
      if (!bre || i === n || src.startsWith('\\)', i) || src.startsWith('\\|', i)) toks.push({ k: 'anchor', src: '$' });
      else lit('$');
    } else if (!bre && ch === '(') {
      if (src[i] === '?') {
        if (pcre && src.startsWith('?:', i)) { i += 2; toks.push({ k: 'lparen', nocap: true }); } else throw new PatternError();
      } else toks.push({ k: 'lparen' });
    } else if (!bre && ch === ')') {
      toks.push({ k: 'rparen' });
    } else if (!bre && ch === '|') {
      toks.push({ k: 'alt' });
    } else if (!bre && (ch === '+' || ch === '?')) {
      if (startish()) lit(ch); else if (ch === '+') quant(1, Infinity); else quant(0, 1);
    } else if (!bre && ch === '{') {
      const interval = startish() ? null : parseInterval(src, i, false);
      if (interval) { i = interval.next; quant(interval.min, interval.max); } else lit('{');
    } else {
      lit(ch);
    }
  }
  return toks;
}

// Tree: alt = { seqs: item[][] }; item = { kind: 'leaf'|'group', src?, lit?, alt?, cap?, quant? }
function parseTree(tokens, ignoreCase) {
  let p = 0;
  const stats = { unbounded: 0 };

  const innerInfo = (alt) => {
    const info = { quant: false, alt: alt.seqs.length > 1, nested: false };
    for (const seq of alt.seqs) {
      for (const item of seq) {
        if (item.quant) info.quant = true;
        if (item.kind === 'group') {
          info.nested = true;
          const sub = innerInfo(item.alt);
          info.quant = info.quant || sub.quant;
          info.alt = info.alt || sub.alt;
        }
      }
    }
    return info;
  };

  // `(a|b|c)+` is safe only when the alternatives are literals and none is a prefix of another.
  const prefixFreeLiterals = (alt) => {
    const words = [];
    for (const seq of alt.seqs) {
      if (seq.length === 0) return false;
      let word = '';
      for (const item of seq) {
        if (item.kind !== 'leaf' || item.lit === undefined || item.quant) return false;
        word += ignoreCase ? item.lit.toLowerCase() : item.lit;
      }
      words.push(word);
    }
    return words.every((a, ai) => words.every((b, bi) => ai === bi || !b.startsWith(a)));
  };

  const checkGroupQuant = (item, q) => {
    const info = innerInfo(item.alt);
    const unbounded = q.max === Infinity;
    if (info.quant) {
      const seq = item.alt.seqs[0];
      const last = seq && seq[seq.length - 1];
      let delimited = !info.alt && !info.nested && item.alt.seqs.length === 1 && q.max <= 5 && last
        && last.kind === 'leaf' && last.lit !== undefined && !last.quant;
      if (delimited) {
        // The repeated part must not be able to swallow the delimiter, otherwise iterations are ambiguous
        // ([0-9]+\.){3} is fine, (.*a){5} and ([a-z.]+\.){3} are not. `src` is our own generated, validated source.
        for (const leaf of seq.slice(0, -1)) {
          if (leaf.quant && new RegExp(`^(?:${leaf.src})$`, ignoreCase ? 'i' : '').test(last.lit)) delimited = false;
        }
      }
      if (!delimited) throw new PatternError();
    } else if (info.alt && unbounded && !prefixFreeLiterals(item.alt)) {
      throw new PatternError();
    }
  };

  const parseSeq = (depth) => {
    const items = [];
    while (p < tokens.length) {
      const tok = tokens[p];
      if (tok.k === 'alt') break;
      if (tok.k === 'rparen') {
        if (depth === 0) throw new PatternError('Unmatched ) or \\)');
        break;
      }
      p += 1;
      let item;
      if (tok.k === 'lparen') {
        const alt = parseAlt(depth + 1);
        if (!tokens[p] || tokens[p].k !== 'rparen') throw new PatternError('Unmatched ( or \\(');
        p += 1;
        item = { kind: 'group', alt, cap: !tok.nocap };
      } else if (tok.k === 'quant') {
        throw new PatternError();
      } else {
        item = { kind: 'leaf', src: tok.src, lit: tok.lit, anchor: tok.k === 'anchor' || tok.k === 'bol' };
      }
      while (p < tokens.length && tokens[p].k === 'quant') {
        const q = tokens[p];
        p += 1;
        if (item.quant || item.anchor) throw new PatternError(); // a** and ^* are nested quantifiers
        if (item.kind === 'group') checkGroupQuant(item, q);
        if (q.max === Infinity) stats.unbounded += 1;
        item.quant = q;
      }
      items.push(item);
    }
    return items;
  };

  function parseAlt(depth) {
    const seqs = [parseSeq(depth)];
    while (p < tokens.length && tokens[p].k === 'alt') {
      p += 1;
      seqs.push(parseSeq(depth));
    }
    return { seqs };
  }

  const tree = parseAlt(0);
  if (p < tokens.length) throw new PatternError('Unmatched ) or \\)');
  if (stats.unbounded > LIMITS.MAX_QUANTIFIERS) throw new PatternError();
  return { tree, stats };
}

// ---------------------------------------------------------------------------------------------------
// Code generation: the validated tree is compiled to a small program for the Pike VM below.
// ---------------------------------------------------------------------------------------------------
const OP = { CHAR: 0, SPLIT: 1, JMP: 2, SAVE: 3, ASSERT: 4, MATCH: 5 };
const ANCHOR_KIND = {
  '^': 'bol', $: 'eol', '\\b': 'wb', '\\B': 'nwb', [`\\b(?=[${WORD}])`]: 'wstart', [`\\b(?<=[${WORD}])`]: 'wend',
};

const isWordCode = (code) => (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;

function assertHolds(kind, text, pos) {
  const prev = pos > 0 && isWordCode(text.charCodeAt(pos - 1));
  const next = pos < text.length && isWordCode(text.charCodeAt(pos));
  switch (kind) {
    case 'bol': return pos === 0;
    case 'eol': return pos === text.length;
    case 'wb': return prev !== next;
    case 'nwb': return prev === next;
    case 'wstart': return prev !== next && next;
    case 'wend': return prev !== next && prev;
    case 'notprev': return !prev; // grep -w
    case 'notnext': return !next;
    default: return false;
  }
}

const canon = (code) => {
  const ch = String.fromCharCode(code);
  const up = ch.toUpperCase();
  return up.length === 1 && !(code >= 128 && up.charCodeAt(0) < 128) ? up.charCodeAt(0) : code;
};

// Returns a predicate over UTF-16 code units. Class sources are our own generated text (see lex), and the
// one-character regex built here cannot backtrack.
function atomTest(item, ignoreCase) {
  if (item.lit !== undefined) {
    const want = item.lit.charCodeAt(0);
    if (!ignoreCase) return (code) => code === want;
    const wantCanon = canon(want);
    return (code) => code === want || canon(code) === wantCanon;
  }
  if (item.src === '[^\\n]') return (code) => code !== 10;
  const single = new RegExp(`^(?:${item.src})$`, ignoreCase ? 'i' : '');
  const memo = new Int8Array(256).fill(-1);
  return (code) => {
    if (code < 256 && memo[code] !== -1) return memo[code] === 1;
    const result = single.test(String.fromCharCode(code));
    if (code < 256) memo[code] = result ? 1 : 0;
    return result;
  };
}

class Emitter {
  constructor(ignoreCase) {
    this.insts = [];
    this.ignoreCase = ignoreCase;
    this.nextGroup = 1;
  }

  push(inst) {
    if (this.insts.length >= LIMITS.MAX_PROGRAM) throw new PatternError();
    this.insts.push(inst);
    return this.insts.length - 1;
  }

  alt(alt) {
    const jumps = [];
    alt.seqs.forEach((seq, index) => {
      if (index < alt.seqs.length - 1) {
        const split = this.push({ op: OP.SPLIT, x: 0, y: 0 });
        this.insts[split].x = this.insts.length;
        this.seq(seq);
        jumps.push(this.push({ op: OP.JMP, x: 0 }));
        this.insts[split].y = this.insts.length;
      } else {
        this.seq(seq);
      }
    });
    for (const jump of jumps) this.insts[jump].x = this.insts.length;
  }

  seq(items) {
    for (const item of items) this.item(item);
  }

  body(item) {
    if (item.kind === 'group') {
      if (item.cap) {
        const slot = this.nextGroup * 2;
        this.nextGroup += 1;
        this.push({ op: OP.SAVE, n: slot });
        this.alt(item.alt);
        this.push({ op: OP.SAVE, n: slot + 1 });
      } else {
        this.alt(item.alt);
      }
    } else if (item.anchor) {
      this.push({ op: OP.ASSERT, kind: ANCHOR_KIND[item.src] });
    } else {
      this.push({ op: OP.CHAR, test: atomTest(item, this.ignoreCase) });
    }
  }

  item(item) {
    const q = item.quant;
    if (!q) { this.body(item); return; }
    const firstGroup = this.nextGroup;
    for (let i = 0; i < q.min; i += 1) {
      this.nextGroup = firstGroup; // every copy of a repeated group reports the same group number
      this.body(item);
    }
    const prefer = (split, here, out) => {
      this.insts[split].x = q.lazy ? out : here;
      this.insts[split].y = q.lazy ? here : out;
    };
    if (q.max === Infinity) {
      this.nextGroup = firstGroup;
      const split = this.push({ op: OP.SPLIT, x: 0, y: 0 });
      this.body(item);
      this.push({ op: OP.JMP, x: split });
      prefer(split, split + 1, this.insts.length);
    } else {
      const splits = [];
      for (let i = q.min; i < q.max; i += 1) {
        this.nextGroup = firstGroup;
        const split = this.push({ op: OP.SPLIT, x: 0, y: 0 });
        splits.push(split);
        this.body(item);
      }
      for (const split of splits) prefer(split, split + 1, this.insts.length);
    }
    this.nextGroup = firstGroup + countItemGroups(item);
  }
}

function countItemGroups(item) {
  if (item.kind !== 'group') return 0;
  let total = item.cap ? 1 : 0;
  for (const seq of item.alt.seqs) total += countGroups(seq);
  return total;
}

function countGroups(items) {
  return items.reduce((sum, item) => sum + countItemGroups(item), 0);
}

// ---------------------------------------------------------------------------------------------------
// Pike VM: simulates all threads in lock step, one input position at a time.
// ---------------------------------------------------------------------------------------------------
const meterStore = new AsyncLocalStorage();

// Runs `fn` with regex work charged to `tick` (the command line's Budget). 64 VM steps cost one work unit.
export function withRegexMeter(tick, fn) {
  return meterStore.run({ tick }, fn);
}

function run(prog, text, from, wantCaps) {
  const { insts, nslots } = prog;
  const n = text.length;
  const mark = new Int32Array(insts.length);
  let steps = 0;
  const meter = meterStore.getStore();
  const settle = () => { if (meter) meter.tick(Math.ceil(steps / LIMITS.REGEX_STEPS_PER_UNIT)); };

  const addThread = (listPc, listCaps, pc0, caps0, pos, stamp) => {
    const stackPc = [pc0];
    const stackCaps = [caps0];
    while (stackPc.length > 0) {
      let pc = stackPc.pop();
      let caps = stackCaps.pop();
      for (;;) {
        if (mark[pc] === stamp) break;
        mark[pc] = stamp;
        steps += 1;
        const ins = insts[pc];
        if (ins.op === OP.JMP) {
          pc = ins.x;
        } else if (ins.op === OP.SPLIT) {
          stackPc.push(ins.y);
          stackCaps.push(caps);
          pc = ins.x;
        } else if (ins.op === OP.SAVE) {
          if (caps) { caps = caps.slice(); caps[ins.n] = pos; steps += 2; }
          pc += 1;
        } else if (ins.op === OP.ASSERT) {
          if (!assertHolds(ins.kind, text, pos)) break;
          pc += 1;
        } else {
          listPc.push(pc);
          listCaps.push(caps);
          break;
        }
      }
    }
    if (steps > LIMITS.MAX_REGEX_STEPS) { settle(); throw new ResourceLimitError(); }
  };

  const blank = wantCaps ? new Array(nslots).fill(undefined) : null;
  let cPc = [];
  let cCaps = [];
  let found = null;
  for (let pos = from; pos <= n; pos += 1) {
    const stamp = pos - from + 1;
    if (found === null) {
      let start = null;
      if (wantCaps) { start = blank.slice(); start[0] = pos; }
      addThread(cPc, cCaps, 0, start, pos, stamp);
    }
    if (cPc.length === 0 && found !== null) break;
    const nPc = [];
    const nCaps = [];
    const code = pos < n ? text.charCodeAt(pos) : -1;
    for (let i = 0; i < cPc.length; i += 1) {
      const ins = insts[cPc[i]];
      if (ins.op === OP.MATCH) {
        if (!wantCaps) { settle(); return true; }
        found = cCaps[i].slice();
        found[1] = pos;
        break; // every thread after this one has lower priority
      }
      if (code >= 0 && ins.test(code)) addThread(nPc, nCaps, cPc[i] + 1, cCaps[i], pos + 1, stamp + 1);
    }
    cPc = nPc;
    cCaps = nCaps;
  }
  settle();
  return found === null ? (wantCaps ? null : false) : found;
}

// Minimal RegExp look-alike: `test`, `exec`, `lastIndex`, and the `global` flag semantics callers rely on.
class SafeRegExp {
  constructor(prog, global) {
    this.prog = prog;
    this.global = global;
    this.lastIndex = 0;
  }

  test(text) {
    return run(this.prog, String(text), 0, false) === true;
  }

  exec(input) {
    const text = String(input);
    const from = this.global ? this.lastIndex : 0;
    if (from > text.length) { this.lastIndex = 0; return null; }
    const caps = run(this.prog, text, from, true);
    if (caps === null) { this.lastIndex = 0; return null; }
    const match = [text.slice(caps[0], caps[1])];
    for (let g = 1; g < this.prog.nslots / 2; g += 1) {
      const s = caps[2 * g];
      const e = caps[2 * g + 1];
      match.push(s !== undefined && e !== undefined ? text.slice(s, e) : undefined);
    }
    match.index = caps[0];
    match.input = text;
    if (this.global) this.lastIndex = caps[1];
    return match;
  }
}

function translate(pattern, flavor, ignoreCase) {
  const { tree } = parseTree(lex(pattern, flavor), ignoreCase);
  return tree;
}

// patterns: string | string[]. Options: flavor 'bre' | 'ere' | 'pcre', fixed, ignoreCase, word, line.
// Returns { re, prog, groups }.
export function compilePattern(patterns, {
  flavor = 'bre', fixed = false, ignoreCase = false, word = false, line = false,
} = {}) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  if (list.length > 20) throw new PatternError();
  const trees = [];
  for (const pattern of list) {
    if (pattern.length > LIMITS.MAX_PATTERN) throw new PatternError();
    if (fixed) {
      const seq = Array.from(pattern).map((ch) => ({ kind: 'leaf', src: escapeLiteral(ch), lit: ch, anchor: false }));
      trees.push({ seqs: [seq] });
    } else {
      trees.push(translate(pattern, flavor, ignoreCase));
    }
  }
  const emitter = new Emitter(ignoreCase);
  const assertion = (kind) => emitter.push({ op: OP.ASSERT, kind });
  if (line) assertion('bol');
  else if (word) assertion('notprev');
  const merged = { seqs: trees.map((tree) => [{ kind: 'group', alt: tree, cap: false }]) };
  emitter.alt(trees.length === 1 ? trees[0] : merged);
  if (line) assertion('eol');
  else if (word) assertion('notnext');
  emitter.push({ op: OP.MATCH });
  const groups = trees.reduce((sum, tree) => sum + tree.seqs.reduce((s, seq) => s + countGroups(seq), 0), 0);
  const prog = { insts: emitter.insts, nslots: (groups + 1) * 2 };
  return { re: new SafeRegExp(prog, false), prog, groups };
}

// A fresh global matcher for iteration (grep -o, sed s///g, awk gsub).
export function globalRegExp(compiled) {
  return new SafeRegExp(compiled.prog, true);
}

export function matchesLine(compiled, text) {
  return compiled.re.test(text);
}
