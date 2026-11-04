import { describe, expect, it, vi } from 'vitest';
import { buildRegistry } from '../../src/terminal/commands/index.js';
import { EXTRA_HELP, extraCommands } from '../../src/terminal/extras.js';
import { COMMAND_NAMES } from '../../src/terminal/shell.js';
import { out, run, stripAnsi } from './_helpers.js';

const MAX_BYTES = 3072;
const ALLOWED_SGR = new Set(['0', '1', '2', ...Array.from({ length: 7 }, (_, i) => String(31 + i)),
  ...Array.from({ length: 8 }, (_, i) => String(90 + i))]);
const SGR = /\u001b\[([0-9;]*)m/g;
const ENGINE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,30}$/; // the engine ignores extras whose name does not match

const names = Object.keys(extraCommands);
const exec = (name, input) => extraCommands[name](input);
const text = async (name, ...args) => (await exec(name, { args, stdin: null, ctx: {} })).stdout;
const plain = (value) => value.replace(SGR, '');

function expectClean(value) {
  expect(typeof value).toBe('string');
  for (const match of value.matchAll(SGR)) {
    for (const param of match[1].split(';')) expect(ALLOWED_SGR.has(param)).toBe(true);
  }
  expect(plain(value)).toMatch(/^[\n -~]*$/);
}

const HUGE = 'The quick brown fox jumps over the lazy dog. '.repeat(400);
const INPUTS = [
  undefined,
  null,
  {},
  { args: undefined },
  { args: [] },
  { args: [], stdin: null, ctx: {} },
  { args: ['hello', 'world'], stdin: null, ctx: {} },
  { args: [], stdin: 'piped text\nsecond line\n', ctx: {} },
  { args: [null, 42, {}, undefined, '--', '-W', '-w', '-e'], stdin: undefined, ctx: undefined },
  { args: ['-W', 'abc', 'x'], stdin: 42, ctx: null },
  { args: [HUGE], stdin: HUGE, ctx: {} },
  { args: [], stdin: `${HUGE}\n${HUGE}`, ctx: {} },
  { args: ['\u001b[2J\u001b[31mred', 'café', '\u0000\u0007bell', '😀'], stdin: null, ctx: {} },
  { args: ['x'.repeat(5000)], stdin: 'y'.repeat(5000), ctx: {} },
  { args: Array.from({ length: 500 }, (_, i) => `w${i}`), stdin: '', ctx: {} },
];

describe('extras registry', () => {
  it('ships at least 16 commands with a help line each', () => {
    expect(names.length).toBeGreaterThanOrEqual(16);
    expect(Object.keys(EXTRA_HELP).sort()).toEqual([...names].sort());
    for (const [name, line] of Object.entries(EXTRA_HELP)) {
      expect(typeof line, name).toBe('string');
      expect(line.length, name).toBeGreaterThan(3);
      expect(line, name).toMatch(/^[ -~]+$/);
    }
  });

  it('uses simple lower-case names and plain handler functions', () => {
    for (const name of names) {
      expect(name, name).toMatch(/^[a-z0-9]+$/);
      expect(typeof extraCommands[name]).toBe('function');
    }
  });

  it('covers the planned command list', () => {
    for (const name of ['cowsay', 'cowthink', 'fortune', 'neofetch', 'figlet', 'banner', 'sl', 'lolcat', 'matrix',
      'cmatrix', 'hack', 'hacktheplanet', 'vim', 'nano', 'emacs', 'xyzzy', 'coffee', '42', 'credits', 'about',
      'ghost', 'never', 'gonna', 'uwu', 'calc', 'yes', 'sleep']) {
      expect(names, name).toContain(name);
    }
  });

  it('is merged into the engine: a name is either registered as an extra or owned by a core command', () => {
    const { extraNames } = buildRegistry();
    for (const name of names) {
      if (extraNames.has(name)) {
        expect(COMMAND_NAMES, name).toContain(name);
      } else {
        // not registered: the core defines it (core wins on clashes) or the engine's name rule rejects it
        expect(COMMAND_NAMES.includes(name) || !ENGINE_NAME.test(name), name).toBe(true);
      }
    }
    // the fun commands that matter most must not be shadowed by anything
    for (const name of ['cowsay', 'cowthink', 'fortune', 'neofetch', 'figlet', 'banner', 'sl', 'lolcat', 'matrix',
      'cmatrix', 'hack', 'coffee', 'answer', 'credits', 'about', 'ghost', 'never', 'uwu', 'calc', 'yes', 'xyzzy']) {
      expect(extraNames.has(name), name).toBe(true);
    }
  });
});

