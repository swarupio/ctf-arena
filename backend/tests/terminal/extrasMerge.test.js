import { describe, expect, it, vi } from 'vitest';

// A fake extras module, so the merge logic is tested independently of the real fun commands.
vi.mock('../../src/terminal/extras.js', () => ({
  extraCommands: {
    cowtest: async ({ args, stdin, ctx }) => ({
      stdout: `moo ${args.join(' ')} stdin=${stdin === null ? 'null' : JSON.stringify(stdin)} flag=${typeof ctx.flag} cwd=${ctx.cwd}`,
      exit: 0,
      effect: 'matrix',
    }),
    seedtest: async ({ ctx }) => ({ stdout: `seed=${typeof ctx.seed} keys=${Object.keys(ctx).filter((key) => ctx[key] !== undefined).sort().join(',')}` }),
    ls: async () => ({ stdout: 'EXTRA LS SHOULD LOSE' }),
    boom: async () => { throw new Error('kaput'); },
    huge: async () => ({ stdout: 'x'.repeat(200000) }),
    sneaky: async () => ({ stdout: 'a\x1b[2Jb \x1b[31mred\x1b[0m \x07bell' }),
    failing: async () => ({ stdout: 'bad', exit: 3 }),
    bogus: 'not a function',
    'bad name!': async () => ({ stdout: 'nope' }),
    nothing: async () => undefined,
  },
}));

const { COMMAND_NAMES } = await import('../../src/terminal/shell.js');
const { makeTestCtx, out, run } = await import('./_helpers.js');

describe('extras merge (docs section 13)', () => {
  it('registers extra commands next to the core ones', async () => {
    expect(COMMAND_NAMES).toContain('cowtest');
    expect(COMMAND_NAMES).not.toContain('bogus');
    expect(COMMAND_NAMES).not.toContain('bad name!');
    expect(await out('cowtest a b')).toContain('moo a b stdin=null');
  });

  it('passes piped text as stdin and the cwd, but never the flag function', async () => {
    expect(await out('echo hi | cowtest')).toContain('stdin="hi\\n"');
    const text = await out('cowtest', makeTestCtx({ cwd: '/etc' }));
    expect(text).toContain('flag=undefined');
    expect(text).toContain('cwd=/etc');
  });

  it('never hands extras the per-team seed either', async () => {
    const text = await out('seedtest', makeTestCtx({ seed: 'a'.repeat(64) }));
    expect(text).toContain('seed=undefined');
    expect(text).not.toContain('aaaa');
  });

  it('forwards the effect hint and exit code', async () => {
    expect((await run('cowtest')).effect).toBe('matrix');
    expect((await run('failing')).exit).toBe(3);
    expect(await out('nothing')).toBe('');
  });

  it('lets core commands win on name clashes', async () => {
    expect(await out('ls docs')).toBe('a.txt\nb.txt\nold.txt\nsub');
  });

  it('lists extras in help under their own heading', async () => {
    const text = await out('help');
    expect(text).toContain('extras (just for fun):');
    expect(text).toMatch(/extras \(just for fun\):\n\s+.*cowtest/);
    expect(text).not.toMatch(/extras \(just for fun\):\n\s+.*\bls\b.*\n/);
  });

  it('survives throwing extras, caps their output and strips non-SGR escapes', async () => {
    const boom = await run('boom');
    expect(boom.output).toBe('boom: internal error');
    expect(boom.exit).toBe(1);
    const huge = await run('huge');
    expect(huge.output).toBe(`${'x'.repeat(2000)}... (line truncated)`); // one very long line is cut at 2000 characters
    expect(await out('huge | wc -c')).toBe('65537');
    const sneaky = await out('sneaky');
    expect(sneaky).toBe('a^[[2Jb \x1b[31mred\x1b[0m bell');
  });

  it('works inside pipelines and with colour stripped for the next stage', async () => {
    expect(await out('cowtest x | tr a-z A-Z')).toContain('MOO X');
  });
});
