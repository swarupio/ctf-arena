import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../src/components/crackme/patch.js';
import {
  debugProgram, editOf, patchableRows, withEdit,
} from '../src/components/crackme/patchEditor.js';
import {
  CHECKPOINT_EVERY, MAX_WATCH, cloneMachine, createTimeline, decisionMarks, decisionOf, decisionText, diffLines, diffMachines, parseWatchAddress,
  readWatched, toggleWatch, watchRows,
} from '../src/components/crackme/timeline.js';
import {
  CODE_BASE, createMachine, runProgram, stepMachine,
} from '../src/components/crackme/vm.js';

const AB = [
  ['INPUT'], ['PUSH', 65], ['CMP'], ['JNZ', 9],
  ['INPUT'], ['PUSH', 66], ['CMP'], ['JNZ', 9],
  ['ACCEPT'], ['REJECT'],
];
// Counts memory cell 3 up to `n`, so it runs a few hundred steps and writes memory on every lap.
const counter = (n) => [
  ['PUSH', 0], ['PUSH', 3], ['STORE'],
  ['PUSH', 3], ['LOAD'], ['PUSH', 1], ['ADD'], ['DUP'], ['PUSH', 3], ['STORE'], ['PUSH', n], ['CMP'], ['JNZ', 3],
  ['ACCEPT'],
];
const VM = { memSize: 64, codeBase: CODE_BASE };
const make = (program, input = '', options = {}) => () => createMachine(program, input, { debugger: true, ...options });
const snapshot = (machine) => JSON.parse(JSON.stringify(machine));

test('every past step is rebuilt exactly, across checkpoints', () => {
  const factory = make(counter(60));
  const timeline = createTimeline(factory);
  const live = factory();
  const states = [snapshot(live)];
  while (live.status === 'running') { stepMachine(live); states.push(snapshot(live)); }
  assert.ok(live.steps > CHECKPOINT_EVERY * 2, 'the program must cross several checkpoints');
  // Visit the steps in a scrambled order so rebuilding does not depend on having walked forward.
  const order = [...states.keys()].sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101));
  for (const step of order) { assert.deepEqual(snapshot(timeline.viewAt(step)), states[step], `step ${step}`); }
  assert.equal(timeline.viewAt(live.steps + 500).steps, live.steps, 'never runs past the stop');
  assert.equal(timeline.viewAt(-5).steps, 0);
  assert.equal(timeline.viewAt('x').steps, 0);
});

test('viewing the past never changes the live machine or earlier views', () => {
  const factory = make(AB, 'AB');
  const timeline = createTimeline(factory);
  const a = timeline.viewAt(3);
  const copy = snapshot(a);
  a.stack.push(99);
  a.mem[0] = 7;
  assert.deepEqual(snapshot(timeline.viewAt(3)), copy);
  const clone = cloneMachine(a);
  clone.mem[1] = 5;
  assert.equal(a.mem[1], 0);
});

test('memory stays bounded by the step cap: a long run keeps only a few checkpoints', () => {
  const spin = [['JMP', 0]];
  const factory = make(spin, '', { maxSteps: 20000 });
  const timeline = createTimeline(factory);
  const view = timeline.viewAt(20000);
  assert.equal(view.steps, 20000);
  assert.ok(timeline.checkpointCount() <= Math.floor(20000 / CHECKPOINT_EVERY) + 1);
  assert.equal(timeline.viewAt(999999).steps, 20000, 'clamped to the step cap');
  assert.ok(timeline.viewAt(20000).steps <= 20000);
});

test('what changed: stack, pc, input pointer, compare flag, branch outcome', () => {
  const timeline = createTimeline(make(AB, 'AC'));
  assert.equal(diffMachines(timeline.viewAt(0), timeline.viewAt(0)), null);
  assert.deepEqual(diffLines(null), ['Nothing has run yet. Step forward to start.']);
  const input = diffMachines(timeline.viewAt(0), timeline.viewAt(1));
  assert.equal(input.text, 'INPUT');
  assert.deepEqual(input.pushed, [65]);
  assert.deepEqual(input.input, { from: 0, to: 1 });
  const cmp = diffMachines(timeline.viewAt(2), timeline.viewAt(3));
  assert.equal(cmp.text, 'CMP');
  assert.deepEqual(cmp.popped, [65, 65]);
  assert.deepEqual(cmp.pushed, [0]);
  assert.deepEqual(cmp.flag, { from: null, to: 0 });
  const branch = diffMachines(timeline.viewAt(3), timeline.viewAt(4));
  assert.deepEqual(branch.branch, { op: 'JNZ', taken: false, target: 9, value: 0 });
  assert.ok(diffLines(branch).some((line) => line.includes('did not jump')));
  const lines = diffLines(cmp).join(' ');
  assert.match(lines, /Stack: removed 65, 65; added 0/);
  assert.match(lines, /equal/);
});

test('what changed: memory and self-modified code cells', () => {
  const program = [['PUSH', 42], ['PUSH', 5], ['STORE'], ['PUSH', 7], ['PUSH', CODE_BASE + 6], ['STORE'], ['PUSH', 0], ['HALT']];
  const timeline = createTimeline(make(program));
  const mem = diffMachines(timeline.viewAt(2), timeline.viewAt(3));
  assert.deepEqual(mem.memory, [{ address: 5, from: 0, to: 42 }]);
  assert.match(diffLines(mem).join(' '), /Memory cell 5: 0 to 42/);
  const code = diffMachines(timeline.viewAt(5), timeline.viewAt(6));
  assert.deepEqual(code.code, [{ index: 6, from: 0, to: 7 }]);
  assert.match(diffLines(code).join(' '), /Code cell of instruction 6: 0 to 7/);
  const halt = diffMachines(timeline.viewAt(7), timeline.viewAt(8));
  assert.equal(halt.status, 'halt');
  assert.match(diffLines(halt).join(' '), /stopped: halt/);
});

