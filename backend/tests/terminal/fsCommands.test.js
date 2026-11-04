import { describe, expect, it } from 'vitest';
import { makeTestCtx, out, run, stripAnsi } from './_helpers.js';

const lines = (text) => text.split('\n');

describe('ls', () => {
  it('lists in C-locale order without hidden files, one per line when piped', async () => {
    const names = lines(await out('ls | cat'));
    expect(names[0]).toBe('README.txt'); // uppercase sorts before lowercase
    expect(names).toContain('notes.txt');
    expect(names).not.toContain('.hidden');
    expect(names.indexOf('README.txt')).toBeLessThan(names.indexOf('big.log'));
  });

  it('shows hidden files with -a (including . and ..) and -A', async () => {
    expect(lines(await out('ls -a | cat')).slice(0, 3)).toEqual(['.', '..', '.hidden']);
    expect(lines(await out('ls -A | cat')).slice(0, 1)).toEqual(['.hidden']);
  });

  it('prints a GNU style long listing', async () => {
    const text = await out('ls -l docs');
    expect(lines(text)[0]).toBe('total 16');
    expect(text).toMatch(/^-rw-r--r-- 1 guest guest\s+14 Mar 14 09:26 a\.txt$/m);
    expect(text).toMatch(/^drwxr-xr-x 2 guest guest 4096 Mar 14 09:26 sub$/m);
    expect(text).toMatch(/^-rw-r--r-- 1 guest guest\s+4 Jan {2}1 {2}2023 old\.txt$/m); // old files show the year
    expect(await out('ls -l link')).toMatch(/^lrwxrwxrwx 1 guest guest\s+10 Mar 14 09:26 link -> docs\/a\.txt$/);
  });

  it('supports -h, -S, -t, -r, -1 and -d', async () => {
    expect(await out('ls -lh big.log')).toMatch(/ 42K /);
    expect(lines(await out('ls -S docs | cat'))[0]).toBe('sub'); // dirs are 4096 bytes
    expect(lines(await out('ls -t docs | cat')).pop()).toBe('old.txt'); // oldest last
    expect(lines(await out('ls -r docs | cat'))[0]).toBe('sub');
    expect(await out('ls -1 docs')).toBe('a.txt\nb.txt\nold.txt\nsub');
    expect(await out('ls -d docs docs/sub')).toBe('docs\ndocs/sub');
  });

  it('recurses with -R and prints headers for several operands', async () => {
    expect(await out('ls -R docs')).toBe('docs:\na.txt\nb.txt\nold.txt\nsub\n\ndocs/sub:\nc.txt\nempty');
    expect(await out('ls docs/sub docs/sub/c.txt')).toBe('docs/sub/c.txt\n\ndocs/sub:\nc.txt\nempty');
  });

  it('handles symlinks like GNU ls', async () => {
    expect(await out('ls link')).toBe('link');
    expect(await out('ls dirlink')).toBe('a.txt\nb.txt\nold.txt\nsub');
    expect(await out('ls -l dirlink')).toMatch(/dirlink -> docs$/);
  });

  it('reports errors like ls', async () => {
    const missing = await run('ls nope');
    expect(missing.output).toBe("ls: cannot access 'nope': No such file or directory");
    expect(missing.exit).toBe(2);
    expect((await run('ls private')).output).toBe("ls: cannot open directory 'private': Permission denied");
    expect((await run('ls -z')).output).toContain("ls: invalid option -- 'z'");
  });

  it('colours only for tty output', async () => {
    const colored = makeTestCtx({ color: undefined });
    delete colored.color;
    const tty = await out('ls', colored);
    expect(tty).toContain('\x1b[1;34mdocs\x1b[0m');
    expect(tty).toContain('\x1b[1;36mlink\x1b[0m');
    expect(await out('ls bin', colored)).toContain('\x1b[1;32mrun.sh\x1b[0m');
    expect(await out('ls | cat', colored)).not.toContain('\x1b');
    expect(await out('ls > /tmp/x; cat /tmp/x', colored)).not.toContain('\x1b');
    expect(await out('ls --color=never', colored)).not.toContain('\x1b');
    expect(await out('ls --color=always | cat', colored)).toContain('\x1b[1;34m');
    expect(await out('ls', makeTestCtx({ color: false }))).not.toContain('\x1b');
  });

  it('lays names out in columns on a tty and strips them when piped', async () => {
    const ctx = makeTestCtx({ color: true });
    const tty = lines(await out('ls docs', ctx));
    expect(tty).toHaveLength(1);
    expect(stripAnsi(tty[0])).toBe('a.txt  b.txt  old.txt  sub');
  });
});

