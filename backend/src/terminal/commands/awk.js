// `awk`: a small but real interpreter (no eval, no I/O besides stdout). Supports BEGIN/END, patterns, ranges,
// fields and NF/NR/FS/OFS, arrays, if/while/for/do, printf/sprintf, and the usual string/number built-ins.
import { LIMITS, ResourceLimitError } from '../limits.js';
import { PatternError, compilePattern, globalRegExp, matchesLine } from '../regex.js';
import { cmpBytes } from '../vfs.js';
import {
  asText, forEachInput, parseArgs, splitLines, usageError,
} from './util.js';

class AwkError extends Error {}

const KEYWORDS = new Set(['BEGIN', 'END', 'if', 'else', 'while', 'for', 'do', 'break', 'continue', 'next', 'exit', 'print', 'printf', 'delete', 'in', 'function', 'return', 'getline']);
const BUILTINS = new Set(['length', 'substr', 'index', 'split', 'sub', 'gsub', 'match', 'sprintf', 'sin', 'cos', 'atan2', 'exp', 'log', 'sqrt', 'int', 'rand', 'srand', 'tolower', 'toupper', 'system', 'close', 'fflush']);
const MAX_STRING = 1 << 20;

// ---------------------------------------------------------------- values

class StrNum { constructor(s) { this.s = s; } }
const UNINIT = new StrNum('');
const NUMERIC = /^[ \t\n]*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?[ \t\n]*$/;
const NUMERIC_PREFIX = /^[ \t\n]*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/;

const looksNumeric = (s) => NUMERIC.test(s);
function toNum(v) {
  if (typeof v === 'number') return v;
  const s = typeof v === 'string' ? v : v.s;
  const m = NUMERIC_PREFIX.exec(s);
  return m ? Number(m[0]) : 0;
}

function fmtG(n, precision = 6) {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'nan' : n < 0 ? '-inf' : 'inf';
  if (n === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(n)));
  if (exp < -5 || exp >= precision) {
    const parts = n.toExponential(Math.max(0, precision - 1)).split('e');
    const mantissa = parts[0].includes('.') ? parts[0].replace(/0+$/, '').replace(/\.$/, '') : parts[0];
    const sign = parts[1][0];
    const digits = parts[1].slice(1).padStart(2, '0');
    return `${mantissa}e${sign}${digits}`;
  }
  const fixed = n.toFixed(Math.max(0, precision - 1 - exp));
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

function toStr(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1e16 ? String(v) : fmtG(v);
  return v.s;
}

const isNumericValue = (v) => (typeof v === 'number' ? true : typeof v === 'string' ? false : v === UNINIT || looksNumeric(v.s));
function truthy(v) {
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  return looksNumeric(v.s) ? toNum(v) !== 0 : v.s !== '';
}

