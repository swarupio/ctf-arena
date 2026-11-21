// Cabinet assembly and verdicts for Crackme Arcade. Pure: no database, no state between calls.
import { expectedFlagFor } from '../../services/flagService.js';
import { INPUT_LIMIT, LEVELS, SERVER_STEP_LIMIT } from './levels.js';
import { Rng } from './rng.js';
import {
  CODE_BASE, CODE_MAX, MEM_SIZE, STACK_MAX, VM_VERSION, runProgram,
} from './vm.js';

export const ADMIN_PREVIEW_TEAM = 'admin-preview';
export const slugOf = (level) => `crackme-${level.id}`;

export function buildPuzzle(level, { secret, teamId }) {
  return level.build(new Rng(secret, String(teamId), level.id));
}

export const hintTexts = (level, built) => level.hints.map((hint) => (typeof hint === 'function' ? hint(built) : hint));

// The server's verdict: run the team's own program, with no debugger attached, on the submitted input.
export const inputAccepted = (built, submitted) => runProgram(built.program, submitted, {
  debugger: false, maxSteps: SERVER_STEP_LIMIT,
}).accepted;

// Everything the browser may see about a cabinet. The accepted input is not part of it.
export const publicPuzzle = (built) => ({
  program: built.program,
  inputMax: INPUT_LIMIT,
  vm: {
    version: VM_VERSION, codeBase: CODE_BASE, memSize: MEM_SIZE, stackMax: STACK_MAX, codeMax: CODE_MAX, maxSteps: SERVER_STEP_LIMIT,
  },
});

export const flagFor = (challenge, { secret, teamId }) => expectedFlagFor(challenge, { secret, teamId });

// Pairs each level with its Challenge row. Levels without a visible row are switched off (not seeded or hidden).
export const levelsForDocs = (docs) => {
  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  return LEVELS.filter((level) => bySlug.has(slugOf(level))).map((level) => ({ level, doc: bySlug.get(slugOf(level)) }));
};
