import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEEDS, autoplayDelay, clampIndex, clampSpeed, formatClock, isFinished, keyAction, nextIndex,
  phaseRanges, prevIndex, progressPercent, stepCounter, stepDelay,
} from '../src/pages/demoPlayer.js';

const TOTAL = 20;

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
});
