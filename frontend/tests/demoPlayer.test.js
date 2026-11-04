import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEEDS, advance, autoplayDelay, clampHop, clampIndex, clampSpeed, formatClock, hasHops, hopCounter, hopDelay,
  hopsOf, isAtEnd, isFinished, keyAction, nextIndex, phaseRanges, playbackDelay, prevIndex, progressPercent,
  retreat, servedByAt, stepCounter, stepDelay,
} from '../src/pages/demoPlayer.js';
import { STEPS } from '../src/demo/demoScript.js';

const TOTAL = 20;

const hop = (edge, extra = {}) => ({ edge, title: 'T', text: 'x', lines: [0], ...extra });
// Three steps with 3, 1 and 2 hops (the 1-hop step stands in for a step with only a synthesized hop).
const SCRIPT = [
  { duration: 9000, hops: [hop(['browser', 'nginx']), hop(['nginx', 'backend1']), hop(null)], servedBy: 'backend1' },
  { duration: 4000, narration: 'Only narration', log: [{}, {}, {}] },
  { duration: 7000, hops: [hop(['browser', 'nginx']), hop(['backend2', 'mongo'])], servedBy: 'backend2' },
];

test('supported speeds are the four documented ones', () => {
  assert.deepEqual([...SPEEDS], [0.5, 1, 2, 4]);
});

test('clampIndex keeps the index between before-start (-1) and the last step', () => {
  assert.equal(clampIndex(-1, TOTAL), -1);
  assert.equal(clampIndex(0, TOTAL), 0);
  assert.equal(clampIndex(19, TOTAL), 19);
  assert.equal(clampIndex(20, TOTAL), 19);
  assert.equal(clampIndex(500, TOTAL), 19);
  assert.equal(clampIndex(-7, TOTAL), -1);
  assert.equal(clampIndex(3.9, TOTAL), 3);
  assert.equal(clampIndex(Infinity, TOTAL), 19);
  assert.equal(clampIndex(NaN, TOTAL), -1);
  assert.equal(clampIndex(undefined, TOTAL), -1);
  assert.equal(clampIndex(4, 0), -1, 'an empty script has no steps');
  assert.equal(clampIndex(4, undefined), -1);
});

test('nextIndex starts the demo from -1 and stops on the last step', () => {
  assert.equal(nextIndex(-1, TOTAL), 0);
  assert.equal(nextIndex(0, TOTAL), 1);
  assert.equal(nextIndex(18, TOTAL), 19);
  assert.equal(nextIndex(19, TOTAL), 19);
  assert.equal(nextIndex(99, TOTAL), 19);
  assert.equal(nextIndex(-50, TOTAL), 0);
  assert.equal(nextIndex(0, 0), -1);
  assert.equal(nextIndex(0, 1), 0);
});

test('prevIndex steps back and never goes below before-start', () => {
  assert.equal(prevIndex(19), 18);
  assert.equal(prevIndex(1), 0);
  assert.equal(prevIndex(0), -1);
  assert.equal(prevIndex(-1), -1);
  assert.equal(prevIndex(-9), -1);
  assert.equal(prevIndex(NaN), -1);
});

test('isFinished is true only on the last step', () => {
  assert.equal(isFinished(-1, TOTAL), false);
  assert.equal(isFinished(0, TOTAL), false);
  assert.equal(isFinished(18, TOTAL), false);
  assert.equal(isFinished(19, TOTAL), true);
  assert.equal(isFinished(25, TOTAL), true);
  assert.equal(isFinished(0, 1), true);
  assert.equal(isFinished(-1, 0), false, 'nothing to finish without steps');
});

test('stepDelay scales with speed and never drops under 400ms', () => {
  assert.equal(stepDelay(4000, 1), 4000);
  assert.equal(stepDelay(4000, 0.5), 8000);
  assert.equal(stepDelay(4000, 2), 2000);
  assert.equal(stepDelay(4000, 4), 1000);
  assert.equal(stepDelay(1200, 4), 400);
  assert.equal(stepDelay(100, 1), 400);
  assert.equal(stepDelay(0, 1), 4000, 'a missing duration falls back to 4s');
  assert.equal(stepDelay(undefined, 2), 2000);
  assert.equal(stepDelay(NaN, 1), 4000);
});

