import { describe, expect, it } from 'vitest';
import {
  Budget, LIMITS, ResourceLimitError, capOutput, compilePattern, PatternError,
} from '../../src/terminal/limits.js';
import { COMMAND_NAMES, execute } from '../../src/terminal/shell.js';
import { dir, file } from '../../src/terminal/vfs.js';
import {
  int, pick, rng,
} from '../../src/terminal/gen.js';
import { makeTestCtx, out, run } from './_helpers.js';

// A VFS of roughly 3 MB: 60 directories x 50 files x ~1 KB, plus one file with 300k lines.
function bigCtx() {
  const kids = {};
  for (let d = 0; d < 60; d += 1) {
    const files = {};
    for (let f = 0; f < 50; f += 1) files[`f${f}.log`] = file(`line of data ${d}-${f}\n`.repeat(40));
    kids[`d${d}`] = dir(files);
  }
  return makeTestCtx({ fs: dir({ home: dir({ guest: dir({ ...kids, huge: file('x line\n'.repeat(300000)) }) }) }) });
}

describe('Budget', () => {
  it('throws ResourceLimitError once the budget is spent', () => {
    const budget = new Budget(10);
    budget.tick(10);
    expect(() => budget.tick(1)).toThrow(ResourceLimitError);
  });

  it('charges one unit per four lines', () => {
    const budget = new Budget(100);
    budget.tickLines(40);
    expect(budget.used).toBe(10);
    budget.tickLines(1);
    expect(budget.used).toBe(11);
  });
});

