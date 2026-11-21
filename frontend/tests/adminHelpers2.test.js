import test from 'node:test';
import assert from 'node:assert/strict';
import {
  barWidths, labelIndexes, lineChartModel, linearScale, maxOf, nearestIndex, niceMax, plotArea, sumSeries, xAt, yTicks,
} from '../src/admin/chart.js';
import {
  CSV_EXPORTS, IMPORT_MAX, csvPath, filenameFromDisposition, jsonBlob, parseImportFile, safeFilename, saveBlob,
} from '../src/admin/download.js';
import { friendlyError, isAuthError } from '../src/admin/errors.js';
import {
  challengeName, diffRows, formatDate, formatDay, formatSigned, orDash, orDeleted, safeHref, summarizeValue, truncate,
} from '../src/admin/format.js';
import { dropToast, pushToast, toastDuration } from '../src/admin/toast.js';

test('niceMax rounds up to 1, 2, 5 times a power of ten', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(-4), 1);
  assert.equal(niceMax(NaN), 1);
  assert.equal(niceMax(1), 1);
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(5), 5);
  assert.equal(niceMax(6), 10);
  assert.equal(niceMax(73), 100);
  assert.equal(niceMax(120), 200);
  assert.equal(niceMax(0.3), 0.5);
});

test('y ticks run from zero to the nice maximum', () => {
  assert.deepEqual(yTicks(73), [0, 25, 50, 75, 100]);
  assert.deepEqual(yTicks(0, 2), [0, 0.5, 1]);
});

test('linear scale maps a domain to a range, also backwards', () => {
  const y = linearScale([0, 100], [200, 0]);
  assert.equal(y(0), 200);
  assert.equal(y(100), 0);
  assert.equal(y(25), 150);
  assert.equal(linearScale([5, 5], [0, 10])(5), 5);
});

test('plot area and x positions', () => {
  const area = plotArea(400, 200, { top: 10, right: 10, bottom: 30, left: 40 });
  assert.deepEqual(area, { left: 40, top: 10, right: 390, bottom: 170 });
  assert.equal(xAt(0, 5, area), 40);
  assert.equal(xAt(4, 5, area), 390);
  assert.equal(xAt(0, 1, area), 215);
  assert.ok(plotArea(10, 10).right > plotArea(10, 10).left);
});

test('line chart model builds a path per series on a shared nice scale', () => {
  const rows = [{ a: 0, b: 10 }, { a: 5, b: 20 }, { a: 10, b: 0 }];
  assert.equal(maxOf(rows, ['a', 'b']), 20);
  const model = lineChartModel(rows, ['a', 'b'], { width: 340, height: 200, margin: { top: 0, right: 0, bottom: 0, left: 40 } });
  assert.equal(model.top, 20);
  assert.deepEqual(model.xs, [40, 190, 340]);
  assert.equal(model.series[1].path, 'M40 100 L190 0 L340 200');
  assert.equal(model.series[0].points[2].value, 10);
  assert.equal(model.ticks[0].value, 0);
  assert.equal(model.ticks.at(-1).value, 20);
  const empty = lineChartModel([], ['a'], { width: 300, height: 100 });
  assert.equal(empty.series[0].path, '');
});

test('nearestIndex picks the closest point and -1 for none', () => {
  assert.equal(nearestIndex(100, [0, 90, 200]), 1);
  assert.equal(nearestIndex(-50, [0, 90, 200]), 0);
  assert.equal(nearestIndex(10, []), -1);
});

test('label indexes keep labels apart and include the last point', () => {
  assert.deepEqual(labelIndexes(0, 400), []);
  assert.deepEqual(labelIndexes(3, 400), [0, 1, 2]);
  const many = labelIndexes(30, 280, 56);
  assert.equal(many.at(-1), 29);
  assert.ok(many.length <= 5);
  assert.deepEqual(many, [...many].sort((a, b) => a - b));
});

test('bar widths scale to a nice maximum and keep tiny values visible', () => {
  assert.deepEqual(barWidths([0, 50, 100], 200), [0, 100, 200]);
  assert.deepEqual(barWidths([1, 1000], 100), [2, 100]);
  assert.deepEqual(barWidths([], 100), []);
  assert.deepEqual(barWidths(['x', -3], 100), [0, 0]);
  assert.equal(sumSeries([{ n: 2 }, { n: '3' }, {}], 'n'), 5);
});

