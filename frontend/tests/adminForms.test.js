import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_CHALLENGE, challengeBody, challengeToForm, formatAttachments, importSummary, isReadOnlyType, parseAttachments, readOnlyNote,
  settingsPatch, settingsToDraft, typedMatches, validateAdjustment, validateChallenge, validateReason, validateSettings,
} from '../src/admin/forms.js';
import { trapIndex } from '../src/components/admin/useModal.js';
import {
  DISMISS_KEY, bannerLevel, bannerRole, bannerSignature, dismiss, isDismissed, visibleAnnouncement,
} from '../src/components/announcement.js';

const form = (changes = {}) => ({ ...EMPTY_CHALLENGE, slug: 'cookie-monster', title: 'Cookie Monster', flag: 'CTF{x}', ...changes });

test('challenge form validation mirrors the API rules', () => {
  assert.deepEqual(validateChallenge(form()), {});
  assert.ok(validateChallenge(form({ slug: 'Bad Slug' })).slug);
  assert.ok(validateChallenge(form({ slug: 'a--b' })).slug);
  assert.ok(validateChallenge(form({ title: '  ' })).title);
  assert.ok(validateChallenge(form({ points: 0 })).points);
  assert.ok(validateChallenge(form({ points: 10001 })).points);
  assert.ok(validateChallenge(form({ points: 1.5 })).points);
  assert.ok(validateChallenge(form({ flag: '' })).flag);
  assert.equal(validateChallenge(form({ flag: '' }), { editing: true }).flag, undefined);
  assert.ok(validateChallenge(form({ type: 'docker', image: 'nginx' })).image);
  assert.ok(validateChallenge(form({ type: 'docker', image: 'ctf/x', internalPort: 70000 })).internalPort);
  assert.deepEqual(validateChallenge(form({ type: 'docker', image: 'ctf/x', internalPort: 80, flag: '' })), {});
  assert.ok(validateChallenge(form({ attachments: 'a | javascript:alert(1)' })).attachments);
  assert.ok(validateChallenge(form({ attachments: 'a | //evil.test/x' })).attachments);
  assert.deepEqual(validateChallenge(form({ attachments: 'a | /files/a.txt\nb | https://x.test/b' })), {});
});

test('challenge body: flag only when typed, docker fields only for docker, attachments parsed', () => {
  const stat = challengeBody(form({ flag: ' CTF{x} ' }));
  assert.equal(stat.flag, 'CTF{x}');
  assert.equal(stat.image, undefined);
  assert.equal(stat.points, 100);
  assert.deepEqual(stat.attachments, []);
  assert.equal(challengeBody(form({ flag: '' })).flag, undefined);
  const docker = challengeBody(form({ type: 'docker', image: ' ctf/x ', internalPort: '80', flag: 'ignored' }));
  assert.equal(docker.image, 'ctf/x');
  assert.equal(docker.internalPort, 80);
  assert.equal(docker.flag, undefined);
});

test('attachments round trip and challengeToForm never carries a flag', () => {
  assert.deepEqual(parseAttachments('cipher.txt | /files/cipher.txt\n\n/files/raw.bin'), [
    { name: 'cipher.txt', url: '/files/cipher.txt' }, { name: 'raw.bin', url: '/files/raw.bin' },
  ]);
  assert.equal(formatAttachments([{ name: 'a', url: '/a' }]), 'a | /a');
  assert.equal(formatAttachments(undefined), '');
  const edited = challengeToForm({ slug: 's', title: 'T', category: 'web', difficulty: 'hard', points: 5, type: 'docker', image: 'ctf/s', internalPort: 81, visible: false, hasFlag: true, flag: 'LEAK', attachments: [{ name: 'a', url: '/a' }] });
  assert.equal(edited.flag, '');
  assert.equal(edited.visible, false);
  assert.equal(edited.attachments, 'a | /a');
});

test('terminal and game challenges are read-only with an explanation', () => {
  assert.equal(isReadOnlyType('terminal'), true);
  assert.equal(isReadOnlyType('game'), true);
  assert.equal(isReadOnlyType('static'), false);
  assert.match(readOnlyNote('terminal'), /seed script/);
  assert.match(readOnlyNote('game'), /managed by their category/);
  assert.equal(readOnlyNote('static'), '');
});