describe('through the real shell', () => {
  it('runs extras like any other command, with pipes', async () => {
    expect(stripAnsi(await out('cowsay hello arena'))).toContain('< hello arena >');
    expect(stripAnsi(await out('echo moo | cowsay'))).toContain('< moo >');
    expect(await out('calc \'(2+3)*7\'')).toBe('35');
    expect(await out('answer')).toContain('life, the universe and everything');
    expect(stripAnsi(await out('fortune | cowthink'))).toContain('o   ^__^');
    expect((await run('matrix')).effect).toBe('matrix');
  });

  it('lists the extras in help', async () => {
    const help = await out('help');
    expect(help).toContain('extras (just for fun):');
    expect(help).toContain('cowsay');
  });

  it('never leaks the team flag, even with flags in the engine ctx', async () => {
    for (const line of ['cowsay hi', 'fortune', 'neofetch', 'ghost', 'credits', 'hack', 'figlet hi', 'coffee', 'sl']) {
      expect(await out(line)).not.toContain('CTF{');
    }
  });
});

describe.each(names)('%s', (name) => {
  it('tolerates missing, odd and huge input and stays ASCII under the size cap', async () => {
    for (const input of INPUTS) {
      const result = await exec(name, input);
      expect(typeof result.exit).toBe('number');
      expectClean(result.stdout);
      expect(result.stdout.length).toBeLessThanOrEqual(MAX_BYTES);
      expect(result.stdout.length).toBeGreaterThan(0);
      if (result.effect !== undefined) expect(typeof result.effect).toBe('string');
    }
  });

  it('is deterministic', async () => {
    for (const input of INPUTS) {
      const first = await exec(name, input);
      const second = await exec(name, input);
      expect(second).toEqual(first);
    }
  });

  it('never touches ctx.flag and never prints a flag-looking string', async () => {
    const flag = vi.fn(() => 'CTF{should_never_appear}');
    const guarded = new Proxy({}, {
      get(_, key) {
        if (key === 'flag') throw new Error('extras must not read ctx.flag');
        return undefined;
      },
    });
    for (const ctx of [{ flag }, guarded, {}]) {
      const result = await exec(name, { args: ['hello'], stdin: null, ctx });
      expect(result.stdout).not.toContain('CTF{');
    }
    expect(flag).not.toHaveBeenCalled();
  });

  it('prints no URLs and never mentions club names or secrets', async () => {
    for (const input of INPUTS.slice(4, 8)) {
      const output = (await exec(name, input)).stdout.toLowerCase();
      expect(output).not.toMatch(/https?:|www\.|\.com\b|gdgc/);
      expect(output).not.toContain('passphrase');
    }
  });
});

describe('input sanitising', () => {
  it('strips escape sequences and non-ASCII typed by the player', async () => {
    for (const name of ['cowsay', 'cowthink', 'uwu', 'banner', 'figlet']) {
      const output = await text(name, '\u001b[2Jhi', 'café');
      expect(output, name).not.toContain('\u001b');
      expect(output, name).not.toMatch(/[^\n -~]/);
    }
    expect(await text('cowsay', '\u001b[2Jhi', 'café')).toContain('hi caf?');
  });

  it('truncates huge stdin to 2 KB before working on it', async () => {
    const cow = (await exec('cowsay', { args: [], stdin: 'a '.repeat(5000), ctx: {} })).stdout;
    expect(cow.length).toBeLessThanOrEqual(MAX_BYTES);
    const lolcat = (await exec('lolcat', { args: [], stdin: 'b'.repeat(100000), ctx: {} })).stdout;
    expect(lolcat.length).toBeLessThanOrEqual(MAX_BYTES);
  });
});

