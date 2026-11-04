import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANONYMOUS_NAME, DEFAULT_LIMIT, EVIDENCE_NOTE, INTEGRITY_PATHS, MAX_LIMIT, SIGNAL_KINDS, canDismiss, clampLimit,
  dismissPrompt, entryKey, entryName, formatWhen, isAnonymous, kindHelp, kindLabel, lastSeen, normalizeEntries,
  prepareEntries, riskLabel, riskPips, riskText, severityLevel, signalCount, signalTooltip, sortEntries, sortSignals,
  teamLabel, timeAgo, totalSignals,
} from '../src/pages/integrityHelpers.js';

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('endpoint paths match the API contract, clamp the limit and escape ids', () => {
  assert.equal(INTEGRITY_PATHS.list(50), '/admin/integrity?limit=50');
  assert.equal(INTEGRITY_PATHS.list(), `/admin/integrity?limit=${DEFAULT_LIMIT}`);
  assert.equal(INTEGRITY_PATHS.list(10_000), `/admin/integrity?limit=${MAX_LIMIT}`);
  assert.equal(INTEGRITY_PATHS.dismiss('abc123'), '/admin/integrity/abc123');
  assert.equal(INTEGRITY_PATHS.dismiss('a/../b'), '/admin/integrity/a%2F..%2Fb');
  for (const bad of [0, -3, NaN, 'abc', null]) assert.equal(clampLimit(bad), DEFAULT_LIMIT);
  assert.equal(clampLimit('25'), 25);
  assert.equal(clampLimit(7.9), 7);
});

test('every signal kind has the agreed label and a help text that says it is not proof', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(SIGNAL_KINDS).map(([kind, { label }]) => [kind, label])), {
    'honeypot-endpoint': 'Opened a debug endpoint',
    'tainted-flag': 'Submitted a leaked decoy flag',
    'terminal-canary': 'Followed an AI-bait instruction',
    'terminal-velocity': 'Inhuman command rate',
    'terminal-cadence': 'Machine-regular timing',
    'automation-ua': 'Scripted HTTP client',
  });
  for (const kind of Object.keys(SIGNAL_KINDS)) {
    assert.ok(kindHelp(kind).length > 20);
    assert.match(signalTooltip({ kind, count: 1 }, NOW), /evidence to review, not proof/i);
  }
  assert.match(EVIDENCE_NOTE, /not proof/);
});

test('unknown kinds still read sensibly and cannot hit object prototype keys', () => {
  assert.equal(kindLabel('some-new_kind'), 'Some new kind');
  assert.equal(kindLabel(''), 'Unknown signal');
  assert.equal(kindLabel(undefined), 'Unknown signal');
  assert.equal(kindLabel('constructor'), 'Constructor');
  assert.match(kindHelp('constructor'), /does not know/);
});

test('risk pips scale 0..100 onto five pips and always show one for any risk', () => {
  assert.deepEqual(riskPips(0), { filled: 0, total: 5, level: 'none' });
  assert.deepEqual(riskPips(1), { filled: 1, total: 5, level: 'low' });
  assert.equal(riskPips(20).filled, 1);
  assert.equal(riskPips(21).filled, 2);
  assert.deepEqual(riskPips(50), { filled: 3, total: 5, level: 'medium' });
  assert.deepEqual(riskPips(75), { filled: 4, total: 5, level: 'high' });
  assert.deepEqual(riskPips(100), { filled: 5, total: 5, level: 'high' });
  assert.equal(riskPips(900).filled, 5);
  for (const bad of [undefined, null, NaN, -4, 'abc']) assert.equal(riskPips(bad).filled, 0);
  assert.equal(riskLabel(riskPips(50)), 'Risk 3 of 5, medium');
  assert.equal(riskText(72.4), '72');
  assert.equal(riskText('x'), '0');
});

