import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildPuzzle, hintTexts, inputAccepted, publicPuzzle } from '../../src/games/crackme/game.js';
import {
  INPUT_LIMIT, LEVELS, MAX_POINTS, SERVER_STEP_LIMIT, TRACKS, trackMaxPoints,
} from '../../src/games/crackme/levels.js';
import {
  CODE_BASE, CODE_MAX, createMachine, runProgram, stepMachine,
} from '../../src/games/crackme/vm.js';
import * as browserVm from '../../../frontend/src/components/crackme/vm.js';
import { solveLevel } from './solvers.js';

const secret = 'unit_test_secret_that_is_long_enough_123456';
const TEAMS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(24, '0'));
const built = (level, teamId) => buildPuzzle(level, { secret, teamId });
const PRINTABLE = /^[\x20-\x7e]+$/;

describe('definitions', () => {
  it('has 16 levels, four per track, each track ends with a boss', () => {
    expect(LEVELS).toHaveLength(16);
    for (const track of TRACKS) {
      const mine = LEVELS.filter((level) => level.track === track.id);
      expect(mine).toHaveLength(4);
      expect(mine.map((level) => level.n)).toEqual([1, 2, 3, 4]);
      expect(mine.filter((level) => level.boss).map((level) => level.n)).toEqual([4]);
    }
    expect(new Set(LEVELS.map((level) => level.id)).size).toBe(16);
  });

  it('has fixed, strictly increasing points and a documented maximum', () => {
    expect(TRACKS.map((track) => [track.id, trackMaxPoints(track.id)])).toEqual([
      ['easy', 135], ['medium', 270], ['hard', 500], ['insane', 1000],
    ]);
    expect(MAX_POINTS).toBe(1905);
    const points = LEVELS.map((level) => level.points);
    for (const track of TRACKS) {
      const mine = LEVELS.filter((level) => level.track === track.id).map((level) => level.points);
      expect(mine).toEqual([...mine].sort((a, b) => a - b));
    }
    expect(Math.max(...LEVELS.filter((l) => l.track === 'easy').map((l) => l.points))).toBeLessThan(Math.min(...LEVELS.filter((l) => l.track === 'medium').map((l) => l.points)) + 21);
    expect(points.every((value) => Number.isInteger(value) && value > 0)).toBe(true);
  });

  it('gives easy, medium and hard hints and the insane track none', () => {
    for (const level of LEVELS) {
      if (level.track === 'insane') { expect(level.hints).toEqual([]); } else { expect(level.hints.length).toBeGreaterThanOrEqual(2); }
    }
    expect(TRACKS.map((track) => track.hints)).toEqual([true, true, true, false]);
  });
});

describe('every level is solvable from what the player sees', () => {
  for (const level of LEVELS) {
    it(`${level.id} ${level.title}`, () => {
      for (const teamId of TEAMS) {
        const cabinet = built(level, teamId);
        const visible = publicPuzzle(cabinet).program;
        const answer = solveLevel(level.id, visible);
        expect(answer, `${level.id} solver found nothing`).toBeTruthy();
        expect(answer.length).toBeLessThanOrEqual(INPUT_LIMIT);
        expect(answer).toMatch(PRINTABLE);
        expect(inputAccepted(cabinet, answer), `${level.id} ${teamId}: ${answer}`).toBe(true);
        // A different team's cabinet does not take this team's solution.
        const other = built(level, TEAMS[(TEAMS.indexOf(teamId) + 1) % TEAMS.length]);
        expect(inputAccepted(other, answer)).toBe(false);
      }
    });
  }
});

describe('wrong inputs', () => {
  it('rejects empty, partial, random and extended inputs', () => {
    for (const level of LEVELS) {
      const cabinet = built(level, TEAMS[0]);
      const { answer } = cabinet;
      expect(inputAccepted(cabinet, answer), `${level.id} generator answer`).toBe(true);
      for (const wrong of ['', 'a', 'AAAAAAAA', '0000', 'ZZZZ-ZZZZ', answer.slice(1), answer.slice(0, -1), `${answer}x`, answer.toLowerCase().replace(/[0-9-]/g, 'q')]) {
        if (wrong !== answer) { expect(inputAccepted(cabinet, wrong), `${level.id} ${wrong}`).toBe(false); }
      }
    }
  });

  it('keeps the verdict stable under the step limit: every program halts well inside it on every tried input', () => {
    for (const level of LEVELS) {
      const cabinet = built(level, TEAMS[1]);
      for (const text of [cabinet.answer, '', 'x'.repeat(INPUT_LIMIT), '-'.repeat(INPUT_LIMIT), '9'.repeat(INPUT_LIMIT)]) {
        const result = runProgram(cabinet.program, text, { maxSteps: SERVER_STEP_LIMIT, debugger: false });
        expect(result.status, `${level.id}`).not.toBe('timeout');
        expect(result.status, `${level.id}`).not.toBe('fault');
      }
    }
  });
});

