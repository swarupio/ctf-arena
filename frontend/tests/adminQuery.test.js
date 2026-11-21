import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ariaSort, buildQuery, dateRangeFilters, dateToIso, formatSort, isObjectId, listQueryString, nextSort, parseSort, path,
} from '../src/admin/query.js';
import { clampPage, pageCount, pageWindow, rangeLabel } from '../src/admin/pagination.js';

test('buildQuery drops blanks, keeps booleans as text and encodes values', () => {
  assert.equal(buildQuery({}), '');
  assert.equal(buildQuery({ a: '', b: null, c: undefined, d: NaN }), '');
  assert.equal(buildQuery({ page: 1, banned: false, q: 'a b&c' }), '?page=1&banned=false&q=a+b%26c');
  assert.equal(buildQuery({ zero: 0 }), '?zero=0');
});

test('listQueryString always sends page and limit and trims the search text', () => {
  assert.equal(listQueryString(), '?page=1&limit=25');
  assert.equal(listQueryString({ page: 3, limit: 50, q: '  alice ', sort: '-createdAt', filters: { role: 'admin', banned: '' } }),
    '?page=3&limit=50&q=alice&sort=-createdAt&role=admin');
});

test('sort strings parse, format and toggle', () => {
  assert.deepEqual(parseSort('-score'), { field: 'score', desc: true });
  assert.deepEqual(parseSort('name'), { field: 'name', desc: false });
  assert.deepEqual(parseSort(''), { field: '', desc: false });
  assert.equal(formatSort({ field: 'x', desc: true }), '-x');
  assert.equal(formatSort({ field: '', desc: true }), '');
  assert.equal(nextSort('', 'name'), 'name');
  assert.equal(nextSort('name', 'name'), '-name');
  assert.equal(nextSort('-name', 'name'), 'name');
  assert.equal(nextSort('-score', 'name'), 'name');
  assert.equal(ariaSort('-score', 'score'), 'descending');
  assert.equal(ariaSort('score', 'score'), 'ascending');
  assert.equal(ariaSort('score', 'name'), 'none');
});

test('object ids are 24 hex characters', () => {
  assert.equal(isObjectId('665f1c2e8b3a4d0012345678'), true);
  assert.equal(isObjectId('665F1C2E8B3A4D0012345678'), true);
  for (const bad of ['', 'abc', '665f1c2e8b3a4d001234567', '665f1c2e8b3a4d00123456789', 'zzzf1c2e8b3a4d0012345678', null, 12]) assert.equal(isObjectId(bad), false);
});

test('date inputs become UTC instants, the end of the range is the last millisecond', () => {
  assert.equal(dateToIso('2026-11-22'), '2026-11-22T00:00:00.000Z');
  assert.equal(dateToIso('2026-11-22', true), '2026-11-22T23:59:59.999Z');
  for (const bad of ['', '22/11/2026', '2026-13-45', undefined]) assert.equal(dateToIso(bad), '');
  assert.deepEqual(dateRangeFilters({ from: '2026-11-01', to: '' }), { from: '2026-11-01T00:00:00.000Z', to: '' });
});

test('path encodes every part', () => {
  assert.equal(path('admin', 'users', 'a/../b'), '/admin/users/a%2F..%2Fb');
});

test('page count and clamping', () => {
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageCount(25, 25), 1);
  assert.equal(pageCount(26, 25), 2);
  assert.equal(pageCount(137, 25), 6);
  assert.equal(pageCount('x', 0), 1);
  assert.equal(clampPage(0, 100, 25), 1);
  assert.equal(clampPage(99, 100, 25), 4);
  assert.equal(clampPage('2', 100, 25), 2);
});

test('range label uses an en dash and handles empty and partial last pages', () => {
  assert.equal(rangeLabel(1, 25, 0), '0 results');
  assert.equal(rangeLabel(1, 25, 137), '1–25 of 137');
  assert.equal(rangeLabel(6, 25, 137), '126–137 of 137');
  assert.equal(rangeLabel(9, 25, 137), '126–137 of 137');
});

test('page window shows first, last and neighbours with gaps', () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(1, 5), [1, 2, 'gap', 5]);
  assert.deepEqual(pageWindow(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(5, 10), [1, 'gap', 4, 5, 6, 'gap', 10]);
  assert.deepEqual(pageWindow(10, 10), [1, 'gap', 9, 10]);
  assert.deepEqual(pageWindow(4, 10), [1, 2, 3, 4, 5, 'gap', 10]);
});
