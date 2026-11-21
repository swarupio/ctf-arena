// A tiny hand-written SQL evaluator for the SQL-injection labs. It understands a small SELECT dialect over
// in-memory tables handed in by the lab. It never touches MongoDB, the filesystem, eval or Function, and every
// loop is bounded by the token cap (LIMITS.SQL_TOKENS), the depth cap and the row cap.
import { LIMITS } from './limits.js';

export class SqlError extends Error {}

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'LIKE', 'IN', 'IS', 'NULL', 'UNION', 'ALL', 'ORDER', 'BY',
  'LIMIT', 'ASC', 'DESC', 'AS', 'TRUE', 'FALSE',
]);
const isDigit = (c) => c >= '0' && c <= '9';
const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentPart = (c) => isIdentStart(c) || isDigit(c) || c === '.' || c === '$';

export function tokenize(sql) {
  if (typeof sql !== 'string' || sql.length > LIMITS.SQL_LENGTH) { throw new SqlError('Query is too long'); }
  const tokens = [];
  let i = 0;
  while (i < sql.length) {
    if (tokens.length > LIMITS.SQL_TOKENS) { throw new SqlError('Query is too complex'); }
    const c = sql[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }
    if (c === '#' || (c === '-' && sql[i + 1] === '-')) { break; }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) { throw new SqlError("You have an error in your SQL syntax; unterminated comment near '/*'"); }
      i = end + 2;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let text = '';
      for (;;) {
        if (j >= sql.length) { throw new SqlError(`You have an error in your SQL syntax; unclosed quotation mark near '${sql.slice(i, i + 20)}'`); }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { text += "'"; j += 2; continue; }
          break;
        }
        text += sql[j];
        j += 1;
      }
      tokens.push({ k: 'str', v: text });
      i = j + 1;
      continue;
    }
    if (isDigit(c)) {
      let j = i;
      while (j < sql.length && (isDigit(sql[j]) || sql[j] === '.')) { j += 1; }
      tokens.push({ k: 'num', v: Number.parseFloat(sql.slice(i, j)) || 0 });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      while (j < sql.length && isIdentPart(sql[j])) { j += 1; }
      const word = sql.slice(i, j);
      const upper = word.toUpperCase();
      tokens.push(KEYWORDS.has(upper) ? { k: 'kw', v: upper } : { k: 'id', v: word.toLowerCase() });
      i = j;
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>' || two === '!=') { tokens.push({ k: 'op', v: two === '!=' ? '<>' : two }); i += 2; continue; }
    if ('=<>(),*;'.includes(c)) { tokens.push({ k: 'op', v: c }); i += 1; continue; }
    throw new SqlError(`You have an error in your SQL syntax near '${sql.slice(i, i + 12)}'`);
  }
  return tokens;
}

const toNumber = (value) => {
  if (typeof value === 'number') { return value; }
  if (typeof value === 'boolean') { return value ? 1 : 0; }
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

// MySQL-like loose comparison: NULL never matches, strings compare case-insensitively, string vs number is numeric.
function compare(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) { return null; }
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : (x > y ? 1 : 0);
  }
  const x = toNumber(a);
  const y = toNumber(b);
  return x < y ? -1 : (x > y ? 1 : 0);
}

// LIKE with % and _ via the classic two-pointer wildcard match: no regular expression, no recursion.
export function like(text, pattern) {
  const s = String(text).toLowerCase();
  const p = String(pattern).toLowerCase();
  let si = 0;
  let pi = 0;
  let star = -1;
  let mark = 0;
  while (si < s.length) {
    if (pi < p.length && (p[pi] === '_' || p[pi] === s[si]) && p[pi] !== '%') { si += 1; pi += 1; }
    else if (pi < p.length && p[pi] === '%') { star = pi; mark = si; pi += 1; }
    else if (star !== -1) { pi = star + 1; mark += 1; si = mark; }
    else { return false; }
  }
  while (pi < p.length && p[pi] === '%') { pi += 1; }
  return pi === p.length;
}

class Parser {
  constructor(tokens, tables) { this.t = tokens; this.i = 0; this.tables = tables; this.depth = 0; }

