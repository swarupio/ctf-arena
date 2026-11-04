import { describe, expect, it } from 'vitest';
import { ShellSyntaxError, parse, tokenize } from '../../src/terminal/parser.js';
import { dir, file } from '../../src/terminal/vfs.js';
import { makeTestCtx, out, run } from './_helpers.js';

describe('tokenizer and parser', () => {
  it('splits words, quotes and operators', () => {
    const tokens = tokenize("echo 'a b' \"c d\" e\\ f | wc && ls; pwd");
    const words = tokens.filter((t) => t.t === 'word');
    const ops = tokens.filter((t) => t.t === 'op').map((t) => t.v);
    expect(words).toHaveLength(7);
    expect(ops).toEqual(['|', '&&', ';']);
  });

  it('parses and/or lists and pipelines into an AST', () => {
    const ast = parse('a | b && c || d; e');
    expect(ast.items.map((i) => i.conn)).toEqual([null, '&&', '||', ';']);
    expect(ast.items[0].node.stages).toHaveLength(2);
  });

  it('throws bash-like syntax errors', () => {
    expect(() => parse("echo 'x")).toThrow(ShellSyntaxError);
    expect(() => parse('ls |')).toThrow(/unexpected end of file/);
    expect(() => parse('&& ls')).toThrow(/unexpected token/);
    expect(() => parse('ls ;; ls')).toThrow(/;;/);
    expect(() => parse('fi')).toThrow(/unexpected token/);
  });
});

describe('quoting and expansion', () => {
  it('keeps single quotes literal and expands double quotes', async () => {
    expect(await out("echo '$HOME'")).toBe('$HOME');
    expect(await out('echo "$HOME"')).toBe('/home/guest');
    expect(await out('echo "a   b"')).toBe('a   b');
    expect(await out('echo a    b')).toBe('a b');
    expect(await out('echo "it\'s"')).toBe("it's");
  });

  it('handles backslash escapes', async () => {
    expect(await out('echo a\\ b')).toBe('a b');
    expect(await out('echo \\$HOME')).toBe('$HOME');
    expect(await out('echo "q\\"q"')).toBe('q"q');
  });

  it('expands ~ and shell variables', async () => {
    expect(await out('echo ~')).toBe('/home/guest');
    expect(await out('echo ~/docs')).toBe('/home/guest/docs');
    expect(await out('echo "~"')).toBe('~');
    expect(await out('echo $USER $HOSTNAME $SHELL $PWD')).toBe('guest arena /bin/bash /home/guest');
    expect(await out('false; echo $?')).toBe('1');
  });

  it('supports assignments, defaults and lengths', async () => {
    expect(await out('X=hello; echo $X ${X} ${#X}')).toBe('hello hello 5');
    expect(await out('echo ${NOPE:-fallback}')).toBe('fallback');
    expect(await out('FOO=1 env | grep ^FOO=')).toBe('FOO=1');
    expect(await out('FOO=1 true; echo "[$FOO]"')).toBe('[]');
  });

  it('runs command substitution up to depth 3', async () => {
    expect(await out('echo $(echo hi)')).toBe('hi');
    expect(await out('echo `echo tick`')).toBe('tick');
    expect(await out('echo "a $(echo b $(echo c))"')).toBe('a b c');
    expect(await out('echo $(echo $(echo $(echo deep)))')).toBe('deep');
    const tooDeep = await run('echo $(echo $(echo $(echo $(echo no))))');
    expect(tooDeep.output).toContain('nested too deeply');
    expect(tooDeep.exit).toBe(1);
  });

  it('evaluates arithmetic expansion', async () => {
    expect(await out('x=5; echo $((x*2+1))')).toBe('11');
    expect(await out('echo $(( (2+3) ** 2 ))')).toBe('25');
    expect((await run('echo $((1/0))')).output).toContain('division by 0');
  });

  it('supports brace expansion', async () => {
    expect(await out('echo {1..3} {a,b}x')).toBe('1 2 3 ax bx');
    expect(await out('echo f{01..03}')).toBe('f01 f02 f03');
    expect(await out('echo {c..a}')).toBe('c b a');
    expect(await out('echo {a,b{1,2}}')).toBe('a b1 b2');
    expect((await run('echo {1..100000}')).output).toContain('brace expansion too large');
  });

  it('supports ANSI-C quoting', async () => {
    expect(await out("echo $'a\\tb'")).toBe('a\tb');
    expect(await out("echo -n $'\\x41\\101'")).toBe('AA');
  });

  it('ignores comments', async () => {
    expect(await out('echo hi # not this')).toBe('hi');
    expect(await out('echo a#b')).toBe('a#b');
  });

  it('returns nothing for empty input', async () => {
    expect((await run('')).output).toBe('');
    expect((await run('   ')).exit).toBe(0);
  });
});