test('severity accepts words and small numbers', () => {
  assert.equal(severityLevel('high'), 'high');
  assert.equal(severityLevel(' Critical '), 'high');
  assert.equal(severityLevel('medium'), 'medium');
  assert.equal(severityLevel('low'), 'low');
  assert.equal(severityLevel('whatever'), 'low');
  assert.equal(severityLevel(1), 'low');
  assert.equal(severityLevel(2), 'medium');
  assert.equal(severityLevel(3), 'high');
  assert.equal(severityLevel(undefined), 'low');
});

test('signal counts fall back to one for missing or broken values', () => {
  assert.equal(signalCount({ count: 4 }), 4);
  assert.equal(signalCount({ count: '3' }), 3);
  for (const bad of [{}, { count: 0 }, { count: -2 }, { count: 'x' }, null, undefined]) assert.equal(signalCount(bad), 1);
});

test('normalizeEntries tolerates junk and fills defaults', () => {
  assert.deepEqual(normalizeEntries(undefined), []);
  assert.deepEqual(normalizeEntries({ not: 'an array' }), []);
  const [entry, ...rest] = normalizeEntries([null, 'x', { userId: 7, risk: '40', signals: [null, { kind: 'automation-ua', count: 2, lastAt: 12, detail: 5 }] }]);
  assert.equal(rest.length, 0);
  assert.equal(entry.userId, '7');
  assert.equal(entry.risk, 40);
  assert.equal(entry.displayName, '');
  assert.deepEqual(entry.signals, [{ kind: 'automation-ua', detail: '', count: 2, severity: undefined, firstAt: null, lastAt: null }]);
  assert.deepEqual(normalizeEntries([{ userId: 'u', risk: 'oops' }])[0].signals, []);
  assert.equal(normalizeEntries([{ userId: 'u', risk: 'oops' }])[0].risk, 0);
});

test('entries are ranked by risk, then signal volume, then recency, then name', () => {
  const entries = normalizeEntries([
    { userId: 'a', displayName: 'Ada', risk: 40, signals: [{ kind: 'automation-ua', count: 1, lastAt: ago(HOUR) }] },
    { userId: 'b', displayName: 'Bob', risk: 90, signals: [{ kind: 'honeypot-endpoint', count: 1, lastAt: ago(DAY) }] },
    { userId: 'c', displayName: 'Cyd', risk: 40, signals: [{ kind: 'terminal-velocity', count: 5, lastAt: ago(DAY) }] },
    { userId: 'd', displayName: 'Dee', risk: 40, signals: [{ kind: 'terminal-cadence', count: 1, lastAt: ago(MIN) }] },
    { userId: 'e', displayName: 'Eve', risk: 40, signals: [{ kind: 'terminal-cadence', count: 1, lastAt: ago(MIN) }] },
  ]);
  const input = [...entries];
  assert.deepEqual(sortEntries(entries).map((entry) => entry.userId), ['b', 'c', 'd', 'e', 'a']);
  assert.deepEqual(entries, input, 'sorting must not mutate its input');
  assert.equal(totalSignals(entries[2]), 5);
  assert.equal(lastSeen(entries[3]), NOW - MIN);
  assert.equal(lastSeen({ signals: [] }), 0);
});

test('signals are ordered by severity then recency, and prepareEntries applies both sorts', () => {
  const signals = normalizeEntries([{ userId: 'u', signals: [
    { kind: 'a', severity: 'low', lastAt: ago(MIN) },
    { kind: 'b', severity: 'high', lastAt: ago(DAY) },
    { kind: 'c', severity: 'high', lastAt: ago(HOUR) },
    { kind: 'd', severity: 'medium', lastAt: ago(MIN) },
  ] }])[0].signals;
  assert.deepEqual(sortSignals(signals).map((signal) => signal.kind), ['c', 'b', 'd', 'a']);
  const prepared = prepareEntries([
    { userId: 'low', risk: 5, signals: [] },
    { userId: 'top', risk: 95, signals: [{ kind: 'x', severity: 'low' }, { kind: 'y', severity: 'high' }] },
  ]);
  assert.deepEqual(prepared.map((entry) => entry.userId), ['top', 'low']);
  assert.deepEqual(prepared[0].signals.map((signal) => signal.kind), ['y', 'x']);
});

