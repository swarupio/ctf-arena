import { describe, expect, it } from 'vitest';
import { assemble } from '../../src/games/crackme/asm.js';
import {
  CODE_BASE, CODE_MAX, HARD_MAX_STEPS, MEM_SIZE, STACK_MAX, createMachine, disassemble, runProgram, stepMachine, validateProgram,
} from '../../src/games/crackme/vm.js';

const run = (source, input = '', options = {}) => runProgram(assemble(source).program, input, options);
const finalStack = (source, input = '') => {
  const machine = createMachine(assemble(source).program, input);
  while (machine.status === 'running') { stepMachine(machine); }
  return machine;
};

describe('instructions', () => {
  it('does 32-bit unsigned arithmetic with wrap-around', () => {
    expect(finalStack('PUSH 5\nPUSH 7\nADD\nHALT').stack).toEqual([12]);
    expect(finalStack('PUSH 3\nPUSH 5\nSUB\nHALT').stack).toEqual([4294967294]);
    expect(finalStack('PUSH 4294967295\nPUSH 2\nADD\nHALT').stack).toEqual([1]);
    expect(finalStack('PUSH 65536\nPUSH 65536\nMUL\nHALT').stack).toEqual([0]);
    expect(finalStack('PUSH 4294967295\nPUSH 4294967295\nMUL\nHALT').stack).toEqual([1]);
    expect(finalStack('PUSH 17\nPUSH 5\nMOD\nHALT').stack).toEqual([2]);
    expect(finalStack('PUSH 12\nPUSH 10\nXOR\nHALT').stack).toEqual([6]);
  });

  it('rotates left by n mod 32', () => {
    expect(finalStack('PUSH 1\nPUSH 4\nROL\nHALT').stack).toEqual([16]);
    expect(finalStack('PUSH 2147483648\nPUSH 1\nROL\nHALT').stack).toEqual([1]);
    expect(finalStack('PUSH 7\nPUSH 32\nROL\nHALT').stack).toEqual([7]);
    expect(finalStack('PUSH 7\nPUSH 0\nROL\nHALT').stack).toEqual([7]);
  });

  it('compares (0 when equal), swaps, duplicates and pops', () => {
    expect(finalStack('PUSH 3\nPUSH 3\nCMP\nHALT').stack).toEqual([0]);
    expect(finalStack('PUSH 3\nPUSH 4\nCMP\nHALT').stack).toEqual([1]);
    expect(finalStack('PUSH 1\nPUSH 2\nSWAP\nDUP\nHALT').stack).toEqual([2, 1, 1]);
    expect(finalStack('PUSH 1\nPUSH 2\nPOP\nHALT').stack).toEqual([1]);
  });

  it('jumps, branches and loops', () => {
    const countdown = 'PUSH 5\nloop:\nPUSH 1\nSUB\nDUP\nJNZ loop\nACCEPT';
    expect(run(countdown).status).toBe('accept');
    expect(run('PUSH 0\nJZ yes\nREJECT\nyes:\nACCEPT').status).toBe('accept');
    expect(run('PUSH 1\nJZ yes\nREJECT\nyes:\nACCEPT').status).toBe('reject');
    expect(run('JMP end\nACCEPT\nend:\nREJECT').status).toBe('reject');
  });

  it('reads input a character at a time and yields 0 once it is used up', () => {
    const machine = finalStack('INPUT\nINPUT\nINPUT\nINPUT\nHALT', 'ab');
    expect(machine.stack).toEqual([97, 98, 0, 0]);
  });

  it('loads and stores data memory and code cells (self-modifying operands)', () => {
    expect(finalStack('PUSH 9\nPUSH 3\nSTORE\nPUSH 3\nLOAD\nHALT').stack).toEqual([9]);
    // The PUSH at address 3 starts as 0 and is rewritten to 42 before it runs.
    const patched = finalStack(`PUSH 42\nPUSH ${CODE_BASE + 3}\nSTORE\nPUSH 0\nHALT`);
    expect(patched.stack).toEqual([42]);
    expect(finalStack(`PUSH ${CODE_BASE}\nLOAD\nHALT`).stack).toEqual([CODE_BASE]);
  });

  it('reports the debugger flag only when it is attached', () => {
    const program = assemble('DBG\nJZ no\nACCEPT\nno:\nREJECT').program;
    expect(runProgram(program, '', { debugger: true }).status).toBe('accept');
    expect(runProgram(program, '', { debugger: false }).status).toBe('reject');
    expect(runProgram(program, '').status).toBe('reject');
  });

  it('stops with the right status on ACCEPT, REJECT and HALT', () => {
    expect(run('ACCEPT').accepted).toBe(true);
    expect(run('REJECT').status).toBe('reject');
    const halted = run('HALT');
    expect(halted.status).toBe('halt');
    expect(halted.accepted).toBe(false);
  });
});