test('file names are made safe and read from Content-Disposition', () => {
  assert.ok(!/[\\/]/.test(safeFilename('../../etc/passwd')));
  assert.equal(safeFilename('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(safeFilename('', 'x.csv'), 'x.csv');
  assert.equal(safeFilename('.hidden'), 'hidden');
  assert.equal(safeFilename('a b.csv'), 'a_b.csv');
  assert.equal(filenameFromDisposition('attachment; filename="users.csv"', 'f.csv'), 'users.csv');
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''teams%20list.csv", 'f.csv'), 'teams_list.csv');
  assert.equal(filenameFromDisposition('', 'fallback.csv'), 'fallback.csv');
  assert.equal(filenameFromDisposition(undefined, 'fallback.csv'), 'fallback.csv');
  assert.equal(csvPath('users'), '/admin/export/users.csv');
  assert.deepEqual(CSV_EXPORTS.map((item) => item.name), ['users', 'teams', 'submissions', 'leaderboard']);
});

test('saveBlob clicks a hidden link with an object URL and revokes it afterwards', () => {
  const calls = [];
  const link = { style: {}, click: () => calls.push('click'), remove: () => calls.push('remove') };
  const doc = { createElement: (tag) => { calls.push(`create:${tag}`); return link; }, body: { appendChild: (node) => calls.push(node === link ? 'append' : 'other') } };
  const urls = { createObjectURL: () => 'blob:abc', revokeObjectURL: (url) => calls.push(`revoke:${url}`) };
  const timers = [];
  saveBlob('BLOB', '../users.csv', { doc, urls, later: (fn) => timers.push(fn) });
  assert.equal(link.href, 'blob:abc');
  assert.equal(link.download, '_users.csv');
  assert.equal(link.rel, 'noopener');
  assert.deepEqual(calls, ['create:a', 'append', 'click', 'remove']);
  timers[0]();
  assert.equal(calls.at(-1), 'revoke:blob:abc');
});

test('jsonBlob serialises with indentation and a JSON type', () => {
  class FakeBlob { constructor(parts, options) { this.parts = parts; this.options = options; } }
  const blob = jsonBlob({ a: 1 }, FakeBlob);
  assert.equal(blob.options.type, 'application/json');
  assert.equal(blob.parts[0], '{\n  "a": 1\n}');
});

test('import files: export format or bare array, with clear errors', () => {
  const one = { slug: 'a', title: 'A' };
  assert.deepEqual(parseImportFile(JSON.stringify({ version: 1, challenges: [one] })).challenges, [one]);
  assert.deepEqual(parseImportFile(JSON.stringify([one])).challenges, [one]);
  assert.throws(() => parseImportFile('{nope'), /not valid JSON/);
  assert.throws(() => parseImportFile('{"foo":1}'), /Expected a challenges\.json/);
  assert.throws(() => parseImportFile('[]'), /no challenges/);
  assert.throws(() => parseImportFile('[1]'), /must be an object/);
  assert.throws(() => parseImportFile(JSON.stringify(Array.from({ length: IMPORT_MAX + 1 }, () => one))), /limit is 100/);
  assert.throws(() => parseImportFile('null'), /Expected a challenges\.json/);
});

test('API errors map to friendly text for 401, 403, 404, 409, 423, 422 and network failures', () => {
  const err = (props) => Object.assign(new Error(props.message ?? 'The API request failed.'), props);
  assert.match(friendlyError(err({ status: 401, code: 'UNAUTHENTICATED' })), /session has expired/);
  assert.match(friendlyError(err({ status: 403, code: 'FORBIDDEN' })), /Only admins/);
  assert.match(friendlyError(err({ status: 423, code: 'SUBMISSIONS_FROZEN' })), /frozen/);
  assert.match(friendlyError(err({ status: 409, code: 'CANNOT_BAN_ADMIN' })), /Admins cannot be banned/);
  assert.match(friendlyError(err({ status: 409, code: 'NOT_A_MEMBER' })), /not a member/);
  assert.match(friendlyError(err({ status: 409, code: 'TEAM_NOT_EMPTY' })), /still has members/);
  assert.match(friendlyError(err({ status: 409, code: 'ACTOR_NOT_FOUND' })), /no user row/);
  assert.equal(friendlyError(err({ status: 409, code: 'CONFLICT', message: 'team name already exists' })), 'team name already exists');
  assert.match(friendlyError(err({ status: 409, code: 'CONFLICT' })), /already taken/);
  assert.match(friendlyError(err({ status: 409, code: 'SOMETHING_ELSE' })), /conflicts/);
  assert.match(friendlyError(err({ status: 404, code: 'NOT_FOUND' })), /no longer exists/);
  assert.equal(friendlyError(err({ status: 422, message: 'points: too big' })), 'Check the form: points: too big');
  assert.equal(friendlyError(err({ status: 400, code: 'VALIDATION_ERROR', message: 'name: too short' })), 'Check the form: name: too short');
  assert.match(friendlyError(err({ status: 422 })), /Check the form/);
  assert.match(friendlyError(err({ status: 502 })), /server had a problem/);
  assert.match(friendlyError(new TypeError('Failed to fetch')), /Cannot reach the server/);
  assert.equal(friendlyError(Object.assign(new Error('x'), { name: 'AbortError' })), '');
  assert.equal(friendlyError(null, 'fallback'), 'fallback');
  assert.equal(friendlyError(new Error('Plain message')), 'Plain message');
  assert.equal(isAuthError({ status: 401 }), true);
  assert.equal(isAuthError({ status: 403 }), true);
  assert.equal(isAuthError({ status: 409 }), false);
});

test('formatters tolerate missing values and never output markup', () => {
  assert.equal(formatDate('2026-11-22T10:00:30.000Z'), '2026-11-22 10:00 UTC');
  assert.equal(formatDate(null), '–');
  assert.equal(formatDate('nope'), '–');
  assert.equal(formatDay('2026-11-22'), 'Nov 22');
  assert.equal(formatDay('bad'), 'bad');
  assert.equal(formatSigned(110), '+110');
  assert.equal(formatSigned(-20), '−20');
  assert.equal(formatSigned(0), '0');
  assert.equal(formatSigned('x'), '0');
  assert.equal(orDeleted(null), '(deleted)');
  assert.equal(orDeleted('A'), 'A');
  assert.equal(orDash(''), '–');
  assert.equal(orDash(0), '0');
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
  assert.equal(challengeName(null), '(deleted)');
  assert.equal(challengeName({ slug: 's', title: null }), 's');
  assert.equal(challengeName({ slug: 's', title: 'T' }), 'T');
});

test('only http and https links are clickable', () => {
  assert.equal(safeHref('http://localhost:8080/'), 'http://localhost:8080/');
  assert.equal(safeHref('https://x.test/a'), 'https://x.test/a');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '//host', '', null, 'not a url']) assert.equal(safeHref(bad), '');
});

