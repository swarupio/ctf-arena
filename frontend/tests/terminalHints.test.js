import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_HINTS, hintBarView, hintCommand, hintReducer, hintsEnabled, isHintLine, parseHintOutput,
} from '../src/terminal/hintBar.js';

const out = (tier, total, code, text = 'try ls -la') => `[hint ${tier}/${total} for code ${code}] ${text}\n`;
const run = (actions) => actions.reduce(hintReducer, INITIAL_HINTS);

test('parseHintOutput reads the counter the server prints', () => {
  assert.deepEqual(parseHintOutput(out(2, 3, 4)), { tier: 2, total: 3, code: 4 });
  assert.deepEqual(parseHintOutput(`noise\n${out(1, 3, 12)}`), { tier: 1, total: 3, code: 12 });
});

test('parseHintOutput is defensive', () => {
  for (const bad of [undefined, null, 42, '', 'hint 2/3', '[hint 0/3 for code 1] x', '[hint 4/3 for code 1] x', '[hint 1/99 for code 1] x', 'usage: hint [1-3]']) {
    assert.equal(parseHintOutput(bad), null);
  }
  assert.deepEqual(parseHintOutput('No hints are available for code 2. Look around.\n'), { none: true });
});

test('hintCommand builds only plain hint commands', () => {
  assert.equal(hintCommand(), 'hint');
  assert.equal(hintCommand(1), 'hint');
  assert.equal(hintCommand(2), 'hint 2');
  assert.equal(hintCommand(3), 'hint 3');
  for (const bad of ['3', 2.5, -1, 0, NaN, 99, null]) { assert.equal(hintCommand(bad), 'hint'); }
});

test('isHintLine matches only the hint command', () => {
  assert.ok(isHintLine('hint') && isHintLine('hint 2') && isHintLine('  hint 3 '));
  assert.ok(!isHintLine('hint 2 3') && !isHintLine('hints') && !isHintLine('echo hint') && !isHintLine(null));
});

test('reducer counts distinct hints and tracks the next tier', () => {
  let state = run([{ type: 'output', text: out(1, 3, 1) }]);
  assert.equal(state.used.length, 1);
  assert.equal(hintBarView(state, { mode: 'easy' }).nextCommand, 'hint 2');
  state = hintReducer(state, { type: 'output', text: out(1, 3, 1) });
  assert.equal(state.used.length, 1, 'repeating a tier is not a new hint');
  state = hintReducer(state, { type: 'output', text: out(3, 3, 1) });
  assert.equal(state.used.length, 2);
  assert.equal(hintBarView(state, { mode: 'easy' }).nextCommand, null);
});

test('reducer ignores unparsable output and resets the ladder after a solve', () => {
  const opened = run([{ type: 'output', text: out(2, 3, 5) }]);
  assert.equal(hintReducer(opened, { type: 'output', text: 'garbage' }), opened);
  assert.equal(hintReducer(opened, { type: 'nope' }), opened);
  const solved = hintReducer(opened, { type: 'solved' });
  assert.equal(solved.used.length, 1, 'used stays');
  assert.equal(hintBarView(solved, { mode: 'easy' }).nextCommand, null);
  const next = hintReducer(solved, { type: 'output', text: out(1, 3, 6) });
  assert.equal(next.used.length, 2);
  assert.equal(next.code, 6);
});

test('a reply without hints removes the next-hint button', () => {
  const state = run([{ type: 'output', text: out(1, 3, 1) }, { type: 'output', text: 'No hints are available for code 2.\n' }]);
  assert.equal(state.none, true);
  assert.equal(hintBarView(state, { mode: 'easy' }).nextCommand, null);
});

test('view: cost line, tier label, admin has no counter, hint-less modes hide', () => {
  const state = run([{ type: 'output', text: out(2, 3, 1) }]);
  const view = hintBarView(state, { mode: 'hard' });
  assert.equal(view.visible, true);
  assert.equal(view.usedText, 'Hints used: 1');
  assert.equal(view.costText, 'Free: no points deducted');
  assert.equal(view.tierText, 'Hint 2 of 3, Approach');
  assert.equal(hintBarView(state, { mode: 'hard', isAdmin: true }).usedText, null);
  assert.equal(hintBarView(INITIAL_HINTS, { mode: 'easy' }).tierText, '');
  assert.equal(hintBarView(INITIAL_HINTS, { mode: 'insane' }).visible, false);
  assert.equal(hintsEnabled(''), false);
});