describe('cowsay and cowthink', () => {
  it('draws a single line balloon', async () => {
    expect((await text('cowsay', 'moo')).split('\n').slice(0, 3)).toEqual([' _____', '< moo >', ' -----']);
  });

  it('wraps long input within the default width of 40', async () => {
    const output = await text('cowsay', ...HUGE.slice(0, 600).split(' '));
    const lines = output.split('\n');
    const balloon = lines.slice(0, lines.findIndex((line, i) => i > 0 && /^ -+$/.test(line)) + 1);
    expect(balloon.length).toBeGreaterThan(4);
    for (const line of balloon) expect(line.length).toBeLessThanOrEqual(40 + 4);
    expect(output).toContain('/ ');
    expect(output).toContain('\\ ');
  });

  it('honours -W and splits words longer than the width', async () => {
    const output = await text('cowsay', '-W', '12', 'supercalifragilisticexpialidocious', 'ok');
    const rows = output.split('\n').slice(0, 7);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(12 + 4);
    expect(rows.join('')).toContain('supercalifra');
  });

  it('reads stdin when there are no args, and args win when both exist', async () => {
    const piped = (await exec('cowsay', { args: [], stdin: 'from a pipe\n', ctx: {} })).stdout;
    expect(piped).toContain('< from a pipe >');
    const both = (await exec('cowsay', { args: ['args'], stdin: 'pipe', ctx: {} })).stdout;
    expect(both).toContain('< args >');
  });

  it('supports eye modes and has a friendly empty case', async () => {
    expect(await text('cowsay', '-d', 'x')).toContain('(xx)');
    expect(await text('cowsay', '-e', '@@', 'x')).toContain('(@@)');
    expect(await text('cowsay')).toContain('Moo!');
  });

  it('cowthink uses a thought bubble', async () => {
    const output = await text('cowthink', 'hmm');
    expect(output.split('\n')[1]).toBe('( hmm )');
    expect(output).toContain('        o   ^__^');
  });

  it('caps very tall balloons', async () => {
    const output = await text('cowsay', '-W', '10', ...'word '.repeat(300).split(' '));
    expect(output.split('\n').length).toBeLessThanOrEqual(30);
    expect(output).toContain('...');
  });
});

describe('fortune and ghost', () => {
  it('has at least 30 distinct quotes and is stable per input', async () => {
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) seen.add(await text('fortune', `seed${i}`));
    expect(seen.size).toBeGreaterThanOrEqual(30);
    expect(await text('fortune', 'seed7')).toBe(await text('fortune', 'seed7'));
  });

  it('uses a fixed pick with no words so replicas agree', async () => {
    const first = await text('fortune');
    expect(first.length).toBeGreaterThan(10);
    expect(await text('fortune')).toBe(first);
    expect((await exec('fortune', { args: [], stdin: null, ctx: { mode: { mode: 'hard' } } })).stdout).toBe(first);
  });

  it('includes some NovaCorp in-jokes', async () => {
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) seen.add(await text('fortune', `n${i}`));
    expect([...seen].some((quote) => quote.includes('NovaCorp'))).toBe(true);
  });

  it('ghost taunts without revealing anything about the puzzles', async () => {
    const seen = new Set();
    for (let i = 0; i < 100; i += 1) seen.add(plain(await text('ghost', `g${i}`)));
    expect(seen.size).toBeGreaterThanOrEqual(8);
    for (const line of seen) {
      expect(line).toMatch(/^ghost@novacorp: /);
      expect(line.toLowerCase()).not.toMatch(/flag|ctf|code|passphrase|vault|password|hint|\/|hidden|secret|token|key/);
    }
  });
});

describe('neofetch', () => {
  it('shows the NovaCorp-OS logo and info with colours', async () => {
    const output = await text('neofetch');
    expect(output).toContain('\u001b[');
    const bare = plain(output);
    expect(bare).toContain('NovaCorp-OS');
    expect(bare).toContain('guest@arena');
    expect(bare).toContain('Arena Terminal');
  });

  it('only accepts simple user and host names from ctx', async () => {
    const good = plain((await exec('neofetch', { args: [], ctx: { user: 'alice', host: 'box1' } })).stdout);
    expect(good).toContain('alice@box1');
    const bad = plain((await exec('neofetch', { args: [], ctx: { user: '\u001b[2J', host: 'x'.repeat(99) } })).stdout);
    expect(bad).toContain('guest@arena');
  });
});