test('audit before/after summaries become diff rows', () => {
  assert.deepEqual(diffRows(null, null), []);
  assert.deepEqual(diffRows({ banned: false, name: 'A' }, { banned: true, name: 'A', reason: 'x' }), [
    { key: 'banned', before: 'false', after: 'true', changed: true },
    { key: 'name', before: 'A', after: 'A', changed: false },
    { key: 'reason', before: '–', after: 'x', changed: true },
  ]);
  assert.equal(summarizeValue({ a: 1 }), '{"a":1}');
  assert.equal(summarizeValue(undefined), '–');
  assert.equal(summarizeValue('x'.repeat(200)).length, 120);
});

test('toast stack merges repeats, keeps the newest five and drops by id', () => {
  let list = [];
  list = pushToast(list, { id: 1, kind: 'error', message: 'Boom' });
  list = pushToast(list, { id: 2, kind: 'error', message: 'Boom' });
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 2);
  assert.equal(list[0].id, 2);
  list = pushToast(list, { id: 3, kind: 'success', message: 'Boom' });
  assert.equal(list.length, 2);
  for (let id = 4; id < 12; id += 1) list = pushToast(list, { id, kind: 'info', message: `m${id}` });
  assert.equal(list.length, 5);
  assert.equal(list.at(-1).id, 11);
  assert.deepEqual(dropToast(list, 11).map((toast) => toast.id), [7, 8, 9, 10]);
  assert.ok(toastDuration('error') > toastDuration('success'));
  assert.equal(toastDuration('weird'), toastDuration('info'));
});
