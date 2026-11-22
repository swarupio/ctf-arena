import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceChanged } from '../src/admin/draftSync.js';
import { settingsPatch, settingsToDraft } from '../src/admin/forms.js';
import {
  FREE_HINTS, HINT_COST_DEFAULTS, costsBody, costsDirty, costsToDraft, hintPoints, isFreeDraft, presetDraft, previewRows, validateCostsDraft,
} from '../src/admin/hintCostsForm.js';

test('a saved object becomes text inputs; missing or bad values fall back to the defaults', () => {
  assert.deepEqual(costsToDraft(HINT_COST_DEFAULTS), { enabled: true, nudge: '5', approach: '10', walkthrough: '25', maxPercent: '40' });
  assert.deepEqual(costsToDraft(undefined), costsToDraft(HINT_COST_DEFAULTS));
  assert.deepEqual(costsToDraft({ enabled: false, nudge: 'x', approach: -1, walkthrough: 7, maxPercent: 101 }), {
    enabled: false, nudge: '5', approach: '10', walkthrough: '7', maxPercent: '40',
  });
});

test('validation: whole numbers 0..100 only', () => {
  assert.deepEqual(validateCostsDraft(costsToDraft(HINT_COST_DEFAULTS)), {});
  assert.deepEqual(validateCostsDraft({ ...costsToDraft(FREE_HINTS) }), {});
  const bad = validateCostsDraft({ enabled: true, nudge: '', approach: '101', walkthrough: '2.5', maxPercent: '-3' });
  assert.deepEqual(Object.keys(bad).sort(), ['approach', 'maxPercent', 'nudge', 'walkthrough']);
  assert.match(bad.nudge, /Enter a number/);
  assert.match(bad.approach, /whole number from 0 to 100/);
  assert.ok(validateCostsDraft({ ...costsToDraft(HINT_COST_DEFAULTS), nudge: 'abc' }).nudge);
  assert.ok(validateCostsDraft({ ...costsToDraft(HINT_COST_DEFAULTS), nudge: '1e2' }).nudge);
  assert.equal(validateCostsDraft({ ...costsToDraft(HINT_COST_DEFAULTS), nudge: ' 100 ' }).nudge, undefined);
});

test('the PUT body has numbers and exactly the five keys', () => {
  const body = costsBody({ enabled: false, nudge: '1', approach: '2', walkthrough: '3', maxPercent: '4' });
  assert.deepEqual(body, { hintCosts: { enabled: false, nudge: 1, approach: 2, walkthrough: 3, maxPercent: 4 } });
});

test('dirty compares against the saved values, ignoring spaces', () => {
  const draft = costsToDraft(HINT_COST_DEFAULTS);
  assert.equal(costsDirty(HINT_COST_DEFAULTS, draft), false);
  assert.equal(costsDirty(HINT_COST_DEFAULTS, { ...draft, nudge: ' 5 ' }), false);
  assert.equal(costsDirty(HINT_COST_DEFAULTS, { ...draft, nudge: '6' }), true);
  assert.equal(costsDirty(HINT_COST_DEFAULTS, { ...draft, enabled: false }), true);
  assert.equal(costsDirty(undefined, draft), false);
});

test('presets: free hints is all zero, defaults match the server defaults', () => {
  assert.deepEqual(presetDraft(FREE_HINTS), { enabled: true, nudge: '0', approach: '0', walkthrough: '0', maxPercent: '0' });
  assert.deepEqual(presetDraft(HINT_COST_DEFAULTS), costsToDraft(HINT_COST_DEFAULTS));
  assert.equal(isFreeDraft(presetDraft(FREE_HINTS)), true);
  assert.equal(isFreeDraft(presetDraft(HINT_COST_DEFAULTS)), false);
  assert.equal(isFreeDraft({ ...presetDraft(HINT_COST_DEFAULTS), enabled: false }), true);
});

test('hintPoints follows the server rules', () => {
  assert.equal(hintPoints(100, 10), 10);
  assert.equal(hintPoints(10, 5), 1);
  assert.equal(hintPoints(9, 5), 0);
  assert.equal(hintPoints(100, 0), 0);
  assert.equal(hintPoints(0, 50), 0);
});

test('the preview table shows cost per tier, the cap and the net for 10, 50, 100 and 300 point levels', () => {
  const rows = previewRows(costsToDraft(HINT_COST_DEFAULTS));
  assert.deepEqual(rows.map((row) => row.base), [10, 50, 100, 300]);
  assert.deepEqual(rows[0], { base: 10, nudge: 1, approach: 1, walkthrough: 3, cap: 4, spent: 4, net: 6 });
  assert.deepEqual(rows[1], { base: 50, nudge: 3, approach: 5, walkthrough: 13, cap: 20, spent: 20, net: 30 });
  assert.deepEqual(rows[2], { base: 100, nudge: 5, approach: 10, walkthrough: 25, cap: 40, spent: 40, net: 60 });
  assert.deepEqual(rows[3], { base: 300, nudge: 15, approach: 30, walkthrough: 75, cap: 120, spent: 120, net: 180 });
});

test('the preview respects the cap, the 1 point floor, the switch, and shows nothing for an invalid draft', () => {
  const capped = previewRows({ enabled: true, nudge: '50', approach: '50', walkthrough: '50', maxPercent: '20' });
  assert.equal(capped[2].spent, 20);
  assert.equal(capped[2].net, 80);
  const all = previewRows({ enabled: true, nudge: '100', approach: '100', walkthrough: '100', maxPercent: '100' });
  assert.equal(all[0].net, 1);
  const off = previewRows({ ...costsToDraft(HINT_COST_DEFAULTS), enabled: false });
  assert.ok(off.every((row) => row.spent === 0 && row.net === row.base && row.cap === 0));
  const broken = previewRows({ ...costsToDraft(HINT_COST_DEFAULTS), nudge: 'x' });
  assert.ok(broken.every((row) => row.net === null && row.cap === null));
});

test('hint costs are their own slice: they do not touch the settings form draft or its patch', () => {
  const before = { registrationOpen: true, submissionsFrozen: false, announcement: { text: '', level: 'info' }, hintCosts: HINT_COST_DEFAULTS };
  const after = { ...before, hintCosts: { ...HINT_COST_DEFAULTS, nudge: 9 } };
  assert.equal(sliceChanged(settingsToDraft(before), settingsToDraft(after)), false);
  assert.deepEqual(settingsPatch(after, settingsToDraft(after)), {});
  assert.equal(sliceChanged(before.hintCosts, after.hintCosts), true);
});
