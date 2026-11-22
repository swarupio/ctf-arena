import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, entryLeaks, getDebrief, hasDebrief, keyById, levelKeys, skillsOfLevel, validateEntry } from '../src/debrief/entries.js';
import { debriefMode, isEnded, modeTitle } from '../src/debrief/visibility.js';
import { loadEventEnded, resetEventEndedCache } from '../src/debrief/useEventEnded.js';

const good = {
  what: 'Find the hidden value in a short message.',
  how: 'The message uses a simple substitution, so counting letters and trying a shift reveals it quickly and reliably.',
  defend: 'Never rely on obscurity: use vetted modern ciphers and keep keys out of the code.',
  tools: ['CyberChef'],
  next: 'Try a keyed cipher next.',
};

// ---- real content ---------------------------------------------------------------------------------------------

const known = new Set(levelKeys());
const entries = Object.entries(SOURCES).flatMap(([file, source]) => Object.entries(source).map(([key, entry]) => ({ file, key, entry })));

test('debrief content: every key exists in levelSkills (no orphans) and is defined once', () => {
  const seen = new Map();
  for (const { file, key } of entries) {
    assert.ok(known.has(key), `${file}: orphan key "${key}"`);
    assert.ok(!seen.has(key), `${key} defined in both ${seen.get(key)} and ${file}`);
    seen.set(key, file);
  }
});

test('debrief content: every entry matches the schema', () => {
  for (const { file, key, entry } of entries) {
    assert.deepEqual(validateEntry(entry), [], `${file} ${key}`);
  }
});

test('debrief content: no entry leaks a flag, token, email or team URL', () => {
  for (const { file, key, entry } of entries) {
    assert.deepEqual(entryLeaks(entry), [], `${file} ${key}`);
  }
});

test('debrief content: coverage report', (t) => {
  const covered = [...known].filter((key) => hasDebrief(key)).length;
  t.diagnostic(`debrief coverage: ${covered} of ${known.size} mapped levels have an entry`);
  assert.ok(covered <= known.size);
});

test('debrief content: every mapped level has an entry (CHECK_DEBRIEF_COMPLETE=1)', { skip: process.env.CHECK_DEBRIEF_COMPLETE !== '1' }, () => {
  const missing = [...known].filter((key) => !hasDebrief(key));
  assert.deepEqual(missing, [], `${missing.length} levels without a debrief`);
});

// ---- validator ------------------------------------------------------------------------------------------------

test('validateEntry accepts a good entry and an empty tools list / next', () => {
  assert.deepEqual(validateEntry(good), []);
  assert.deepEqual(validateEntry({ ...good, tools: [], next: '' }), []);
});

test('validateEntry enforces every limit', () => {
  const bad = (patch) => validateEntry({ ...good, ...patch });
  assert.ok(bad({ what: 'short' }).length);
  assert.ok(bad({ what: 'x'.repeat(221) }).length);
  assert.ok(bad({ how: 'x'.repeat(59) }).length);
  assert.ok(bad({ how: 'x'.repeat(601) }).length);
  assert.ok(bad({ defend: 'x'.repeat(39) }).length);
  assert.ok(bad({ defend: 'x'.repeat(401) }).length);
  assert.ok(bad({ next: 'x'.repeat(161) }).length);
  assert.ok(bad({ next: undefined }).length);
  assert.ok(bad({ tools: ['a', 'b', 'c', 'd', 'e', 'f'] }).length);
  assert.ok(bad({ tools: [''] }).length);
  assert.ok(bad({ tools: 'nmap' }).length);
  assert.ok(bad({ extra: 'field' }).length);
  assert.ok(validateEntry(null).length);
  assert.ok(validateEntry([]).length);
});

test('entryLeaks catches flags, long tokens, emails and team URLs, and allows prose', () => {
  const leaks = (patch) => entryLeaks({ ...good, ...patch });
  assert.deepEqual(entryLeaks(good), []);
  assert.ok(leaks({ what: 'The answer is CTF{abc} here, nothing else' }).length);
  assert.ok(leaks({ how: `${good.how} ${'a1b2c3d4'.repeat(4)}` }).length);
  assert.ok(leaks({ how: `${good.how} dGhpcy1pcy1hLXNlY3JldC12YWx1ZTEyMw==` }).length);
  assert.ok(leaks({ next: 'mail ops@example.com' }).length);
  assert.ok(leaks({ next: 'see https://ctf.example.com/team/alpha/solves' }).length);
  assert.ok(leaks({ defend: `${good.defend} It is a game of chance.` }).length);
  // long hyphenated words and plain links are ordinary
  assert.deepEqual(leaks({ defend: `${good.defend} Send Strict-Transport-Security headers, see https://owasp.org/Top10/` }), []);
});

test('lookups: getDebrief, hasDebrief and keyById', () => {
  assert.equal(getDebrief('nope:none:0'), null);
  assert.equal(hasDebrief('nope:none:0'), false);
  assert.equal(keyById('cipherlab', 'e1'), 'cipherlab:easy:e1');
  assert.equal(keyById('weblab', 'sqli-login'), 'weblab:easy:sqli-login');
  assert.equal(keyById('crackme', 'i4'), 'crackme:insane:i4');
  assert.equal(keyById('cipherlab', 'zzz'), null);
  assert.ok(skillsOfLevel('cipherlab:hard:h2').length >= 2);
  assert.deepEqual(skillsOfLevel('nope'), []);
});

// ---- visibility -----------------------------------------------------------------------------------------------

test('debriefMode: captured, ended, admin and hidden', () => {
  assert.equal(debriefMode({}), null);
  assert.equal(debriefMode({ captured: true }), 'captured');
  assert.equal(debriefMode({ eventEnded: true }), 'writeup');
  assert.equal(debriefMode({ captured: true, eventEnded: true }), 'captured');
  assert.equal(debriefMode({ isAdmin: true }), 'preview');
  assert.equal(modeTitle('writeup'), 'Write-up');
  assert.equal(modeTitle('captured'), 'Debrief: what you just learned');
  assert.match(modeTitle('preview'), /preview/);
});

test('isEnded only trusts phase "ended"', () => {
  assert.equal(isEnded({ phase: 'ended' }), true);
  for (const phase of ['live', 'upcoming', 'frozen', 'none', undefined]) { assert.equal(isEnded({ phase }), false); }
  assert.equal(isEnded(null), false);
});

test('loadEventEnded shares one request, caches for a minute and treats failure as not ended', async () => {
  resetEventEndedCache();
  let calls = 0;
  const fetcher = async () => { calls += 1; return { phase: 'ended' }; };
  const [a, b] = await Promise.all([loadEventEnded(fetcher, 1000), loadEventEnded(fetcher, 1001)]);
  assert.deepEqual([a, b, calls], [true, true, 1]);
  await loadEventEnded(fetcher, 30_000);
  assert.equal(calls, 1);
  await loadEventEnded(fetcher, 62_000);
  assert.equal(calls, 2);
  resetEventEndedCache();
  assert.equal(await loadEventEnded(async () => { throw new Error('down'); }, 0), false);
  resetEventEndedCache();
});
