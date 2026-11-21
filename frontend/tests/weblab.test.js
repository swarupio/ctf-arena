import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyForm, applySetCookies, base64Decode, base64Encode, buildPayload, describeError, diffLines, displayUrl, draftFromRequest,
  findFlags, formDefaults, formatBounty, formatCookieLines, formatHeaderLines, formatRawRequest, parseCookieLines,
  parseHeaderLines, percent, pushHistory, severityMeta, statusQuip, themeOf, toCurl, urlDecode, urlEncode,
} from '../src/components/weblab/helpers.js';

const draft = (extra = {}) => ({ method: 'GET', path: '/x', headers: '', cookies: '', body: '', ...extra });

test('header and cookie lines parse, normalise and round trip', () => {
  assert.deepEqual(parseHeaderLines('Authorization: Bearer a:b\n\nX-Test:  1 ').value, { authorization: 'Bearer a:b', 'x-test': '1' });
  assert.equal(parseHeaderLines('nonsense').errors.length, 1);
  assert.equal(parseHeaderLines(': nothing').errors.length, 1);
  assert.equal(parseHeaderLines('__proto__: x').errors.length, 1);
  assert.deepEqual(parseCookieLines('a=1; b=x=y\nc=').value, { a: '1', b: 'x=y', c: '' });
  assert.equal(parseCookieLines('=oops').errors.length, 1);
  assert.equal(formatCookieLines({ a: '1', b: '2' }), 'a=1\nb=2');
  assert.equal(formatHeaderLines({ a: '1' }), 'a: 1');
  const request = { method: 'POST', path: '/p', headers: { a: '1' }, cookies: { c: 'd' }, body: '{}' };
  assert.deepEqual(draftFromRequest(request), { method: 'POST', path: '/p', headers: 'a: 1', cookies: 'c=d', body: '{}' });
  assert.equal({}.polluted, undefined);
});

test('buildPayload enforces the same limits as the API', () => {
  assert.equal(buildPayload(draft()).ok, true);
  assert.deepEqual(buildPayload(draft({ cookies: 'a=1', headers: 'x: y' })).payload, { method: 'GET', path: '/x', headers: { x: 'y' }, cookies: { a: '1' }, body: '' });
  assert.equal(buildPayload(draft({ method: 'TRACE' })).ok, false);
  assert.equal(buildPayload(draft({ path: 'x' })).ok, false);
  assert.equal(buildPayload(draft({ path: `/${'a'.repeat(300)}` })).ok, false);
  assert.equal(buildPayload(draft({ body: 'x'.repeat(2001) })).ok, false);
  assert.equal(buildPayload(draft({ headers: 'bad line' })).ok, false);
  assert.equal(buildPayload(draft({ headers: Array.from({ length: 21 }, (_, i) => `h${i}: v`).join('\n') })).ok, false);
  assert.equal(buildPayload(draft({ cookies: Array.from({ length: 11 }, (_, i) => `c${i}=v`).join('\n') })).ok, false);
  assert.equal(buildPayload(draft({ cookies: `${'n'.repeat(41)}=v` })).ok, false);
  assert.equal(buildPayload(draft({ cookies: `a=${'v'.repeat(501)}` })).ok, false);
});

test('cookies set by the site are merged into the cookie box', () => {
  assert.equal(applySetCookies('a=1', [{ name: 'b', value: '2' }]), 'a=1\nb=2');
  assert.equal(applySetCookies('a=1', [{ name: 'a', value: '9' }]), 'a=9');
  assert.equal(applySetCookies('a=1', []), 'a=1');
  assert.equal(applySetCookies('a=1', undefined), 'a=1');
});

test('raw request and curl copy helpers quote safely', () => {
  const payload = { method: 'POST', path: '/login', headers: { 'content-type': 'application/json' }, cookies: { s: 'v' }, body: "{\"a\":\"it's\"}" };
  const raw = formatRawRequest(payload);
  assert.match(raw, /^POST \/login HTTP\/1.1\nHost: target.lab\ncontent-type: application\/json\nCookie: s=v\n\n/);
  const curl = toCurl(payload);
  assert.match(curl, /-X POST 'https:\/\/target.lab\/login'/);
  assert.match(curl, /-b 's=v'/);
  assert.ok(curl.includes("'{\"a\":\"it'\\''s\"}'"));
  assert.ok(!toCurl({ ...payload, body: '', cookies: {} }).includes('--data-raw'));
});

test('base64 and url coders round trip, handle unicode and reject garbage', () => {
  const text = '{"admin":false,"name":"h\u00e9llo \u2713"}';
  assert.equal(base64Decode(base64Encode(text)).value, text);
  assert.equal(base64Decode(base64Encode(text, { url: true })).value, text);
  assert.equal(base64Encode('hi'), 'aGk=');
  assert.equal(base64Encode('??>>', { url: true }), 'Pz8-Pg');
  assert.equal(base64Decode('%%%').ok, false);
  assert.equal(base64Decode('/w==').ok, false);
  assert.equal(urlDecode(urlEncode('a b&c=d/../')).value, 'a b&c=d/../');
  assert.equal(urlDecode('%E0%A4%A').ok, false);
});