describe('limits and faults', () => {
  it('stops an infinite loop at the step limit', () => {
    const result = run('top:\nJMP top', '', { maxSteps: 500 });
    expect(result).toMatchObject({ status: 'timeout', reason: 'STEP_LIMIT', steps: 500, accepted: false });
  });

  it('caps maxSteps at the hard limit even if asked for more', () => {
    const result = run('top:\nJMP top', '', { maxSteps: 10 ** 9 });
    expect(result.steps).toBe(HARD_MAX_STEPS);
    expect(result.status).toBe('timeout');
  });

  it('faults on stack overflow and underflow', () => {
    expect(run('top:\nPUSH 1\nJMP top').reason).toBe('STACK_OVERFLOW');
    expect(createMachine(assemble('top:\nPUSH 1\nJMP top').program, '').stack.length).toBe(0);
    expect(run('ADD').reason).toBe('STACK_UNDERFLOW');
    expect(run('POP').reason).toBe('STACK_UNDERFLOW');
    expect(run('JZ 0').reason).toBe('STACK_UNDERFLOW');
  });

  it('keeps the stack inside its bound', () => {
    const machine = createMachine(assemble('top:\nPUSH 1\nJMP top').program, '');
    while (machine.status === 'running') { stepMachine(machine); }
    expect(machine.stack.length).toBe(STACK_MAX);
  });

  it('faults on division by zero, bad addresses and running off the end', () => {
    expect(run('PUSH 1\nPUSH 0\nMOD').reason).toBe('DIV_ZERO');
    expect(run(`PUSH ${MEM_SIZE}\nLOAD`).reason).toBe('BAD_ADDRESS');
    expect(run('PUSH 1\nPUSH 99999\nSTORE').reason).toBe('BAD_ADDRESS');
    expect(run(`PUSH ${CODE_BASE + 50}\nLOAD`).reason).toBe('BAD_ADDRESS');
    expect(run('PUSH 1').reason).toBe('PC_RANGE');
    expect(run('JMP 1000').reason).toBe('PC_RANGE');
  });

  it('never throws on malformed programs', () => {
    const bad = [
      null, undefined, 'PUSH 1', [], {}, [['NOPE']], [['PUSH']], [['PUSH', -1]], [['PUSH', 1.5]], [['PUSH', 2 ** 32]], [['ADD', 1, 2]],
      [['__proto__']], [['constructor', 1]], [[1]], [42], [['PUSH', '1']],
      Array.from({ length: CODE_MAX + 1 }, () => ['HALT']),
    ];
    for (const program of bad) {
      const result = runProgram(program, 'abc');
      expect(result.status).toBe('fault');
      expect(result.accepted).toBe(false);
      expect(validateProgram(program)).not.toBeNull();
    }
  });

  it('survives hostile inputs: huge strings are truncated, odd types are empty', () => {
    const program = assemble('top:\nINPUT\nJNZ top\nACCEPT').program;
    const long = 'a'.repeat(100000);
    const result = runProgram(program, long);
    expect(result.status).toBe('accept');
    expect(result.steps).toBeLessThan(500);
    for (const input of [undefined, null, 5, {}, [], '\u0000\uffff']) { expect(() => runProgram(program, input)).not.toThrow(); }
  });

  it('bounds memory: only MEM_SIZE data cells exist', () => {
    const machine = createMachine(assemble('HALT').program, '');
    expect(machine.mem.length).toBe(MEM_SIZE);
    expect(run(`PUSH 1\nPUSH ${MEM_SIZE - 1}\nSTORE\nACCEPT`).status).toBe('accept');
  });

  it('is pure: it does not mutate the program it is given', () => {
    const { program } = assemble(`PUSH 7\nPUSH ${CODE_BASE}\nSTORE\nACCEPT`);
    const copy = JSON.stringify(program);
    runProgram(program, '');
    expect(JSON.stringify(program)).toBe(copy);
  });

  it('has no dynamic code, process, filesystem or network access in its source', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../../src/games/crackme/vm.js', import.meta.url), 'utf8');
    for (const word of ['eval(', 'Function(', 'import(', 'require(', 'process', 'fetch(', 'node:', 'XMLHttp']) {
      expect(source.includes(word), word).toBe(false);
    }
    expect(source).not.toMatch(/^import /m);
  });
});

describe('assembler and disassembler', () => {
  it('resolves labels, characters, symbols and code cells', () => {
    const { program, labels } = assemble("start:\nPUSH 'A'\nPUSH $x\nJMP start\nhere:\nPUSH &here", { x: 9 });
    expect(program).toEqual([['PUSH', 65], ['PUSH', 9], ['JMP', 0], ['PUSH', CODE_BASE + 3]]);
    expect(labels).toEqual({ start: 0, here: 3 });
    expect(disassemble(program)[2]).toEqual({ address: 2, text: 'JMP 0' });
  });

  it('rejects bad source', () => {
    expect(() => assemble('NOPE')).toThrow();
    expect(() => assemble('PUSH')).toThrow();
    expect(() => assemble('ADD 1')).toThrow();
    expect(() => assemble('JMP nowhere')).toThrow();
    expect(() => assemble('a:\na:\nHALT')).toThrow();
  });
});