describe('globbing', () => {
  it('matches *, ? and [..] against the VFS without hidden files', async () => {
    expect(await out('echo docs/*.txt')).toBe('docs/a.txt docs/b.txt docs/old.txt');
    expect(await out('echo ?otes.txt')).toBe('notes.txt');
    expect(await out('echo [n]otes.txt')).toBe('notes.txt');
    expect(await out('echo [a-b].txt', makeTestCtx({ cwd: '/home/guest/docs' }))).toBe('a.txt b.txt');
    expect(await out('echo .h*')).toBe('.hidden');
    expect(await out('echo *hidden')).toBe('*hidden');
  });

  it('keeps unmatched and quoted globs literal', async () => {
    expect(await out('echo *.nothing')).toBe('*.nothing');
    expect(await out('echo "*.txt"')).toBe('*.txt');
    expect(await out("echo '*.txt'")).toBe('*.txt');
    expect(await out('echo \\*.txt')).toBe('*.txt');
  });

  it('expands multi-level globs in sorted order and absolute paths', async () => {
    expect(await out('echo /home/guest/docs/s*/*.txt')).toBe('/home/guest/docs/sub/c.txt');
    expect(await out('echo /etc/pass*')).toBe('/etc/passwd');
  });

  it('caps glob expansion at 200 matches', async () => {
    const files = {};
    for (let i = 0; i < 300; i += 1) files[`f${String(i).padStart(3, '0')}`] = file('x');
    const ctx = makeTestCtx({ fs: dir({ home: dir({ guest: dir(files) }) }) });
    expect((await out('echo f* | wc -w', ctx)).trim()).toBe('200');
  });
});

describe('operators and redirects', () => {
  it('chains with ; && ||', async () => {
    expect(await out('echo a; echo b')).toBe('a\nb');
    expect(await out('true && echo yes')).toBe('yes');
    expect(await out('false && echo no')).toBe('');
    expect(await out('false || echo recovered')).toBe('recovered');
    expect(await out('false && echo a || echo b')).toBe('b');
    expect(await out('true || echo a && echo b')).toBe('b');
    expect(await out('! false && echo negated')).toBe('negated');
  });

  it('pipes data between commands', async () => {
    expect(await out('echo hello | tr a-z A-Z')).toBe('HELLO');
    expect(await out('printf "b\\na\\nb\\n" | sort | uniq -c')).toBe('      1 a\n      2 b');
  });

  it('redirects into the /tmp overlay for one command line', async () => {
    expect(await out('echo hi > /tmp/a; cat /tmp/a')).toBe('hi');
    expect(await out('echo one > /tmp/a; echo two >> /tmp/a; cat /tmp/a')).toBe('one\ntwo');
    expect(await out('echo hi > /tmp/a')).toBe('');
    expect(await out('cat /tmp/a')).toContain('No such file or directory');
  });

  it('refuses redirects outside /tmp', async () => {
    const result = await run('echo x > /etc/evil');
    expect(result.output).toBe('bash: /etc/evil: Read-only file system');
    expect(result.exit).toBe(1);
    expect((await run('echo x > /nodir/f')).output).toContain('No such file or directory');
  });

  it('supports input redirects and here-strings', async () => {
    expect(await out('tr a-z A-Z < notes.txt | head -n1')).toBe('ALPHA');
    expect(await out('base64 <<< hi')).toBe('aGkK');
    expect((await run('cat < missing')).output).toContain('missing: No such file or directory');
  });

  it('routes stderr', async () => {
    expect(await out('ls /nope 2>/dev/null; echo done')).toBe('done');
    expect(await out('ls /nope 2>&1 | wc -l')).toBe('1');
    expect(await out('ls /nope &>/dev/null; echo ok')).toBe('ok');
    expect(await out('echo hi >/dev/null')).toBe('');
    expect(await out('ls /nope 2>/tmp/err; cat /tmp/err')).toBe("ls: cannot access '/nope': No such file or directory");
  });

  it('does not let cd inside a pipeline or subshell leak', async () => {
    expect((await run('cd docs | cat')).cwd).toBe('/home/guest');
    expect((await run('(cd docs; pwd); pwd')).output).toBe('/home/guest/docs\n/home/guest');
    expect((await run('cd docs')).cwd).toBe('/home/guest/docs');
  });
});

describe('control flow', () => {
  it('runs for loops over globs and words', async () => {
    expect(await out('for f in docs/*.txt; do echo $f; done')).toBe('docs/a.txt\ndocs/b.txt\ndocs/old.txt');
    expect(await out('for n in 1 2 3; do echo n=$n; done | tail -n1')).toBe('n=3');
  });

  it('runs if/elif/else with test', async () => {
    expect(await out('if [ -f notes.txt ]; then echo yes; fi')).toBe('yes');
    expect(await out('if [ -d notes.txt ]; then echo dir; else echo file; fi')).toBe('file');
    expect(await out('if test 1 -gt 2; then echo a; elif test 3 -gt 2; then echo b; fi')).toBe('b');
  });

  it('reports unsupported syntax instead of crashing', async () => {
    for (const line of ['while true; do echo x; done', 'echo a & echo b', 'cat <<EOF', 'echo <(ls)', 'case x in x) echo;; esac']) {
      const result = await run(line);
      expect(result.output).toMatch(/^bash: /);
      expect(result.exit).toBeGreaterThan(0);
    }
  });
});
