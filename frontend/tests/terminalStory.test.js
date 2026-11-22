import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAR, countKey, isUnread, loadCommandCount, loadMailSeen, mailChipLabel, mailIds, mailKey, mailNotice, markRead,
  newMailNotice, parBadge, parseMailRead, saveCommandCount, saveMailSeen, unreadCount,
} from '../src/terminal/mail.js';
import { bootLines } from '../src/terminal/viewModel.js';
import { COMMANDS } from '../src/terminal/data.js';

const memory = () => {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), map };
};

test('mail ids follow the solved codes exactly like the server: 1, n + 1, and total + 2 when all are solved', () => {
  assert.deepEqual(mailIds([], 4), [1]);
  assert.deepEqual(mailIds([{ n: 2 }], 4), [1, 3]);
  assert.deepEqual(mailIds([{ n: 3 }, { n: 1 }], 4), [1, 2, 4]);
  assert.deepEqual(mailIds([1, 2, 3, 4], 4), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(mailIds([1, 2, 3, 4, 5], 5), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(mailIds([{ n: 1 }, { n: 1 }], 4), [1, 2]);
});

test('mail ids ignore junk and never invent an epilogue without a known total', () => {
  assert.deepEqual(mailIds(null, 4), [1]);
  assert.deepEqual(mailIds(undefined, undefined), [1]);
  assert.deepEqual(mailIds([{ n: 'x' }, null, { n: 0 }, { n: -2 }, { n: 99 }], 4), [1]);
  assert.deepEqual(mailIds([1, 2], 0), [1, 2, 3]);
  assert.deepEqual(mailIds([1], 'four'), [1, 2]);
});

test('unread counting and marking use a small bit mask', () => {
  assert.equal(unreadCount([1, 2, 3], 0), 3);
  assert.equal(unreadCount([1, 2, 3], markRead(0, [2])), 2);
  assert.equal(isUnread(markRead(0, [2]), 2), false);
  assert.equal(isUnread(markRead(0, [2]), 3), true);
  assert.equal(markRead(0, [1, 2, 3]), 14);
  assert.equal(markRead(14, [2]), 14);
  assert.equal(markRead(0, [0, 12, 99, -1, 1.5]), 0); // out of range ids are ignored (server mask stops at bit 11)
  assert.equal(markRead(0, [11]), 2048);
  assert.ok(markRead(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) <= 0xfff);
  assert.equal(unreadCount([1], -5), 1);
  assert.equal(unreadCount([1], 5000), 1);
});

test('only a successful `mail N` line counts as reading', () => {
  assert.deepEqual(parseMailRead('mail 2'), [2]);
  assert.deepEqual(parseMailRead('  mail   2   3 '), [2, 3]);
  assert.deepEqual(parseMailRead('mail'), []);
  assert.deepEqual(parseMailRead('mail -h'), []);
  assert.deepEqual(parseMailRead('mail 2 | head'), []);
  assert.deepEqual(parseMailRead('mail abc'), []);
  assert.deepEqual(parseMailRead('mail 1234'), []);
  assert.deepEqual(parseMailRead('cat mail 2'), []);
  assert.deepEqual(parseMailRead(undefined), []);
});

test('the notices read well in the singular and the plural', () => {
  assert.equal(mailNotice(0), null);
  assert.equal(mailNotice(1), 'You have 1 unread message. Type mail to read it.');
  assert.equal(mailNotice(3), 'You have 3 unread messages. Type mail to read them.');
  assert.match(newMailNotice(), /new mail/);
  assert.equal(mailChipLabel(0), 'mail, no unread messages');
  assert.equal(mailChipLabel(1), 'mail, 1 unread message');
  assert.equal(mailChipLabel(2), 'mail, 2 unread messages');
});

test('the boot text gets the unread notice before the closing hint, and is unchanged without one', () => {
  assert.deepEqual(bootLines(['a'], mailNotice(2)), ['a', '', 'You have 2 unread messages. Type mail to read them.', 'Type help to begin.']);
  assert.deepEqual(bootLines(['a']), ['a', '', 'Type help to begin.']);
  assert.deepEqual(bootLines([], 'note'), ['note', 'Type help to begin.']);
  assert.deepEqual(bootLines(undefined, null), ['Type help to begin.']);
  assert.deepEqual(bootLines(['a'], ''), ['a', '', 'Type help to begin.']);
});

test('read marks and command counts are stored per mode and survive broken storage', () => {
  const storage = memory();
  const me = 'Ann@Example.com';
  saveMailSeen(storage, me, 'easy', 6);
  assert.equal(loadMailSeen(storage, me, 'easy'), 6);
  assert.equal(loadMailSeen(storage, me, 'hard'), 0);
  assert.equal(storage.map.get(mailKey(me, 'easy')), '6');
  assert.equal(loadMailSeen(storage, 'bob@example.com', 'easy'), 0, 'a second account has its own read marks');
  assert.notEqual(mailKey(me, 'easy'), mailKey('bob@example.com', 'easy'));
  assert.notEqual(countKey(me, 'easy'), countKey('bob@example.com', 'easy'));
  assert.equal(mailKey('', 'easy'), '');
  assert.equal(countKey(null, 'easy'), '');
  saveMailSeen(storage, undefined, 'easy', 6);
  saveCommandCount(storage, undefined, 'easy', 6);
  assert.equal(storage.map.size, 1, 'signed out persists nothing');
  assert.equal(loadMailSeen(storage, undefined, 'easy'), 0);
  saveMailSeen(storage, me, 'easy', 99999);
  assert.equal(loadMailSeen(storage, me, 'easy'), 0);
  storage.setItem(mailKey(me, 'medium'), 'junk');
  assert.equal(loadMailSeen(storage, me, 'medium'), 0);
  saveCommandCount(storage, me, 'easy', 7);
  assert.equal(loadCommandCount(storage, me, 'easy'), 7);
  assert.equal(storage.map.get(countKey(me, 'easy')), '7');
  saveCommandCount(storage, me, 'easy', -3);
  assert.equal(loadCommandCount(storage, me, 'easy'), 0);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadMailSeen(broken, me, 'easy'), 0);
  assert.equal(loadCommandCount(null, me, 'easy'), 0);
  assert.doesNotThrow(() => saveMailSeen(broken, me, 'easy', 2));
  assert.doesNotThrow(() => saveCommandCount(null, me, 'easy', 2));
});

test('the par badge is cosmetic: Minimalist at or under par, a plain count above it, nothing without commands', () => {
  assert.deepEqual(parBadge('easy', 3), { minimalist: true, text: 'Minimalist: captured in 3 commands' });
  assert.deepEqual(parBadge('easy', 1), { minimalist: true, text: 'Minimalist: captured in 1 command' });
  assert.deepEqual(parBadge('easy', PAR.easy), { minimalist: true, text: `Minimalist: captured in ${PAR.easy} commands` });
  assert.deepEqual(parBadge('easy', PAR.easy + 1), { minimalist: false, text: `Captured in ${PAR.easy + 1} commands` });
  assert.equal(parBadge('hard', 0), null);
  assert.equal(parBadge('hard', NaN), null);
  assert.equal(parBadge('hard', 2.5), null);
  assert.equal(parBadge('nightmare', 3).minimalist, false);
  assert.ok(PAR.easy < PAR.medium && PAR.medium < PAR.hard);
});

test('Tab completion offers the new story commands', () => {
  for (const name of ['mail', 'make', 'novi', 'whoami']) assert.ok(COMMANDS.includes(name), name);
  assert.equal(new Set(COMMANDS).size, COMMANDS.length);
});
