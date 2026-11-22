// Time-travel helpers for the Crackme debugger (docs/CRACKME_ARCADE.md "Time-travel debugger"). The VM is deterministic, so
// the past never has to be stored step by step: a timeline keeps a full copy of the machine every CHECKPOINT_EVERY steps
// (at most maxSteps / CHECKPOINT_EVERY + 1 copies, so the memory use respects the VM step cap) and rebuilds any other step by
// replaying forward from the nearest copy. Nothing here decides whether an input is accepted; it only replays vm.js.
import {
  CODE_BASE, OPCODES, formatInstruction, stepMachine,
} from './vm.js';

export const CHECKPOINT_EVERY = 128;
export const MAX_CHECKPOINTS = 800; // 100 000 hard step cap / 128, rounded up: a safety net, never reached with the 20 000 step cap
export const MAX_WATCH = 8;

// The VM never changes `ops` or `input`, so a copy shares them and only duplicates what a step can write.
export const cloneMachine = (machine) => ({
  ...machine, stack: [...machine.stack], mem: [...machine.mem], args: [...machine.args],
});

export function createTimeline(make) {
  const start = make();
  const checkpoints = new Map([[0, cloneMachine(start)]]);
  const limit = start.maxSteps;

  // The machine as it stood after `step` steps (clamped to the step cap and to where the program really stopped).
  function viewAt(step) {
    const target = Math.min(Math.max(0, Math.floor(Number(step) || 0)), limit);
    let from = Math.floor(target / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;
    while (!checkpoints.has(from)) { from -= CHECKPOINT_EVERY; }
    const machine = cloneMachine(checkpoints.get(from));
    while (machine.steps < target && machine.status === 'running') {
      stepMachine(machine);
      if (machine.steps % CHECKPOINT_EVERY === 0 && machine.status === 'running' && !checkpoints.has(machine.steps) && checkpoints.size < MAX_CHECKPOINTS) {
        checkpoints.set(machine.steps, cloneMachine(machine));
      }
    }
    return machine;
  }

  return { viewAt, make, checkpointCount: () => checkpoints.size };
}

// ---- what changed ----------------------------------------------------------------------------------------------------
const instructionAt = (machine, address) => {
  const op = machine.ops[address];
  return op === undefined ? '' : formatInstruction(OPCODES[op].operand ? [op, machine.args[address]] : [op]);
};

// The change between two views one step apart (`before` is the state the instruction ran in, `after` the state it left).
export function diffMachines(before, after) {
  if (!before || !after || after.steps === before.steps) { return null; }
  const op = before.ops[before.pc];
  let common = 0;
  while (common < before.stack.length && common < after.stack.length && before.stack[common] === after.stack[common]) { common += 1; }
  const memory = [];
  before.mem.forEach((value, address) => {
    if (value !== after.mem[address]) { memory.push({ address, from: value, to: after.mem[address] }); }
  });
  const code = [];
  before.args.forEach((value, index) => {
    if (value !== after.args[index]) { code.push({ index, from: value, to: after.args[index] }); }
  });
  let branch = null;
  if (op === 'JZ' || op === 'JNZ') {
    const value = before.stack[before.stack.length - 1];
    branch = { op, taken: (op === 'JZ') === (value === 0), target: before.args[before.pc], value };
  }
  return {
    step: after.steps,
    address: before.pc,
    text: instructionAt(before, before.pc),
    pc: before.pc === after.pc ? null : { from: before.pc, to: after.pc },
    input: before.ip === after.ip ? null : { from: before.ip, to: after.ip },
    flag: before.flag === after.flag ? null : { from: before.flag, to: after.flag },
    popped: before.stack.slice(common).reverse(),
    pushed: after.stack.slice(common),
    memory,
    code,
    branch,
    status: after.status,
    reason: after.reason,
  };
}

const flagText = (flag) => (flag === null ? 'none' : flag === 0 ? '0 (equal)' : '1 (different)');
const pad3 = (value) => String(value).padStart(3, '0');

// Plain-text lines for the "What changed" panel. Every line is words, never colour alone.
export function diffLines(diff) {
  if (!diff) { return ['Nothing has run yet. Step forward to start.']; }
  const lines = [];
  if (diff.branch) {
    lines.push(diff.branch.taken
      ? `${diff.branch.op} saw ${diff.branch.value} and jumped to ${pad3(diff.branch.target)}.`
      : `${diff.branch.op} saw ${diff.branch.value} and did not jump, so execution fell through.`);
  }
  if (diff.pc) { lines.push(`PC ${pad3(diff.pc.from)} to ${pad3(diff.pc.to)}.`); }
  if (diff.flag) { lines.push(`Last CMP result: ${flagText(diff.flag.from)} to ${flagText(diff.flag.to)}.`); }
  if (diff.input) { lines.push(`Input pointer ${diff.input.from} to ${diff.input.to}.`); }
  if (diff.popped.length > 0 || diff.pushed.length > 0) {
    const parts = [];
    if (diff.popped.length > 0) { parts.push(`removed ${diff.popped.join(', ')}`); }
    if (diff.pushed.length > 0) { parts.push(`added ${diff.pushed.join(', ')}`); }
    lines.push(`Stack: ${parts.join('; ')}.`);
  }
  for (const cell of diff.memory) { lines.push(`Memory cell ${cell.address}: ${cell.from} to ${cell.to}.`); }
  for (const cell of diff.code) { lines.push(`Code cell of instruction ${cell.index}: ${cell.from} to ${cell.to}.`); }
  if (diff.status !== 'running') { lines.push(`The machine stopped: ${diff.status}${diff.reason ? ` (${diff.reason})` : ''}.`); }
  return lines;
}

// ---- watched cells ---------------------------------------------------------------------------------------------------
// Returns { address } or { error }. Data cells are 0..memSize-1; code cells are codeBase + instruction index.
export function parseWatchAddress(text, vm, programLength) {
  const raw = String(text ?? '').trim();
  if (!/^\d{1,4}$/.test(raw)) { return { error: 'Type a cell address as a whole number.' }; }
  const address = Number(raw);
  if (address < vm.memSize) { return { address }; }
  if (address >= vm.codeBase && address < vm.codeBase + programLength) { return { address }; }
  return { error: `Cells are 0 to ${vm.memSize - 1}, or ${vm.codeBase} to ${vm.codeBase + programLength - 1} for instruction operands.` };
}

export function readWatched(machine, address) {
  if (address < machine.mem.length) { return machine.mem[address]; }
  const value = machine.args[address - CODE_BASE];
  return value === undefined ? null : value;
}

export const watchLabel = (address, codeBase = CODE_BASE) => (address >= codeBase ? `code cell ${address} (operand of instruction ${address - codeBase})` : `cell ${address}`);

export function toggleWatch(list, address) {
  if (list.includes(address)) { return list.filter((item) => item !== address); }
  return list.length >= MAX_WATCH ? list : [...list, address];
}

// One row per pinned cell: its value now, its value one step earlier and whether this step changed it.
export function watchRows(before, after, list) {
  return list.map((address) => {
    const value = readWatched(after, address);
    const previous = before ? readWatched(before, address) : value;
    return { address, value, previous, changed: before !== null && before !== undefined && value !== previous };
  });
}

// ---- which compare/branch decided ------------------------------------------------------------------------------------
// Replays the run from the start and finds the last conditional branch that executed (the decision that led to the stop),
// plus the CMP that fed it. Returns null while the program is still running or when it faulted.
export function decisionOf(make, steps) {
  const machine = make();
  let branch = null;
  let compare = null;
  while (machine.status === 'running' && machine.steps < steps) {
    const op = machine.ops[machine.pc];
    const address = machine.pc;
    const top = machine.stack[machine.stack.length - 1];
    const below = machine.stack[machine.stack.length - 2];
    const before = machine.steps;
    stepMachine(machine);
    if (machine.steps === before) { break; }
    if (op === 'CMP') { compare = { step: machine.steps, address, a: below, b: top, result: below === top ? 0 : 1 }; }
    if (op === 'JZ' || op === 'JNZ') {
      branch = {
        step: machine.steps, address, op, value: top, taken: (op === 'JZ') === (top === 0), target: machine.args[address],
        compare: compare && compare.step === machine.steps - 1 ? compare : null,
      };
    }
  }
  if (machine.status !== 'accept' && machine.status !== 'reject' && machine.status !== 'halt') { return null; }
  return { status: machine.status, branch, finalStep: machine.steps };
}

export function decisionText(decision) {
  if (!decision) { return ''; }
  const verdict = decision.status === 'accept' ? 'ACCEPT' : decision.status === 'reject' ? 'REJECT' : 'HALT (counts as rejected)';
  const { branch } = decision;
  if (!branch) { return `No conditional branch ran: the program went straight to ${verdict}.`; }
  const where = `${branch.op} at ${pad3(branch.address)}`;
  const outcome = branch.taken ? `jumped to ${pad3(branch.target)}` : 'did not jump';
  const cmp = branch.compare
    ? `The CMP at ${pad3(branch.compare.address)} compared ${branch.compare.a} with ${branch.compare.b}: ${branch.compare.result === 0 ? 'equal' : 'different'}. `
    : '';
  return `${cmp}The last decision was ${where}: it saw ${branch.value} and ${outcome}, which led to ${verdict}.`;
}

// Addresses to highlight in the listing.
export function decisionMarks(decision) {
  const marks = new Set();
  if (decision?.branch) {
    marks.add(decision.branch.address);
    if (decision.branch.compare) { marks.add(decision.branch.compare.address); }
  }
  return marks;
}
