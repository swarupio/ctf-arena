import { describe, expect, it } from 'vitest';
import { makeTestCtx, out, run, stripAnsi } from './_helpers.js';

describe('grep', () => {
  it('matches plain patterns with the common flags', async () => {
    expect(await out('grep alpha notes.txt')).toBe('alpha\nalpha\nalpha');
    expect(await out('grep -n alpha notes.txt')).toBe('1:alpha\n4:alpha\n6:alpha');
    expect(await out('grep -c alpha notes.txt')).toBe('3');
    expect(await out('grep -i beta notes.txt')).toBe('Beta');
    expect(await out('grep -v alpha notes.txt')).toBe('Beta\ngamma\ndelta');
    expect(await out('grep -vc alpha notes.txt')).toBe('3');
    expect(await out('grep -x alpha notes.txt | wc -l')).toBe('3');
    expect(await out('grep -w amm notes.txt')).toBe('');
    expect(await out('grep -w gamma notes.txt')).toBe('gamma');
  });

  it('supports -e, -f, -m, -q and exit codes', async () => {
    expect(await out('grep -e Beta -e delta notes.txt')).toBe('Beta\ndelta');
    expect(await out('printf "gamma\\ndelta\\n" > /tmp/p; grep -f /tmp/p notes.txt')).toBe('gamma\ndelta');
    expect(await out('grep -m1 alpha notes.txt')).toBe('alpha');
    expect((await run('grep -q alpha notes.txt')).exit).toBe(0);
    expect((await run('grep -q zzz notes.txt')).exit).toBe(1);
    expect((await run('grep alpha nope')).exit).toBe(2);
    expect((await run('grep alpha nope')).output).toBe('grep: nope: No such file or directory');
    expect((await run('grep -s alpha nope')).output).toBe('');
    expect((await run('grep')).output).toContain('Usage: grep');
  });

  it('prints file names for several files and recursion', async () => {
    expect(await out('grep -n one docs/a.txt docs/b.txt')).toBe('docs/a.txt:1:one\ndocs/b.txt:1:one');
    expect(await out('grep -h one docs/a.txt docs/b.txt')).toBe('one\none');
    expect(await out('grep -H one docs/a.txt')).toBe('docs/a.txt:one');
    expect(await out('grep -r one docs')).toBe('docs/a.txt:one\ndocs/b.txt:one');
    expect(await out('grep -rn deep docs')).toBe('docs/sub/c.txt:1:deep CTF{decoy}');
    expect(await out('cd docs; grep -r deep')).toBe('sub/c.txt:deep CTF{decoy}');
    expect(await out('cd docs; grep -r deep .')).toBe('./sub/c.txt:deep CTF{decoy}');
    expect(await out('grep -rl one docs')).toBe('docs/a.txt\ndocs/b.txt');
    expect(await out('grep -rL one docs')).toBe('docs/sub/c.txt\ndocs/sub/empty\ndocs/old.txt');
    expect(await out('grep -rc one docs')).toBe('docs/a.txt:1\ndocs/b.txt:1\ndocs/sub/c.txt:0\ndocs/sub/empty:0\ndocs/old.txt:0');
    expect(await out('grep one docs')).toBe('grep: docs: Is a directory');
    expect(await out('grep -r --include="*.txt" -l deep docs')).toBe('docs/sub/c.txt');
    expect(await out('grep -r --exclude-dir=sub -c deep docs | grep -c sub')).toBe('0');
  });

  it('does not follow symlinks with -r but does with -R and command-line links', async () => {
    expect(await out('grep -r one . 2>/dev/null | grep -c "^./link"')).toBe('0');
    expect(await out('grep -R one . 2>/dev/null | grep -c "^./link"')).toBe('1');
    expect(await out('grep -r one dirlink')).toBe('dirlink/a.txt:one\ndirlink/b.txt:one');
  });

  it('supports regex flavours', async () => {
    expect(await out('grep "^a.*a$" notes.txt | head -n1')).toBe('alpha');
    expect(await out('grep -E "gam+a|delta" notes.txt')).toBe('gamma\ndelta');
    expect(await out('grep "gam\\+a" notes.txt')).toBe('gamma');
    expect(await out('grep "gamma\\|delta" notes.txt')).toBe('gamma\ndelta');
    expect(await out('grep -F "a.b" notes.txt')).toBe('');
    expect(await out('printf "a.b\\naxb\\n" | grep -F "a.b"')).toBe('a.b');
    expect(await out('printf "a.b\\naxb\\n" | grep "a.b"')).toBe('a.b\naxb');
    expect(await out('printf "a.b\\naxb\\n" | grep "a\\.b"')).toBe('a.b');
    expect(await out('printf "ab12\\n" | grep -o "[0-9]\\+"')).toBe('12');
    expect(await out('printf "ab12\\n" | grep -oE "[[:digit:]]{2}"')).toBe('12');
    expect(await out('printf "x1\\n" | grep -P "\\d"')).toBe('x1');
    expect(await out('printf "a\\nb\\n" | grep -E "^(a|b)$" | wc -l')).toBe('2');
    expect(await out('printf "10.0.0.1 ok\\nnope\\n" | grep -E "([0-9]+\\.){3}[0-9]+"')).toBe('10.0.0.1 ok');
    expect(await out('printf "a\\n" | egrep "a|b"')).toBe('a');
    expect(await out('printf "a.b\\n" | fgrep "a.b"')).toBe('a.b');
  });

  it('prints context lines with separators', async () => {
    expect(await out('grep -A1 Beta notes.txt')).toBe('Beta\ngamma');
    expect(await out('grep -B1 delta notes.txt')).toBe('alpha\ndelta');
    expect(await out('grep -n -C1 gamma notes.txt')).toBe('2-Beta\n3:gamma\n4-alpha');
    expect(await out('grep -A0 -n -e Beta -e delta notes.txt')).toBe('2:Beta\n5:delta');
    expect(await out('grep -n -A1 -e Beta -e delta notes.txt')).toBe('2:Beta\n3-gamma\n--\n5:delta\n6-alpha');
  });

  it('only colours on a tty and never splits a CTF{...} token', async () => {
    const tty = makeTestCtx({ color: true });
    expect(await out('grep -n alpha notes.txt', tty)).toBe('\x1b[32m1\x1b[0m\x1b[36m:\x1b[0m\x1b[1;31malpha\x1b[0m\n\x1b[32m4\x1b[0m\x1b[36m:\x1b[0m\x1b[1;31malpha\x1b[0m\n\x1b[32m6\x1b[0m\x1b[36m:\x1b[0m\x1b[1;31malpha\x1b[0m');
    expect(await out('grep alpha notes.txt | cat', tty)).not.toContain('\x1b');
    expect(await out('grep --color=never alpha notes.txt', tty)).not.toContain('\x1b');
    expect(await out('grep -r CTF docs', tty)).toContain('deep CTF{decoy}');
    expect(stripAnsi(await out('grep -r deep docs', tty))).toBe('docs/sub/c.txt:deep CTF{decoy}');
    expect(await out('grep -o "CTF{[a-z]*}" docs/sub/c.txt', tty)).toBe('\x1b[1;31mCTF{decoy}\x1b[0m');
    expect(await out('grep alpha notes.txt', makeTestCtx({ color: false }))).not.toContain('\x1b');
  });

  it('reports binary matches without dumping bytes', async () => {
    expect(await out('grep ABC bin.dat')).toBe('Binary file bin.dat matches');
    expect(await out('grep -a ABC bin.dat | wc -l')).toBe('1');
  });
});

