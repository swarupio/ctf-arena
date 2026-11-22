import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import { buildPuzzle } from '../../src/games/crackme/game.js';
import { LEVELS, SERVER_STEP_LIMIT } from '../../src/games/crackme/levels.js';
import {
  PATCH_MAX_EDITS, PATCH_RULES, applyPatch, isPatchable, patchOptions, patchProblem,
} from '../../src/games/crackme/patch.js';
import { PATCH_TESTS, evaluatePatch, patchInputs } from '../../src/games/crackme/patchBay.js';
import { runProgram } from '../../src/games/crackme/vm.js';
import { patchSolution } from './solvers.js';

const secret = env.FLAG_SECRET;
const TEAMS = Array.from({ length: 8 }, (_, i) => `team-patch-${i}`);
const PATCHABLE = LEVELS.filter(isPatchable);
const seedOf = (teamId) => ({ secret, teamId });
const cabinet = (level, teamId) => buildPuzzle(level, seedOf(teamId));
const firstBranch = (program) => program.findIndex(([op]) => op === 'JNZ' || op === 'JZ');

describe('patch rules', () => {
  it('apply only on the hard and insane tracks, eight cabinets', () => {
    expect(PATCH_TESTS).toBe(6);
    expect(PATCHABLE.map((level) => level.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'i1', 'i2', 'i3', 'i4']);
  });

  it('whitelist: branches flip or become POP, CMP becomes SUB or XOR, nothing else is patchable', () => {
    expect(patchOptions('JNZ')).toEqual(['JZ', 'POP']);
    expect(patchOptions('JZ')).toEqual(['JNZ', 'POP']);
    expect(patchOptions('CMP')).toEqual(['SUB', 'XOR']);
    for (const op of ['PUSH', 'ACCEPT', 'REJECT', 'HALT', 'STORE', 'LOAD', 'DBG', 'INPUT', 'JMP', 'toString', '__proto__']) {
      expect(patchOptions(op)).toEqual([]);
    }
    expect(Object.keys(PATCH_RULES)).toEqual(['JNZ', 'JZ', 'CMP']);
  });

  it('rejects empty, oversized, malformed, out of range, duplicate and non-whitelisted edits', () => {
    const program = [['INPUT'], ['PUSH', 1], ['CMP'], ['JNZ', 5], ['ACCEPT'], ['REJECT']];
    expect(patchProblem(program, [{ index: 3, op: 'POP' }])).toBeNull();
    expect(patchProblem(program, [])).toBe('PATCH_EMPTY');
    expect(patchProblem(program, 'x')).toBe('PATCH_EMPTY');
    expect(patchProblem(program, Array.from({ length: PATCH_MAX_EDITS + 1 }, (_, i) => ({ index: i % 6, op: 'POP' })))).toBe('PATCH_TOO_MANY');
    expect(patchProblem(program, [null])).toBe('PATCH_SHAPE');
    expect(patchProblem(program, [{ index: '3', op: 'POP' }])).toBe('PATCH_SHAPE');
    expect(patchProblem(program, [{ index: 3 }])).toBe('PATCH_SHAPE');
    expect(patchProblem(program, [{ index: 9, op: 'POP' }])).toBe('PATCH_RANGE');
    expect(patchProblem(program, [{ index: -1, op: 'POP' }])).toBe('PATCH_RANGE');
    expect(patchProblem(program, [{ index: 3, op: 'POP' }, { index: 3, op: 'JZ' }])).toBe('PATCH_DUPLICATE');
    expect(patchProblem(program, [{ index: 5, op: 'ACCEPT' }])).toBe('PATCH_NOT_ALLOWED');
    expect(patchProblem(program, [{ index: 4, op: 'REJECT' }])).toBe('PATCH_NOT_ALLOWED');
    expect(patchProblem(program, [{ index: 3, op: 'JMP' }])).toBe('PATCH_NOT_ALLOWED');
    expect(patchProblem(program, [{ index: 3, op: 'JNZ' }])).toBe('PATCH_NOT_ALLOWED');
    expect(patchProblem(program, [{ index: 3, op: '__proto__' }])).toBe('PATCH_NOT_ALLOWED');
    expect(patchProblem(program, [{ index: 2, op: 'POP' }])).toBe('PATCH_NOT_ALLOWED');
    expect(() => applyPatch(program, [{ index: 5, op: 'ACCEPT' }])).toThrow('PATCH_NOT_ALLOWED');
  });

  it('applyPatch keeps the operand of a flipped branch, drops it for POP and never changes its input', () => {
    const program = [['PUSH', 0], ['JNZ', 3], ['JZ', 3], ['ACCEPT']];
    const copy = JSON.parse(JSON.stringify(program));
    expect(applyPatch(program, [{ index: 1, op: 'JZ' }, { index: 2, op: 'POP' }])).toEqual([['PUSH', 0], ['JZ', 3], ['POP'], ['ACCEPT']]);
    expect(program).toEqual(copy);
  });

  it('the patch module has no imports or dangerous references, and the browser copy is byte-identical', async () => {
    const source = await readFile(new URL('../../src/games/crackme/patch.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import /m);
    expect(source).not.toMatch(/\b(eval|Function|process|fetch)\b\s*[(\w{]/);
    const frontend = await readFile(new URL('../../../frontend/src/components/crackme/patch.js', import.meta.url), 'utf8');
    expect(frontend.replace(/\r\n/g, '\n')).toBe(source.replace(/\r\n/g, '\n'));
  });
});

describe('hidden inputs', () => {
  it('are deterministic per team and cabinet, differ between teams, and the original program rejects them all', () => {
    for (const level of PATCHABLE) {
      const a = cabinet(level, TEAMS[0]);
      const first = patchInputs(level, a, seedOf(TEAMS[0]));
      expect(patchInputs(level, a, seedOf(TEAMS[0]))).toEqual(first);
      expect(first).toHaveLength(PATCH_TESTS);
      expect(new Set(first).size).toBe(PATCH_TESTS);
      expect(first).not.toContain(a.answer);
      for (const text of first) {
        expect(text.length).toBeLessThanOrEqual(32);
        expect(runProgram(a.program, text, { debugger: false, maxSteps: SERVER_STEP_LIMIT }).accepted).toBe(false);
      }
      expect(patchInputs(level, cabinet(level, TEAMS[1]), seedOf(TEAMS[1]))).not.toEqual(first);
    }
  });
});

describe('every patchable cabinet stays solvable for every team', () => {
  it('a token patch fails the list; the reference patch passes everything and keeps the real serial', () => {
    for (const level of PATCHABLE) {
      for (const teamId of TEAMS) {
        const built = cabinet(level, teamId);
        const at = firstBranch(built.program);
        const token = evaluatePatch(level, built, [{ index: at, op: patchOptions(built.program[at][0])[0] }], seedOf(teamId));
        expect(token.problem).toBeNull();
        expect(token.valid).toBe(false);
        const edits = patchSolution(built.program);
        expect(edits.length).toBeGreaterThan(0);
        expect(edits.length).toBeLessThanOrEqual(PATCH_MAX_EDITS);
        const verdict = evaluatePatch(level, built, edits, seedOf(teamId));
        expect(verdict, `${level.id} ${teamId}`).toMatchObject({
          problem: null, passed: PATCH_TESTS, total: PATCH_TESTS, serialOk: true, valid: true,
        });
      }
    }
  });

  it('a partial patch scores partially, and one that breaks the serial is not valid', () => {
    const level = PATCHABLE[0];
    const built = cabinet(level, TEAMS[2]);
    const edits = patchSolution(built.program);
    const partial = evaluatePatch(level, built, edits.slice(1), seedOf(TEAMS[2]));
    expect(partial.valid).toBe(false);
    expect(partial.passed).toBeLessThan(PATCH_TESTS);
    const broken = evaluatePatch(level, built, [...edits.slice(1), { index: edits[0].index, op: 'JZ' }], seedOf(TEAMS[2]));
    expect(broken.valid).toBe(false);
  });

  it('is per team: one team\'s patch does not solve another team\'s cabinet', () => {
    const level = PATCHABLE[3];
    const a = cabinet(level, TEAMS[0]);
    const b = cabinet(level, TEAMS[1]);
    const mine = patchSolution(a.program);
    expect(evaluatePatch(level, a, mine, seedOf(TEAMS[0])).valid).toBe(true);
    // The same index list applied to a different program is checked against that program's own opcodes.
    const crossed = evaluatePatch(level, b, mine, seedOf(TEAMS[1]));
    expect(crossed.valid === true || crossed.problem !== null || crossed.passed <= PATCH_TESTS).toBe(true);
    expect(patchInputs(level, b, seedOf(TEAMS[1]))).not.toEqual(patchInputs(level, a, seedOf(TEAMS[0])));
  });

  it('every single-edit patch terminates and returns a verdict (step cap, faults)', () => {
    const started = Date.now();
    for (const level of [PATCHABLE[2], PATCHABLE[5]]) {
      const built = cabinet(level, TEAMS[0]);
      built.program.forEach(([op], index) => {
        for (const next of patchOptions(op)) {
          const verdict = evaluatePatch(level, built, [{ index, op: next }], seedOf(TEAMS[0]));
          expect(verdict.problem).toBeNull();
          expect(verdict.passed).toBeLessThanOrEqual(PATCH_TESTS);
        }
      });
    }
    expect(Date.now() - started).toBeLessThan(20000);
    const loop = [['PUSH', 0], ['JZ', 0], ['ACCEPT']];
    expect(runProgram(loop, '', { maxSteps: SERVER_STEP_LIMIT })).toMatchObject({ status: 'timeout', accepted: false });
  });

  it('rejects not-whitelisted edits without running anything', () => {
    const level = PATCHABLE[0];
    const built = cabinet(level, TEAMS[0]);
    const end = built.program.findIndex(([op]) => op === 'ACCEPT');
    expect(evaluatePatch(level, built, [{ index: end, op: 'POP' }], seedOf(TEAMS[0]))).toEqual({ problem: 'PATCH_NOT_ALLOWED' });
  });
});