function compareValues(a, b) {
  if (isNumericValue(a) && isNumericValue(b)) {
    const x = toNum(a);
    const y = toNum(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return cmpBytes(toStr(a), toStr(b));
}

// ---------------------------------------------------------------- lexer

function lex(src) {
  const toks = [];
  let i = 0;
  const regexAllowed = () => {
    const prev = toks[toks.length - 1];
    if (!prev) return true;
    if (prev.t === 'num' || prev.t === 'str' || prev.t === 'name' || prev.t === 're') return false;
    if (prev.t === 'builtin') return false;
    if (prev.t === 'op' && (prev.v === ')' || prev.v === ']' || prev.v === '$' || prev.v === '++' || prev.v === '--')) return false;
    return true;
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\r') { i += 1; continue; }
    if (ch === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (ch === '\n') { toks.push({ t: 'nl' }); i += 1; continue; }
    if (ch === '#') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (ch === '"') {
      let s = '';
      i += 1;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          const n = src[i + 1];
          const simple = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', '/': '/' };
          if (Object.hasOwn(simple, n)) { s += simple[n]; i += 2; continue; }
          const oct = /^[0-7]{1,3}/.exec(src.slice(i + 1));
          if (oct) { s += String.fromCharCode(parseInt(oct[0], 8)); i += 1 + oct[0].length; continue; }
          s += `\\${n}`;
          i += 2;
          continue;
        }
        if (src[i] === '\n') throw new AwkError('non-terminated string');
        s += src[i];
        i += 1;
      }
      if (i >= src.length) throw new AwkError('non-terminated string');
      i += 1;
      toks.push({ t: 'str', v: s });
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      let s = '';
      i += 1;
      while (i < src.length && src[i] !== '/') {
        if (src[i] === '\n') throw new AwkError('non-terminated regular expression');
        if (src[i] === '\\' && src[i + 1] === '/') { s += '/'; i += 2; continue; }
        if (src[i] === '\\' && i + 1 < src.length) { s += src[i] + src[i + 1]; i += 2; continue; }
        if (src[i] === '[') { // a / inside [...] does not end the regex
          const close = src.indexOf(']', i + 2);
          if (close > 0 && !src.slice(i, close).includes('\n')) { s += src.slice(i, close + 1); i = close + 1; continue; }
        }
        s += src[i];
        i += 1;
      }
      if (i >= src.length) throw new AwkError('non-terminated regular expression');
      i += 1;
      toks.push({ t: 're', v: s });
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i));
    if (num) { toks.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (name) {
      const word = name[0];
      i += word.length;
      if (KEYWORDS.has(word)) toks.push({ t: 'kw', v: word });
      else if (BUILTINS.has(word)) toks.push({ t: 'builtin', v: word });
      else toks.push({ t: 'name', v: word, call: src[i] === '(' });
      continue;
    }
    const ops = ['**=', '&&', '||', '==', '!=', '<=', '>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '^=', '!~', '>>', '**'];
    const op = ops.find((candidate) => src.startsWith(candidate, i));
    if (op) { toks.push({ t: 'op', v: op === '**' ? '^' : op === '**=' ? '^=' : op }); i += op.length; continue; }
    if ('{}()[];,+-*/%^!><|?:~$='.includes(ch)) { toks.push({ t: 'op', v: ch }); i += 1; continue; }
    throw new AwkError(`syntax error at source line 1: unexpected character '${ch}'`);
  }
  toks.push({ t: 'eof' });
  return toks;
}

// ---------------------------------------------------------------- parser

class Parser {
  constructor(tokens) { this.toks = tokens; this.p = 0; }

  peek() { return this.toks[this.p]; }
  next() { const tok = this.toks[this.p]; this.p += 1; return tok; }
  isOp(v) { const t = this.peek(); return t.t === 'op' && t.v === v; }
  isKw(v) { const t = this.peek(); return t.t === 'kw' && t.v === v; }
  fail(message) { throw new AwkError(message ?? 'syntax error'); }
  expectOp(v) { if (!this.isOp(v)) this.fail(`syntax error: expected '${v}'`); this.p += 1; }
  skipNl() { while (this.peek().t === 'nl') this.p += 1; }
  skipTerms() { while (this.peek().t === 'nl' || this.isOp(';')) this.p += 1; }

  parseProgram() {
    const items = [];
    this.skipTerms();
    while (this.peek().t !== 'eof') {
      items.push(this.parseItem());
      this.skipTerms();
    }
    return items;
  }

  parseItem() {
    if (this.isKw('function')) this.fail('user-defined functions are not supported in this sandbox');
    if (this.isKw('BEGIN') || this.isKw('END')) {
      const kind = this.next().v.toLowerCase();
      this.skipNl();
      return { kind, body: this.parseBlock() };
    }
    if (this.isOp('{')) return { kind: 'rule', pattern: null, body: this.parseBlock() };
    const pattern = this.parseExpr();
    let pattern2 = null;
    if (this.isOp(',')) { this.next(); this.skipNl(); pattern2 = this.parseExpr(); }
    const body = this.isOp('{') ? this.parseBlock() : null;
    return { kind: 'rule', pattern, pattern2, body, active: false };
  }

  parseBlock() {
    this.expectOp('{');
    const stmts = [];
    this.skipTerms();
    while (!this.isOp('}')) {
      if (this.peek().t === 'eof') this.fail('syntax error: missing }');
      stmts.push(this.parseStatement());
      this.skipTerms();
    }
    this.next();
    return { type: 'block', stmts };
  }

  endSimple() {
    const t = this.peek();
    if (t.t === 'nl' || t.t === 'eof' || (t.t === 'op' && (t.v === ';' || t.v === '}'))) return;
    this.fail('syntax error');
  }

  parseSimpleOrBlock() {
    this.skipNl();
    if (this.isOp(';')) { this.next(); return { type: 'block', stmts: [] }; }
    return this.parseStatement();
  }

  parseStatement() {
    const t = this.peek();
    if (t.t === 'op' && t.v === '{') return this.parseBlock();
    if (t.t === 'kw') {
      switch (t.v) {
        case 'if': {
          this.next();
          this.expectOp('(');
          const cond = this.parseExpr();
          this.expectOp(')');
          const then = this.parseSimpleOrBlock();
          const save = this.p;
          this.skipTerms();
          if (this.isKw('else')) { this.next(); return { type: 'if', cond, then, orelse: this.parseSimpleOrBlock() }; }
          this.p = save;
          return { type: 'if', cond, then, orelse: null };
        }
        case 'while': {
          this.next();
          this.expectOp('(');
          const cond = this.parseExpr();
          this.expectOp(')');
          if (this.isOp(';')) { this.next(); return { type: 'while', cond, body: { type: 'block', stmts: [] } }; }
          return { type: 'while', cond, body: this.parseSimpleOrBlock() };
        }
        case 'do': {
          this.next();
          const body = this.parseSimpleOrBlock();
          this.skipTerms();
          if (!this.isKw('while')) this.fail('syntax error: expected while');
          this.next();
          this.expectOp('(');
          const cond = this.parseExpr();
          this.expectOp(')');
          return { type: 'do', cond, body };
        }
        case 'for': return this.parseFor();
        case 'print': case 'printf': return this.parsePrint();
        case 'next': this.next(); this.endSimple(); return { type: 'next' };
        case 'break': this.next(); this.endSimple(); return { type: 'break' };
        case 'continue': this.next(); this.endSimple(); return { type: 'continue' };
        case 'exit': {
          this.next();
          let code = null;
          const n = this.peek();
          if (!(n.t === 'nl' || n.t === 'eof' || (n.t === 'op' && (n.v === ';' || n.v === '}')))) code = this.parseExpr();
          this.endSimple();
          return { type: 'exit', code };
        }
        case 'delete': {
          this.next();
          const name = this.next();
          if (name.t !== 'name') this.fail('syntax error');
          let subs = null;
          if (this.isOp('[')) { this.next(); subs = this.parseExprList(']'); this.expectOp(']'); }
          this.endSimple();
          return { type: 'delete', name: name.v, subs };
        }
        case 'getline': this.fail('getline is not supported in this sandbox'); break;
        case 'return': this.fail('return outside a function'); break;
        default: break;
      }
    }
    const expr = this.parseExpr();
    this.endSimple();
    return { type: 'expr', expr };
  }

  parseFor() {
    this.next();
    this.expectOp('(');
    const a = this.toks[this.p];
    const b = this.toks[this.p + 1];
    const c = this.toks[this.p + 2];
    const d = this.toks[this.p + 3];
    if (a.t === 'name' && b.t === 'kw' && b.v === 'in' && c.t === 'name' && d.t === 'op' && d.v === ')') {
      this.p += 4;
      return { type: 'forin', variable: a.v, array: c.v, body: this.parseSimpleOrBlock() };
    }
    let init = null;
    if (!this.isOp(';')) init = { type: 'expr', expr: this.parseExpr() };
    this.expectOp(';');
    this.skipNl();
    let cond = null;
    if (!this.isOp(';')) cond = this.parseExpr();
    this.expectOp(';');
    this.skipNl();
    let step = null;
    if (!this.isOp(')')) step = { type: 'expr', expr: this.parseExpr() };
    this.expectOp(')');
    if (this.isOp(';')) { this.next(); return { type: 'for', init, cond, step, body: { type: 'block', stmts: [] } }; }
    return { type: 'for', init, cond, step, body: this.parseSimpleOrBlock() };
  }

  parsePrint() {
    const kind = this.next().v;
    const isEnd = () => {
      const t = this.peek();
      return t.t === 'nl' || t.t === 'eof' || (t.t === 'op' && (t.v === ';' || t.v === '}'));
    };
    let args = [];
    if (!isEnd()) {
      if (this.isOp('(')) {
        const save = this.p;
        this.next();
        const list = this.parseExprList(')', true);
        if (this.isOp(')')) {
          this.next();
          if (isEnd()) args = list;
          else this.p = save;
        } else this.p = save;
      }
      if (args.length === 0 && this.p !== undefined && !isEnd()) args = this.parseExprList(null, true);
    }
    if (this.isOp('>') || this.isOp('>>') || this.isOp('|')) this.fail('output redirection is not supported in this sandbox');
    this.endSimple();
    return { type: kind, args };
  }

  parseExprList(closer, noGt = false) {
    const list = [];
    this.skipNl();
    if (closer && this.isOp(closer)) return list;
    list.push(this.parseExpr(noGt));
    while (this.isOp(',')) { this.next(); this.skipNl(); list.push(this.parseExpr(noGt)); }
    return list;
  }

  isLvalue(node) { return node.type === 'var' || node.type === 'field' || node.type === 'index'; }

  parseExpr(noGt = false) {
    const left = this.parseTernary(noGt);
    const t = this.peek();
    if (t.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '^='].includes(t.v) && this.isLvalue(left)) {
      this.next();
      this.skipNl();
      return { type: 'assign', op: t.v, target: left, value: this.parseExpr(noGt) };
    }
    return left;
  }

  parseTernary(noGt) {
    const cond = this.parseOr(noGt);
    if (this.isOp('?')) {
      this.next();
      this.skipNl();
      const a = this.parseExpr(noGt);
      this.skipNl();
      this.expectOp(':');
      this.skipNl();
      const b = this.parseExpr(noGt);
      return { type: 'cond', cond, a, b };
    }
    return cond;
  }

  parseOr(noGt) {
    let left = this.parseAnd(noGt);
    while (this.isOp('||')) { this.next(); this.skipNl(); left = { type: 'or', a: left, b: this.parseAnd(noGt) }; }
    return left;
  }

  parseAnd(noGt) {
    let left = this.parseIn(noGt);
    while (this.isOp('&&')) { this.next(); this.skipNl(); left = { type: 'and', a: left, b: this.parseIn(noGt) }; }
    return left;
  }

  parseIn(noGt) {
    let left = this.parseMatch(noGt);
    while (this.isKw('in')) {
      this.next();
      const name = this.next();
      if (name.t !== 'name') this.fail('syntax error');
      left = { type: 'in', key: left, array: name.v };
    }
    return left;
  }

  parseMatch(noGt) {
    let left = this.parseCompare(noGt);
    while (this.isOp('~') || this.isOp('!~')) {
      const negate = this.next().v === '!~';
      left = { type: 'match', negate, subject: left, pattern: this.parseCompare(noGt) };
    }
    return left;
  }

  parseCompare(noGt) {
    const left = this.parseConcat(noGt);
    const t = this.peek();
    if (t.t === 'op' && ['<', '<=', '==', '!=', '>=', '>'].includes(t.v) && !(noGt && t.v === '>')) {
      this.next();
      return { type: 'cmp', op: t.v, a: left, b: this.parseConcat(noGt) };
    }
    return left;
  }

  startsOperand() {
    const t = this.peek();
    if (t.t === 'num' || t.t === 'str' || t.t === 'builtin') return true;
    if (t.t === 'name') return true;
    if (t.t === 'op') return ['$', '(', '!', '++', '--'].includes(t.v) && t.v !== '!';
    return false;
  }

  parseConcat(noGt) {
    let left = this.parseAdditive();
    while (this.startsOperand()) left = { type: 'concat', a: left, b: this.parseAdditive() };
    return left;
  }

  parseAdditive() {
    let left = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().v;
      left = { type: 'bin', op, a: left, b: this.parseMul() };
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = this.next().v;
      left = { type: 'bin', op, a: left, b: this.parseUnary() };
    }
    return left;
  }

  parseUnary() {
    if (this.isOp('!')) { this.next(); return { type: 'not', a: this.parseUnary() }; }
    if (this.isOp('-')) { this.next(); return { type: 'neg', a: this.parseUnary() }; }
    if (this.isOp('+')) { this.next(); return { type: 'pos', a: this.parseUnary() }; }
    return this.parsePow();
  }

  parsePow() {
    const base = this.parsePostfix();
    if (this.isOp('^')) { this.next(); return { type: 'bin', op: '^', a: base, b: this.parseUnary() }; }
    return base;
  }

  parsePostfix() {
    const node = this.parsePrimary();
    if (this.isLvalue(node) && (this.isOp('++') || this.isOp('--'))) {
      return { type: 'postinc', delta: this.next().v === '++' ? 1 : -1, target: node };
    }
    return node;
  }

  parsePrimary() {
    const t = this.next();
    switch (t.t) {
      case 'num': return { type: 'num', v: t.v };
      case 'str': return { type: 'str', v: t.v };
      case 're': return { type: 'regex', source: t.v, compiled: compileAwk(t.v) };
      case 'builtin': return this.parseBuiltin(t.v);
      case 'name':
        if (t.call) this.fail('user-defined functions are not supported in this sandbox');
        if (this.isOp('[')) {
          this.next();
          const subs = this.parseExprList(']');
          this.expectOp(']');
          return { type: 'index', name: t.v, subs };
        }
        return { type: 'var', name: t.v };
      case 'kw':
        if (t.v === 'getline') this.fail('getline is not supported in this sandbox');
        break;
      case 'op':
        if (t.v === '(') {
          this.skipNl();
          const inner = this.parseExpr();
          this.skipNl();
          this.expectOp(')');
          return { type: 'group', a: inner };
        }
        if (t.v === '$') return { type: 'field', index: this.parseFieldIndex() };
        if (t.v === '++' || t.v === '--') {
          const target = this.parsePrimary();
          if (!this.isLvalue(target)) this.fail('syntax error');
          return { type: 'preinc', delta: t.v === '++' ? 1 : -1, target };
        }
        break;
      default: break;
    }
    return this.fail('syntax error');
  }

  parseFieldIndex() {
    if (this.isOp('++') || this.isOp('--')) return this.parsePrimary();
    if (this.isOp('-')) { this.next(); return { type: 'neg', a: this.parseFieldIndex() }; }
    return this.parsePrimary();
  }

  parseBuiltin(name) {
    if (name === 'system' || name === 'close' || name === 'fflush') {
      if (name !== 'system') { if (this.isOp('(')) { this.next(); this.parseExprList(')'); this.expectOp(')'); } return { type: 'num', v: 0 }; }
      return this.fail('system() is not available in this sandbox');
    }
    if (!this.isOp('(')) {
      if (name === 'length') return { type: 'call', name, args: [] };
      return this.fail('syntax error');
    }
    this.next();
    const args = this.parseExprList(')');
    this.expectOp(')');
    return { type: 'call', name, args };
  }
}