describe('sort and uniq', () => {
  it('sorts in C-locale byte order', async () => {
    expect(await out('printf "b\\nB\\na\\nA\\n" | sort')).toBe('A\nB\na\nb');
    expect(await out('printf "b\\nB\\na\\nA\\n" | sort -f')).toBe('A\na\nB\nb');
    expect(await out('printf "b\\na\\nb\\n" | sort -r')).toBe('b\nb\na');
    expect(await out('printf "b\\na\\nb\\n" | sort -u')).toBe('a\nb');
  });

  it('sorts numerically and by keys', async () => {
    expect(await out('printf "10\\n9\\n100\\n" | sort')).toBe('10\n100\n9');
    expect(await out('printf "10\\n9\\n100\\n" | sort -n')).toBe('9\n10\n100');
    expect(await out('printf "10\\n9\\n100\\n" | sort -nr')).toBe('100\n10\n9');
    expect(await out('sort -t, -k2,2n data.csv | tail -n 2')).toBe('ann,31,Paris\ncy,40,Rome');
    expect(await out('sort -t, -k3 -k2n data.csv | head -n 3')).toBe('bob,25,Oslo\ndee,25,Oslo\nann,31,Paris'); // header "city" sorts last (lowercase after uppercase)
    expect(await out('printf "b 2\\na 2\\nc 1\\n" | sort -k2n')).toBe('c 1\na 2\nb 2');
    expect(await out('printf "b 2\\na 2\\nc 1\\n" | sort -k2n -s')).toBe('c 1\nb 2\na 2');
    expect(await out('printf "1K\\n1M\\n1G\\n" | sort -h')).toBe('1K\n1M\n1G');
    expect(await out('printf "v10\\nv9\\n" | sort -V')).toBe('v9\nv10');
  });

  it('refuses random sort (determinism)', async () => {
    expect((await run('sort -R notes.txt')).output).toContain('disabled in this sandbox');
  });

  it('uniq counts adjacent duplicates with %7d format', async () => {
    expect(await out('sort notes.txt | uniq -c')).toBe('      1 Beta\n      3 alpha\n      1 delta\n      1 gamma');
    expect(await out('sort notes.txt | uniq -d')).toBe('alpha');
    expect(await out('sort notes.txt | uniq -u')).toBe('Beta\ndelta\ngamma');
    expect(await out('printf "a\\nA\\nb\\n" | uniq -i')).toBe('a\nb');
    expect(await out('cat notes.txt | uniq | wc -l')).toBe('6');
  });

  it('supports the classic frequency pipeline', async () => {
    expect(await out('grep -o "[A-Za-z]*" notes.txt | sort | uniq -c | sort -rn | head -n 1')).toBe('      3 alpha');
  });
});

