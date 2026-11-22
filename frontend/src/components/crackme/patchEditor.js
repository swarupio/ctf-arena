// Pure helpers for the Patch Bay editor. The rules themselves (whitelist, limits, how a patch is applied) live in ./patch.js,
// the same file the server uses; the server still validates and judges every patch.
import { PATCH_MAX_EDITS, applyPatch, patchOptions, patchProblem } from './patch.js';

// The instructions a player may change: one row per patchable instruction with the opcodes it may become.
export function patchableRows(program) {
  return program.flatMap(([op, arg], index) => {
    const options = patchOptions(op);
    return options.length > 0 ? [{ index, op, operand: arg === undefined ? '' : String(arg), options }] : [];
  });
}

// Sets (or, with an empty op, clears) the edit of one instruction. Never grows past `max`; returns a new list.
export function withEdit(edits, index, op, max = PATCH_MAX_EDITS) {
  const rest = edits.filter((edit) => edit.index !== index);
  if (!op) { return rest; }
  if (rest.length >= max) { return edits; }
  return [...rest, { index, op }].sort((a, b) => a.index - b.index);
}

export const editOf = (edits, index) => edits.find((edit) => edit.index === index)?.op ?? '';

// The program the debugger should show: the original, or the patched one when the edits are valid and the player asked for it.
export function debugProgram(program, edits, enabled) {
  if (!enabled || edits.length === 0 || patchProblem(program, edits)) { return program; }
  return applyPatch(program, edits);
}

export const editsLabel = (count, max = PATCH_MAX_EDITS) => `${count} of ${max} edits used`;
