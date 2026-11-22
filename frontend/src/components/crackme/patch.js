// Patch Bay rules (docs/CRACKME_ARCADE.md "Patch Bay"). Pure: no imports, no state. Like vm.js this file is shared VERBATIM
// with the browser (frontend/src/components/crackme/patch.js is a byte-identical copy, enforced by a test), so the editor in
// the UI and the server validate and apply a patch the same way.
//
// A patch is a short list of edits `{ index, op }`: replace the opcode of instruction `index` with `op`. Only the
// substitutions in PATCH_RULES are allowed. Every one of them keeps the stack balanced (a branch pops one value, POP pops one
// value, CMP/SUB/XOR pop two and push one), so a patch can change a decision but never corrupt the machine on its own.
// A branch that becomes POP drops its operand; flipping a branch keeps its operand.

export const PATCH_MAX_EDITS = 20;
export const PATCH_TRACKS = Object.freeze(['hard', 'insane']);
export const PATCH_RULES = Object.freeze({
  JNZ: Object.freeze(['JZ', 'POP']),
  JZ: Object.freeze(['JNZ', 'POP']),
  CMP: Object.freeze(['SUB', 'XOR']),
});

export const isPatchable = (level) => PATCH_TRACKS.includes(level?.track);

// Returns an error code, or null when the patch is acceptable for this program. The codes are stable (the API returns them).
export function patchProblem(program, edits) {
  if (!Array.isArray(program)) { return 'PATCH_SHAPE'; }
  if (!Array.isArray(edits) || edits.length === 0) { return 'PATCH_EMPTY'; }
  if (edits.length > PATCH_MAX_EDITS) { return 'PATCH_TOO_MANY'; }
  const seen = new Set();
  for (const edit of edits) {
    if (edit === null || typeof edit !== 'object' || !Number.isInteger(edit.index) || typeof edit.op !== 'string') { return 'PATCH_SHAPE'; }
    if (edit.index < 0 || edit.index >= program.length) { return 'PATCH_RANGE'; }
    if (seen.has(edit.index)) { return 'PATCH_DUPLICATE'; }
    seen.add(edit.index);
    const original = program[edit.index][0];
    if (!Object.hasOwn(PATCH_RULES, original) || !PATCH_RULES[original].includes(edit.op)) { return 'PATCH_NOT_ALLOWED'; }
  }
  return null;
}

// A new program with the edits applied (the input is not changed). Call patchProblem first: an invalid edit throws.
export function applyPatch(program, edits) {
  const problem = patchProblem(program, edits);
  if (problem) { throw new Error(problem); }
  const patched = program.map((item) => [...item]);
  for (const { index, op } of edits) {
    patched[index] = op === 'POP' ? ['POP'] : [op, program[index][1]];
  }
  return patched;
}

// Which opcodes may this instruction become? (an empty list means it is not patchable)
export const patchOptions = (op) => (Object.hasOwn(PATCH_RULES, op) ? PATCH_RULES[op] : []);