describe('cut, tr, rev, paste, comm, column, seq', () => {
  it('cuts fields and characters', async () => {
    expect(await out('cut -d, -f1 data.csv | head -n 2')).toBe('name\nann');
    expect(await out('cut -d, -f2-3 data.csv | head -n 2')).toBe('age,city\n31,Paris');
    expect(await out('cut -d, -f1,3 data.csv | head -n 2')).toBe('name,city\nann,Paris');
    expect(await out('cut -c1-3 notes.txt | head -n 2')).toBe('alp\nBet');
    expect(await out('cut -c3- notes.txt | head -n 1')).toBe('pha');
    expect(await out('cut -d, -f2 --complement data.csv | head -n 1')).toBe('name,city');
    expect(await out('printf "a:b\\nnodelim\\n" | cut -d: -f2')).toBe('b\nnodelim');
    expect(await out('printf "a:b\\nnodelim\\n" | cut -s -d: -f2')).toBe('b');
    expect((await run('cut data.csv')).output).toContain('you must specify a list');
  });

  it('translates with ranges and classes', async () => {
    expect(await out('echo hello | tr a-z A-Z')).toBe('HELLO');
    expect(await out("echo hello | tr '[:lower:]' '[:upper:]'")).toBe('HELLO');
    expect(await out("echo Hello | tr 'a-zA-Z' 'n-za-mN-ZA-M'")).toBe('Uryyb');
    expect(await out('echo hello | tr -d l')).toBe('heo');
    expect(await out("echo 'a  b   c' | tr -s ' '")).toBe('a b c');
    expect(await out('echo abc | tr abc x')).toBe('xxx');
    expect(await out('echo hello123 | tr -cd 0-9')).toBe('123');
    expect(await out("printf 'a\\nb\\n' | tr -d '\\n'")).toBe('ab');
    expect(await out("echo abc | tr 'a-c' '\\n' | wc -l")).toBe('4');
    expect((await run('echo x | tr z-a x')).output).toContain('reverse collating sequence order');
  });

  it('reverses, pastes, compares and aligns', async () => {
    expect(await out('echo abc | rev')).toBe('cba');
    expect(await out('paste docs/a.txt docs/b.txt | head -n 2')).toBe('one\tone\ntwo\t2');
    expect(await out('paste -s -d, docs/a.txt')).toBe('one,two,three');
    expect(await out('printf "a\\nb\\nc\\n" > /tmp/x; printf "b\\nc\\nd\\n" > /tmp/y; comm -12 /tmp/x /tmp/y')).toBe('b\nc');
    expect(await out('printf "a\\nb\\n" > /tmp/x; printf "b\\nc\\n" > /tmp/y; comm /tmp/x /tmp/y')).toBe('a\n\t\tb\n\tc');
    expect(await out('printf "a 1\\nbbb 22\\n" | column -t')).toBe('a    1\nbbb  22');
    expect(await out('seq 3')).toBe('1\n2\n3');
    expect(await out('seq 2 2 8')).toBe('2\n4\n6\n8');
    expect(await out('seq -w 8 10')).toBe('08\n09\n10');
    expect(await out('seq -s, 1 3')).toBe('1,2,3');
  });
});