test('speed is clamped to 0.5x..4x and garbage means normal speed', () => {
  assert.equal(clampSpeed(8), 4);
  assert.equal(clampSpeed(0.1), 0.5);
  assert.equal(clampSpeed(3), 3);
  assert.equal(clampSpeed(0), 1);
  assert.equal(clampSpeed(-2), 1);
  assert.equal(clampSpeed(NaN), 1);
  assert.equal(clampSpeed('fast'), 1);
  assert.equal(stepDelay(4000, 100), 1000, 'too fast is treated as 4x');
  assert.equal(stepDelay(4000, 0.01), 8000, 'too slow is treated as 0.5x');
  assert.equal(stepDelay(4000, 0), 4000);
  assert.equal(stepDelay(4000, -1), 4000);
});

test('autoplayDelay uses the intro pause before the first step and the step duration after', () => {
  const steps = [{ duration: 3000 }, { duration: 6000 }, {}];
  assert.equal(autoplayDelay(steps, -1, 1), 1200);
  assert.equal(autoplayDelay(steps, -1, 4), 400);
  assert.equal(autoplayDelay(steps, 0, 1), 3000);
  assert.equal(autoplayDelay(steps, 1, 2), 3000);
  assert.equal(autoplayDelay(steps, 2, 1), 4000, 'no duration falls back to 4s');
  assert.equal(autoplayDelay(steps, 9, 1), 4000, 'unknown step falls back to 4s');
  assert.equal(autoplayDelay(undefined, 0, 1), 4000);
});

test('phaseRanges groups contiguous steps by phase with inclusive bounds', () => {
  const steps = [
    { phase: 'Login' }, { phase: 'Login' }, { phase: 'Play' }, { phase: 'Play' }, { phase: 'Play' },
    { phase: 'Score' }, { phase: 'Login' },
  ];
  assert.deepEqual(phaseRanges(steps), [
    { phase: 'Login', start: 0, end: 1 },
    { phase: 'Play', start: 2, end: 4 },
    { phase: 'Score', start: 5, end: 5 },
    { phase: 'Login', start: 6, end: 6 },
  ]);
  assert.deepEqual(phaseRanges([]), []);
  assert.deepEqual(phaseRanges(undefined), []);
  assert.deepEqual(phaseRanges([{ phase: 'Only' }]), [{ phase: 'Only', start: 0, end: 0 }]);
});

test('phaseRanges covers every step exactly once', () => {
  const steps = Array.from({ length: 12 }, (_, i) => ({ phase: ['A', 'B', 'C'][Math.floor(i / 5)] }));
  const ranges = phaseRanges(steps);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[ranges.length - 1].end, steps.length - 1);
  ranges.slice(1).forEach((range, i) => assert.equal(range.start, ranges[i].end + 1));
});

test('progressPercent counts the current step as done', () => {
  assert.equal(progressPercent(-1, TOTAL), 0);
  assert.equal(progressPercent(0, TOTAL), 5);
  assert.equal(progressPercent(9, TOTAL), 50);
  assert.equal(progressPercent(19, TOTAL), 100);
  assert.equal(progressPercent(40, TOTAL), 100);
  assert.equal(progressPercent(0, 3), 33.33);
  assert.equal(progressPercent(5, 0), 0);
  assert.equal(progressPercent(NaN, TOTAL), 0);
});

test('stepCounter reads like the control bar label', () => {
  assert.equal(stepCounter(6, TOTAL), 'Step 7 of 20');
  assert.equal(stepCounter(-1, TOTAL), 'Step 0 of 20');
  assert.equal(stepCounter(19, TOTAL), 'Step 20 of 20');
  assert.equal(stepCounter(99, TOTAL), 'Step 20 of 20');
});

test('formatClock renders the game clock', () => {
  assert.equal(formatClock(12), 'T+12:00');
  assert.equal(formatClock(0), 'T+00:00');
  assert.equal(formatClock(5), 'T+05:00');
  assert.equal(formatClock(12.5), 'T+12:30');
  assert.equal(formatClock(125), 'T+125:00');
  assert.equal(formatClock('7:05'), 'T+07:05');
  assert.equal(formatClock(undefined), 'T+00:00');
  assert.equal(formatClock(-3), 'T+00:00');
});