describe('cd and pwd', () => {
  it('moves around with relative paths, ~, .. and -', async () => {
    expect((await run('cd docs/sub')).cwd).toBe('/home/guest/docs/sub');
    expect((await run('cd ../..', makeTestCtx({ cwd: '/home/guest/docs/sub' }))).cwd).toBe('/home/guest');
    expect((await run('cd /etc')).cwd).toBe('/etc');
    expect((await run('cd', makeTestCtx({ cwd: '/etc' }))).cwd).toBe('/home/guest');
    expect((await run('cd ~/docs')).cwd).toBe('/home/guest/docs');
    expect(await out('cd docs; cd -; pwd')).toBe('/home/guest\n/home/guest');
  });

  it('prints errors', async () => {
    expect((await run('cd nope')).output).toBe('bash: cd: nope: No such file or directory');
    expect((await run('cd notes.txt')).output).toBe('bash: cd: notes.txt: Not a directory');
    expect((await run('cd private')).output).toBe('bash: cd: private: Permission denied');
    expect((await run('cd a b')).output).toBe('bash: cd: too many arguments');
    expect((await run('cd -')).output).toBe('bash: cd: OLDPWD not set');
  });

  it('keeps the logical path for symlinks and resolves with pwd -P', async () => {
    expect(await out('cd dirlink; pwd')).toBe('/home/guest/dirlink');
    expect(await out('cd dirlink; pwd -P')).toBe('/home/guest/docs');
    expect(await out('ls dirlink/..')).toContain('README.txt'); // `..` is physical for ls: parent of docs
  });

  it('falls back to home for an invalid starting directory', async () => {
    expect((await run('pwd', makeTestCtx({ cwd: '/does/not/exist' }))).output).toBe('/home/guest');
    expect((await run('pwd', makeTestCtx({ cwd: '/root' }))).output).toBe('/home/guest');
  });
});

describe('cat, head, tail, tac, nl', () => {
  it('prints files and numbers lines', async () => {
    expect(await out('cat docs/a.txt')).toBe('one\ntwo\nthree');
    expect(await out('cat -n docs/a.txt')).toBe('     1\tone\n     2\ttwo\n     3\tthree');
    expect(await out('cat docs/a.txt docs/b.txt | wc -l')).toBe('7');
    expect(await out('echo hi | cat - docs/a.txt')).toBe('hi\none\ntwo\nthree');
    expect(await out('cat -A crlf.txt')).toBe('a^M$\nb^M$');
  });

  it('reports cat errors and continues', async () => {
    const result = await run('cat nope docs/a.txt docs');
    expect(result.output).toBe('cat: nope: No such file or directory\none\ntwo\nthree\ncat: docs: Is a directory');
    expect(result.exit).toBe(1);
  });

  it('follows symlinks and reports loops', async () => {
    expect(await out('cat link')).toBe('one\ntwo\nthree');
    expect(await out('cat loop1')).toBe('cat: loop1: Too many levels of symbolic links');
    expect(await out('cat dangling')).toBe('cat: dangling: No such file or directory');
  });

  it('head and tail take -n, -c and -N', async () => {
    expect(await out('head -n2 notes.txt')).toBe('alpha\nBeta');
    expect(await out('head -2 notes.txt')).toBe('alpha\nBeta');
    expect(await out('head -n -4 notes.txt')).toBe('alpha\nBeta');
    expect(await out('head -c 5 notes.txt')).toBe('alpha');
    expect(await out('tail -n 2 notes.txt')).toBe('delta\nalpha');
    expect(await out('tail -n +5 notes.txt')).toBe('delta\nalpha');
    expect(await out('tail -c 6 notes.txt')).toBe('alpha');
    expect(await out('head -n 1 notes.txt data.csv')).toBe('==> notes.txt <==\nalpha\n\n==> data.csv <==\nname,age,city');
    expect(await out('head -q -n 1 notes.txt data.csv')).toBe('alpha\nname,age,city');
    expect((await run('head -n x notes.txt')).output).toContain("invalid number of lines: 'x'");
    expect(await out('seq 1 20 | head')).toBe(Array.from({ length: 10 }, (_, i) => i + 1).join('\n'));
  });

  it('tac, nl and less/more', async () => {
    expect(await out('tac docs/a.txt')).toBe('three\ntwo\none');
    expect(await out('nl docs/a.txt')).toBe('     1\tone\n     2\ttwo\n     3\tthree');
    expect(await out('printf "a\\n\\nb\\n" | nl')).toBe('     1\ta\n       \n     2\tb');
    expect(await out('printf "a\\n\\nb\\n" | nl -ba')).toBe('     1\ta\n     2\t\n     3\tb');
    expect(await out('less docs/a.txt')).toBe('one\ntwo\nthree');
    expect(await out('more docs/a.txt')).toBe('one\ntwo\nthree');
  });
});