describe('sed', () => {
  it('substitutes with s///[g], other delimiters and groups', async () => {
    expect(await out('sed s/alpha/ALPHA/ notes.txt | head -n 1')).toBe('ALPHA');
    expect(await out('echo aaa | sed s/a/b/')).toBe('baa');
    expect(await out('echo aaa | sed s/a/b/g')).toBe('bbb');
    expect(await out('echo aaa | sed s/a/b/2')).toBe('aba');
    expect(await out('echo aaa | sed s/a/b/2g')).toBe('abb');
    expect(await out('echo /usr/bin | sed s,/usr,/opt,')).toBe('/opt/bin');
    expect(await out('echo hello | sed "s/\\(h\\)\\(e\\)/\\2\\1/"')).toBe('ehllo');
    expect(await out('echo hello | sed -E "s/(h)(e)/\\2\\1/"')).toBe('ehllo');
    expect(await out('echo hello | sed "s/l/[&]/g"')).toBe('he[l][l]o');
    expect(await out('echo Hello | sed "s/h/J/I"')).toBe('Jello');
    expect(await out('echo abc | sed "s/x*/-/g"')).toBe('-a-b-c-');
    expect(await out('echo a.b | sed "s/\\./-/"')).toBe('a-b');
    expect(await out('echo "a b" | sed "s/ /\\n/"')).toBe('a\nb');
  });

  it('prints, deletes and addresses lines', async () => {
    expect(await out("sed -n '2p' notes.txt")).toBe('Beta');
    expect(await out("sed -n '2,3p' notes.txt")).toBe('Beta\ngamma');
    expect(await out("sed -n '$p' notes.txt")).toBe('alpha');
    expect(await out("sed '2d' notes.txt | head -n 2")).toBe('alpha\ngamma');
    expect(await out("sed '2,5d' notes.txt")).toBe('alpha\nalpha');
    expect(await out("sed '/alpha/d' notes.txt")).toBe('Beta\ngamma\ndelta');
    expect(await out("sed -n '/Beta/,/delta/p' notes.txt")).toBe('Beta\ngamma\nalpha\ndelta');
    expect(await out("sed -n '/alpha/!p' notes.txt")).toBe('Beta\ngamma\ndelta');
    expect(await out("sed 2q notes.txt")).toBe('alpha\nBeta');
    expect(await out("sed -e '1d' -e '2d' notes.txt | head -n 1")).toBe('gamma');
    expect(await out("sed -n '1p;3p' notes.txt")).toBe('alpha\ngamma');
    expect(await out("sed '=' docs/a.txt | head -n 2")).toBe('1\none');
    expect(await out("echo abc | sed 'y/abc/xyz/'")).toBe('xyz');
  });

  it('reports sed errors and refuses unsafe patterns', async () => {
    expect((await run("sed 'k' notes.txt")).output).toContain("unknown command: `k'");
    expect((await run("sed 's/a/b' notes.txt")).output).toContain("unterminated `s' command");
    expect((await run("sed 's/\\(a\\)\\1/x/' notes.txt")).output).toBe('sed: unsupported pattern');
    expect((await run("sed 's/a/\\1/' notes.txt")).output).toContain('invalid reference \\1');
    expect((await run('sed')).output).toContain('Usage: sed');
  });
});

