// Tokenizer, parser and word expansion for the terminal shell. See docs/TERMINAL_GAME.md section 5.
// Words are flat arrays of "items": { c, q } literal char (q = quoted), { v, op?, arg?, q } variable,
// { s, q } command substitution, { ar, q } arithmetic. Nothing here touches the filesystem directly.
import { LIMITS } from './limits.js';

export class ShellSyntaxError extends Error {
  constructor(message, exit = 2) {
    super(message);
    this.name = 'ShellSyntaxError';
    this.exit = exit;
  }
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;
const SPECIAL_VARS = '?#$@*!-0123456789';
const CLOSERS = new Set(['then', 'else', 'elif', 'fi', 'do', 'done', 'esac', 'in']);
const UNSUPPORTED = new Set(['while', 'until', 'case', 'function', 'select', 'coproc', '{', '}', '[[']);

function ansiCEscape(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '\\' || i + 1 >= text.length) { out.push(ch); continue; }
    i += 1;
    const next = text[i];
    const simple = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"' };
    if (Object.hasOwn(simple, next)) { out.push(simple[next]); continue; }
    if (next === 'x') {
      const hex = /^[0-9A-Fa-f]{1,2}/.exec(text.slice(i + 1));
      if (hex) { out.push(String.fromCharCode(parseInt(hex[0], 16))); i += hex[0].length; continue; }
    }
    if (/[0-7]/.test(next)) {
      const oct = /^[0-7]{1,3}/.exec(text.slice(i));
      out.push(String.fromCharCode(parseInt(oct[0], 8) & 0xff));
      i += oct[0].length - 1;
      continue;
    }
    out.push('\\', next);
  }
  return out.join('');
}

// Finds the index of the `)` that closes a `$(` whose body starts at `start`.
function matchParen(line, start) {
  let depth = 1;
  for (let i = start; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === "'") {
      const close = line.indexOf("'", i + 1);
      if (close < 0) break;
      i = close;
    } else if (ch === '"') {
      for (i += 1; i < line.length && line[i] !== '"'; i += 1) if (line[i] === '\\') i += 1;
    } else if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth === 0) return i; }
  }
  throw new ShellSyntaxError("unexpected EOF while looking for matching `)'");
}

