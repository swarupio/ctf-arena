// Crackme Arcade virtual machine (docs/CRACKME_ARCADE.md). A tiny 32-bit stack machine that only ever touches its own
// arrays: no eval, no Function, no fs, no network, no database, no imports. This file is shared VERBATIM with the browser
// (frontend/src/components/crackme/vm.js is a byte-identical copy, enforced by a test), so the step-through debugger
// and the server verdict can never disagree.
//
// Program format: an array of instructions, each `[mnemonic]` or `[mnemonic, operand]`, e.g. ['PUSH', 65].
// Values are unsigned 32-bit integers (wrap-around). Data memory has MEM_SIZE cells at addresses 0..MEM_SIZE-1.
// The operand of instruction i is also readable and writable as the code cell CODE_BASE + i (self-modifying code).

export const VM_VERSION = 1;
export const CODE_BASE = 256;
export const MEM_SIZE = 64;
export const STACK_MAX = 64;
export const CODE_MAX = 256;
export const INPUT_MAX = 64;
export const DEFAULT_MAX_STEPS = 20000;
export const HARD_MAX_STEPS = 100000;
export const U32 = 0xffffffff;

// mnemonic -> { operand: takes an operand, pops, pushes }
export const OPCODES = Object.freeze({
  PUSH: { operand: true, doc: 'Push the operand.' },
  POP: { operand: false, doc: 'Discard the top value.' },
  DUP: { operand: false, doc: 'Duplicate the top value.' },
  SWAP: { operand: false, doc: 'Swap the top two values.' },
  ADD: { operand: false, doc: 'b=pop, a=pop, push a+b (wraps at 32 bits).' },
  SUB: { operand: false, doc: 'b=pop, a=pop, push a-b (wraps at 32 bits).' },
  MUL: { operand: false, doc: 'b=pop, a=pop, push a*b (wraps at 32 bits).' },
  MOD: { operand: false, doc: 'b=pop, a=pop, push a mod b (b=0 is a fault).' },
  XOR: { operand: false, doc: 'b=pop, a=pop, push a xor b.' },
  ROL: { operand: false, doc: 'n=pop, a=pop, push a rotated left by n mod 32 bits.' },
  CMP: { operand: false, doc: 'b=pop, a=pop, push 0 if a=b, otherwise 1.' },
  JMP: { operand: true, doc: 'Jump to the operand address.' },
  JZ: { operand: true, doc: 'v=pop; jump to the operand if v is 0.' },
  JNZ: { operand: true, doc: 'v=pop; jump to the operand if v is not 0.' },
  LOAD: { operand: false, doc: 'a=pop, push the cell at address a (data memory or a code cell).' },
  STORE: { operand: false, doc: 'a=pop (address), v=pop, write v to the cell at address a.' },
  INPUT: { operand: false, doc: 'Push the next input character code, or 0 once the input is used up.' },
  DBG: { operand: false, doc: 'Push 1 when a debugger is attached, otherwise 0.' },
  ACCEPT: { operand: false, doc: 'Stop: the input is accepted.' },
  REJECT: { operand: false, doc: 'Stop: the input is rejected.' },
  HALT: { operand: false, doc: 'Stop without accepting (counts as rejected).' },
});

export const MNEMONICS = Object.freeze(Object.keys(OPCODES));
const OPERAND_OPS = new Set(MNEMONICS.filter((name) => OPCODES[name].operand));
const TERMINAL = { ACCEPT: 'accept', REJECT: 'reject', HALT: 'halt' };

// Returns an error string, or null when the program is structurally fine. Jump targets are NOT checked here (self-modifying
// code may rewrite them); a bad target is a PC_RANGE fault when it is taken.
export function validateProgram(program) {
  if (!Array.isArray(program)) { return 'PROGRAM_SHAPE'; }
  if (program.length === 0 || program.length > CODE_MAX) { return 'PROGRAM_SIZE'; }
  for (const item of program) {
    if (!Array.isArray(item) || item.length < 1 || item.length > 2) { return 'PROGRAM_SHAPE'; }
    if (typeof item[0] !== 'string' || !Object.hasOwn(OPCODES, item[0])) { return 'BAD_OPCODE'; }
    if (item.length === 2 && !(Number.isInteger(item[1]) && item[1] >= 0 && item[1] <= U32)) { return 'BAD_OPERAND'; }
    if (OPERAND_OPS.has(item[0]) && item.length !== 2) { return 'BAD_OPERAND'; }
  }
  return null;
}

const toChars = (input) => {
  const text = typeof input === 'string' ? input : '';
  const codes = [];
  for (let i = 0; i < text.length && codes.length < INPUT_MAX; i += 1) { codes.push(text.charCodeAt(i) & 0xffff); }
  return codes;
};

// A machine is a plain object (so the debugger can copy it into React state). status: running until a stop.
export function createMachine(program, input, options = {}) {
  const problem = validateProgram(program);
  const requested = Number.isInteger(options.maxSteps) && options.maxSteps > 0 ? options.maxSteps : DEFAULT_MAX_STEPS;
  const machine = {
    status: problem ? 'fault' : 'running',
    reason: problem,
    pc: 0,
    steps: 0,
    maxSteps: Math.min(requested, HARD_MAX_STEPS),
    debugger: options.debugger ? 1 : 0,
    ops: problem ? [] : program.map((item) => item[0]),
    args: problem ? [] : program.map((item) => (item.length === 2 ? item[1] : 0)),
    stack: [],
    mem: new Array(MEM_SIZE).fill(0),
    input: toChars(input),
    ip: 0,
    flag: null,
    lastWrite: null,
  };
  return machine;
}