test('keyboard shortcuts map to player actions', () => {
  const body = { tagName: 'BODY' };
  assert.equal(keyAction({ key: 'ArrowRight', target: body }), 'next');
  assert.equal(keyAction({ key: 'ArrowLeft', target: body }), 'prev');
  assert.equal(keyAction({ key: ' ', target: body }), 'toggle');
  assert.equal(keyAction({ key: 'r', target: body }), 'restart');
  assert.equal(keyAction({ key: 'R', target: body }), 'restart');
  assert.equal(keyAction({ key: 'x', target: body }), null);
  assert.equal(keyAction({ key: 'Enter', target: body }), null);
  assert.equal(keyAction(undefined), null);
});

test('keyboard shortcuts leave typing controls and modified keys alone', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(keyAction({ key: ' ', target: { tagName } }), null);
    assert.equal(keyAction({ key: 'ArrowRight', target: { tagName } }), null);
    assert.equal(keyAction({ key: 'r', target: { tagName } }), null);
  }
  assert.equal(keyAction({ key: 'r', target: { tagName: 'DIV', isContentEditable: true } }), null);
  assert.equal(keyAction({ key: 'r', ctrlKey: true, target: { tagName: 'BODY' } }), null, 'Ctrl+R reloads the page');
  assert.equal(keyAction({ key: 'ArrowLeft', altKey: true, target: { tagName: 'BODY' } }), null, 'Alt+Left is browser back');
  assert.equal(keyAction({ key: 'r', metaKey: true, target: { tagName: 'BODY' } }), null);
});

test('space activates buttons and links natively, arrows and r still work there', () => {
  assert.equal(keyAction({ key: ' ', target: { tagName: 'BUTTON' } }), null);
  assert.equal(keyAction({ key: ' ', target: { tagName: 'button' } }), null);
  assert.equal(keyAction({ key: ' ', target: { tagName: 'A' } }), null);
  assert.equal(keyAction({ key: 'ArrowRight', target: { tagName: 'BUTTON' } }), 'next');
  assert.equal(keyAction({ key: 'ArrowLeft', target: { tagName: 'BUTTON' } }), 'prev');
  assert.equal(keyAction({ key: 'r', target: { tagName: 'BUTTON' } }), 'restart');
});

test('holding space or r does not repeat the action, holding an arrow does', () => {
  const body = { tagName: 'BODY' };
  assert.equal(keyAction({ key: ' ', repeat: true, target: body }), null);
  assert.equal(keyAction({ key: 'r', repeat: true, target: body }), null);
  assert.equal(keyAction({ key: 'ArrowRight', repeat: true, target: body }), 'next');
  assert.equal(keyAction({ key: '.', repeat: true, target: body }), 'nextHop');
});

test('comma and full stop move by hop, and are left alone while typing or with modifiers', () => {
  const body = { tagName: 'BODY' };
  assert.equal(keyAction({ key: '.', target: body }), 'nextHop');
  assert.equal(keyAction({ key: '>', target: body }), 'nextHop');
  assert.equal(keyAction({ key: ',', target: body }), 'prevHop');
  assert.equal(keyAction({ key: '<', target: body }), 'prevHop');
  assert.equal(keyAction({ key: '.', target: { tagName: 'BUTTON' } }), 'nextHop');
  assert.equal(keyAction({ key: ',', target: { tagName: 'INPUT' } }), null);
  assert.equal(keyAction({ key: '.', target: { tagName: 'TEXTAREA' } }), null);
  assert.equal(keyAction({ key: '.', ctrlKey: true, target: body }), null);
  assert.equal(keyAction({ key: ',', metaKey: true, target: body }), null);
});

test('hopsOf returns the real hops, normalised', () => {
  const hops = hopsOf(SCRIPT[0]);
  assert.equal(hops.length, 3);
  assert.deepEqual(hops[0].edge, ['browser', 'nginx']);
  assert.equal(hops[2].edge, null);
  assert.equal(hasHops(SCRIPT[0]), true);
  const messy = hopsOf({ hops: [null, { edge: 'nope', lines: 'all' }, { edge: ['a'], title: undefined, lines: [1, -2, 1.5, 3] }] });
  assert.equal(messy.length, 2, 'entries that are not objects are dropped');
  assert.deepEqual(messy[0], { edge: null, title: 'Step', text: '', lines: [] });
  assert.deepEqual(messy[1], { edge: null, title: 'Step', text: '', lines: [1, 3] });
});