export function tokenize(line) {
  const tokens = [];
  const n = line.length;
  let i = 0;
  let cur = null;
  const add = (item) => { if (!cur) cur = []; cur.push(item); };
  const flush = () => { if (cur) { tokens.push({ t: 'word', items: cur }); cur = null; } };
  const op = (v, extra = {}) => tokens.push({ t: 'op', v, ...extra });
  const takeFd = () => {
    if (cur && cur.length === 1 && !cur[0].q && cur[0].c !== undefined && /^[0-9]$/.test(cur[0].c)) {
      const fd = Number(cur[0].c);
      cur = null;
      return fd;
    }
    return undefined;
  };

  // Reads a `$...` expansion at line[at]; returns the index after it.
  const readDollar = (at, quoted) => {
    const next = line[at + 1];
    if (next === '(') {
      if (line[at + 2] === '(') {
        const close = line.indexOf('))', at + 3);
        if (close < 0) throw new ShellSyntaxError("unexpected EOF while looking for matching `)'");
        add({ ar: line.slice(at + 3, close), q: quoted });
        return close + 2;
      }
      const close = matchParen(line, at + 2);
      add({ s: line.slice(at + 2, close), q: quoted });
      return close + 1;
    }
    if (next === '{') {
      const close = line.indexOf('}', at + 2);
      if (close < 0) throw new ShellSyntaxError("unexpected EOF while looking for matching `}'");
      const body = line.slice(at + 2, close);
      const lenMatch = /^#([A-Za-z_][A-Za-z0-9_]*)$/.exec(body);
      const opMatch = /^([A-Za-z_][A-Za-z0-9_]*|[0-9?#$@*])(?:(:[-=+])(.*))?$/s.exec(body);
      if (lenMatch) add({ v: lenMatch[1], op: '#', q: quoted });
      else if (opMatch) add({ v: opMatch[1], op: opMatch[2], arg: opMatch[3] ?? '', q: quoted });
      else throw new ShellSyntaxError(`\${${body}}: bad substitution`, 1);
      return close + 1;
    }
    if (next === "'" && !quoted) {
      const close = line.indexOf("'", at + 2);
      if (close < 0) throw new ShellSyntaxError("unexpected EOF while looking for matching `''");
      for (const ch of ansiCEscape(line.slice(at + 2, close))) add({ c: ch, q: true });
      add({ c: '', q: true });
      return close + 1;
    }
    if (next !== undefined && NAME_START.test(next)) {
      let end = at + 2;
      while (end < n && NAME_CHAR.test(line[end])) end += 1;
      add({ v: line.slice(at + 1, end), q: quoted });
      return end;
    }
    if (next !== undefined && SPECIAL_VARS.includes(next)) {
      add({ v: next, q: quoted });
      return at + 2;
    }
    add({ c: '$', q: quoted });
    return at + 1;
  };

  const readBacktick = (at, quoted) => {
    let end = at + 1;
    let body = '';
    while (end < n && line[end] !== '`') {
      if (line[end] === '\\' && line[end + 1] === '`') { body += '`'; end += 2; continue; }
      body += line[end];
      end += 1;
    }
    if (end >= n) throw new ShellSyntaxError("unexpected EOF while looking for matching ``'");
    add({ s: body, q: quoted });
    return end + 1;
  };

  while (i < n) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t' || ch === '\r') { flush(); i += 1; continue; }
    if (ch === '\n') { flush(); op(';'); i += 1; continue; }
    if (ch === '#' && !cur) break;
    if (ch === '\\') {
      if (i + 1 >= n) { add({ c: '\\', q: true }); i += 1; continue; }
      if (line[i + 1] === '\n') { i += 2; continue; }
      add({ c: line[i + 1], q: true });
      i += 2;
      continue;
    }
    if (ch === "'") {
      const close = line.indexOf("'", i + 1);
      if (close < 0) throw new ShellSyntaxError("unexpected EOF while looking for matching `''");
      add({ c: '', q: true });
      for (const c of line.slice(i + 1, close)) add({ c, q: true });
      i = close + 1;
      continue;
    }
    if (ch === '"') {
      add({ c: '', q: true });
      i += 1;
      let closed = false;
      while (i < n) {
        const d = line[i];
        if (d === '"') { closed = true; i += 1; break; }
        if (d === '\\' && i + 1 < n && '$`"\\\n'.includes(line[i + 1])) {
          if (line[i + 1] !== '\n') add({ c: line[i + 1], q: true });
          i += 2;
        } else if (d === '$') i = readDollar(i, true);
        else if (d === '`') i = readBacktick(i, true);
        else { add({ c: d, q: true }); i += 1; }
      }
      if (!closed) throw new ShellSyntaxError("unexpected EOF while looking for matching `\"'");
      continue;
    }
    if (ch === '$') { i = readDollar(i, false); continue; }
    if (ch === '`') { i = readBacktick(i, false); continue; }
    if (ch === '|') {
      flush();
      if (line[i + 1] === '|') { op('||'); i += 2; }
      else if (line[i + 1] === '&') throw new ShellSyntaxError("syntax error near unexpected token `|&'");
      else { op('|'); i += 1; }
      continue;
    }
    if (ch === '&') {
      flush();
      if (line[i + 1] === '&') { op('&&'); i += 2; }
      else if (line[i + 1] === '>') {
        i += 2;
        let append = false;
        if (line[i] === '>') { append = true; i += 1; }
        op(append ? '>>' : '>', { fd: 'both' });
      } else { op('&'); i += 1; }
      continue;
    }
    if (ch === ';') {
      flush();
      if (line[i + 1] === ';') throw new ShellSyntaxError("syntax error near unexpected token `;;'");
      op(';');
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')') { flush(); op(ch); i += 1; continue; }
    if (ch === '<') {
      const fd = takeFd();
      flush();
      if (line.startsWith('<<<', i)) { op('<<<', { fd: fd ?? 0 }); i += 3; }
      else if (line.startsWith('<<', i)) throw new ShellSyntaxError('here-documents are not supported in this sandbox', 1);
      else if (line[i + 1] === '(') throw new ShellSyntaxError('process substitution is not supported in this sandbox', 1);
      else { op('<', { fd: fd ?? 0 }); i += 1; }
      continue;
    }
    if (ch === '>') {
      const fd = takeFd();
      flush();
      if (line[i + 1] === '>') { op('>>', { fd: fd ?? 1 }); i += 2; }
      else if (line[i + 1] === '&') {
        const match = /^>&(\d|-)/.exec(line.slice(i));
        if (!match) throw new ShellSyntaxError("syntax error near unexpected token `&'");
        op('dup', { fd: fd ?? 1, to: match[1] });
        i += 3;
      } else { op('>', { fd: fd ?? 1 }); i += 1; }
      continue;
    }
    add({ c: ch, q: false });
    i += 1;
  }
  flush();
  return tokens;
}

// ---- parser ----

const plainText = (token) => {
  if (!token || token.t !== 'word') return null;
  let text = '';
  for (const item of token.items) {
    if (item.c === undefined || item.q) return null;
    text += item.c;
  }
  return text;
};

const tokenText = (token) => {
  if (token.t === 'op') return token.v === 'dup' ? '>&' : token.v;
  return token.items.map((item) => item.c ?? '').join('') || 'word';
};

const unexpected = (token) => new ShellSyntaxError(
  token ? `syntax error near unexpected token \`${tokenText(token)}'` : 'syntax error: unexpected end of file',
);

function splitAssignment(items) {
  let name = '';
  let idx = 0;
  while (idx < items.length && items[idx].c !== undefined && !items[idx].q && items[idx].c !== '=') {
    const ch = items[idx].c;
    if (!(idx === 0 ? NAME_START : NAME_CHAR).test(ch)) return null;
    name += ch;
    idx += 1;
  }
  if (!name || idx >= items.length || items[idx].c !== '=' || items[idx].q) return null;
  return { name, items: items.slice(idx + 1) };
}

export function parse(line) {
  const toks = tokenize(line);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (token, value) => token && token.t === 'op' && (value === undefined || token.v === value);
  const kw = (token) => plainText(token);
  const isRedir = (token) => token.t === 'op' && ['<', '>', '>>', '<<<', 'dup'].includes(token.v);

  function parseSimple() {
    const assigns = [];
    const words = [];
    const redirs = [];
    while (p < toks.length) {
      const tok = toks[p];
      if (tok.t === 'op') {
        if (!isRedir(tok)) break;
        p += 1;
        if (tok.v === 'dup') { redirs.push({ op: 'dup', fd: tok.fd, to: tok.to }); continue; }
        const target = toks[p];
        if (!target || target.t !== 'word') throw unexpected(target);
        p += 1;
        redirs.push({ op: tok.v, fd: tok.fd, target: target.items });
        continue;
      }
      if (words.length === 0) {
        const assign = splitAssignment(tok.items);
        if (assign) { assigns.push(assign); p += 1; continue; }
      }
      words.push(tok.items);
      p += 1;
    }
    if (words.length === 0 && assigns.length === 0 && redirs.length === 0) throw unexpected(toks[p]);
    return { type: 'simple', assigns, words, redirs };
  }

  function parseFor() {
    p += 1;
    const nameTok = toks[p];
    const name = plainText(nameTok);
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw unexpected(nameTok);
    p += 1;
    let words = null;
    if (kw(peek()) === 'in') {
      p += 1;
      words = [];
      while (peek() && peek().t === 'word') { words.push(peek().items); p += 1; }
    }
    while (isOp(peek(), ';')) p += 1;
    if (kw(peek()) !== 'do') throw unexpected(peek());
    p += 1;
    const body = parseSeq(new Set(['done']), false);
    if (kw(peek()) !== 'done') throw unexpected(peek());
    p += 1;
    return { type: 'for', name, words, body };
  }

  function parseIf() {
    p += 1;
    const branches = [];
    let orelse = null;
    let cond = parseSeq(new Set(['then']), false);
    for (;;) {
      if (kw(peek()) !== 'then') throw unexpected(peek());
      p += 1;
      const body = parseSeq(new Set(['elif', 'else', 'fi']), false);
      branches.push({ cond, body });
      const word = kw(peek());
      if (word === 'elif') { p += 1; cond = parseSeq(new Set(['then']), false); continue; }
      if (word === 'else') { p += 1; orelse = parseSeq(new Set(['fi']), false); }
      break;
    }
    if (kw(peek()) !== 'fi') throw unexpected(peek());
    p += 1;
    return { type: 'if', branches, orelse };
  }

  function parseCommand() {
    const tok = peek();
    if (!tok) throw unexpected(null);
    if (isOp(tok, '(')) {
      p += 1;
      const body = parseSeq(new Set(), true);
      if (!isOp(peek(), ')')) throw unexpected(peek());
      p += 1;
      return { type: 'group', body };
    }
    const word = kw(tok);
    if (word === 'for') return parseFor();
    if (word === 'if') return parseIf();
    if (word !== null && UNSUPPORTED.has(word)) throw new ShellSyntaxError(`'${word}' is not supported in this sandbox`, 1);
    if (word !== null && CLOSERS.has(word)) throw unexpected(tok);
    return parseSimple();
  }

  function parsePipeline() {
    let negate = false;
    if (kw(peek()) === '!') { negate = true; p += 1; }
    const stages = [parseCommand()];
    while (isOp(peek(), '|')) { p += 1; stages.push(parseCommand()); }
    return { type: 'pipeline', negate, stages };
  }

  function parseSeq(stop, inGroup) {
    const items = [];
    let conn = null;
    if (isOp(peek(), ';')) throw unexpected(peek());
    for (;;) {
      while (isOp(peek(), ';') && items.length > 0) p += 1;
      const tok = peek();
      if (!tok) break;
      if (isOp(tok, ')')) { if (!inGroup) throw unexpected(tok); break; }
      const word = kw(tok);
      if (word !== null && stop.has(word)) break;
      items.push({ node: parsePipeline(), conn });
      const next = peek();
      if (!next) break;
      if (isOp(next, '&&') || isOp(next, '||')) {
        conn = next.v;
        p += 1;
        if (!peek()) throw unexpected(null);
        continue;
      }
      if (isOp(next, ';')) { conn = ';'; continue; }
      if (isOp(next, '&')) throw new ShellSyntaxError('background jobs (&) are not supported in this sandbox', 1);
      if (isOp(next, ')')) break;
      const nextWord = kw(next);
      if (nextWord !== null && stop.has(nextWord)) break;
      throw unexpected(next);
    }
    return { type: 'seq', items };
  }

  const ast = parseSeq(new Set(), false);
  if (p < toks.length) throw unexpected(toks[p]);
  return ast;
}

// ---- expansion ----

class BraceLimit extends ShellSyntaxError {}

function braceRange(inner) {
  if (inner.some((item) => item.c === undefined || item.q)) return null;
  const text = inner.map((item) => item.c).join('');
  const num = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(text);
  let values = null;
  if (num) {
    const from = Number(num[1]);
    const to = Number(num[2]);
    const step = Math.max(1, Math.abs(Number(num[3] ?? 1)));
    const width = /^-?0\d/.test(num[1]) || /^-?0\d/.test(num[2]) ? Math.max(num[1].length, num[2].length) : 0;
    if (Math.abs(to - from) / step > LIMITS.BRACE_CAP) throw new BraceLimit(`brace expansion too large (max ${LIMITS.BRACE_CAP} words)`, 1);
    values = [];
    for (let v = from; from <= to ? v <= to : v >= to; v += from <= to ? step : -step) {
      const body = String(Math.abs(v)).padStart(width - (v < 0 ? 1 : 0), '0');
      values.push(v < 0 ? `-${body}` : body);
    }
    return values;
  }
  const alpha = /^([A-Za-z])\.\.([A-Za-z])$/.exec(text);
  if (alpha) {
    const from = alpha[1].charCodeAt(0);
    const to = alpha[2].charCodeAt(0);
    values = [];
    for (let v = from; from <= to ? v <= to : v >= to; v += from <= to ? 1 : -1) values.push(String.fromCharCode(v));
    return values;
  }
  return null;
}

function braceExpand(items, start = 0, budget = { left: LIMITS.BRACE_CAP }) {
  for (let i = start; i < items.length; i += 1) {
    if (items[i].c !== '{' || items[i].q) continue;
    let depth = 0;
    let close = -1;
    const commas = [];
    for (let j = i; j < items.length; j += 1) {
      const x = items[j];
      if (x.c === undefined || x.q) continue;
      if (x.c === '{') depth += 1;
      else if (x.c === '}') { depth -= 1; if (depth === 0) { close = j; break; } }
      else if (x.c === ',' && depth === 1) commas.push(j);
    }
    if (close < 0) return [items];
    const prefix = items.slice(0, i);
    const suffix = items.slice(close + 1);
    const finish = (parts) => {
      const out = [];
      for (const part of parts) {
        for (const result of braceExpand([...prefix, ...part, ...suffix], i, budget)) {
          out.push(result);
          budget.left -= 1;
          if (budget.left < 0) throw new BraceLimit(`brace expansion too large (max ${LIMITS.BRACE_CAP} words)`, 1);
        }
      }
      return out;
    };
    if (commas.length > 0) {
      const parts = [];
      let from = i + 1;
      for (const comma of commas) { parts.push(items.slice(from, comma)); from = comma + 1; }
      parts.push(items.slice(from, close));
      return finish(parts);
    }
    const seq = braceRange(items.slice(i + 1, close));
    if (seq) return finish(seq.map((text) => Array.from(text).map((c) => ({ c, q: true }))));
    return braceExpand(items, i + 1, budget);
  }
  return [items];
}

// A tiny, safe integer calculator for $(( )).
function evalArith(expr, env) {
  const toks = expr.match(/\d+|[A-Za-z_][A-Za-z0-9_]*|\*\*|[-+*/%()]/g) ?? [];
  let p = 0;
  const fail = () => { throw new ShellSyntaxError(`${expr.trim()}: syntax error in expression`, 1); };
  const atom = () => {
    const tok = toks[p];
    p += 1;
    if (tok === undefined) fail();
    if (tok === '(') { const v = sum(); if (toks[p] !== ')') fail(); p += 1; return v; }
    if (tok === '-') return -atom();
    if (tok === '+') return atom();
    if (/^\d/.test(tok)) return Number(tok);
    if (/^[A-Za-z_]/.test(tok)) { const v = parseInt(env.getVar(tok) ?? '0', 10); return Number.isFinite(v) ? v : 0; }
    return fail();
  };
  const power = () => { const base = atom(); if (toks[p] === '**') { p += 1; return Math.trunc(base ** power()); } return base; };
  const product = () => {
    let v = power();
    while (toks[p] === '*' || toks[p] === '/' || toks[p] === '%') {
      const o = toks[p]; p += 1;
      const r = power();
      if (o === '*') v *= r;
      else if (r === 0) throw new ShellSyntaxError(`${expr.trim()}: division by 0 (error token is "0")`, 1);
      else v = o === '/' ? Math.trunc(v / r) : v % r;
    }
    return v;
  };
  function sum() {
    let v = product();
    while (toks[p] === '+' || toks[p] === '-') { const o = toks[p]; p += 1; const r = product(); v = o === '+' ? v + r : v - r; }
    return v;
  }
  const value = sum();
  if (p < toks.length) fail();
  return Math.trunc(Number.isFinite(value) ? value : 0);
}

async function pieceOf(item, env) {
  if (item.c !== undefined) return { text: item.c, q: item.q };
  if (item.v !== undefined) {
    const raw = env.getVar(item.v);
    let text = raw ?? '';
    if (item.op === '#') text = String(text.length);
    else if (item.op === ':-') text = raw ? raw : item.arg;
    else if (item.op === ':=') { if (!raw) { env.setVar(item.v, item.arg); text = item.arg; } }
    else if (item.op === ':+') text = raw ? item.arg : '';
    return { text, q: item.q, split: !item.q };
  }
  if (item.s !== undefined) return { text: await env.subst(item.s), q: item.q, split: !item.q };
  return { text: String(evalArith(item.ar, env)), q: item.q, split: !item.q };
}

const escapeGlob = (text) => text.replace(/[\\*?[\]]/g, '\\$&');
const hasGlobText = (text) => /[*?[]/.test(text);

async function expandVariant(items, env, out, { split, glob }) {
  let list = items;
  if (list.length > 0 && list[0].c === '~' && !list[0].q && (list.length === 1 || (list[1].c === '/' && !list[1].q))) {
    list = [...Array.from(env.home).map((c) => ({ c, q: true })), ...list.slice(1)];
  }
  const fields = [];
  let current = null;
  for (const item of list) {
    const piece = await pieceOf(item, env);
    if (split && piece.split) {
      const parts = piece.text.split(/[ \t\n]+/);
      parts.forEach((part, index) => {
        if (index > 0) { if (current) fields.push(current); current = null; }
        if (part !== '') { if (!current) current = []; current.push({ text: part, q: false }); }
      });
    } else {
      if (!current) current = [];
      current.push({ text: piece.text, q: piece.q });
    }
  }
  if (current) fields.push(current);
  for (const field of fields) {
    const literal = field.map((seg) => seg.text).join('');
    if (glob && field.some((seg) => !seg.q && hasGlobText(seg.text))) {
      const pattern = field.map((seg) => (seg.q ? escapeGlob(seg.text) : seg.text)).join('');
      const matches = env.glob(pattern);
      if (matches.length > 0) { out.push(...matches); continue; }
    }
    out.push(literal);
  }
}

// Expands a list of words into argv strings (brace, tilde, $VAR, $(), arithmetic, split, glob).
export async function expandWords(words, env) {
  const out = [];
  for (const items of words) {
    for (const variant of braceExpand(items)) await expandVariant(variant, env, out, { split: true, glob: true });
  }
  return out;
}

// Expansion without splitting or globbing (assignments, redirect targets, here-strings).
export async function expandOne(items, env) {
  const out = [];
  await expandVariant(items, env, out, { split: false, glob: false });
  return out.join('');
}
