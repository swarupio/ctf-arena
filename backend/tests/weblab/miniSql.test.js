import { describe, expect, it } from 'vitest';
import { SqlError, like, runQuery, tokenize } from '../../src/games/weblab/miniSql.js';

const tables = {
  users: {
    columns: ['id', 'name', 'role'],
    rows: [{ id: 1, name: 'Ann', role: 'user' }, { id: 2, name: 'Bob', role: 'admin' }, { id: 3, name: "O'Neil", role: 'user' }],
  },
  other: { columns: ['secret'], rows: [{ secret: 's3' }] },
};
const q = (sql) => runQuery(sql, tables);

describe('mini SQL evaluator', () => {
  it('filters with comparisons, AND, OR, NOT and parentheses', () => {
    expect(q("SELECT * FROM users WHERE role='admin'").rows).toEqual([[2, 'Bob', 'admin']]);
    expect(q("SELECT id FROM users WHERE role='user' AND NOT id=1").rows).toEqual([[3]]);
    expect(q("SELECT id FROM users WHERE (id=1 OR id=2) AND role<>'admin'").rows).toEqual([[1]]);
    expect(q('SELECT id FROM users WHERE id IN (1, 3)').rows).toEqual([[1], [3]]);
  });

  it('supports the classic injection payloads', () => {
    expect(q("SELECT * FROM users WHERE name='x' OR '1'='1'").rows).toHaveLength(3);
    expect(q("SELECT * FROM users WHERE name='Bob' -- ' AND role='z'").rows).toEqual([[2, 'Bob', 'admin']]);
    expect(q("SELECT * FROM users WHERE name='x' OR 1=1 #").rows).toHaveLength(3);
    expect(q("SELECT * FROM users WHERE name='x' /* c */ OR id=1").rows).toEqual([[1, 'Ann', 'user']]);
    expect(q("SELECT * FROM users WHERE name='O''Neil'").rows).toHaveLength(1);
  });

  it('supports UNION with matching column counts and reports mismatches', () => {
    expect(q('SELECT id, name FROM users WHERE id=1 UNION SELECT 9, secret FROM other').rows).toEqual([[1, 'Ann'], [9, 's3']]);
    expect(() => q('SELECT id FROM users UNION SELECT 1, 2')).toThrow(/different number of columns/);
  });

  it('supports ORDER BY n for column counting and LIMIT', () => {
    expect(() => q('SELECT id, name FROM users ORDER BY 3')).toThrow(/Unknown column '3'/);
    expect(q('SELECT id, name FROM users ORDER BY 2 DESC LIMIT 1').rows).toEqual([[3, "O'Neil"]]);
  });

  it('LIKE uses % and _ without a regular expression', () => {
    expect(like('Hello', 'h%o')).toBe(true);
    expect(like('Hello', 'h_llo')).toBe(true);
    expect(like('Hello', '%x%')).toBe(false);
    expect(like('a'.repeat(900), `${'%a'.repeat(400)}b`)).toBe(false);
  });

  it('rejects syntax errors, unknown tables and columns, and prototype names', () => {
    expect(() => q("SELECT * FROM users WHERE name='x")).toThrow(SqlError);
    expect(() => q('SELECT * FROM nothing')).toThrow(/doesn't exist/);
    expect(() => q('SELECT * FROM constructor')).toThrow(/doesn't exist/);
    expect(() => q('SELECT * FROM __proto__')).toThrow(SqlError);
    expect(() => q('SELECT nope FROM users')).toThrow(/Unknown column/);
    expect(() => q('DROP TABLE users')).toThrow(SqlError);
    expect(() => q('SELECT * FROM users; SELECT 1')).toThrow(SqlError);
  });

  it('is bounded: long, deep and token-heavy queries are rejected quickly', () => {
    const start = Date.now();
    const attacks = [
      `SELECT * FROM users WHERE ${'('.repeat(900)}1=1${')'.repeat(900)}`,
      `SELECT * FROM users WHERE ${'NOT '.repeat(240)}id=1`,
      `SELECT * FROM users WHERE id=1${' OR id=1'.repeat(500)}`,
      `SELECT * FROM users WHERE name LIKE '${'%a'.repeat(400)}'`,
      `SELECT ${'1,'.repeat(300)}1`,
      "'".repeat(5000),
      `SELECT * FROM users WHERE ${'('.repeat(100)}1=1${')'.repeat(100)}`,
    ];
    for (const sql of attacks) {
      try { q(sql); } catch (error) { expect(error).toBeInstanceOf(SqlError); }
    }
    expect(Date.now() - start).toBeLessThan(1500);
    expect(() => tokenize('x'.repeat(5000))).toThrow(/too long/);
  });

  it('never evaluates player text as code', () => {
    expect(() => q("SELECT * FROM users WHERE name=process.exit(1)")).toThrow(SqlError);
    globalThis.__weblabPwned = false;
    expect(() => q("SELECT * FROM users WHERE name='x' OR globalThis.__weblabPwned=1")).toThrow(SqlError);
    expect(globalThis.__weblabPwned).toBe(false);
  });
});