describe('capOutput', () => {
  it('leaves short output alone', () => {
    expect(capOutput('hello\nworld')).toEqual({ text: 'hello\nworld', truncated: false });
  });

  it('truncates at 16 KB with a note, on a line boundary', () => {
    const text = Array.from({ length: 5000 }, (_, i) => `line number ${i}`).join('\n');
    const result = capOutput(text);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(LIMITS.MAX_OUTPUT + 30);
    expect(result.text.endsWith('\n... (output truncated)')).toBe(true);
    expect(result.text.startsWith('line number 0\nline number 1\n')).toBe(true);
  });

  it('cuts single lines at 2000 characters', () => {
    const result = capOutput(`${'a'.repeat(5000)}\nshort`);
    const [first, second] = result.text.split('\n');
    expect(first).toBe(`${'a'.repeat(2000)}... (line truncated)`);
    expect(second).toBe('short');
  });

  it('never leaves half an escape sequence behind', () => {
    const colored = `${'\x1b[1;31mx\x1b[0m'.repeat(400)}`;
    const result = capOutput(colored);
    expect(result.text).not.toMatch(/\x1b(\[[0-9;]*)?(\.\.\.|$)/);
  });
});

describe('execute limits', () => {
  it('rejects command lines over 300 characters', async () => {
    const result = await run(`echo ${'a'.repeat(300)}`);
    expect(result.output).toBe('bash: command line too long (limit 300 characters)');
    expect(result.exit).toBe(1);
    expect((await run(`echo ${'a'.repeat(290)}`)).exit).toBe(0);
  });

  it('allows 8 pipeline stages and rejects 9', async () => {
    const stages = (n) => Array.from({ length: n }, () => 'cat').join(' | ');
    expect(await out(`echo ok | ${stages(7)}`)).toBe('ok');
    const result = await run(`echo ok | ${stages(8)}`);
    expect(result.output).toBe('bash: pipeline too long (limit 8 commands)');
    expect(result.exit).toBe(2);
  });

  it('enforces the $() depth cap', async () => {
    expect(await out('echo $(echo $(echo $(echo ok)))')).toBe('ok');
    expect((await run('echo $(echo $(echo $(echo $(echo no))))')).output).toContain('nested too deeply');
  });

  it('enforces the xargs depth cap', async () => {
    expect(await out('echo a | xargs xargs echo')).toBe('a');
    expect((await run('echo a | xargs xargs xargs echo')).output).toContain('command nesting too deep');
  });

  it('answers exit 137 when the work budget is exceeded', async () => {
    const ctx = bigCtx();
    for (const line of [
      `cat ${'huge '.repeat(8)}| wc -l`,
      `grep -c x ${'huge '.repeat(20)}`,
      "awk 'BEGIN{while(1){}}'",
      "awk 'BEGIN{x=\"a\"; while(1){x=x x}}'",
      'for i in {1..100}; do for j in {1..100}; do echo $i$j; done; done',
      'seq 1 200000 | sort | uniq | sort -r | sort | uniq | sort -n | wc -l',
    ]) {
      const result = await run(line, ctx);
      expect(result, line).toMatchObject({ output: 'bash: resource limit exceeded', exit: 137 });
    }
  });

  it('truncates big output with the note and stays under 16 KB', async () => {
    const result = await run('cat huge', bigCtx());
    expect(result.exit).toBe(0);
    expect(result.output.endsWith('... (output truncated)')).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(LIMITS.MAX_OUTPUT + 30);
  });

  it('truncates long lines in the final output', async () => {
    const ctx = makeTestCtx({ fs: dir({ home: dir({ guest: dir({ long: file(`${'z'.repeat(5000)}\n`) }) }) }) });
    const result = await run('cat long', ctx);
    expect(result.output).toBe(`${'z'.repeat(2000)}... (line truncated)`);
  });

  it('caps zip bombs and unbounded generators', async () => {
    expect((await run('seq 1 999999999')).exit).toBe(137);
    expect((await run('yes | head -n 1')).exit).toBeLessThan(138);
  });

  it('lists a 3 MB VFS quickly', async () => {
    const ctx = bigCtx();
    await run('find / -type f | wc -l', ctx); // warm up
    const started = performance.now();
    const result = await run('find / -type f | wc -l', ctx);
    const elapsed = performance.now() - started;
    expect(result.output).toBe('3001');
    expect(elapsed).toBeLessThan(200);
  });

  it('keeps typical commands fast', async () => {
    const ctx = makeTestCtx();
    await run('ls', ctx);
    const started = performance.now();
    for (let i = 0; i < 20; i += 1) {
      await run('ls -la docs | grep txt | wc -l', ctx);
      await run('cat notes.txt | sort | uniq -c', ctx);
    }
    expect((performance.now() - started) / 40).toBeLessThan(20);
  });
});

describe('regex safety', () => {
  const rejected = [
    '(a+)+$', '(a*)*', '(a+)*b', '(a|aa)+$', '(a|a)*', '(.*a){5}', '(a+){2}', '(x+x+)+y', '((a+))+', 'a**',
    '(?=a)', '(?!a)', '(?<=a)', '(?<!a)', '(a)\\1', '\\1', '([a-z])\\1',
  ];

  it.each(rejected)('grep -E rejects %s', async (pattern) => {
    const result = await run(`grep -E '${pattern.replace(/'/g, "'\\''")}' notes.txt`);
    expect(result.output).toBe('grep: unsupported pattern');
    expect(result.exit).toBe(2);
  });

  it('rejects backreferences in basic patterns and lookarounds in perl mode', async () => {
    expect((await run("grep '\\(a\\)\\1' notes.txt")).output).toBe('grep: unsupported pattern');
    expect((await run("grep '\\(a*\\)*b' notes.txt")).output).toBe('grep: unsupported pattern');
    expect((await run("grep -P '(?=a)a' notes.txt")).output).toBe('grep: unsupported pattern');
    expect((await run("grep -P '(a+)+b' notes.txt")).output).toBe('grep: unsupported pattern');
  });

  it('rejects patterns longer than 64 characters', async () => {
    expect((await run(`grep '${'a'.repeat(65)}' notes.txt`)).output).toBe('grep: unsupported pattern');
    expect((await run(`grep -c '${'a'.repeat(64)}' notes.txt`)).output).toBe('0');
  });

  it('rejects unsafe patterns in sed, awk and find too', async () => {
    expect((await run("sed 's/(a+)+/x/' notes.txt")).exit).toBe(0); // BRE: parens are literals
    expect((await run("sed -E 's/(a+)+/x/' notes.txt")).output).toBe('sed: unsupported pattern');
    expect((await run("awk '/(a+)+/' notes.txt")).output).toContain('unsupported pattern');
    expect((await run("awk '$0 ~ \"(a|aa)+$\"' notes.txt")).output).toContain('unsupported pattern');
    expect((await run("find . -regex '(a+)+'")).output).toContain('unsupported pattern');
  });

  it('still allows the common safe idioms', async () => {
    expect(await out("printf '10.0.0.1 x\\n' | grep -E '([0-9]+\\.){3}[0-9]+'")).toBe('10.0.0.1 x');
    expect(await out("printf 'warn\\nok\\n' | grep -E '(error|warn)+'")).toBe('warn');
    expect(await out("printf 'aaa\\n' | grep -E 'a{2,3}'")).toBe('aaa');
    expect(await out("printf 'ab\\n' | grep -E '(ab)+'")).toBe('ab');
    expect(await out("printf 'x\\n' | grep -E '^.*$'")).toBe('x');
    expect(await out("printf 'a+b\\n' | grep -F '(a+)+'")).toBe('');
    expect(await out("printf '(a+)+\\n' | grep -F '(a+)+'")).toBe('(a+)+');
    expect(await out("printf '(a+)+\\n' | grep '(a+)+'")).toBe('(a+)+');
  });

  it('compilePattern throws PatternError', () => {
    expect(() => compilePattern('(a+)+', { flavor: 'ere' })).toThrow(PatternError);
    expect(() => compilePattern('a[')).toThrow(/Unmatched \[/);
    expect(compilePattern('a.c').re.test('abc')).toBe(true);
    expect(compilePattern('[[:upper:]]+', { flavor: 'ere' }).re.test('abC')).toBe(true);
    expect(compilePattern('a|b', { fixed: true }).re.test('a|b')).toBe(true);
    expect(compilePattern('a|b', { fixed: true }).re.test('a')).toBe(false);
  });
});

describe('fuzz', () => {
  const alphabet = ['\'', '"', '`', '$', '(', ')', '{', '}', '[', ']', '|', '&', ';', '>', '<', '\\', '*', '?', '~', '!', '#', '=', ' ', ' ', ' ', '-', '.', '/', '\n', '\t', '%', ',', ':', '1', '2', 'a', 'Z', '\x00', '\x1b', 'é'];
  const words = ['ls', 'cat', 'grep', 'find', 'awk', 'sed', 'tr', 'sort', 'echo', 'cd', 'xargs', 'for', 'if', 'then', 'fi', 'do', 'done', 'in', '$(', '${', '$((', '2>&1', '&&', '||', '/', '..', '~', '*', '-r', '-E', "'", '"'];

  it('always resolves to a result object for random garbage', async () => {
    const r = rng('terminal-fuzz');
    const ctx = makeTestCtx();
    for (let i = 0; i < 700; i += 1) {
      let line = '';
      const parts = int(r, 1, 30);
      for (let p = 0; p < parts; p += 1) line += r() < 0.4 ? pick(r, words) : pick(r, alphabet) + (r() < 0.3 ? pick(r, alphabet) : '');
      line = line.slice(0, 300);
      const result = await execute(line, ctx);
      expect(result, JSON.stringify(line)).toEqual(expect.objectContaining({ output: expect.any(String), cwd: expect.any(String), exit: expect.any(Number) }));
      expect(result.output, JSON.stringify(line)).not.toContain('internal error');
      expect(result.cwd.startsWith('/')).toBe(true);
    }
  }, 60000);

  it('survives random flags and operands for every command', async () => {
    const r = rng('terminal-flag-fuzz');
    const ctx = makeTestCtx();
    const flags = ['-a', '-l', '-n', '-r', '-v', '-i', '-E', '-F', '-c', '-d', ',', '-f1', '-k2', '-t,', '-h', '-R', '-L1', '-s', '-0', '-e', 'x', '--', '--help', '-9', '-', 'notes.txt', 'docs', '/', '..', 'nope', '*'];
    const skip = new Set(['yes', 'exit', 'logout']);
    for (const name of COMMAND_NAMES) {
      if (skip.has(name)) continue;
      for (let i = 0; i < 12; i += 1) {
        const args = Array.from({ length: int(r, 0, 4) }, () => pick(r, flags)).join(' ');
        const line = `${name} ${args}`;
        const result = await execute(line, ctx);
        expect(typeof result.output, line).toBe('string');
        expect(result.output, line).not.toContain('internal error');
        const piped = await execute(`echo hello world | ${line}`, ctx);
        expect(piped.output, `${line} (piped)`).not.toContain('internal error');
      }
    }
  }, 120000);

  it('handles non-string input and broken contexts', async () => {
    expect((await execute(undefined, makeTestCtx())).exit).toBe(0);
    expect((await execute(42, makeTestCtx())).output).toBe('');
    expect((await execute('ls', {})).exit).toBe(0);
    expect((await execute('ls', null)).exit).toBe(0);
    expect((await execute('pwd', makeTestCtx({ cwd: 'relative' }))).output).toBe('/home/guest');
    expect((await execute('pwd', { mode: {}, cwd: 'relative' })).output).toBe('/');
    const noProgress = makeTestCtx();
    delete noProgress.progress;
    expect((await execute('status', noProgress)).output).toContain('Codes found: 0/2');
  });
});
