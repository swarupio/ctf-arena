// Patch Bay verdicts. Pure: no database, no state. Hidden test inputs are derived from the team seed, so every replica
// rebuilds the same list and nothing is stored. The list itself never leaves this process; only counts do.
import { SERVER_STEP_LIMIT } from './levels.js';
import { applyPatch, patchProblem } from './patch.js';
import { Rng } from './rng.js';
import { runProgram } from './vm.js';

export const PATCH_TESTS = 6;

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const PRINTABLE = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
// [alphabet, minimum length, maximum length] for each hidden input: short, numeric, serial-like, long and noisy ones.
const SHAPES = [
  [UPPER, 1, 5], [DIGITS, 6, 10], [`${UPPER}${DIGITS}-`, 8, 16], [PRINTABLE, 12, 24], [UPPER, 3, 10], [PRINTABLE, 32, 32],
];

const accepts = (program, text) => runProgram(program, text, { debugger: false, maxSteps: SERVER_STEP_LIMIT }).accepted;

// PATCH_TESTS inputs the ORIGINAL program rejects (so only a real patch can make them pass), distinct from each other and
// from the team's own serial. Deterministic per team and cabinet.
export function patchInputs(level, built, { secret, teamId }) {
  const rng = new Rng(secret, String(teamId), `${level.id}-patch`);
  const inputs = [];
  for (const [alphabet, min, max] of SHAPES) {
    let text = '';
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const length = rng.range(min, max);
      text = Array.from({ length }, () => alphabet[rng.int(alphabet.length)]).join('');
      if (!inputs.includes(text) && text !== built.answer && !accepts(built.program, text)) { break; }
    }
    inputs.push(text);
  }
  return inputs;
}

// Runs the patched program on the hidden list and on the real serial. `problem` is set for a patch that is not allowed
// (nothing ran). Never throws, whatever the edits are.
export function evaluatePatch(level, built, edits, seed) {
  const problem = patchProblem(built.program, edits);
  if (problem) { return { problem }; }
  const patched = applyPatch(built.program, edits);
  const passed = patchInputs(level, built, seed).filter((text) => accepts(patched, text)).length;
  const serialOk = accepts(patched, built.answer);
  return {
    problem: null, passed, total: PATCH_TESTS, serialOk, valid: passed === PATCH_TESTS && serialOk,
  };
}