test('watch cells: parsing, limits, values and change flags', () => {
  assert.deepEqual(parseWatchAddress(' 12 ', VM, 10), { address: 12 });
  assert.deepEqual(parseWatchAddress('63', VM, 10), { address: 63 });
  assert.deepEqual(parseWatchAddress('259', VM, 10), { address: 259 });
  for (const bad of ['', 'x', '-1', '1.5', '64', '255', '266', '99999', '0x10', null]) {
    assert.ok(parseWatchAddress(bad, VM, 10).error, String(bad));
  }
  let list = [];
  for (let i = 0; i < MAX_WATCH + 3; i += 1) { list = toggleWatch(list, i); }
  assert.equal(list.length, MAX_WATCH);
  assert.deepEqual(toggleWatch([1, 2, 3], 2), [1, 3]);

  const timeline = createTimeline(make(counter(5)));
  const rows = (step) => watchRows(timeline.viewAt(step - 1), timeline.viewAt(step), [3, 4, CODE_BASE + 1]);
  const afterStore = rows(3);
  assert.equal(afterStore.find((row) => row.address === 3).changed, false, 'storing 0 over 0 changes nothing');
  let changed = 0;
  for (let step = 1; step < 60; step += 1) { if (rows(step).find((row) => row.address === 3).changed) { changed += 1; } }
  assert.ok(changed >= 4);
  assert.equal(readWatched(timeline.viewAt(0), CODE_BASE + 1), 3);
  assert.equal(readWatched(timeline.viewAt(0), CODE_BASE + 500), null);
  assert.deepEqual(watchRows(null, timeline.viewAt(0), [3])[0], { address: 3, value: 0, previous: 0, changed: false });
});

test('decision: the last conditional branch and its CMP decide accept and reject', () => {
  const rejected = decisionOf(make(AB, 'AC'), 1000);
  assert.equal(rejected.status, 'reject');
  assert.equal(rejected.branch.address, 7);
  assert.equal(rejected.branch.taken, true);
  assert.deepEqual({ a: rejected.branch.compare.a, b: rejected.branch.compare.b, result: rejected.branch.compare.result }, { a: 67, b: 66, result: 1 });
  assert.match(decisionText(rejected), /compared 67 with 66: different/);
  assert.match(decisionText(rejected), /jumped to 009/);
  assert.deepEqual([...decisionMarks(rejected)].sort(), [6, 7]);

  const accepted = decisionOf(make(AB, 'AB'), 1000);
  assert.equal(accepted.status, 'accept');
  assert.equal(accepted.branch.taken, false);
  assert.match(decisionText(accepted), /did not jump/);

  assert.equal(decisionOf(make(AB, 'AB'), 3), null, 'still running: no decision yet');
  assert.equal(decisionOf(make([['POP']], ''), 100), null, 'a fault has no deciding branch');
  const straight = decisionOf(make([['REJECT']]), 10);
  assert.equal(straight.branch, null);
  assert.match(decisionText(straight), /straight to REJECT/);
  assert.equal(decisionText(null), '');
  assert.equal(decisionMarks(null).size, 0);
});

test('the debugger replay agrees with the verdict of runProgram', () => {
  for (const text of ['AB', 'AC', '', 'ABC']) {
    const decision = decisionOf(make(AB, text), 1000);
    assert.equal(decision.status === 'accept', runProgram(AB, text, { debugger: true }).accepted);
  }
});

test('patch editor: rows, bounded edits, replacement and the program the debugger shows', () => {
  const rows = patchableRows(AB);
  assert.deepEqual(rows.map((row) => [row.index, row.op, row.options]), [
    [2, 'CMP', ['SUB', 'XOR']], [3, 'JNZ', ['JZ', 'POP']], [6, 'CMP', ['SUB', 'XOR']], [7, 'JNZ', ['JZ', 'POP']],
  ]);
  let edits = withEdit([], 3, 'POP');
  edits = withEdit(edits, 7, 'JZ');
  assert.deepEqual(edits, [{ index: 3, op: 'POP' }, { index: 7, op: 'JZ' }]);
  assert.equal(editOf(edits, 3), 'POP');
  assert.equal(editOf(edits, 2), '');
  assert.deepEqual(withEdit(edits, 3, 'JZ'), [{ index: 3, op: 'JZ' }, { index: 7, op: 'JZ' }]);
  assert.deepEqual(withEdit(edits, 3, ''), [{ index: 7, op: 'JZ' }]);
  assert.equal(withEdit(edits, 2, 'SUB', 2), edits, 'no more edits than the limit');
  assert.equal(debugProgram(AB, edits, false), AB);
  assert.equal(debugProgram(AB, [], true), AB);
  assert.equal(debugProgram(AB, [{ index: 0, op: 'POP' }], true), AB, 'an invalid patch never reaches the debugger');
  const patched = debugProgram(AB, edits, true);
  assert.deepEqual(patched[3], ['POP']);
  assert.deepEqual(patched[7], ['JZ', 9]);
  assert.equal(AB[3][0], 'JNZ');
  // Both checks turned into POP: any input is accepted.
  const all = applyPatch(AB, [{ index: 3, op: 'POP' }, { index: 7, op: 'POP' }]);
  assert.equal(runProgram(all, 'zz').accepted, true);
  assert.equal(runProgram(all, 'AB').accepted, true);
});
