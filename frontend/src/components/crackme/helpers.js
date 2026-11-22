// Pure view helpers for Crackme Arcade (tested in tests/crackme.test.js). The VM itself is ./vm.js, the same file the
// server runs; nothing here decides whether an input is correct.
import { OPCODES, currentProgram, stepMachine } from './vm.js';
import { eventMessage } from '../../event/messages.js';

export const TRACK_ORDER = ['easy', 'medium', 'hard', 'insane'];
export const TRACK_BLURB = { easy: 'Plain compares', medium: 'Checksums and hashes', hard: 'Serials and traps', insane: 'No hints' };
export const STATUS_LABEL = { solved: 'Captured', open: 'Open', locked: 'Locked' };

export const percent = (done, total) => (total > 0 ? Math.round((Math.min(done, total) * 100) / total) : 0);

export function streakText(streak) {
  if (!streak || streak < 1) { return 'No streak yet'; }
  return streak === 1 ? '1 in a row' : `${streak} in a row`;
}

// First cabinet a player can work on: the earliest open level of the easiest track that is not complete.
export function nextLevel(overview) {
  for (const track of overview?.tracks ?? []) {
    const open = track.levels.find((level) => level.status === 'open');
    if (open) { return open; }
  }
  return null;
}

const MESSAGES = {
  NO_TEAM: 'Join or create a team first. Your cabinets are unique to your team.',
  TEAM_BANNED: 'Your team has been banned from the arena.',
  LEVEL_LOCKED: 'Clear the previous cabinet of this track to unlock this one.',
  RATE_LIMITED: 'Too many attempts on this cabinet. Wait a minute, then read the listing again.',
  CRACKME_NOT_SEEDED: 'Crackme Arcade is not set up yet. Ask an admin to run npm run seed:crackme.',
  NO_HINTS: 'The Warehouse of Lost ROMs gives no hints.',
  NO_MORE_HINTS: 'No more hints on this level.',
  NOT_FOUND: 'That cabinet does not exist.',
  FORBIDDEN: 'Only players can do that. Admins can preview cabinets only.',
};

export function crackmeErrorMessage(error) {
  const event = eventMessage(error);
  if (event) { return event; }
  if (error?.code && MESSAGES[error.code]) { return MESSAGES[error.code]; }
  return error?.message || 'Something went wrong. Please try again.';
}

// The server accepts printable ASCII only (space to tilde) and says nothing useful otherwise, so check before sending.
export const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
export function inputProblem(input) {
  if (!input) { return 'Type an input first.'; }
  if (!PRINTABLE_ASCII.test(input)) { return 'Only printable ASCII characters (letters, digits, punctuation and spaces) are allowed.'; }
  return '';
}

// A failed reload after a correct answer must not wipe the page: keep the last puzzle and only show the error.
export function afterLoadFailure(current, message, keep) {
  return { puzzle: keep ? current.puzzle : null, error: message };
}

// ---- listing ---------------------------------------------------------------------------------------------------------
export const pad = (value, width = 3) => String(value).padStart(width, '0');
export const hex = (value, width = 2) => (Number(value) >>> 0).toString(16).toUpperCase().padStart(width, '0');

export const charComment = (value) => (Number.isInteger(value) && value >= 32 && value <= 126 ? `'${String.fromCharCode(value)}'` : '');

// One row per instruction: the CURRENT program (so a self-modifying STORE shows up) compared with the original listing.
export function listingRows(original, current = original) {
  return current.map(([op, arg], address) => {
    const takesOperand = Boolean(OPCODES[op]?.operand);
    const originalArg = original[address]?.[1];
    let comment = '';
    if (takesOperand) {
      if (op === 'PUSH') { comment = charComment(arg); } else { comment = `to ${pad(arg)}`; }
    }
    return {
      address,
      addr: pad(address),
      mnemonic: op,
      operand: takesOperand ? String(arg) : '',
      comment,
      patched: takesOperand && originalArg !== arg,
    };
  });
}

export const rowsOfMachine = (original, machine) => listingRows(original, currentProgram(machine));

// ---- running ---------------------------------------------------------------------------------------------------------
export const SPEEDS = [
  { id: 'slow', label: 'Slow (2 steps/s)', interval: 500, batch: 1 },
  { id: 'normal', label: 'Normal (8 steps/s)', interval: 125, batch: 1 },
  { id: 'fast', label: 'Fast (100 steps/s)', interval: 40, batch: 4 },
  { id: 'turbo', label: 'Turbo', interval: 30, batch: 400 },
];

// Steps up to `count` instructions, stopping BEFORE an instruction that has a breakpoint. Returns whether one was hit.
export function runBatch(machine, count, breakpoints) {
  for (let done = 0; done < count && machine.status === 'running'; done += 1) {
    if (breakpoints.has(machine.pc)) { return { hit: true, steps: done }; }
    stepMachine(machine);
  }
  return { hit: false, steps: count };
}

// Runs until the machine stops, a breakpoint is hit or `limit` steps pass (used by "Run to end"). Leaves the first
// instruction alone even if it carries a breakpoint, so a click on Run always makes progress.
export function runToStop(machine, breakpoints, limit = 100000) {
  if (machine.status === 'running') { stepMachine(machine); }
  for (let done = 1; done < limit && machine.status === 'running'; done += 1) {
    if (breakpoints.has(machine.pc)) { return { hit: true }; }
    stepMachine(machine);
  }
  return { hit: false };
}

const VERDICTS = {
  running: 'Running',
  accept: 'ACCEPT: this input passes in your debugger',
  reject: 'REJECT: the program refused this input',
  halt: 'HALT: stopped without accepting',
  timeout: 'Stopped: too many steps (is there an endless loop?)',
  fault: 'Fault: the machine crashed',
};
const FAULTS = {
  STACK_OVERFLOW: 'stack overflow', STACK_UNDERFLOW: 'stack underflow', DIV_ZERO: 'division by zero', BAD_ADDRESS: 'bad memory address',
  PC_RANGE: 'jumped outside the program', STEP_LIMIT: 'step limit', PROGRAM_SHAPE: 'bad program', PROGRAM_SIZE: 'bad program',
  BAD_OPCODE: 'bad opcode', BAD_OPERAND: 'bad operand',
};

export function verdictText(machine) {
  const base = VERDICTS[machine.status] ?? machine.status;
  return machine.status === 'fault' && machine.reason ? `${base} (${FAULTS[machine.reason] ?? machine.reason})` : base;
}

export const isStopped = (machine) => machine.status !== 'running';

// Memory cells as rows of 8 for the panel; `changed` marks the cell written by the last step.
export function memoryRows(mem, lastWrite = null, width = 8) {
  const rows = [];
  for (let start = 0; start < mem.length; start += width) {
    rows.push({
      start,
      cells: mem.slice(start, start + width).map((value, offset) => ({
        address: start + offset, value, changed: start + offset === lastWrite, zero: value === 0,
      })),
    });
  }
  return rows;
}

// Stack top first, as most debuggers show it.
export const stackRows = (stack) => stack.map((value, index) => ({ index, value, char: charComment(value) })).reverse();

// Short deterministic confetti layout (no Math.random, so renders are stable and testable).
export function confettiPieces(count = 18) {
  return Array.from({ length: count }, (_, i) => ({ id: i, left: (i * 37) % 100, delay: ((i * 53) % 40) / 100, hue: (i * 47) % 3 }));
}
