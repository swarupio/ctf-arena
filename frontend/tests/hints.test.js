import test from 'node:test';
import assert from 'node:assert/strict';
import { FREE_LINE, HINT_COSTS, costLine, hintCost } from '../src/hints/config.js';
import {
  NO_HINTS_LEVEL, NO_HINTS_TRACK, announcement, buildLadder, needsConfirm, readOpened, storageKey, tierLabel, usedLabel, userKey, writeOpened,
} from '../src/hints/helpers.js';

const memory = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, data };
};
const alice = { email: 'Alice@Example.com' };

test('every category ships free and the line says so', () => {
  for (const category of ['cipherlab', 'crackme', 'osint', 'weblab', 'forensics', 'terminal']) {
    assert.equal(HINT_COSTS[category], 0);
    assert.equal(costLine(category), 'Free: no points deducted');
  }
  assert.equal(FREE_LINE, 'Free: no points deducted');
  assert.ok(Object.isFrozen(HINT_COSTS));
});

test('the cost line is driven by one config object', () => {
  assert.equal(costLine('osint', { osint: 5 }), 'Costs 5 points per hint');
  assert.equal(costLine('osint', { osint: 1 }), 'Costs 1 point per hint');
  assert.equal(costLine('osint', { osint: -3 }), 'Free: no points deducted');
  assert.equal(costLine('osint', { osint: 2.5 }), 'Free: no points deducted');
  assert.equal(hintCost('unknown'), 0);
});

test('tiers are labelled by position and use what the content has', () => {
  assert.deepEqual([1, 2, 3].map((n) => tierLabel(n, 3)), ['Nudge', 'Approach', 'Walkthrough-lite']);
  assert.deepEqual([1, 2].map((n) => tierLabel(n, 2)), ['Nudge', 'Approach']);
  assert.equal(tierLabel(1, 1), 'Nudge');
  assert.deepEqual([1, 2, 3, 4].map((n) => tierLabel(n, 4)), ['Nudge', 'Approach', 'Approach', 'Walkthrough-lite']);
  assert.equal(tierLabel(0, 3), '');
  assert.equal(tierLabel(4, 3), '');
  assert.equal(tierLabel(1, 0), '');
  assert.equal(tierLabel('1', 3), '');
});

test('only the Walkthrough-lite tier needs a confirmation', () => {
  assert.equal(needsConfirm(1, 3), false);
  assert.equal(needsConfirm(2, 3), false);
  assert.equal(needsConfirm(3, 3), true);
  assert.equal(needsConfirm(2, 2), false);
  assert.equal(needsConfirm(1, 1), false);
});

test('the ladder opens one hint at a time and counts them', () => {
  const start = buildLadder({ total: 3, shown: [], category: 'cipherlab' });
  assert.equal(start.kind, 'ladder');
  assert.equal(start.used, 0);
  assert.deepEqual(start.tiers.map((t) => t.state), ['next', 'locked', 'locked']);
  assert.deepEqual(start.next, { position: 1, label: 'Nudge', confirm: false, button: 'Open hint 1 of 3' });
  const mid = buildLadder({ total: 3, shown: ['a', 'b'] });
  assert.equal(mid.used, 2);
  assert.equal(mid.next.button, 'Open hint 3 of 3');
  assert.equal(mid.next.confirm, true);
  assert.deepEqual(mid.tiers.map((t) => t.text), ['a', 'b', null]);
  const done = buildLadder({ total: 3, shown: ['a', 'b', 'c'] });
  assert.equal(done.next, null);
  assert.equal(usedLabel(done.used), 'Hints used: 3');
});

test('the ladder never shows more than the public total and ignores junk', () => {
  const ladder = buildLadder({ total: 2, shown: ['a', 'b', 'c', 7, null] });
  assert.equal(ladder.used, 2);
  assert.equal(ladder.tiers.length, 2);
  assert.equal(buildLadder({ total: 2, shown: 'oops' }).used, 0);
  assert.equal(buildLadder({ total: -1, shown: ['a'] }).kind, 'none');
  assert.equal(buildLadder({ total: 2.5, shown: ['a'] }).kind, 'none');
});

