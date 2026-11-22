import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceChanged, stableKey } from '../src/admin/draftSync.js';
import { settingsToDraft } from '../src/admin/forms.js';

test('the key ignores object identity and key order', () => {
  assert.equal(stableKey({ a: 1, b: { c: 2, d: [1, { x: 1, y: 2 }] } }), stableKey({ b: { d: [1, { y: 2, x: 1 }], c: 2 }, a: 1 }));
  assert.notEqual(stableKey({ a: 1 }), stableKey({ a: 2 }));
  assert.equal(stableKey(undefined), 'null');
});

test('saving the event does not change the settings slice', () => {
  const before = { registrationOpen: true, submissionsFrozen: false, announcement: { text: 'hi', level: 'info' }, event: null, updatedAt: 'a' };
  const after = { ...before, event: { name: 'Cup', phase: 'upcoming' }, updatedAt: 'b' };
  assert.equal(sliceChanged(settingsToDraft(before), settingsToDraft(after)), false);
  assert.equal(sliceChanged(before.event, after.event), true);
});

test('saving the banner changes the settings slice but not the event slice', () => {
  const event = { name: 'Cup', phase: 'live', startsAt: 'x', endsAt: 'y' };
  const before = { announcement: { text: '', level: 'info' }, event };
  const after = { announcement: { text: 'Maintenance', level: 'warning' }, event: { ...event } };
  assert.equal(sliceChanged(settingsToDraft(before), settingsToDraft(after)), true);
  assert.equal(sliceChanged(before.event, after.event), false);
});
