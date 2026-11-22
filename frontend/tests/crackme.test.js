import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  afterLoadFailure, charComment, confettiPieces, crackmeErrorMessage, hex, inputProblem, listingRows, memoryRows, nextLevel, pad, percent, rowsOfMachine, runBatch,
  runToStop, stackRows, streakText, verdictText,
} from '../src/components/crackme/helpers.js';
import {
  CODE_BASE, OPCODES, createMachine, disassemble, runProgram, stepMachine, validateProgram,
} from '../src/components/crackme/vm.js';

// Tiny accepted-iff-input-is-"AB" program: INPUT CMP chain.
const AB = [
  ['INPUT'], ['PUSH', 65], ['CMP'], ['JNZ', 9],
  ['INPUT'], ['PUSH', 66], ['CMP'], ['JNZ', 9],
  ['ACCEPT'], ['REJECT'],
];

test('the browser VM runs the golden program the same way the server does', () => {
  assert.equal(runProgram(AB, 'AB').status, 'accept');
  assert.equal(runProgram(AB, 'AC').status, 'reject');
  assert.equal(runProgram(AB, '').status, 'reject');
  assert.deepEqual(runProgram(AB, 'AB'), { status: 'accept', reason: null, steps: 9, pc: 8, accepted: true });
});

test('debugger flag, self-modifying code, limits and faults', () => {
  assert.equal(runProgram([['DBG'], ['JZ', 3], ['ACCEPT'], ['REJECT']], '', { debugger: true }).status, 'accept');
  assert.equal(runProgram([['DBG'], ['JZ', 3], ['ACCEPT'], ['REJECT']], '', { debugger: false }).status, 'reject');
  const patched = createMachine([['PUSH', 42], ['PUSH', CODE_BASE + 3], ['STORE'], ['PUSH', 0], ['HALT']], '');
  while (patched.status === 'running') { stepMachine(patched); }
  assert.deepEqual(patched.stack, [42]);
  assert.equal(runProgram([['JMP', 0]], '', { maxSteps: 50 }).status, 'timeout');
  assert.equal(runProgram([['ADD']], '').reason, 'STACK_UNDERFLOW');
  assert.equal(runProgram([['PUSH', 1], ['PUSH', 0], ['MOD']], '').reason, 'DIV_ZERO');
  assert.equal(runProgram([['NOPE']], '').status, 'fault');
  assert.notEqual(validateProgram('x'), null);
  assert.equal(Object.keys(OPCODES).length, 21);
});

test('the frontend VM is byte-identical to the backend one when both are checked out', () => {
  const backend = new URL('../../backend/src/games/crackme/vm.js', import.meta.url);
  if (!existsSync(backend)) { return; }
  const norm = (text) => text.replace(/\r\n/g, '\n');
  assert.equal(norm(readFileSync(new URL('../src/components/crackme/vm.js', import.meta.url), 'utf8')), norm(readFileSync(backend, 'utf8')));
});

test('listing rows show characters, jump targets and patched operands', () => {
  const rows = listingRows(AB);
  assert.deepEqual(rows[1], { address: 1, addr: '001', mnemonic: 'PUSH', operand: '65', comment: "'A'", patched: false });
  assert.equal(rows[3].comment, 'to 009');
  assert.equal(rows[0].operand, '');
  assert.equal(disassemble(AB)[3].text, 'JNZ 9');
const program = [['PUSH', 5], ['PUSH', CODE_BASE + 3], ['STORE'], ['PUSH', 1], ['HALT']];  const machine = createMachine(program, '');  while (machine.status === 'running') { stepMachine(machine); }  const shown = rowsOfMachine(program, machine);  assert.equal(shown[3].patched, true);  assert.equal(shown[3].operand, '5');  assert.equal(shown[0].patched, false);  assert.deepEqual(program[3], ['PUSH', 1]);
});

test('runBatch stops before a breakpoint and runToStop leaves the first instruction', () => {
  const machine = createMachine(AB, 'AB');
  const { hit } = runBatch(machine, 100, new Set([4]));
  assert.equal(hit, true);
  assert.equal(machine.pc, 4);
  assert.equal(runBatch(machine, 100, new Set([4])).hit, true);
  assert.equal(runToStop(machine, new Set([4])).hit, false);
  assert.equal(machine.status, 'accept');
  const again = createMachine(AB, 'AB');
  assert.equal(runToStop(again, new Set([0])).hit, false);
  assert.equal(again.status, 'accept');
  const slow = createMachine(AB, 'AB');
  assert.deepEqual(runBatch(slow, 2, new Set()), { hit: false, steps: 2 });
  assert.equal(slow.steps, 2);
});

test('verdicts, stack and memory views', () => {
  const machine = createMachine([['ADD']], '');
  stepMachine(machine);
  assert.match(verdictText(machine), /stack underflow/);
  assert.match(verdictText(createMachine([['ACCEPT']], '')), /Running/);
  assert.deepEqual(stackRows([1, 65]).map((row) => row.value), [65, 1]);
  assert.equal(stackRows([65])[0].char, "'A'");
  const rows = memoryRows(new Array(64).fill(0).map((_, i) => i), 9);
  assert.equal(rows.length, 8);
  assert.equal(rows[1].cells[1].changed, true);
  assert.equal(rows[0].cells[0].zero, true);
});

test('small formatting helpers', () => {
  assert.equal(pad(7), '007');
  assert.equal(hex(255), 'FF');
  assert.equal(hex(4294967295, 2), 'FFFFFFFF');
  assert.equal(charComment(65), "'A'");
  assert.equal(charComment(10), '');
  assert.equal(percent(1, 4), 25);
  assert.equal(percent(5, 4), 100);
  assert.equal(percent(0, 0), 0);
  assert.equal(streakText(0), 'No streak yet');
  assert.equal(streakText(1), '1 in a row');
  assert.equal(streakText(3), '3 in a row');
  assert.equal(confettiPieces(5).length, 5);
});

test('next level and error messages', () => {
  const overview = { tracks: [{ levels: [{ id: 'e1', status: 'solved' }, { id: 'e2', status: 'open' }] }, { levels: [{ id: 'm1', status: 'open' }] }] };
  assert.equal(nextLevel(overview).id, 'e2');
  assert.equal(nextLevel({ tracks: [] }), null);
  assert.equal(nextLevel(null), null);
  assert.match(crackmeErrorMessage({ code: 'RATE_LIMITED' }), /Too many attempts/);
  assert.match(crackmeErrorMessage({ code: 'CRACKME_NOT_SEEDED' }), /seed:crackme/);
  assert.equal(crackmeErrorMessage({ message: 'boom' }), 'boom');
  assert.match(crackmeErrorMessage(null), /Something went wrong/);
});

test('input validation mirrors the server: printable ASCII only', () => {
  assert.equal(inputProblem('PACMAN42'), '');
  assert.equal(inputProblem('NAME-12345 x~'), '');
  assert.match(inputProblem(''), /Type an input/);
  assert.match(inputProblem('caf\u00e9'), /printable ASCII/);
  assert.match(inputProblem('tab\there'), /printable ASCII/);
  assert.match(inputProblem('line\nbreak'), /printable ASCII/);
});

test('a failed reload keeps the puzzle on screen, a failed first load does not', () => {
  const current = { puzzle: { id: 'e1' }, error: '' };
  assert.deepEqual(afterLoadFailure(current, 'down', true), { puzzle: { id: 'e1' }, error: 'down' });
  assert.deepEqual(afterLoadFailure(current, 'down', false), { puzzle: null, error: 'down' });
});