describe('wc', () => {
  it('counts lines, words and bytes with GNU padding', async () => {
    expect(await out('wc -l notes.txt')).toBe('6 notes.txt');
    expect(await out('wc notes.txt')).toBe(' 6  6 35 notes.txt');
    expect(await out('wc -w -c notes.txt')).toBe(' 6 35 notes.txt');
    expect(await out('echo a b | wc -w')).toBe('2');
    expect(await out('echo a b | wc')).toBe('      1       2       4');
  });

  it('pads multi-file output by the total byte size and adds a total line', async () => {
    expect(await out('wc -l notes.txt data.csv')).toBe(' 6 notes.txt\n 5 data.csv\n11 total');
  });

  it('reports missing files', async () => {
    const result = await run('wc -l nope');
    expect(result.output).toBe('wc: nope: No such file or directory');
    expect(result.exit).toBe(1);
  });
});

describe('file and stat', () => {
  it('detects file types from magic bytes', async () => {
    const text = await out('file notes.txt blob.gz pic.png bin/tool bin.dat link docs crlf.txt layers.b64 docs/sub/empty bin/run.sh');
    expect(text).toMatch(/notes\.txt: +ASCII text$/m);
    expect(text).toMatch(/blob\.gz: +gzip compressed data, from Unix, original size modulo 2\^32 11$/m);
    expect(text).toMatch(/pic\.png: +PNG image data, 16 x 8, 8-bit\/color RGBA, non-interlaced$/m);
    expect(text).toMatch(/bin\/tool: +ELF 64-bit LSB executable, x86-64/m);
    expect(text).toMatch(/bin\.dat: +data$/m);
    expect(text).toMatch(/link: +symbolic link to docs\/a\.txt$/m);
    expect(text).toMatch(/docs: +directory$/m);
    expect(text).toMatch(/crlf\.txt: +ASCII text, with CRLF line terminators$/m);
    expect(text).toMatch(/docs\/sub\/empty: +empty$/m);
    expect(text).toMatch(/bin\/run\.sh: +Bourne-Again shell script, ASCII text executable$/m);
    expect(await out('file -b notes.txt')).toBe('ASCII text');
  });

  it('prints stat details and custom formats', async () => {
    const text = await out('stat docs/a.txt');
    expect(text).toContain('  File: docs/a.txt');
    expect(text).toContain('Size: 14');
    expect(text).toContain('regular file');
    expect(text).toContain('Access: (0644/-rw-r--r--)  Uid: ( 1000/   guest)   Gid: ( 1000/   guest)');
    expect(text).toContain('Modify: 2024-03-14 09:26:53.000000000 +0000');
    expect(await out('stat -c "%n %s %a %U" docs/a.txt')).toBe('docs/a.txt 14 644 guest');
    expect((await run('stat nope')).output).toBe("stat: cannot statx 'nope': No such file or directory");
  });
});

describe('tree and du', () => {
  it('draws a tree with counts', async () => {
    expect(await out('tree docs')).toBe([
      'docs', '├── a.txt', '├── b.txt', '├── old.txt', '└── sub', '    ├── c.txt', '    └── empty', '', '1 directory, 5 files',
    ].join('\n'));
  });

  it('supports -L, -a, -d and --noreport', async () => {
    expect(await out('tree -L 1 docs')).toBe('docs\n├── a.txt\n├── b.txt\n├── old.txt\n└── sub\n\n1 directory, 3 files');
    expect(await out('tree -d docs')).toBe('docs\n└── sub\n\n1 directory');
    expect(await out('tree --noreport docs/sub')).toBe('docs/sub\n├── c.txt\n└── empty');
    expect(await out('tree -a -L 1 | head -n 3')).toBe('.\n├── .hidden\n├── README.txt');
    expect(await out('tree --charset=ascii docs/sub')).toContain('|-- c.txt');
    expect(await out('tree docs --noreport', makeTestCtx({ color: true }))).toContain('\x1b[1;34msub\x1b[0m');
  });

  it('shows disk usage', async () => {
    expect(await out('du -s docs')).toMatch(/^\d+\tdocs$/);
    expect(await out('du -sh big.log')).toBe('44K\tbig.log');
    expect(await out('du docs/sub')).toBe('8\tdocs/sub');
    expect(await out('du -ab docs/a.txt')).toBe('14\tdocs/a.txt');
  });
});