const regexCache = new Map();
function compileAwk(source) {
  if (regexCache.has(source)) return regexCache.get(source);
  let compiled;
  try {
    compiled = compilePattern(source, { flavor: 'ere' });
  } catch (error) {
    if (error instanceof PatternError) throw new AwkError(`${error.message}: /${source}/`);
    throw error;
  }
  if (regexCache.size > 100) regexCache.clear();
  regexCache.set(source, compiled);
  return compiled;
}

// ---------------------------------------------------------------- formatting

function sprintfAwk(format, args) {
  let out = '';
  let index = 0;
  const nextArg = () => (index < args.length ? args[index++] : UNINIT);
  for (let i = 0; i < format.length; i += 1) {
    const ch = format[i];
    if (ch !== '%') { out += ch; continue; }
    const m = /^%([-+ 0#]*)(\d*|\*)(?:\.(\d*|\*))?([a-zA-Z%])/.exec(format.slice(i));
    if (!m) { out += ch; continue; }
    i += m[0].length - 1;
    const [, flags, widthSpec, precSpec, conv] = m;
    let width = widthSpec === '*' ? toNum(nextArg()) : Number(widthSpec || 0);
    const precision = precSpec === undefined ? undefined : precSpec === '*' ? toNum(nextArg()) : Number(precSpec || 0);
    let left = flags.includes('-');
    if (width < 0) { left = true; width = -width; }
    const zero = flags.includes('0') && !left;
    const pad = (text, numeric) => {
      if (text.length >= width) return text;
      if (left) return text.padEnd(width);
      if (zero && numeric) { const sign = /^[-+ ]/.test(text) ? text[0] : ''; return sign + text.slice(sign.length).padStart(width - sign.length, '0'); }
      return text.padStart(width);
    };
    const sign = (n, text) => (n >= 0 ? (flags.includes('+') ? `+${text}` : flags.includes(' ') ? ` ${text}` : text) : text);
    switch (conv) {
      case '%': out += '%'; break;
      case 's': { let s = toStr(nextArg()); if (precision !== undefined) s = s.slice(0, precision); out += pad(s, false); break; }
      case 'c': { const v = nextArg(); out += pad(typeof v === 'number' ? String.fromCharCode(v) : toStr(v).slice(0, 1), false); break; }
      case 'd': case 'i': { const n = Math.trunc(toNum(nextArg())); out += pad(sign(n, String(n)), true); break; }
      case 'u': { out += pad(String(Math.abs(Math.trunc(toNum(nextArg())))), true); break; }
      case 'o': case 'x': case 'X': {
        const n = Math.trunc(toNum(nextArg()));
        let text = (n < 0 ? BigInt(n) + (1n << 64n) : BigInt(n)).toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') text = text.toUpperCase();
        out += pad(text, true);
        break;
      }
      case 'f': case 'F': { const n = toNum(nextArg()); out += pad(sign(n, n.toFixed(precision ?? 6)), true); break; }
      case 'e': case 'E': { const n = toNum(nextArg()); let t = n.toExponential(precision ?? 6).replace(/e([-+])(\d)$/, 'e$10$2'); if (conv === 'E') t = t.toUpperCase(); out += pad(sign(n, t), true); break; }
      case 'g': case 'G': { const n = toNum(nextArg()); out += pad(sign(n, fmtG(n, precision === 0 ? 1 : precision ?? 6)), true); break; }
      default: out += m[0];
    }
  }
  return out;
}

// ---------------------------------------------------------------- interpreter

const BREAK = 1;
const CONTINUE = 2;
const NEXT = 3;
const EXIT = 4;

class Interp {
  constructor(c, items, { fs, assigns }) {
    this.c = c;
    this.items = items;
    this.vars = new Map([['FS', fs], ['OFS', ' '], ['ORS', '\n'], ['RS', '\n'], ['NR', 0], ['FNR', 0], ['NF', 0], ['FILENAME', ''], ['SUBSEP', '\x1c'], ['RSTART', 0], ['RLENGTH', -1]]);
    for (const [name, value] of assigns) this.vars.set(name, new StrNum(value));
    this.arrays = new Map();
    this.record = '';
    this.fields = null;
    this.out = [];
    this.outSize = 0;
    this.steps = 0;
    this.exitCode = 0;
    this.randState = 1;
  }

  tickStep() {
    this.steps += 1;
    if ((this.steps & 3) === 0) this.c.rc.tick(1);
  }

  emit(text) {
    this.outSize += text.length;
    if (this.outSize > LIMITS.MAX_STREAM) throw new ResourceLimitError();
    this.out.push(text);
  }

  getArray(name) {
    let arr = this.arrays.get(name);
    if (!arr) { arr = new Map(); this.arrays.set(name, arr); }
    return arr;
  }

  subscript(subs) { return subs.map((node) => toStr(this.evalExpr(node))).join(toStr(this.vars.get('SUBSEP'))); }

  // ---- fields

  setRecord(text) { this.record = text; this.fields = null; }

  splitRecord(text) {
    const fs = toStr(this.vars.get('FS'));
    if (text === '') return [];
    if (fs === ' ') {
      const trimmed = text.replace(/^[ \t\n]+|[ \t\n]+$/g, '');
      return trimmed === '' ? [] : trimmed.split(/[ \t\n]+/);
    }
    if (fs === '') return Array.from(text);
    if (fs.length === 1 && fs !== '\\') return text.split(fs);
    return this.regexSplit(text, compileAwk(fs));
  }

  regexSplit(text, compiled) {
    const parts = [];
    const re = globalRegExp(compiled);
    let last = 0;
    let match = re.exec(text);
    while (match) {
      if (match[0] === '') { re.lastIndex += 1; match = re.exec(text); continue; }
      parts.push(text.slice(last, match.index));
      last = match.index + match[0].length;
      match = re.exec(text);
    }
    parts.push(text.slice(last));
    return parts;
  }

  ensureFields() {
    if (this.fields === null) {
      this.fields = this.splitRecord(this.record).map((s) => new StrNum(s));
      this.vars.set('NF', this.fields.length);
    }
  }

  getField(n) {
    if (n === 0) return new StrNum(this.record);
    if (n < 0 || !Number.isFinite(n)) throw new AwkError(`attempt to access field ${n}`);
    this.ensureFields();
    return n <= this.fields.length ? this.fields[n - 1] : UNINIT;
  }

  setField(n, value) {
    if (n === 0) { this.setRecord(toStr(value)); return; }
    if (n < 0 || n > 10000) throw new AwkError(`attempt to access field ${n}`);
    this.ensureFields();
    while (this.fields.length < n) this.fields.push(new StrNum(''));
    this.fields[n - 1] = new StrNum(toStr(value));
    this.vars.set('NF', this.fields.length);
    this.record = this.fields.map((f) => f.s).join(toStr(this.vars.get('OFS')));
  }

  // ---- variables

  getVar(name) {
    if (name === 'NF') { this.ensureFields(); return this.fields.length; }
    return this.vars.has(name) ? this.vars.get(name) : UNINIT;
  }

  setVar(name, value) {
    if (name === 'NF') {
      this.ensureFields();
      const n = Math.max(0, Math.min(10000, Math.trunc(toNum(value))));
      while (this.fields.length < n) this.fields.push(new StrNum(''));
      this.fields.length = n;
      this.vars.set('NF', n);
      this.record = this.fields.map((f) => f.s).join(toStr(this.vars.get('OFS')));
      return;
    }
    this.vars.set(name, value);
  }

  assign(target, value) {
    if (target.type === 'var') this.setVar(target.name, value);
    else if (target.type === 'field') this.setField(Math.trunc(toNum(this.evalExpr(target.index))), value);
    else this.getArray(target.name).set(this.subscript(target.subs), value);
  }

  // ---- evaluation

  evalExpr(node) {
    switch (node.type) {
      case 'num': return node.v;
      case 'str': return node.v;
      case 'group': return this.evalExpr(node.a);
      case 'regex': return matchesLine(node.compiled, this.record) ? 1 : 0;
      case 'var': return this.getVar(node.name);
      case 'field': return this.getField(Math.trunc(toNum(this.evalExpr(node.index))));
      case 'index': {
        const arr = this.getArray(node.name);
        const key = this.subscript(node.subs);
        if (!arr.has(key)) arr.set(key, UNINIT);
        return arr.get(key);
      }
      case 'assign': {
        let value = this.evalExpr(node.value);
        if (node.op !== '=') {
          const current = toNum(this.evalExpr(node.target));
          const rhs = toNum(value);
          value = this.arith(node.op[0], current, rhs);
        }
        if (typeof value === 'string' && value.length > MAX_STRING) throw new ResourceLimitError();
        this.assign(node.target, value);
        return value;
      }
      case 'cond': return truthy(this.evalExpr(node.cond)) ? this.evalExpr(node.a) : this.evalExpr(node.b);
      case 'or': return truthy(this.evalExpr(node.a)) || truthy(this.evalExpr(node.b)) ? 1 : 0;
      case 'and': return truthy(this.evalExpr(node.a)) && truthy(this.evalExpr(node.b)) ? 1 : 0;
      case 'not': return truthy(this.evalExpr(node.a)) ? 0 : 1;
      case 'neg': return -toNum(this.evalExpr(node.a));
      case 'pos': return toNum(this.evalExpr(node.a));
      case 'in': return this.getArray(node.array).has(toStr(this.evalExpr(node.key))) ? 1 : 0;
      case 'match': {
        const subject = toStr(this.evalExpr(node.subject));
        const compiled = node.pattern.type === 'regex' ? node.pattern.compiled : compileAwk(toStr(this.evalExpr(node.pattern)));
        return matchesLine(compiled, subject) !== node.negate ? 1 : 0;
      }
      case 'cmp': {
        const r = compareValues(this.evalExpr(node.a), this.evalExpr(node.b));
        return ({ '<': r < 0, '<=': r <= 0, '==': r === 0, '!=': r !== 0, '>=': r >= 0, '>': r > 0 })[node.op] ? 1 : 0;
      }
      case 'concat': {
        const s = toStr(this.evalExpr(node.a)) + toStr(this.evalExpr(node.b));
        if (s.length > MAX_STRING) throw new ResourceLimitError();
        return s;
      }
      case 'bin': return this.arith(node.op, toNum(this.evalExpr(node.a)), toNum(this.evalExpr(node.b)));
      case 'preinc': { const v = toNum(this.evalExpr(node.target)) + node.delta; this.assign(node.target, v); return v; }
      case 'postinc': { const old = toNum(this.evalExpr(node.target)); this.assign(node.target, old + node.delta); return old; }
      case 'call': return this.call(node);
      default: throw new AwkError('syntax error');
    }
  }

  arith(op, a, b) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': if (b === 0) throw new AwkError('division by zero'); return a / b;
      case '%': if (b === 0) throw new AwkError('division by zero in %'); return a % b;
      case '^': return a ** b;
      default: throw new AwkError('syntax error');
    }
  }

  regexArg(node) {
    return node.type === 'regex' ? node.compiled : compileAwk(toStr(this.evalExpr(node)));
  }

  call(node) {
    const { name, args } = node;
    const arg = (n) => this.evalExpr(args[n]);
    const need = (min, max) => { if (args.length < min || args.length > max) throw new AwkError(`wrong number of arguments to ${name}`); };
    switch (name) {
      case 'length': {
        if (args.length === 0) return Array.from(this.record).length;
        if (args[0].type === 'var' && this.arrays.has(args[0].name)) return this.arrays.get(args[0].name).size;
        return Array.from(toStr(arg(0))).length;
      }
      case 'substr': {
        need(2, 3);
        const s = toStr(arg(0));
        const m = Math.round(toNum(arg(1)));
        const len = args.length === 3 ? Math.round(toNum(arg(2))) : Infinity;
        const start = Math.max(m, 1);
        const end = Number.isFinite(len) ? m + len : Infinity;
        return end <= start ? '' : s.slice(start - 1, end === Infinity ? undefined : end - 1);
      }
      case 'index': need(2, 2); return toStr(arg(0)).indexOf(toStr(arg(1))) + 1;
      case 'tolower': need(1, 1); return toStr(arg(0)).toLowerCase();
      case 'toupper': need(1, 1); return toStr(arg(0)).toUpperCase();
      case 'int': need(1, 1); return Math.trunc(toNum(arg(0)));
      case 'sqrt': need(1, 1); return Math.sqrt(toNum(arg(0)));
      case 'exp': need(1, 1); return Math.exp(toNum(arg(0)));
      case 'log': need(1, 1); return Math.log(toNum(arg(0)));
      case 'sin': need(1, 1); return Math.sin(toNum(arg(0)));
      case 'cos': need(1, 1); return Math.cos(toNum(arg(0)));
      case 'atan2': need(2, 2); return Math.atan2(toNum(arg(0)), toNum(arg(1)));
      case 'rand': {
        this.randState = (Math.imul(this.randState, 1103515245) + 12345) & 0x7fffffff;
        return this.randState / 0x80000000;
      }
      case 'srand': { const old = this.randState; this.randState = args.length > 0 ? Math.trunc(toNum(arg(0))) & 0x7fffffff : 0; return old; }
      case 'sprintf': {
        if (args.length === 0) throw new AwkError('not enough arguments to sprintf');
        return sprintfAwk(toStr(arg(0)), args.slice(1).map((a) => this.evalExpr(a)));
      }
      case 'split': {
        need(2, 3);
        const text = toStr(arg(0));
        if (args[1].type !== 'var') throw new AwkError('split: second argument must be an array');
        let parts;
        if (args.length === 3) {
          const sep = args[2].type === 'regex' ? args[2].compiled : null;
          const fs = sep ? null : toStr(arg(2));
          if (sep) parts = this.regexSplit(text, sep);
          else if (fs === ' ') parts = this.splitWith(text, ' ');
          else if (fs.length === 1) parts = text === '' ? [] : text.split(fs);
          else parts = text === '' ? [] : this.regexSplit(text, compileAwk(fs));
        } else parts = this.splitRecord(text);
        const arr = this.getArray(args[1].name);
        arr.clear();
        parts.forEach((part, i) => arr.set(String(i + 1), new StrNum(part)));
        return parts.length;
      }
      case 'match': {
        need(2, 2);
        const text = toStr(arg(0));
        const re = globalRegExp(this.regexArg(args[1]));
        const m = re.exec(text);
        this.vars.set('RSTART', m ? m.index + 1 : 0);
        this.vars.set('RLENGTH', m ? m[0].length : -1);
        return m ? m.index + 1 : 0;
      }
      case 'sub': case 'gsub': {
        need(2, 3);
        const compiled = this.regexArg(args[0]);
        const repl = toStr(arg(1));
        const target = args.length === 3 ? args[2] : { type: 'field', index: { type: 'num', v: 0 } };
        if (!this.isLvalue(target)) throw new AwkError(`${name}: third argument must be a variable, field or array element`);
        const text = toStr(this.evalExpr(target));
        const re = globalRegExp(compiled);
        let out = '';
        let last = 0;
        let count = 0;
        let prevEnd = -1;
        let m = re.exec(text);
        while (m) {
          if (m[0] === '' && m.index === prevEnd) { re.lastIndex = m.index + 1; if (re.lastIndex > text.length) break; m = re.exec(text); continue; }
          out += text.slice(last, m.index);
          let rep = '';
          for (let i = 0; i < repl.length; i += 1) {
            if (repl[i] === '\\' && (repl[i + 1] === '&' || repl[i + 1] === '\\')) { rep += repl[i + 1]; i += 1; } else if (repl[i] === '&') rep += m[0]; else rep += repl[i];
          }
          out += rep;
          last = m.index + m[0].length;
          prevEnd = last;
          count += 1;
          if (name === 'sub') break;
          if (m[0] === '') { re.lastIndex = m.index + 1; if (re.lastIndex > text.length) break; }
          m = re.exec(text);
        }
        if (count > 0) { out += text.slice(last); this.assign(target, out); }
        return count;
      }
      default: throw new AwkError(`function ${name} is not supported`);
    }
  }

  splitWith(text, fs) {
    const saved = this.vars.get('FS');
    this.vars.set('FS', fs);
    const parts = this.splitRecord(text);
    this.vars.set('FS', saved);
    return parts;
  }

  isLvalue(node) { return node.type === 'var' || node.type === 'field' || node.type === 'index'; }

  // ---- statements

  exec(node) {
    this.tickStep();
    switch (node.type) {
      case 'block':
        for (const stmt of node.stmts) { const signal = this.exec(stmt); if (signal) return signal; }
        return 0;
      case 'expr': this.evalExpr(node.expr); return 0;
      case 'print': {
        const ofs = toStr(this.vars.get('OFS'));
        const text = node.args.length === 0 ? this.record : node.args.map((a) => toStr(this.evalExpr(a))).join(ofs);
        this.emit(text + toStr(this.vars.get('ORS')));
        return 0;
      }
      case 'printf': {
        if (node.args.length === 0) throw new AwkError('printf: no format');
        const values = node.args.map((a) => this.evalExpr(a));
        this.emit(sprintfAwk(toStr(values[0]), values.slice(1)));
        return 0;
      }
      case 'if':
        if (truthy(this.evalExpr(node.cond))) return this.exec(node.then);
        return node.orelse ? this.exec(node.orelse) : 0;
      case 'while':
        while (truthy(this.evalExpr(node.cond))) {
          this.tickStep();
          const signal = this.exec(node.body);
          if (signal === BREAK) break;
          if (signal === NEXT || signal === EXIT) return signal;
        }
        return 0;
      case 'do':
        do {
          this.tickStep();
          const signal = this.exec(node.body);
          if (signal === BREAK) break;
          if (signal === NEXT || signal === EXIT) return signal;
        } while (truthy(this.evalExpr(node.cond)));
        return 0;
      case 'for':
        if (node.init) this.exec(node.init);
        while (node.cond === null || truthy(this.evalExpr(node.cond))) {
          this.tickStep();
          const signal = this.exec(node.body);
          if (signal === BREAK) break;
          if (signal === NEXT || signal === EXIT) return signal;
          if (node.step) this.exec(node.step);
        }
        return 0;
      case 'forin': {
        const keys = [...this.getArray(node.array).keys()];
        for (const key of keys) {
          this.tickStep();
          this.setVar(node.variable, new StrNum(key));
          const signal = this.exec(node.body);
          if (signal === BREAK) break;
          if (signal === NEXT || signal === EXIT) return signal;
        }
        return 0;
      }
      case 'break': return BREAK;
      case 'continue': return CONTINUE;
      case 'next': return NEXT;
      case 'exit': if (node.code) this.exitCode = Math.trunc(toNum(this.evalExpr(node.code))); return EXIT;
      case 'delete':
        if (node.subs) this.getArray(node.name).delete(this.subscript(node.subs));
        else this.getArray(node.name).clear();
        return 0;
      default: throw new AwkError('syntax error');
    }
  }

  matchesRule(rule) {
    if (rule.pattern === null) return true;
    if (!rule.pattern2) return truthy(this.evalExpr(rule.pattern));
    if (!rule.active) {
      if (!truthy(this.evalExpr(rule.pattern))) return false;
      rule.active = !truthy(this.evalExpr(rule.pattern2));
      return true;
    }
    if (truthy(this.evalExpr(rule.pattern2))) rule.active = false;
    return true;
  }

  runRules(kind) {
    for (const item of this.items) {
      if (item.kind !== kind) continue;
      const signal = this.exec(item.body);
      if (signal === EXIT) return EXIT;
    }
    return 0;
  }

  run(records) {
    let exited = this.runRules('begin') === EXIT;
    const hasMain = this.items.some((item) => item.kind === 'rule' || item.kind === 'end');
    if (!exited && hasMain) {
      outer: for (const { text, file } of records) {
        this.vars.set('NR', toNum(this.vars.get('NR')) + 1);
        if (file !== this.vars.get('FILENAME')) { this.vars.set('FILENAME', file); this.vars.set('FNR', 0); }
        this.vars.set('FNR', toNum(this.vars.get('FNR')) + 1);
        this.setRecord(text);
        this.tickStep();
        for (const item of this.items) {
          if (item.kind !== 'rule') continue;
          if (!this.matchesRule(item)) continue;
          if (item.body === null) { this.emit(this.record + toStr(this.vars.get('ORS'))); continue; }
          const signal = this.exec(item.body);
          if (signal === NEXT) break;
          if (signal === EXIT) { exited = true; break outer; }
        }
      }
    }
    if (hasMain || this.items.some((item) => item.kind === 'end')) {
      if (!(exited && false)) this.runRules('end');
    }
    return this.exitCode;
  }
}