test('no hints: a level without any and a track that disallows them say so', () => {
  const none = buildLadder({ total: 0, shown: [] });
  assert.equal(none.kind, 'none');
  assert.equal(none.message, NO_HINTS_LEVEL);
  const insane = buildLadder({ total: 3, shown: ['leak'], allowed: false });
  assert.equal(insane.kind, 'none');
  assert.equal(insane.message, NO_HINTS_TRACK);
  assert.equal(insane.total, 0);
  assert.deepEqual(insane.tiers, []);
  assert.equal(insane.next, null);
});

test('admin preview shows hints but offers no way to open one', () => {
  const preview = buildLadder({ total: 3, shown: ['a', 'b', 'c'], preview: true });
  assert.equal(preview.preview, true);
  assert.equal(preview.next, null);
  assert.equal(preview.used, 3);
  assert.equal(buildLadder({ total: 3, shown: [], preview: true }).next, null);
  assert.equal(buildLadder({ total: 3, shown: [], canOpen: false }).next, null);
});

test('the announcement names the tier and the count', () => {
  const ladder = buildLadder({ total: 3, shown: ['look at the header'] });
  assert.equal(announcement(ladder, 1), 'Hint 1 of 3 opened, Nudge. look at the header Hints used: 1.');
  assert.equal(announcement(ladder, 2), '');
});

test('opened counts are stored per user and scope and survive a reload', () => {
  const storage = memory();
  assert.equal(readOpened(storage, alice, 'weblab:x', 3), 0);
  assert.equal(writeOpened(storage, alice, 'weblab:x', 2), true);
  assert.equal(writeOpened(storage, alice, 'forensics:easy:1', 1), true);
  assert.equal(readOpened(storage, alice, 'weblab:x', 3), 2);
  assert.equal(readOpened(storage, { email: ' alice@example.com ' }, 'weblab:x', 3), 2);
  assert.equal(readOpened(storage, { email: 'bob@example.com' }, 'weblab:x', 3), 0);
  assert.equal(readOpened(storage, alice, 'forensics:easy:1', 1), 1);
  assert.equal(readOpened(storage, alice, 'weblab:x', 1), 1);
  writeOpened(storage, alice, 'weblab:x', 0);
  assert.equal(readOpened(storage, alice, 'weblab:x', 3), 0);
  assert.equal(readOpened(storage, alice, 'forensics:easy:1', 1), 1);
});

test('corrupt storage reads as nothing opened and never throws', () => {
  const key = storageKey(alice);
  for (const bad of ['{not json', 'null', '[]', '"x"', '42', '{"weblab:x":"3"}', '{"weblab:x":-2}', '{"weblab:x":1.5}', '{"weblab:x":9999}']) {
    const storage = memory({ [key]: bad });
    assert.equal(readOpened(storage, alice, 'weblab:x', 3), 0, bad);
    assert.equal(writeOpened(storage, alice, 'weblab:x', 1), true);
    assert.equal(readOpened(storage, alice, 'weblab:x', 3), 1);
  }
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.equal(readOpened(broken, alice, 's', 3), 0);
  assert.equal(writeOpened(broken, alice, 's', 1), false);
  assert.equal(readOpened(null, alice, 's', 3), 0);
  assert.equal(readOpened(memory({ [key]: '{"__proto__":2}' }), alice, 'polluted', 3), 0);
  assert.equal({}.polluted, undefined);
});

test('user keys are safe and stable', () => {
  assert.equal(userKey(alice), 'alice@example.com');
  assert.equal(userKey(null), 'anonymous');
  assert.equal(userKey({ email: '   ' }), 'anonymous');
  assert.equal(userKey({ email: 'x'.repeat(500) }).length, 200);
});

test('the stored scope list stays bounded', () => {
  const storage = memory();
  for (let i = 0; i < 450; i += 1) { writeOpened(storage, alice, `s${i}`, 1); }
  assert.ok(Object.keys(JSON.parse(storage.getItem(storageKey(alice)))).length <= 400);
  assert.equal(readOpened(storage, alice, 's449', 1), 1);
});