test('score adjustments need a non-zero whole number within limits and a reason', () => {
  assert.deepEqual(validateAdjustment({ points: '-50', reason: 'shared hint' }), { errors: {}, body: { points: -50, reason: 'shared hint' } });
  assert.deepEqual(validateAdjustment({ points: '+25', reason: ' bonus ' }).body, { points: 25, reason: 'bonus' });
  for (const points of ['', '0', 'abc', '1.5', '10001', '-10001', '1e3']) assert.ok(validateAdjustment({ points, reason: 'valid reason' }).errors.points, points);
  assert.ok(validateAdjustment({ points: '5', reason: 'ab' }).errors.reason);
  assert.ok(validateAdjustment({ points: '5', reason: 'x'.repeat(201) }).errors.reason);
  assert.equal(validateAdjustment({ points: '0', reason: '' }).body, null);
  assert.equal(validateAdjustment({ points: '10000', reason: 'max' }).errors.points, undefined);
});

test('reasons and notes are length checked after trimming', () => {
  assert.equal(validateReason('abc'), '');
  assert.match(validateReason('  a  '), /at least 3/);
  assert.match(validateReason('x'.repeat(501), { max: 500 }), /under 500/);
  assert.equal(validateReason('x'.repeat(500), { max: 500 }), '');
});

test('typed confirmation needs the exact phrase', () => {
  assert.equal(typedMatches('RESET', 'RESET'), true);
  assert.equal(typedMatches('  RESET ', 'RESET'), true);
  assert.equal(typedMatches('reset', 'RESET'), false);
  assert.equal(typedMatches('', 'RESET'), false);
  assert.equal(typedMatches('', ''), false);
  assert.equal(typedMatches('cookie-monster', 'cookie-monster'), true);
});

test('settings patch holds only what changed and validates the announcement', () => {
  const saved = { registrationOpen: true, submissionsFrozen: false, announcement: { text: 'Hello', level: 'info' } };
  const draft = settingsToDraft(saved);
  assert.deepEqual(settingsPatch(saved, draft), {});
  assert.deepEqual(settingsPatch(saved, { ...draft, submissionsFrozen: true }), { submissionsFrozen: true });
  assert.deepEqual(settingsPatch(saved, { ...draft, announcement: { text: ' Hi ', level: 'info' } }), { announcement: { text: 'Hi', level: 'info' } });
  assert.deepEqual(settingsPatch(saved, { ...draft, announcement: { text: 'Hello', level: 'critical' } }), { announcement: { text: 'Hello', level: 'critical' } });
  assert.deepEqual(settingsPatch({ registrationOpen: true, submissionsFrozen: false }, settingsToDraft({})), {});
  assert.equal(settingsToDraft(undefined).registrationOpen, true);
  assert.deepEqual(validateSettings({ announcement: { text: 'x'.repeat(501), level: 'info' } }), { announcement: 'Keep the announcement under 500 characters.' });
  assert.ok(validateSettings({ announcement: { text: '', level: 'loud' } }).level);
  assert.deepEqual(validateSettings(draft), {});
});

test('import summary counts every group', () => {
  assert.deepEqual(importSummary({ created: ['a'], updated: ['b', 'c'], skipped: [], needsFlag: ['a'], errors: [{}] }), {
    created: 1, updated: 2, skipped: 0, needsFlag: 1, errors: 1, writes: 3,
  });
  assert.equal(importSummary(null).writes, 0);
});

test('focus trap wraps in both directions', () => {
  assert.equal(trapIndex(-1, 3, false), 0);
  assert.equal(trapIndex(-1, 3, true), 2);
  assert.equal(trapIndex(2, 3, false), 0);
  assert.equal(trapIndex(0, 3, true), 2);
  assert.equal(trapIndex(1, 3, false), 2);
  assert.equal(trapIndex(1, 3, true), 0);
  assert.equal(trapIndex(0, 0, false), -1);
});

test('announcement banner: levels, ARIA role, visibility and per-session dismissal', () => {
  assert.equal(bannerLevel('warning'), 'warning');
  assert.equal(bannerLevel('<script>'), 'info');
  assert.equal(bannerRole('critical'), 'alert');
  assert.equal(bannerRole('warning'), 'status');
  assert.equal(bannerRole('nonsense'), 'status');
  assert.deepEqual(visibleAnnouncement({ announcement: { text: ' Starts at 18:00 ', level: 'warning' } }), { text: 'Starts at 18:00', level: 'warning' });
  for (const none of [null, {}, { announcement: { text: '   ', level: 'info' } }, { announcement: { text: 5 } }]) assert.equal(visibleAnnouncement(none), null);

  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const a = { text: 'Hello', level: 'info' };
  assert.equal(isDismissed(a, storage), false);
  dismiss(a, storage);
  assert.equal(store.get(DISMISS_KEY), bannerSignature(a));
  assert.equal(isDismissed(a, storage), true);
  assert.equal(isDismissed({ text: 'Hello again', level: 'info' }, storage), false);
  assert.equal(isDismissed({ text: 'Hello', level: 'critical' }, storage), false);
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(isDismissed(a, blocked), false);
  assert.doesNotThrow(() => dismiss(a, blocked));
});