describe('find', () => {
  it('matches names, types and sizes', async () => {
    expect(await out('find docs -name "*.txt"')).toBe('docs/a.txt\ndocs/b.txt\ndocs/sub/c.txt\ndocs/old.txt');
    expect(await out('find docs -iname "A.TXT"')).toBe('docs/a.txt');
    expect(await out('find docs -type d')).toBe('docs\ndocs/sub');
    expect(await out('find . -maxdepth 1 -type l | sort')).toBe('./dangling\n./dirlink\n./link\n./loop1\n./loop2');
    expect(await out('find docs -type f -size -5c')).toBe('docs/sub/empty\ndocs/old.txt');
    expect(await out('find . -type f -size +40k -name "*.log" 2>/dev/null')).toBe('./big.log');
    expect(await out('find docs -empty')).toBe('docs/sub/empty');
  });

  it('supports -mindepth, -maxdepth, !, -o, parentheses and -print', async () => {
    expect(await out('find docs -mindepth 1 -maxdepth 1')).toBe('docs/a.txt\ndocs/b.txt\ndocs/sub\ndocs/old.txt');
    expect(await out('find docs -maxdepth 0')).toBe('docs');
    expect(await out('find docs -type f ! -name "*.txt"')).toBe('docs/sub/empty');
    expect(await out('find docs \\( -name a.txt -o -name b.txt \\) -print')).toBe('docs/a.txt\ndocs/b.txt');
    expect(await out('find docs -name a.txt -print -name nothing')).toBe('docs/a.txt');
  });

  it('supports -perm, -user, -mtime and -newer', async () => {
    expect(await out('find bin -type f -perm -100')).toBe('bin/run.sh\nbin/tool');
    expect(await out('find bin -type f -perm 755')).toBe('bin/run.sh\nbin/tool');
    expect(await out('find bin -perm /001 -type f')).toBe('bin/run.sh\nbin/tool');
    expect(await out('find /etc -user root -name shadow')).toBe('/etc/shadow');
    expect(await out('find docs -mtime +30')).toBe('docs/old.txt');
    expect(await out('find docs -mtime -1 -type f | wc -l')).toBe('4');
    expect(await out('find docs -type f -newer docs/old.txt | wc -l')).toBe('4');
  });

  it('prints the path as typed and handles prune', async () => {
    expect(await out('find . -maxdepth 1 -name README.txt')).toBe('./README.txt');
    expect(await out('find docs/ -maxdepth 1 -name a.txt')).toBe('docs/a.txt');
    expect(await out('find docs -name sub -prune -o -type f -print')).toBe('docs/a.txt\ndocs/b.txt\ndocs/old.txt');
  });

  it('reports errors and refuses -exec / -delete', async () => {
    expect((await run('find nope')).output).toBe("find: 'nope': No such file or directory");
    expect((await run('find docs -exec cat {} ;')).output).toContain("'-exec' is not available in this sandbox");
    expect((await run('find docs -delete')).output).toContain("'-delete' is not available");
    expect((await run('find docs -bogus')).output).toContain('unknown predicate');
    expect((await run('find docs -name')).output).toContain('missing argument');
    expect((await run('find docs -type z')).output).toContain('Unknown argument to -type');
  });

  it('keeps stderr for unreadable directories and continues', async () => {
    const result = await run('find . -name x.txt');
    expect(result.output).toContain("find: './private': Permission denied");
    expect(result.exit).toBe(1);
    expect(await out('find . -name x.txt 2>/dev/null')).toBe('');
  });

  it('lists in insertion order and survives symlink loops with -L', async () => {
    expect(await out('find docs')).toBe('docs\ndocs/a.txt\ndocs/b.txt\ndocs/sub\ndocs/sub/c.txt\ndocs/sub/empty\ndocs/old.txt');
    const result = await run('find -L . -maxdepth 3 -name loop1');
    expect(result.output).toContain('loop1');
  });
});