describe('awk', () => {
  it('prints fields, with -F and NR/NF/END', async () => {
    expect(await out("awk '{print $1}' docs/b.txt | head -n 2")).toBe('one\n2');
    expect(await out("awk -F, '{print $2}' data.csv | head -n 2")).toBe('age\n31');
    expect(await out("awk -F, '{print $1, $3}' data.csv | sed -n 2p")).toBe('ann Paris');
    expect(await out("awk -F, '{print $NF}' data.csv | sed -n 2p")).toBe('Paris');
    expect(await out("awk -F, 'NR==2' data.csv")).toBe('ann,31,Paris');
    expect(await out("awk 'END{print NR}' data.csv")).toBe('5');
    expect(await out("awk '{print NR\":\"NF}' docs/a.txt | head -n 1")).toBe('1:1');
    expect(await out("awk -F: '{print $1\"@\"$3}' /etc/passwd | head -n 1")).toBe('root@0');
    expect(await out("echo 'a b c' | awk '{print $(NF-1)}'")).toBe('b');
    expect(await out("echo 'a b c' | awk '{$2=\"X\"; print}'")).toBe('a X c');
    expect(await out("echo 'a b c' | awk -v OFS=- '{print $1,$3}'")).toBe('a-c');
  });

  it('filters with patterns, comparisons and ranges', async () => {
    expect(await out("awk '/alpha/' notes.txt | wc -l")).toBe('3');
    expect(await out("awk '/alpha/ {print NR}' notes.txt")).toBe('1\n4\n6');
    expect(await out("awk -F, '$2 > 30 {print $1}' data.csv")).toBe('name\nann\ncy'); // header "age" compares as a string
    expect(await out("awk -F, 'NR > 1 && $2 > 30 {print $1}' data.csv")).toBe('ann\ncy');
    expect(await out("awk -F, '$3 == \"Oslo\" {print $1}' data.csv")).toBe('bob\ndee');
    expect(await out("awk -F, '$3 ~ /^O/ {n++} END {print n}' data.csv")).toBe('2');
    expect(await out("awk '!/alpha/' notes.txt | wc -l")).toBe('3');
    expect(await out("awk 'NR>=2 && NR<=3' notes.txt")).toBe('Beta\ngamma');
    expect(await out("awk '/Beta/,/delta/' notes.txt | wc -l")).toBe('4');
    expect(await out("awk 'length($0) > 5' notes.txt")).toBe('');
    expect(await out("awk 'length > 4' notes.txt | wc -l")).toBe('5'); // every line except "Beta"
  });

  it('aggregates with variables, arrays and printf', async () => {
    expect(await out("awk -F, 'NR>1 {s+=$2} END{print s}' data.csv")).toBe('121');
    expect(await out("awk -F, 'NR>1 {s+=$2} END{printf \"%.1f\\n\", s/(NR-1)}' data.csv")).toBe('30.3');
    expect(await out("awk '{c[$1]++} END{for(k in c) print k, c[k]}' notes.txt | sort")).toBe('Beta 1\nalpha 3\ndelta 1\ngamma 1');
    expect(await out("awk '{ if ($1 == \"alpha\") a++; else b++ } END {print a, b}' notes.txt")).toBe('3 3');
    expect(await out("awk 'BEGIN{for(i=1;i<=3;i++) s=s i; print s}'")).toBe('123');
    expect(await out("awk 'BEGIN{print 2^10, 7%3, int(3.9), length(\"abc\")}'")).toBe('1024 1 3 3');
    expect(await out("awk 'BEGIN{print substr(\"hello\",2,3), index(\"hello\",\"l\"), toupper(\"x\")}'")).toBe('ell 3 X');
    expect(await out("echo 'a-b-c' | awk '{n=split($0,p,\"-\"); print n, p[2]}'")).toBe('3 b');
    expect(await out("echo 'foo foo' | awk '{gsub(/o/,\"0\"); print}'")).toBe('f00 f00');
    expect(await out("echo 'foo' | awk '{sub(/o+/,\"[&]\"); print}'")).toBe('f[oo]');
    expect(await out("echo 'abc' | awk '{print match($0,/c/), RSTART, RLENGTH}'")).toBe('3 3 1');
    expect(await out("awk 'BEGIN{printf \"%5s|%-5s|%03d|%x|%c\\n\", \"ab\", \"cd\", 7, 255, 65}'")).toBe('   ab|cd   |007|ff|A');
    expect(await out("echo 1 2 3 | awk '{for(i=NF;i>0;i--) printf \"%s \", $i; print \"\"}'")).toBe('3 2 1 ');
  });

  it('handles errors and unsupported features', async () => {
    expect((await run("awk '{print' notes.txt")).output).toMatch(/^awk: /);
    expect((await run("awk 'BEGIN{system(\"ls\")}'")).output).toContain('not available in this sandbox');
    expect((await run("awk 'BEGIN{getline}'")).output).toContain('getline is not supported');
    expect((await run("awk 'BEGIN{print 1/0}'")).output).toContain('division by zero');
    expect((await run("awk '/(a+)+$/' notes.txt")).output).toContain('unsupported pattern');
    expect((await run('awk')).output).toContain('usage: awk');
  });
});