describe('determinism and per-team variation', () => {
  it('rebuilds the identical program for the same team and secret', () => {
    for (const level of LEVELS) {
      expect(built(level, TEAMS[0])).toEqual(built(level, TEAMS[0]));
    }
  });

  it('changes constants, program text and the answer per team and per secret', () => {
    for (const level of LEVELS) {
      const programs = new Set(TEAMS.map((teamId) => JSON.stringify(built(level, teamId).program)));
      expect(programs.size, level.id).toBe(TEAMS.length);
      const answers = new Set(TEAMS.map((teamId) => built(level, teamId).answer));
      expect(answers.size, level.id).toBeGreaterThan(TEAMS.length - 3);
      expect(JSON.stringify(buildPuzzle(level, { secret: `${secret}x`, teamId: TEAMS[0] }).program))
        .not.toBe(JSON.stringify(built(level, TEAMS[0]).program));
    }
  });

  it('stays inside the VM size limits and uses valid programs only', () => {
    for (const level of LEVELS) {
      const { program } = built(level, TEAMS[2]);
      expect(program.length).toBeLessThanOrEqual(CODE_MAX);
      expect(JSON.stringify(program)).toMatch(/^\[\[/);
    }
  });
});

describe('difficulty and tricks', () => {
  const sizeOf = (id) => built(LEVELS.find((level) => level.id === id), TEAMS[0]).program.length;

  it('gets bigger as tracks get harder', () => {
    const mean = (track) => {
      const ids = LEVELS.filter((level) => level.track === track).map((level) => level.id);
      return ids.reduce((total, id) => total + sizeOf(id), 0) / ids.length;
    };
    expect(mean('easy')).toBeLessThan(mean('medium') + 60);
    expect(mean('hard')).toBeGreaterThan(40);
  });

  it('the anti-debug cabinets send a debugger to a decoy that the server never accepts', () => {
    for (const id of ['h2', 'i2', 'i4']) {
      const level = LEVELS.find((item) => item.id === id);
      for (const teamId of TEAMS) {
        const cabinet = built(level, teamId);
        const decoy = ['FREEPLAY', 'CREDITS9', 'INSERTCN', 'ATTRACTM'].find((word) => runProgram(cabinet.program, word, { debugger: true }).accepted);
        expect(decoy, `${id} has a decoy`).toBeTruthy();
        expect(inputAccepted(cabinet, decoy)).toBe(false);
        // And the real answer is refused while a debugger is attached.
        expect(runProgram(cabinet.program, cabinet.answer, { debugger: true }).accepted).toBe(false);
      }
    }
  });

  it('i3 seeds its hash from the debugger flag, so the real answer fails under a debugger', () => {
    const level = LEVELS.find((item) => item.id === 'i3');
    const cabinet = built(level, TEAMS[0]);
    expect(runProgram(cabinet.program, cabinet.answer, { debugger: true }).accepted).toBe(false);
    expect(inputAccepted(cabinet, cabinet.answer)).toBe(true);
  });

  it('i3 always changes its result under a debugger, for many teams', () => {
    const level = LEVELS.find((item) => item.id === 'i3');
    for (let t = 0; t < 1500; t += 1) {
      const cabinet = built(level, `team-${t}`);
      expect(inputAccepted(cabinet, cabinet.answer), `team-${t}`).toBe(true);
      expect(runProgram(cabinet.program, cabinet.answer, { debugger: true }).accepted, `team-${t}`).toBe(false);
    }
  });

  it('h3 needs all ten digits: the answer passes, any shorter input is refused', () => {
    const level = LEVELS.find((item) => item.id === 'h3');
    for (let t = 0; t < 1500; t += 1) {
      const cabinet = built(level, `team-${t}`);
      expect(inputAccepted(cabinet, cabinet.answer), `team-${t}`).toBe(true);
      expect(inputAccepted(cabinet, cabinet.answer.slice(0, -1)), `team-${t}`).toBe(false);
      expect(inputAccepted(cabinet, cabinet.answer.slice(0, 2)), `team-${t}`).toBe(false);
    }
  });

  it('h3 hint names the linked digits with 1-based positions that match the program', () => {
    const level = LEVELS.find((item) => item.id === 'h3');
    expect(level.hints.join(' ')).toContain('digit 6 is digit 3 plus 3');
    const { answer } = built(level, TEAMS[0]);
    expect(Number(answer[5])).toBe(Number(answer[2]) + 3);
  });

  it('the self-modifying cabinets hide their real constants from a static read', () => {
    const cabinet = built(LEVELS.find((item) => item.id === 'i1'), TEAMS[0]);
    // A static read sees PUSH 0 placeholders as compare constants; the machine rewrites them through STORE to a code cell.
    const placeholders = cabinet.program.filter(([op, operand], i) => op === 'PUSH' && operand === 0 && cabinet.program[i + 1]?.[0] === 'CMP');
    expect(placeholders).toHaveLength(6);
    expect(cabinet.program.some(([op, operand]) => op === 'PUSH' && operand >= CODE_BASE)).toBe(true);
    const machine = createMachine(cabinet.program, cabinet.answer);
    while (machine.status === 'running') { stepMachine(machine); }
    expect(machine.status).toBe('accept');
    expect(machine.args.filter((value, i) => machine.ops[i] === 'PUSH' && machine.ops[i + 1] === 'CMP' && value === 0)).toHaveLength(0);
  });

  it('the packed cabinets store garbage operands until they unpack themselves', () => {
    for (const id of ['i2', 'i4']) {
      const cabinet = built(LEVELS.find((item) => item.id === id), TEAMS[0]);
      const huge = cabinet.program.filter(([op, operand]) => op === 'PUSH' && operand > 100000);
      expect(huge.length, id).toBeGreaterThan(5);
      expect(JSON.stringify(cabinet.program)).not.toContain(String(cabinet.answer.split('-').at(-1)));
    }
  });
});

describe('no leakage', () => {
  it('the public puzzle carries no answer, flag or hint text, and JSON-serialises the program only', () => {
    for (const level of LEVELS) {
      const cabinet = built(level, TEAMS[0]);
      const text = JSON.stringify(publicPuzzle(cabinet));
      expect(Object.keys(publicPuzzle(cabinet)).sort()).toEqual(['inputMax', 'program', 'vm']);
      expect(text).not.toContain('CTF{');
      expect(text).not.toContain('answer');
      // Plain-text answers must never appear as character runs; the program holds character CODES only.
      expect(text).not.toContain(`"${cabinet.answer}"`);
      for (const hint of level.hints) { expect(text).not.toContain(typeof hint === 'string' ? hint : hint(cabinet)); }
    }
  });

  it('hints reveal at most the first character of the answer', () => {
    for (const level of LEVELS.filter((item) => item.hints.length > 0)) {
      const cabinet = built(level, TEAMS[0]);
      for (const hint of hintTexts(level, cabinet)) {
        expect(hint.includes(cabinet.answer), `${level.id}: ${hint}`).toBe(false);
        if (cabinet.answer.length > 3) { expect(hint.includes(cabinet.answer.slice(0, 3))).toBe(false); }
      }
    }
  });

  it('the generator never puts the answer in plain letters in its source text either', async () => {
    const source = await readFile(new URL('../../src/games/crackme/game.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/answer\s*:/);
  });
});

describe('backend and browser interpreters agree', () => {
  it('ship byte-identical source (the frontend copy is the shared module)', async () => {
    const [backend, frontend] = await Promise.all([
      readFile(new URL('../../src/games/crackme/vm.js', import.meta.url), 'utf8'),
      readFile(new URL('../../../frontend/src/components/crackme/vm.js', import.meta.url), 'utf8'),
    ]);
    expect(frontend.replace(/\r\n/g, '\n')).toBe(backend.replace(/\r\n/g, '\n'));
  });

  it('give the same verdict, steps, stack and memory on every level, for right and wrong inputs, with and without a debugger', async () => {
    const backendVm = await import('../../src/games/crackme/vm.js');
    for (const level of LEVELS) {
      const cabinet = built(level, TEAMS[3]);
      for (const text of [cabinet.answer, 'nope', '', cabinet.answer.slice(0, 3)]) {
        for (const dbg of [false, true]) {
          const a = backendVm.createMachine(cabinet.program, text, { debugger: dbg });
          const b = browserVm.createMachine(cabinet.program, text, { debugger: dbg });
          while (a.status === 'running' && b.status === 'running') {
            backendVm.stepMachine(a);
            browserVm.stepMachine(b);
            expect(b.pc).toBe(a.pc);
          }
          expect(JSON.parse(JSON.stringify(b))).toEqual(JSON.parse(JSON.stringify(a)));
          expect(browserVm.runProgram(cabinet.program, text, { debugger: dbg })).toEqual(backendVm.runProgram(cabinet.program, text, { debugger: dbg }));
        }
      }
    }
  });
});