test('hopsOf synthesizes one hop for a step without hops, and never returns an empty list', () => {
  const fallback = { edge: null, title: 'Step', text: 'Only narration', lines: [0, 1, 2] };
  assert.deepEqual(hopsOf(SCRIPT[1]), [fallback]);
  assert.deepEqual(hopsOf({ narration: 'n', hops: [] }), [{ edge: null, title: 'Step', text: 'n', lines: [] }]);
  assert.deepEqual(hopsOf({ hops: [null] }), [{ edge: null, title: 'Step', text: '', lines: [] }]);
  assert.deepEqual(hopsOf(null), [{ edge: null, title: 'Step', text: '', lines: [] }]);
  assert.deepEqual(hopsOf(undefined), [{ edge: null, title: 'Step', text: '', lines: [] }]);
  assert.equal(hasHops(SCRIPT[1]), false);
  assert.equal(hasHops({ hops: [] }), false);
  assert.equal(hasHops(null), false);
});

test('clampHop keeps the hop inside the step and treats garbage as the first hop', () => {
  assert.equal(clampHop(0, 4), 0);
  assert.equal(clampHop(3, 4), 3);
  assert.equal(clampHop(4, 4), 3);
  assert.equal(clampHop(99, 4), 3);
  assert.equal(clampHop(-1, 4), 0);
  assert.equal(clampHop(1.9, 4), 1);
  assert.equal(clampHop(Infinity, 4), 3);
  assert.equal(clampHop(NaN, 4), 0);
  assert.equal(clampHop(undefined, 4), 0);
  assert.equal(clampHop(2, 1), 0, 'a one-hop step only has hop 0');
  assert.equal(clampHop(2, 0), 0, 'a step with no hops has hop 0');
  assert.equal(clampHop(2, undefined), 0);
});

test('hopCounter reads like "Hop 2 of 4"', () => {
  assert.equal(hopCounter(1, 4), 'Hop 2 of 4');
  assert.equal(hopCounter(0, 3), 'Hop 1 of 3');
  assert.equal(hopCounter(9, 3), 'Hop 3 of 3');
  assert.equal(hopCounter(0, 0), 'Hop 1 of 1');
  assert.equal(hopCounter(NaN, 2), 'Hop 1 of 2');
});

test('hopDelay splits the step time over its hops, at least 1.5s at normal speed', () => {
  assert.equal(hopDelay(SCRIPT[0], 1), 3000, '9s over 3 hops');
  assert.equal(hopDelay(SCRIPT[0], 2), 1500);
  assert.equal(hopDelay(SCRIPT[0], 0.5), 6000);
  assert.equal(hopDelay(SCRIPT[0], 4), 750);
  assert.equal(hopDelay(SCRIPT[2], 1), 3500, '7s over 2 hops');
  assert.equal(hopDelay({ duration: 3000, hops: [hop(null), hop(null), hop(null), hop(null)] }, 1), 1500, 'never under 1.5s per hop at 1x');
  assert.equal(hopDelay({ duration: 3000, hops: [hop(null), hop(null), hop(null), hop(null)] }, 4), 400, 'never under 400ms');
  assert.equal(hopDelay(SCRIPT[1], 1), 4000, 'a step without hops is one hop of the whole duration');
});

test('hopDelay survives missing durations, odd steps and wild speeds', () => {
  assert.equal(hopDelay({}, 1), 4000, 'missing duration falls back to 4s');
  assert.equal(hopDelay({ duration: NaN, hops: [hop(null), hop(null)] }, 1), 2000);
  assert.equal(hopDelay(undefined, 1), 4000);
  assert.equal(hopDelay(null, 2), 2000);
  assert.equal(hopDelay(SCRIPT[0], 100), 750, 'too fast is treated as 4x');
  assert.equal(hopDelay(SCRIPT[0], 0.01), 6000, 'too slow is treated as 0.5x');
  assert.equal(hopDelay(SCRIPT[0], 0), 3000);
  assert.equal(hopDelay(SCRIPT[0], NaN), 3000);
});