describe('diff', () => {
  it('prints normal diffs', async () => {
    expect(await out('diff docs/a.txt docs/b.txt')).toBe('2c2\n< two\n---\n> 2\n3a4\n> four');
    expect(await out('diff docs/b.txt docs/a.txt')).toBe('2c2\n< 2\n---\n> two\n4d3\n< four');
    expect((await run('diff docs/a.txt docs/a.txt')).output).toBe('');
    expect((await run('diff docs/a.txt docs/a.txt')).exit).toBe(0);
    expect((await run('diff docs/a.txt docs/b.txt')).exit).toBe(1);
    expect(await out('diff -q docs/a.txt docs/b.txt')).toBe('Files docs/a.txt and docs/b.txt differ');
    expect(await out('printf "A\\n" > /tmp/x; printf "a\\n" > /tmp/y; diff -i /tmp/x /tmp/y')).toBe('');
  });

  it('prints unified diffs and reports errors', async () => {
    expect(await out('diff -u docs/a.txt docs/b.txt')).toBe([
      '--- docs/a.txt\t2024-03-14 09:26:53.000000000 +0000',
      '+++ docs/b.txt\t2024-03-14 09:26:53.000000000 +0000',
      '@@ -1,3 +1,4 @@', ' one', '-two', '+2', ' three', '+four',
    ].join('\n'));
    expect((await run('diff docs/a.txt nope')).output).toBe('diff: nope: No such file or directory');
    expect((await run('diff docs/a.txt')).exit).toBe(2);
  });
});

describe('xargs', () => {
  it('builds command lines', async () => {
    expect(await out('echo a b c | xargs echo x')).toBe('x a b c');
    expect(await out('echo a b c | xargs -n1 echo x')).toBe('x a\nx b\nx c');
    expect(await out('echo a b c | xargs -n 2 echo')).toBe('a b\nc');
    expect(await out('echo a b | xargs -I{} echo [{}]')).toBe('[a b]');
    expect(await out('printf "a\\nb\\n" | xargs -I{} echo [{}]')).toBe('[a]\n[b]');
    expect(await out('find docs -name "*.txt" | xargs grep -l one')).toBe('docs/a.txt\ndocs/b.txt');
    expect(await out('echo docs/a.txt | xargs cat')).toBe('one\ntwo\nthree');
    expect(await out("printf '\"a b\" c\\n' | xargs -n1 echo")).toBe('a b\nc');
    expect(await out('printf "a\\0b\\0" | xargs -0 -n1 echo')).toBe('a\nb');
    expect(await out('echo | xargs -r echo none')).toBe('');
    expect(await out('echo a | xargs')).toBe('a');
  });

  it('propagates failures and enforces the nesting cap', async () => {
    expect((await run('echo nope | xargs cat')).exit).toBe(123);
    expect((await run('echo x | xargs nosuchcmd')).exit).toBe(127);
    expect((await run('echo a | xargs xargs echo')).output).toBe('a');
    const deep = await run('echo a | xargs xargs xargs echo');
    expect(deep.output).toContain('command nesting too deep');
  });
});

describe('echo, printf, expr', () => {
  it('echo handles -n and -e', async () => {
    expect(await out('echo -n hi; echo there')).toBe('hithere');
    expect(await out('echo -e "a\\tb"')).toBe('a\tb');
    expect(await out('echo -e "a\\x41\\0102"')).toBe('aAB');
    expect(await out('echo -e "stop\\cnot shown"')).toBe('stop');
    expect(await out('echo -ne "x\\ny"')).toBe('x\ny');
    expect(await out('echo "a\\tb"')).toBe('a\\tb');
  });

  it('printf formats and recycles its format', async () => {
    expect(await out('printf "%s-%s\\n" a b c d')).toBe('a-b\nc-d');
    expect(await out('printf "%5d|%-5d|%05d\\n" 42 42 42')).toBe('   42|42   |00042');
    expect(await out('printf "%.2f %e\\n" 3.14159 1500')).toBe('3.14 1.500000e+03');
    expect(await out('printf "%x %X %o\\n" 255 255 8')).toBe('ff FF 10');
    expect(await out('printf "%c%c\\n" hello world')).toBe('hw');
    expect(await out('printf "100%%\\n"')).toBe('100%');
    expect(await out('printf "%b\\n" "a\\tb"')).toBe('a\tb');
    expect(await out("printf '%s' 'no newline'")).toBe('no newline');
    expect((await run('printf "%d\\n" abc')).output).toContain("printf: 'abc': invalid number");
  });

  it('expr does simple arithmetic', async () => {
    expect(await out('expr 6 \\* 7')).toBe('42');
    expect(await out('expr 7 / 2')).toBe('3');
    expect(await out('expr length hello')).toBe('5');
  });
});