const fault = (machine, reason) => {
  machine.status = 'fault';
  machine.reason = reason;
  return machine;
};

function readCell(machine, address) {
  if (address < MEM_SIZE) { return machine.mem[address]; }
  const index = address - CODE_BASE;
  if (address >= CODE_BASE && index < machine.ops.length) { return machine.args[index]; }
  return null;
}

function writeCell(machine, address, value) {
  if (address < MEM_SIZE) { machine.mem[address] = value; return true; }
  const index = address - CODE_BASE;
  if (address >= CODE_BASE && index < machine.ops.length) { machine.args[index] = value; return true; }
  return false;
}

const rol32 = (value, count) => {
  const n = count & 31;
  return n === 0 ? value >>> 0 : ((value << n) | (value >>> (32 - n))) >>> 0;
};

// Executes ONE instruction. Safe to call on a stopped machine (it does nothing).
export function stepMachine(machine) {
  if (machine.status !== 'running') { return machine; }
  if (machine.steps >= machine.maxSteps) { machine.status = 'timeout'; machine.reason = 'STEP_LIMIT'; return machine; }
  if (!(machine.pc >= 0 && machine.pc < machine.ops.length)) { return fault(machine, 'PC_RANGE'); }
  const { stack } = machine;
  const op = machine.ops[machine.pc];
  const arg = machine.args[machine.pc];
  machine.steps += 1;
  machine.lastWrite = null;
  let next = machine.pc + 1;

  const pop = () => stack.pop();
  const need = (count) => stack.length >= count;
  const push = (value) => {
    if (stack.length >= STACK_MAX) { return false; }
    stack.push(value >>> 0);
    return true;
  };

  switch (op) {
    case 'PUSH': if (!push(arg)) { return fault(machine, 'STACK_OVERFLOW'); } break;
    case 'POP': if (!need(1)) { return fault(machine, 'STACK_UNDERFLOW'); } pop(); break;
    case 'DUP':
      if (!need(1)) { return fault(machine, 'STACK_UNDERFLOW'); }
      if (!push(stack[stack.length - 1])) { return fault(machine, 'STACK_OVERFLOW'); }
      break;
    case 'SWAP': {
      if (!need(2)) { return fault(machine, 'STACK_UNDERFLOW'); }
      const top = stack.length - 1;
      [stack[top], stack[top - 1]] = [stack[top - 1], stack[top]];
      break;
    }
    case 'ADD': case 'SUB': case 'MUL': case 'MOD': case 'XOR': case 'ROL': case 'CMP': {
      if (!need(2)) { return fault(machine, 'STACK_UNDERFLOW'); }
      const b = pop();
      const a = pop();
      let result;
      if (op === 'ADD') { result = a + b; }
      else if (op === 'SUB') { result = a - b; }
      else if (op === 'MUL') { result = Math.imul(a, b); }
      else if (op === 'XOR') { result = a ^ b; }
      else if (op === 'ROL') { result = rol32(a, b); }
      else if (op === 'CMP') { result = a === b ? 0 : 1; machine.flag = result; }
      else {
        if (b === 0) { return fault(machine, 'DIV_ZERO'); }
        result = a % b;
      }
      push(result);
      break;
    }
    case 'JMP': next = arg; break;
    case 'JZ': case 'JNZ': {
      if (!need(1)) { return fault(machine, 'STACK_UNDERFLOW'); }
      const value = pop();
      if ((op === 'JZ') === (value === 0)) { next = arg; }
      break;
    }
    case 'LOAD': {
      if (!need(1)) { return fault(machine, 'STACK_UNDERFLOW'); }
      const value = readCell(machine, pop());
      if (value === null) { return fault(machine, 'BAD_ADDRESS'); }
      push(value);
      break;
    }
    case 'STORE': {
      if (!need(2)) { return fault(machine, 'STACK_UNDERFLOW'); }
      const address = pop();
      const value = pop();
      if (!writeCell(machine, address, value)) { return fault(machine, 'BAD_ADDRESS'); }
      machine.lastWrite = address;
      break;
    }
    case 'INPUT': {
      const code = machine.ip < machine.input.length ? machine.input[machine.ip] : 0;
      if (machine.ip < machine.input.length) { machine.ip += 1; }
      if (!push(code)) { return fault(machine, 'STACK_OVERFLOW'); }
      break;
    }
    case 'DBG': if (!push(machine.debugger)) { return fault(machine, 'STACK_OVERFLOW'); } break;
    default:
      // ACCEPT, REJECT and HALT (validateProgram already rejected everything else).
      machine.status = TERMINAL[op];
      machine.reason = null;
      return machine;
  }
  machine.pc = next;
  return machine;
}

// Runs to completion (or until the step limit). Never throws, whatever the program or input.
export function runProgram(program, input, options = {}) {
  const machine = createMachine(program, input, options);
  while (machine.status === 'running') { stepMachine(machine); }
  return {
    status: machine.status, reason: machine.reason, steps: machine.steps, pc: machine.pc, accepted: machine.status === 'accept',
  };
}

// Disassembly helpers (used by the debugger listing and by tests).
export const formatInstruction = (item) => (item.length === 2 && OPERAND_OPS.has(item[0]) ? `${item[0]} ${item[1]}` : item[0]);

export function disassemble(program) {
  return program.map((item, address) => ({ address, text: formatInstruction(item) }));
}

// The program as it stands in a running machine (after any self-modification).
export const currentProgram = (machine) => machine.ops.map((op, index) => (OPERAND_OPS.has(op) ? [op, machine.args[index]] : [op]));
