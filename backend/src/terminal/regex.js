// Safe regular expressions for grep / sed / awk / find. See docs/TERMINAL_GAME.md section 6.
// User text is never handed to `new RegExp` directly: it is lexed and parsed here, rejected when it
// is too long, uses backreferences, lookarounds or nested quantifiers, and only then translated to a
// JavaScript source string that we generated ourselves.
import { LIMITS } from './limits.js';

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
  const stats = { unbounded: 0, risky: false, groups: 0 };

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
      stats.risky = true; // e.g. ([0-9]+\.){3}: allowed, but subjects are clipped
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
        if (item.cap) stats.groups += 1;
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

function quantSource(q) {
  let src;
  if (q.min === 0 && q.max === Infinity) src = '*';
  else if (q.min === 1 && q.max === Infinity) src = '+';
  else if (q.min === 0 && q.max === 1) src = '?';
  else if (q.max === Infinity) src = `{${q.min},}`;
  else if (q.min === q.max) src = `{${q.min}}`;
  else src = `{${q.min},${q.max}}`;
  return q.lazy ? `${src}?` : src;
}

function emitAlt(alt) {
  return alt.seqs.map((seq) => seq.map(emitItem).join('')).join('|');
}

function emitItem(item) {
  let src = item.kind === 'group' ? `(${item.cap ? '' : '?:'}${emitAlt(item.alt)})` : item.src;
  if (item.quant) src += quantSource(item.quant);
  return src;
}

function translate(pattern, flavor, ignoreCase) {
  const { tree, stats } = parseTree(lex(pattern, flavor), ignoreCase);
  return { src: emitAlt(tree), groups: stats.groups, risky: stats.risky };
}

// patterns: string | string[]. Options: flavor 'bre' | 'ere' | 'pcre', fixed, ignoreCase, word, line.
// Returns { re, source, flags, groups, risky }.
export function compilePattern(patterns, {
  flavor = 'bre', fixed = false, ignoreCase = false, word = false, line = false,
} = {}) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  if (list.length > 20) throw new PatternError();
  const parts = [];
  let groups = 0;
  let risky = false;
  for (const pattern of list) {
    if (pattern.length > LIMITS.MAX_PATTERN) throw new PatternError();
    if (fixed) {
      parts.push(Array.from(pattern).map(escapeLiteral).join(''));
    } else {
      const result = translate(pattern, flavor, ignoreCase);
      parts.push(result.src);
      groups += result.groups;
      risky = risky || result.risky;
    }
  }
  let body = parts.length === 1 ? parts[0] : parts.map((part) => `(?:${part})`).join('|');
  if (line) body = `^(?:${body})$`;
  else if (word) body = `(?<![${WORD}])(?:${body})(?![${WORD}])`;
  const flags = ignoreCase ? 'i' : '';
  let re;
  try {
    re = new RegExp(body, flags);
  } catch {
    throw new PatternError();
  }
  return { re, source: body, flags, groups, risky };
}

// A fresh global RegExp for iteration (grep -o, sed s///g, awk gsub).
export function globalRegExp(compiled) {
  return new RegExp(compiled.source, `${compiled.flags}g`);
}

export function matchesLine(compiled, text) {
  const subject = compiled.risky && text.length > LIMITS.MAX_MATCH_SUBJECT ? text.slice(0, LIMITS.MAX_MATCH_SUBJECT) : text;
  return compiled.re.test(subject);
}