test('playbackDelay: intro pause, hop delay, and a longer dwell on the last hop of a step', () => {
  assert.equal(playbackDelay(SCRIPT, { index: -1, hop: 0 }, 1), 1200);
  assert.equal(playbackDelay(SCRIPT, { index: -1, hop: 0 }, 4), 400);
  assert.equal(playbackDelay(SCRIPT, { index: 0, hop: 0 }, 1), 3000);
  assert.equal(playbackDelay(SCRIPT, { index: 0, hop: 1 }, 1), 3000);
  assert.equal(playbackDelay(SCRIPT, { index: 0, hop: 2 }, 1), 4800, 'last hop: delay x 1.6');
  assert.equal(playbackDelay(SCRIPT, { index: 0, hop: 2 }, 2), 2400);
  assert.equal(playbackDelay(SCRIPT, { index: 1, hop: 0 }, 1), 6400, 'a single hop is also the last hop');
  assert.equal(playbackDelay(SCRIPT, { index: 2, hop: 9 }, 1), 5600, 'an out-of-range hop is the last hop');
  assert.equal(playbackDelay(SCRIPT, undefined, 1), 1200);
  assert.equal(playbackDelay(undefined, { index: 0, hop: 0 }, 1), 1200, 'no steps means the intro delay');
  assert.equal(playbackDelay(SCRIPT, { index: 0, hop: 2 }, 4), 1200, 'dwell is scaled by speed too, then floored by the 400ms minimum');
});

test('advance walks hop by hop, then step by step, and ends with null', () => {
  assert.deepEqual(advance({ index: 0, hop: 0 }, SCRIPT), { index: 0, hop: 1 });
  assert.deepEqual(advance({ index: 0, hop: 1 }, SCRIPT), { index: 0, hop: 2 });
  assert.deepEqual(advance({ index: 0, hop: 2 }, SCRIPT), { index: 1, hop: 0 }, 'after the last hop comes hop 0 of the next step');
  assert.deepEqual(advance({ index: 1, hop: 0 }, SCRIPT), { index: 2, hop: 0 }, 'a one-hop step moves straight on');
  assert.deepEqual(advance({ index: 2, hop: 0 }, SCRIPT), { index: 2, hop: 1 });
  assert.equal(advance({ index: 2, hop: 1 }, SCRIPT), null, 'last step, last hop');
});

test('advance handles before-start, odd positions and tiny scripts', () => {
  assert.deepEqual(advance({ index: -1, hop: 0 }, SCRIPT), { index: 0, hop: 0 });
  assert.deepEqual(advance(undefined, SCRIPT), { index: 0, hop: 0 });
  assert.deepEqual(advance({ index: 0, hop: 99 }, SCRIPT), { index: 1, hop: 0 }, 'hop is clamped to the last hop');
  assert.deepEqual(advance({ index: 0, hop: -5 }, SCRIPT), { index: 0, hop: 1 });
  assert.equal(advance({ index: 99, hop: 0 }, SCRIPT).index, 2, 'index is clamped to the last step');
  assert.equal(advance({ index: 99, hop: 99 }, SCRIPT), null);
  assert.equal(advance({ index: 0, hop: 0 }, []), null);
  assert.equal(advance({ index: 0, hop: 0 }, undefined), null);
  assert.deepEqual(advance({ index: 0, hop: 0 }, [SCRIPT[0]]), { index: 0, hop: 1 }, 'one step can still have hops');
  assert.equal(advance({ index: 0, hop: 0 }, [SCRIPT[1]]), null, 'one step with one hop has nowhere to go');
});

test('retreat is the exact inverse of advance and stops at the very start', () => {
  assert.deepEqual(retreat({ index: 0, hop: 2 }, SCRIPT), { index: 0, hop: 1 });
  assert.deepEqual(retreat({ index: 0, hop: 1 }, SCRIPT), { index: 0, hop: 0 });
  assert.equal(retreat({ index: 0, hop: 0 }, SCRIPT), null, 'first hop of the first step');
  assert.deepEqual(retreat({ index: 1, hop: 0 }, SCRIPT), { index: 0, hop: 2 }, 'lands on the last hop of the previous step');
  assert.deepEqual(retreat({ index: 2, hop: 0 }, SCRIPT), { index: 1, hop: 0 }, 'previous step has a single hop');
  assert.deepEqual(retreat({ index: 2, hop: 1 }, SCRIPT), { index: 2, hop: 0 });
  assert.equal(retreat({ index: -1, hop: 0 }, SCRIPT), null);
  assert.equal(retreat(undefined, SCRIPT), null);
  assert.equal(retreat({ index: 0, hop: 0 }, []), null);
  assert.deepEqual(retreat({ index: 0, hop: 99 }, SCRIPT), { index: 0, hop: 1 }, 'hop is clamped first');
});