describe('figlet and banner', () => {
  const widest = (output) => Math.max(...output.split('\n').map((line) => line.length));

  it('renders letters, digits and symbols', async () => {
    const output = await text('figlet', 'Arena 42!');
    expect(output.split('\n')).toHaveLength(5);
    expect(output).toContain('#####');
  });

  it('banner fills the glyphs with the letters themselves', async () => {
    const output = await text('banner', 'hi');
    expect(output).toContain('HHHHH');
    expect(output).not.toContain('#');
  });

  it('caps the width and wraps onto more rows', async () => {
    const long = 'hello world this is far too wide for one row';
    expect(widest(await text('figlet', long))).toBeLessThanOrEqual(60);
    expect(widest(await text('figlet', '-w', '20', long))).toBeLessThanOrEqual(20);
    expect(widest(await text('figlet', '-w', '5', long))).toBeLessThanOrEqual(12);
    expect(widest(await text('figlet', '-w', '9999', long))).toBeLessThanOrEqual(80);
    expect(widest(await text('banner', '-w', '30', long))).toBeLessThanOrEqual(30);
    const huge = (await exec('figlet', { args: [], stdin: HUGE, ctx: {} })).stdout;
    expect(widest(huge)).toBeLessThanOrEqual(60);
    expect(huge.length).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('falls back to a default word and a ? glyph for unknown characters', async () => {
    expect(await text('figlet')).toContain('#');
    expect(await text('figlet', '~~')).toBe(await text('figlet', '??'));
  });
});

describe('sl, coffee, lolcat, matrix, hack and friends', () => {
  it('sl draws one locomotive frame', async () => {
    const output = await text('sl');
    expect(output.split('\n').length).toBeGreaterThan(6);
    expect(output).toContain('choo choo');
  });

  it('coffee draws a mug', async () => {
    expect(await text('coffee')).toContain('Coffee brewed');
  });

  it('lolcat adds rainbow colours without changing the text', async () => {
    const result = await exec('lolcat', { args: [], stdin: 'hello\nrainbow world\n', ctx: {} });
    expect(result.stdout).toContain('\u001b[91m');
    expect(plain(result.stdout)).toBe('hello\nrainbow world');
    expect(result.stdout.endsWith('\u001b[0m')).toBe(true);
    expect(plain(await text('lolcat', 'a', 'b'))).toBe('a b');
  });

  it('lolcat truncates cleanly on huge input', async () => {
    const output = (await exec('lolcat', { args: [], stdin: 'x'.repeat(100000), ctx: {} })).stdout;
    expect(output.length).toBeLessThanOrEqual(MAX_BYTES);
    expect(output).toContain('(output truncated)');
    expect(output).not.toMatch(/\u001b\[?[0-9;]*$/);
  });

  it('matrix and cmatrix wake the intern and trigger the rain effect', async () => {
    for (const name of ['matrix', 'cmatrix']) {
      expect(await exec(name, { args: [], stdin: null, ctx: {} })).toEqual({
        stdout: 'Wake up, intern...', exit: 0, effect: 'matrix',
      });
    }
  });

  it('hack prints a fake progress sequence of 8-10 lines', async () => {
    for (const name of ['hack', 'hacktheplanet']) {
      const lines = plain(await text(name, 'nova.corp')).split('\n');
      const bars = lines.filter((line) => /^\[#*\.*\] /.test(line));
      expect(bars.length).toBeGreaterThanOrEqual(8);
      expect(lines.length).toBeLessThanOrEqual(10);
      for (const bar of bars) expect(bar.indexOf(']')).toBe(9);
      expect(lines[0]).toContain('nova.corp');
    }
  });

  it('hack only echoes a harmless target', async () => {
    expect(await text('hack', '<script>alert(1)</script>')).not.toContain('<');
  });

  it('editors joke about the read-only filesystem', async () => {
    for (const name of ['vim', 'vi', 'nano', 'emacs']) {
      const output = await text(name, 'notes.txt');
      expect(output).toContain('read-only filesystem');
      expect(output).toContain('try cat');
    }
  });

  it('xyzzy, 42, answer, sleep and yes behave', async () => {
    expect(await text('xyzzy')).toBe('Nothing happens.');
    expect(await text('42')).toContain('life, the universe and everything');
    expect(await text('answer')).toBe(await text('42'));
    expect(await text('sleep', '5')).toBe('zzz...');
    expect((await text('yes')).split('\n')).toEqual(Array(12).fill('y'));
    expect((await text('yes', 'no', 'way')).split('\n')).toEqual(Array(12).fill('no way'));
    expect((await text('yes', 'z'.repeat(500))).length).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('credits and about name the CTF Arena team', async () => {
    for (const name of ['credits', 'about']) {
      const output = plain(await text(name));
      expect(output).toContain('ARENA TERMINAL');
      expect(output).toContain('CTF Arena team');
    }
  });

  it('never and gonna are text-only jokes', async () => {
    expect(await text('never')).toContain('give you up');
    expect(await text('rickroll')).toBe(await text('never'));
    expect(await text('gonna')).toContain('never');
  });

  it('uwu uwuifies text', async () => {
    expect(await text('uwu', 'hello', 'world', 'not', 'real'))
      .toMatch(/^hewwo wowwd nyot weaw (uwu|owo|>w<|\^w\^|UwU)$/);
    expect(await text('uwu')).toContain('uwuify');
    const piped = (await exec('uwu', { args: [], stdin: 'little\n', ctx: {} })).stdout;
    expect(piped).toMatch(/^wittwe /);
  });
});

describe('calc', () => {
  const calc = (...args) => exec('calc', { args, stdin: null, ctx: {} });

  it.each([
    ['1 + 2', '3'],
    ['2 + 3 * 4', '14'],
    ['(2 + 3) * 4', '20'],
    ['10 / 4', '2.5'],
    ['10 % 4', '2'],
    ['-7 + 2', '-5'],
    ['--3', '3'],
    ['2 * -3', '-6'],
    ['+5', '5'],
    ['1 - -1', '2'],
    ['((1+2)*(3+4))/7', '3'],
    ['0.1 + 0.2', '0.3'],
    ['1/3', '0.3333333333'],
    ['.5 * 4', '2'],
    ['100 - 100', '0'],
    ['-0 * 5', '0'],
    ['999999999 * 999999', '999998999000001'],
  ])('evaluates %s = %s', async (expression, expected) => {
    expect(await calc(expression)).toEqual({ stdout: expected, exit: 0 });
  });

  it('accepts the expression split over several args or on stdin', async () => {
    expect((await calc('2', '+', '2')).stdout).toBe('4');
    expect((await exec('calc', { args: [], stdin: '6*7\n', ctx: {} })).stdout).toBe('42');
  });

  it.each([
    'process.exit()',
    '2**9999',
    '2^9999',
    '1/0',
    '1 % 0',
    'require("fs")',
    'this.constructor',
    '__proto__',
    'constructor.constructor("return 1")()',
    '1;2',
    '1,2',
    '(1+2',
    '1+2)',
    '()',
    '1 +',
    '* 3',
    '1 2',
    '1.2.3',
    '0x10',
    '1e9',
    'Infinity',
    'NaN',
    '`1`',
    '${1}',
    '9'.repeat(40),
    '999999999999999 * 999999999999999',
    `${'(('.repeat(40)}1${'))'.repeat(40)}`,
    `${'-'.repeat(100)}1`,
    `${'1+'.repeat(150)}1`,
    'alert(1)',
    '\u001b[2J1',
  ])('rejects %j without evaluating it', async (expression) => {
    const result = await calc(expression);
    expect(result.exit).toBe(1);
    expect(result.stdout).toMatch(/^calc: /);
    expectClean(result.stdout);
    expect(result.stdout).not.toMatch(/\d{3}/);
  });

  it('explains division by zero and prints usage without input', async () => {
    expect((await calc('1/0')).stdout).toBe('calc: division by zero');
    const usage = await calc();
    expect(usage.exit).toBe(1);
    expect(usage.stdout).toContain('usage: calc');
  });

  it('does not use eval or Function', async () => {
    const globalEval = vi.spyOn(globalThis, 'eval');
    await calc('1+1');
    await calc('process.exit()');
    expect(globalEval).not.toHaveBeenCalled();
    globalEval.mockRestore();
  });
});