function awk(c) {
  const parsed = parseArgs(c.args, { flags: '', values: 'Fvf', long: { 'field-separator': 'F', assign: 'v', file: 'f' }, stopAtOperand: false });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts, operands } = parsed;
  if (opts.f) { c.err('awk: program files (-f) are not supported in this sandbox\n'); return 2; }
  if (operands.length === 0) { c.err('usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]\n'); return 2; }
  const program = operands.shift();
  let fs = ' ';
  if (opts.F !== undefined) fs = opts.F === 't' ? '\t' : opts.F.replace(/\\t/g, '\t');
  const assigns = (parsed.all.v ?? []).map((pair) => {
    const eq = pair.indexOf('=');
    return eq > 0 ? [pair.slice(0, eq), pair.slice(eq + 1)] : null;
  });
  if (assigns.includes(null)) { c.err('awk: invalid -v argument\n'); return 2; }
  let items;
  try {
    items = new Parser(lex(program)).parseProgram();
  } catch (error) {
    if (error instanceof AwkError) { c.err(`awk: ${error.message}\n`); return 2; }
    throw error;
  }
  const interp = new Interp(c, items, { fs, assigns });
  const records = [];
  const needInput = items.some((item) => item.kind === 'rule' || item.kind === 'end');
  let failures = 0;
  if (needInput) {
    failures = forEachInput(c, 'awk', operands, (buf, label) => {
      const lines = splitLines(asText(buf));
      c.rc.tickLines(lines.length);
      for (const text of lines) records.push({ text, file: label === '-' ? '' : label });
    });
  }
  let exit;
  try {
    exit = interp.run(records);
  } catch (error) {
    if (error instanceof AwkError) {
      c.out(interp.out.join(''));
      c.err(`awk: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  c.out(interp.out.join(''));
  return failures > 0 && exit === 0 ? 2 : exit;
}

export const commands = { awk, gawk: awk, mawk: awk };