test('time ago is coarse, never negative and falls back to a date for old signals', () => {
  assert.equal(timeAgo(ago(0), NOW), 'just now');
  assert.equal(timeAgo(ago(-5 * MIN), NOW), 'just now');
  assert.equal(timeAgo(ago(59_000), NOW), 'just now');
  assert.equal(timeAgo(ago(MIN), NOW), '1 min ago');
  assert.equal(timeAgo(ago(59 * MIN), NOW), '59 min ago');
  assert.equal(timeAgo(ago(HOUR), NOW), '1 h ago');
  assert.equal(timeAgo(ago(23 * HOUR + 59 * MIN), NOW), '23 h ago');
  assert.equal(timeAgo(ago(DAY), NOW), '1 d ago');
  assert.equal(timeAgo(ago(59 * DAY), NOW), '59 d ago');
  assert.equal(timeAgo(ago(60 * DAY), NOW), '2026-09-05');
  for (const bad of [undefined, null, 'not a date', '']) assert.equal(timeAgo(bad, NOW), 'unknown');
});

test('absolute times are UTC and stable', () => {
  assert.equal(formatWhen('2026-11-04T12:03:59.000Z'), '2026-11-04 12:03 UTC');
  assert.equal(formatWhen('nope'), 'unknown');
  assert.equal(formatWhen(undefined), 'unknown');
  assert.equal(formatWhen(null), 'unknown');
});

test('names and teams handle the anonymous aggregate and missing data', () => {
  const anonymous = { userId: null, displayName: ANONYMOUS_NAME, teamName: '', signals: [] };
  assert.ok(isAnonymous(anonymous));
  assert.equal(entryName(anonymous), ANONYMOUS_NAME);
  assert.equal(teamLabel(anonymous), '-');
  assert.equal(canDismiss(anonymous), false);
  assert.ok(isAnonymous({ userId: 'x', displayName: ANONYMOUS_NAME }), 'matched by name even if it has an id');
  assert.equal(canDismiss({ userId: 'x', displayName: ANONYMOUS_NAME }), true);

  const player = { userId: 'u1', displayName: 'Ada', teamName: 'Red', signals: [] };
  assert.equal(isAnonymous(player), false);
  assert.equal(entryName(player), 'Ada');
  assert.equal(teamLabel(player), 'Red');
  assert.equal(teamLabel({ ...player, teamName: '' }), 'No team');
  assert.equal(entryName({ userId: 'u2', displayName: '' }), 'Unknown player');
  assert.equal(entryKey(player, 3), 'u1');
  assert.equal(entryKey(anonymous, 3), 'anonymous:3');
});

test('tooltips explain the signal, include detail and counts, and truncate long detail', () => {
  const tip = signalTooltip({ kind: 'honeypot-endpoint', detail: 'GET /api/x', count: 3, lastAt: ago(5 * MIN) }, NOW);
  assert.match(tip, /decoy/);
  assert.match(tip, /Detail: GET \/api\/x\./);
  assert.match(tip, /Seen 3 times, last 5 min ago\./);
  assert.match(signalTooltip({ kind: 'automation-ua', count: 1 }, NOW), /Seen 1 time,/);
  const long = signalTooltip({ kind: 'automation-ua', detail: 'x'.repeat(500), count: 1 }, NOW);
  assert.ok(long.length < 600);
  assert.ok(long.includes('…'));
});

test('the dismiss prompt names the player and says it is not a ban or score change', () => {
  const prompt = dismissPrompt({ userId: 'u', displayName: 'Ada' });
  assert.match(prompt, /"Ada"/);
  assert.match(prompt, /reviewed/);
  assert.match(prompt, /does not change scores or bans/);
});