test('walking the whole script forward and back visits every hop once', () => {
  const forward = [];
  for (let pos = { index: 0, hop: 0 }; pos; pos = advance(pos, SCRIPT)) forward.push(`${pos.index}.${pos.hop}`);
  assert.deepEqual(forward, ['0.0', '0.1', '0.2', '1.0', '2.0', '2.1']);
  const backward = [];
  for (let pos = { index: 2, hop: 1 }; pos; pos = retreat(pos, SCRIPT)) backward.push(`${pos.index}.${pos.hop}`);
  assert.deepEqual(backward, [...forward].reverse());
});

test('isAtEnd is true only on the last hop of the last step', () => {
  assert.equal(isAtEnd({ index: 2, hop: 1 }, SCRIPT), true);
  assert.equal(isAtEnd({ index: 2, hop: 0 }, SCRIPT), false);
  assert.equal(isAtEnd({ index: 0, hop: 2 }, SCRIPT), false);
  assert.equal(isAtEnd({ index: 1, hop: 0 }, SCRIPT), false);
  assert.equal(isAtEnd({ index: -1, hop: 0 }, SCRIPT), false);
  assert.equal(isAtEnd({ index: 2, hop: 50 }, SCRIPT), true);
  assert.equal(isAtEnd({ index: 50, hop: 0 }, SCRIPT), false, 'clamped to the last step, hop 0 of 2');
  assert.equal(isAtEnd({ index: 0, hop: 0 }, [SCRIPT[1]]), true, 'a single one-hop step is already at its end');
  assert.equal(isAtEnd({ index: 0, hop: 0 }, []), false);
});

test('servedByAt shows the answering replica only from the hop that reaches it', () => {
  const hops = hopsOf(SCRIPT[0]);
  assert.equal(servedByAt(SCRIPT[0], hops, 0), null, 'browser to nginx: no replica chosen yet');
  assert.equal(servedByAt(SCRIPT[0], hops, 1), 'backend1');
  assert.equal(servedByAt(SCRIPT[0], hops, 2), 'backend1');
  assert.equal(servedByAt(SCRIPT[2], undefined, 0), null, 'hops are derived from the step when not passed');
  assert.equal(servedByAt(SCRIPT[2], undefined, 1), 'backend2');
  assert.equal(servedByAt({ servedBy: 'backend3', hops: [hop(['browser', 'nginx'])] }, undefined, 0), 'backend3', 'no hop names it: show it for the whole step');
  assert.equal(servedByAt(SCRIPT[1], undefined, 0), null, 'no servedBy, no badge');
  assert.equal(servedByAt({ servedBy: 'backend1' }, undefined, 0), 'backend1');
  assert.equal(servedByAt(null, undefined, 0), null);
});

test('the real demo script plays through hop by hop and every hop is readable', () => {
  assert.ok(STEPS.length > 0);
  let visited = 0;
  let pos = { index: 0, hop: 0 };
  const seen = new Set();
  while (pos) {
    seen.add(`${pos.index}.${pos.hop}`);
    visited += 1;
    pos = advance(pos, STEPS);
    assert.ok(visited < 1000, 'advance must terminate');
  }
  assert.equal(visited, STEPS.reduce((sum, step) => sum + hopsOf(step).length, 0));
  assert.equal(seen.size, visited, 'no hop is visited twice');
  STEPS.forEach((step, index) => {
    assert.ok(hopDelay(step, 1) >= 1500, `step ${index + 1} stays on each hop for at least 1.5s at normal speed`);
    assert.ok(hopDelay(step, 4) >= 400);
    hopsOf(step).forEach((item) => {
      item.lines.forEach((line) => assert.ok(line < (step.log?.length ?? 0), `step ${index + 1} hop lines point at real log lines`));
    });
  });
});