  peek() { return this.t[this.i]; }

  next() { const token = this.t[this.i]; this.i += 1; return token; }

  is(kind, value) { const token = this.peek(); return Boolean(token) && token.k === kind && (value === undefined || token.v === value); }

  accept(kind, value) { if (this.is(kind, value)) { this.i += 1; return true; } return false; }

  fail() {
    const token = this.peek();
    throw new SqlError(`You have an error in your SQL syntax near '${token ? token.v : 'end of query'}'`);
  }

  expect(kind, value) { if (!this.accept(kind, value)) { this.fail(); } }

  statement() {
    const results = [this.select()];
    while (this.accept('kw', 'UNION')) {
      this.accept('kw', 'ALL');
      results.push(this.select());
    }
    this.accept('op', ';');
    if (this.peek()) { this.fail(); }
    const width = results[0].columns.length;
    if (results.some((r) => r.columns.length !== width)) {
      throw new SqlError('The used SELECT statements have a different number of columns');
    }
    return { columns: results[0].columns, rows: results.flatMap((r) => r.rows).slice(0, LIMITS.ROWS) };
  }

  select() {
    this.expect('kw', 'SELECT');
    const items = [];
    do {
      if (this.accept('op', '*')) { items.push({ star: true }); } else { items.push({ operand: this.operand(), alias: null }); }
      if (this.accept('kw', 'AS') && this.is('id')) { items[items.length - 1].alias = this.next().v; }
    } while (this.accept('op', ',') && items.length < 30);
    let table = null;
    if (this.accept('kw', 'FROM')) {
      if (!this.is('id')) { this.fail(); }
      const name = this.next().v;
      table = Object.hasOwn(this.tables, name) ? this.tables[name] : null;
      if (!table) { throw new SqlError(`Table '${name}' doesn't exist`); }
    }
    const rowSource = table ? table.rows : [{}];
    const cols = table ? table.columns : [];
    const known = new Set(cols);
    const check = (operand, where) => {
      if (operand.id !== undefined && !known.has(operand.id)) { throw new SqlError(`Unknown column '${operand.id}' in '${where}'`); }
    };
    let predicate = () => true;
    if (this.accept('kw', 'WHERE')) { predicate = this.expr(known); }
    let order = null;
    if (this.accept('kw', 'ORDER')) {
      this.expect('kw', 'BY');
      const key = this.next();
      if (!key || (key.k !== 'num' && key.k !== 'id')) { this.fail(); }
      order = { key, desc: false };
      if (this.accept('kw', 'DESC')) { order.desc = true; } else { this.accept('kw', 'ASC'); }
    }
    let limit = LIMITS.ROWS;
    if (this.accept('kw', 'LIMIT')) {
      if (!this.is('num')) { this.fail(); }
      limit = Math.min(limit, Math.max(0, Math.floor(this.next().v)));
    }
    const columns = [];
    const projections = [];
    for (const item of items) {
      if (item.star) {
        if (!table) { throw new SqlError('No tables used'); }
        for (const name of cols) { columns.push(name); projections.push((row) => row[name]); }
      } else {
        check(item.operand, 'field list');
        columns.push(item.alias ?? (item.operand.id ?? String(item.operand.value)));
        projections.push((row) => (item.operand.id === undefined ? item.operand.value : row[item.operand.id]));
      }
    }
    if (order) {
      if (order.key.k === 'num' && (order.key.v < 1 || order.key.v > columns.length)) {
        throw new SqlError(`Unknown column '${order.key.v}' in 'order clause'`);
      }
      if (order.key.k === 'id' && !known.has(order.key.v)) { throw new SqlError(`Unknown column '${order.key.v}' in 'order clause'`); }
    }
    let rows = rowSource.filter((row) => predicate(row) === true);
    if (order) {
      const pick = order.key.k === 'num' ? (row) => projections[order.key.v - 1](row) : (row) => row[order.key.v];
      rows = [...rows].sort((a, b) => (compare(pick(a), pick(b)) ?? 0) * (order.desc ? -1 : 1));
    }
    return { columns, rows: rows.slice(0, limit).map((row) => projections.map((project) => project(row) ?? null)) };
  }