test('site forms become query strings or JSON bodies', () => {
  const login = { fields: [{ name: 'username' }, { name: 'password' }], submit: { method: 'POST', path: '/login', encoding: 'json', label: 'Go' } };
  const out = applyForm(login, { username: "a'b", password: 'p' }, draft());
  assert.equal(out.method, 'POST');
  assert.equal(out.path, '/login');
  assert.deepEqual(JSON.parse(out.body), { username: "a'b", password: 'p' });
  const search = { fields: [{ name: 'q', default: 'Ada' }], submit: { method: 'GET', path: '/search', encoding: 'query', label: 'Go' } };
  const found = applyForm(search, { q: "x' UNION SELECT 1 -- &" }, draft({ body: 'old' }));
  assert.equal(found.path, "/search?q=x'%20UNION%20SELECT%201%20--%20%26".replace("'", "'"));
  assert.equal(found.body, '');
  assert.deepEqual(formDefaults(search), { q: 'Ada' });
  assert.deepEqual(formDefaults(null), {});
  assert.deepEqual(applyForm(null, {}, draft()), draft());
});

test('diffLines marks added, removed and unchanged lines and is capped', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nc\nd'), [
    { type: 'same', text: 'a' }, { type: 'del', text: 'b' }, { type: 'same', text: 'c' }, { type: 'add', text: 'd' },
  ]);
  assert.deepEqual(diffLines('x', 'x'), [{ type: 'same', text: 'x' }]);
  assert.equal(diffLines('a\n'.repeat(5000), 'b\n'.repeat(5000)).length <= 240, true);
  assert.deepEqual(diffLines(undefined, 'a').map((l) => l.type), ['del', 'add']);
});

test('history keeps the newest entries up to the cap', () => {
  let history = [];
  for (let i = 0; i < 30; i += 1) { history = pushHistory(history, { id: i }); }
  assert.equal(history.length, 20);
  assert.equal(history[0].id, 29);
});

test('flags in a response are detected without regex blow-ups', () => {
  assert.deepEqual(findFlags('x CTF{web_lab_0123456789ab} y CTF{web_lab_0123456789ab} CTF{other_1}'), ['CTF{web_lab_0123456789ab}', 'CTF{other_1}']);
  assert.deepEqual(findFlags('CTF{' + 'a'.repeat(100_000)), []);
  assert.deepEqual(findFlags(undefined), []);
});

test('wording helpers: severity badges, bounty, quips, percent, themes, urls', () => {
  assert.deepEqual(severityMeta('critical'), { label: 'CRITICAL', tone: 'critical', stars: 4 });
  assert.equal(severityMeta('nope'), null);
  assert.equal(severityMeta(null), null);
  assert.equal(formatBounty(10000), '$10,000');
  assert.equal(formatBounty(null), '');
  assert.match(statusQuip(200, true), /EXPLOIT LANDED/);
  for (const status of [200, 400, 401, 403, 404, 500, 302]) { assert.ok(statusQuip(status, false).length > 5); }
  assert.equal(percent(30, 120), 25);
  assert.equal(percent(1, 0), 0);
  assert.equal(percent(999, 10), 100);
  assert.equal(themeOf('pizza'), 'pizza');
  assert.equal(themeOf('evil"><script>'), 'retro-bank');
  assert.equal(displayUrl({ path: 'bank.retro/login' }, '/staff'), 'https://bank.retro/staff');
  assert.equal(displayUrl(null, undefined), 'https://target.lab/');
});

test('describeError maps API failures to friendly messages', () => {
  assert.equal(describeError({ code: 'NO_TEAM' }).kind, 'no-team');
  assert.equal(describeError({ code: 'TEAM_BANNED' }).kind, 'banned');
  assert.equal(describeError({ code: 'WEBLAB_NOT_SEEDED' }).kind, 'not-seeded');
  assert.deepEqual(describeError({ code: 'LAB_LOCKED', message: 'Clear first: X' }), { kind: 'locked', message: 'Clear first: X' });
  assert.equal(describeError({ status: 401 }).kind, 'auth');
  assert.equal(describeError({ status: 429 }).kind, 'rate');
  assert.equal(describeError({ status: 404 }).kind, 'not-found');
  assert.equal(describeError({ status: 400 }).kind, 'invalid');
  assert.equal(describeError({ status: 403, message: 'no' }).message, 'no');
  assert.equal(describeError(new TypeError('Failed to fetch')).kind, 'network');
  assert.equal(describeError(undefined).kind, 'network');
});
