import { afterEach, describe, expect, it, vi } from 'vitest';
import { execute } from '../../src/terminal/shell.js';
import { makeTestCtx, sampleFs } from './_helpers.js';

// Every replica must print the same bytes for the same input: no Math.random, no Date.now, no host data.
const LINES = [
  'ls -la', 'ls -lR docs', 'ls -lt', 'tree -a', 'find / -type f 2>/dev/null', 'grep -rn CTF /home 2>/dev/null',
  'cat tokens.txt', 'stat notes.txt', 'file *', 'du -a docs', 'date', 'date +%s', 'uptime', 'ps aux', 'who', 'last', 'w',
  'df -h', 'free', 'uname -a', 'id', 'env', 'sort notes.txt | uniq -c', 'awk \'BEGIN{print rand(), rand()}\'',
  'printf "%s\\n" a b | xargs -n1 echo', 'cat layers.b64', 'zcat blob.gz', 'xxd bin.dat', 'hexdump -C pic.png', 'echo $$ $?',
  'sudo -l', 'vault open /opt/box.vault hunter2', 'sudo cat /var/secure/root.txt', 'history', 'hint', 'status', 'man grep', 'help',
  'seq 1 50 | md5sum', 'diff docs/a.txt docs/b.txt', 'ls /nope', 'find . -newer docs/old.txt -type f | sort',
];

afterEach(() => vi.restoreAllMocks());

describe('determinism', () => {
  it('prints identical bytes for identical input, even across independently built contexts', async () => {
    for (const line of LINES) {
      const first = await execute(line, makeTestCtx({ fs: sampleFs() }));
      const second = await execute(line, makeTestCtx({ fs: sampleFs() }));
      expect(second, line).toEqual(first);
    }
  });

  it('never touches Math.random or Date.now', async () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random used'); });
    const now = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Date.now used'); });
    const ctx = makeTestCtx();
    const results = [];
    for (const line of LINES) results.push(await execute(line, ctx));
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    for (const [index, result] of results.entries()) expect(result.output, LINES[index]).not.toContain('internal error');
  });

  it('prints the fixed in-universe date', async () => {
    const ctx = makeTestCtx();
    expect((await execute('date', ctx)).output).toBe('Thu Mar 14 09:30:00 UTC 2024');
    expect((await execute('date -u +%Y-%m-%dT%H:%M:%S', ctx)).output).toBe('2024-03-14T09:30:00');
    expect((await execute('date +%s', ctx)).output).toBe('1710408600');
    expect((await execute('date -d @0 +%F', ctx)).output).toBe('1970-01-01');
    expect((await execute('date -d 2024-01-02 "+%a %b %e"', ctx)).output).toBe('Tue Jan  2');
    expect((await execute('uptime', ctx)).output).toContain('09:30:00');
  });

  it('differs between teams only where flags are rendered', async () => {
    const a = makeTestCtx({ flags: { 1: 'CTF{aaaa}' } });
    const b = makeTestCtx({ flags: { 1: 'CTF{bbbb}' } });
    const lsA = await execute('ls -la', a);
    const lsB = await execute('ls -la', b);
    expect(lsA.output.replace(/\d+ Mar/g, 'N Mar')).toBe(lsB.output.replace(/\d+ Mar/g, 'N Mar'));
    expect((await execute('cat README.txt', a)).output).toContain('CTF{aaaa}');
    expect((await execute('cat README.txt', b)).output).toContain('CTF{bbbb}');
    expect((await execute('cat README.txt', a)).output).not.toContain('CTF{bbbb}');
  });

  it('does not leak state between calls', async () => {
    const ctx = makeTestCtx();
    await execute('X=1; cd docs; echo hi > /tmp/f', ctx);
    expect((await execute('echo "[$X]"; pwd; ls /tmp', ctx)).output).toBe('[]\n/home/guest');
  });
});