  operand() {
    const token = this.next();
    if (!token) { this.fail(); }
    if (token.k === 'num' || token.k === 'str') { return { value: token.v }; }
    if (token.k === 'id') { return { id: token.v }; }
    if (token.k === 'kw' && token.v === 'NULL') { return { value: null }; }
    if (token.k === 'kw' && (token.v === 'TRUE' || token.v === 'FALSE')) { return { value: token.v === 'TRUE' ? 1 : 0 }; }
    this.i -= 1;
    return this.fail();
  }

  expr(known) {
    this.depth += 1;
    if (this.depth > LIMITS.SQL_DEPTH) { throw new SqlError('Query is too deeply nested'); }
    const out = this.orExpr(known);
    this.depth -= 1;
    return out;
  }

  orExpr(known) {
    let left = this.andExpr(known);
    while (this.accept('kw', 'OR')) {
      const a = left;
      const b = this.andExpr(known);
      left = (row) => { const x = a(row); const y = b(row); return x === true || y === true ? true : (x === null || y === null ? null : false); };
    }
    return left;
  }

  andExpr(known) {
    let left = this.notExpr(known);
    while (this.accept('kw', 'AND')) {
      const a = left;
      const b = this.notExpr(known);
      left = (row) => { const x = a(row); const y = b(row); return x === false || y === false ? false : (x === null || y === null ? null : true); };
    }
    return left;
  }

  notExpr(known) {
    if (this.accept('kw', 'NOT')) {
      this.depth += 1;
      if (this.depth > LIMITS.SQL_DEPTH) { throw new SqlError('Query is too deeply nested'); }
      const inner = this.notExpr(known);
      this.depth -= 1;
      return (row) => { const x = inner(row); return x === null ? null : !x; };
    }
    return this.comparison(known);
  }

  comparison(known) {
    if (this.accept('op', '(')) {
      const inner = this.expr(known);
      this.expect('op', ')');
      return inner;
    }
    const left = this.operand();
    const read = (operand, row) => (operand.id === undefined ? operand.value : row[operand.id]);
    const guard = (operand) => { if (operand.id !== undefined && !known.has(operand.id)) { throw new SqlError(`Unknown column '${operand.id}' in 'where clause'`); } };
    guard(left);
    if (this.accept('kw', 'IS')) {
      const negate = this.accept('kw', 'NOT');
      this.expect('kw', 'NULL');
      return (row) => ((read(left, row) === null || read(left, row) === undefined) !== negate);
    }
    const negate = this.accept('kw', 'NOT');
    if (this.accept('kw', 'LIKE')) {
      const right = this.operand();
      guard(right);
      return (row) => {
        const a = read(left, row);
        const b = read(right, row);
        if (a === null || b === null || a === undefined || b === undefined) { return null; }
        return like(a, b) !== negate;
      };
    }
    if (this.accept('kw', 'IN')) {
      this.expect('op', '(');
      const list = [];
      do { list.push(this.operand()); } while (this.accept('op', ',') && list.length < 30);
      this.expect('op', ')');
      list.forEach(guard);
      return (row) => list.some((item) => compare(read(left, row), read(item, row)) === 0) !== negate;
    }
    if (negate) { this.fail(); }
    const token = this.peek();
    if (token && token.k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(token.v)) {
      this.next();
      const right = this.operand();
      guard(right);
      return (row) => {
        const c = compare(read(left, row), read(right, row));
        if (c === null) { return null; }
        switch (token.v) {
          case '=': return c === 0;
          case '<>': return c !== 0;
          case '<': return c < 0;
          case '>': return c > 0;
          case '<=': return c <= 0;
          default: return c >= 0;
        }
      };
    }
    // A bare operand is truthy when numerically non-zero ("WHERE 1").
    return (row) => { const v = read(left, row); return v === null || v === undefined ? null : toNumber(v) !== 0; };
  }
}

// tables: { name: { columns: ['id', ...], rows: [{ id: 1, ... }] } }. Returns { columns, rows: [[...]] } or throws SqlError.
export function runQuery(sql, tables) {
  return new Parser(tokenize(sql), tables).statement();
}