describe('mutating commands only work under /tmp', () => {
  it('creates, copies, moves and removes inside /tmp', async () => {
    expect(await out('mkdir -p /tmp/a/b && touch /tmp/a/b/f && ls /tmp/a/b')).toBe('f');
    expect(await out('cp notes.txt /tmp/n && wc -l /tmp/n')).toBe('6 /tmp/n');
    expect(await out('cp -r docs /tmp/d && ls /tmp/d/sub')).toBe('c.txt\nempty');
    expect(await out('echo x > /tmp/a; mv /tmp/a /tmp/b; ls /tmp')).toBe('b');
    expect(await out('echo x > /tmp/a; rm /tmp/a; ls /tmp')).toBe('');
    expect(await out('mkdir /tmp/d; rmdir /tmp/d; ls /tmp')).toBe('');
    expect(await out('ln -s /etc /tmp/e; ls /tmp/e')).toBe('passwd\nshadow');
    expect(await out('echo hi | tee /tmp/t; cat /tmp/t')).toBe('hi\nhi');
    expect(await out('touch /tmp/x; chmod 700 /tmp/x; ls -l /tmp/x')).toMatch(/^-rwx------ 1 guest guest 0 Mar 14 09:30 \/tmp\/x$/);
  });

  it('answers Read-only file system everywhere else', async () => {
    expect((await run('touch foo')).output).toBe("touch: cannot touch 'foo': Read-only file system");
    expect((await run('mkdir foo')).output).toBe("mkdir: cannot create directory 'foo': Read-only file system");
    expect((await run('rm notes.txt')).output).toBe("rm: cannot remove 'notes.txt': Read-only file system");
    expect((await run('cp notes.txt copy.txt')).output).toBe("cp: cannot create regular file 'copy.txt': Read-only file system");
    expect((await run('mv notes.txt moved.txt')).output).toBe("mv: cannot move 'notes.txt' to 'moved.txt': Read-only file system");
    expect((await run('ln -s a b')).output).toBe("ln: failed to create symbolic link 'b': Read-only file system");
    expect((await run('chmod 777 notes.txt')).output).toBe("chmod: changing permissions of 'notes.txt': Read-only file system");
    expect((await run('chown root notes.txt')).output).toContain('Operation not permitted');
    expect((await run('sed -i s/a/b/ notes.txt')).output).toContain('Read-only file system');
  });

  it('protects / and /tmp itself', async () => {
    expect((await run('rm -rf /')).output).toContain("it is dangerous to operate recursively on '/'");
    expect((await run('rm -rf /tmp')).output).toContain('Read-only file system');
    expect((await run('cp nope /tmp/x')).output).toBe("cp: cannot stat 'nope': No such file or directory");
    expect((await run('cp docs /tmp/x')).output).toBe("cp: -r not specified; omitting directory 'docs'");
  });

  it('does not persist anything between command lines', async () => {
    await run('echo hi > /tmp/keep');
    expect((await run('cat /tmp/keep')).output).toContain('No such file or directory');
  });
});

describe('path utilities and test', () => {
  it('basename, dirname, realpath, readlink', async () => {
    expect(await out('basename /a/b/c.txt .txt')).toBe('c');
    expect(await out('dirname /a/b/c.txt')).toBe('/a/b');
    expect(await out('realpath dirlink/a.txt')).toBe('/home/guest/docs/a.txt');
    expect(await out('readlink link')).toBe('docs/a.txt');
    expect(await out('readlink -f link')).toBe('/home/guest/docs/a.txt');
  });

  it('test / [ evaluate file tests', async () => {
    expect((await run('[ -f notes.txt ]')).exit).toBe(0);
    expect((await run('[ -d notes.txt ]')).exit).toBe(1);
    expect((await run('test -e nope')).exit).toBe(1);
    expect((await run('[ -r noread.txt ]')).exit).toBe(1);
    expect((await run('[ -L link ]')).exit).toBe(0);
    expect((await run('[ a = a ] && [ 2 -lt 10 ]')).exit).toBe(0);
    expect((await run('[ -n "" -o x = y ]')).exit).toBe(1);
  });

  it('strips colours helper works', () => {
    expect(stripAnsi('\x1b[1;34mx\x1b[0m')).toBe('x');
  });
});
