import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { binary, dir, renderTokens } from '../../src/terminal/vfs.js';
import { makeTestCtx, out, run } from './_helpers.js';

const FLAG = 'CTF{test_2}';

describe('flag tokens', () => {
  it('render every filter, chained left to right', async () => {
    const text = (await out('cat tokens.txt')).split('\n');
    expect(text[0]).toBe(`b64=${Buffer.from(FLAG).toString('base64')}`);
    expect(text[1]).toBe('rot=PGS{grfg_2}');
    expect(text[2]).toBe('rev=}2_tset{FTC');
    expect(text[3]).toBe(`hex=${Buffer.from(FLAG).toString('hex')}`);
    expect(text[4]).toBe('up=CTF{TEST_2}');
    expect(text[5]).toBe('low=ctf{test_2}');
    expect(text[6]).toBe('sl=CTF{');
    const key = Buffer.from('K');
    expect(text[7]).toBe(`xor=${Buffer.from(FLAG).map((b) => b ^ key[0]).toString('hex')}`);
    expect(text[8]).toBe(`chain=${Buffer.from('}2_tset{FTC').toString('base64')}`);
  });

  it('prints unknown filters literally and still fills unknown codes via ctx.flag', async () => {
    const text = (await out('cat tokens.txt')).split('\n');
    expect(text[9]).toBe('bad={{flag:2|nope}}');
    expect(text[10]).toBe('unk=CTF{test_77}');
    expect(renderTokens('{{flag:5}}', () => undefined)).toBe('{{flag:5}}');
    expect(renderTokens('{{nothing}}', () => 'x')).toBe('{{nothing}}');
  });

  it('slice can split a flag into fragments', () => {
    const flag = (n) => `CTF{fragment_number_${n}_abc}`;
    const parts = ['0-10', '10-20', '20-99'].map((range) => renderTokens(`{{flag:5|slice:${range}}}`, flag));
    expect(parts.join('')).toBe(flag(5));
  });

  it('every command sees rendered bytes', async () => {
    expect(await out('grep -c test_1 README.txt')).toBe('1');
    expect(await out('wc -c README.txt')).toBe(`${'Welcome\nsecret: CTF{test_1}\nbye\n'.length} README.txt`);
    expect(await out('head -c 18 README.txt | tail -c 3')).toBe(' CT');
    expect(await out('cat README.txt | md5sum')).toBe(`${createHash('md5').update('Welcome\nsecret: CTF{test_1}\nbye\n').digest('hex')}  -`);
    expect(await out('xxd -p README.txt | tr -d "\\n" | grep -c 4354467b746573745f317d')).toBe('1');
    expect(await out('strings README.txt | grep -c CTF')).toBe('1');
    expect(await out('ls -l README.txt')).toContain(String('Welcome\nsecret: CTF{test_1}\nbye\n'.length));
  });

  it('uses the per-request flag function', async () => {
    const ctx = makeTestCtx({ flags: { 1: 'CTF{team_a}' } });
    const other = makeTestCtx({ flags: { 1: 'CTF{team_b}' } });
    expect(await out('grep -o "CTF{[a-z_]*}" README.txt', ctx)).toBe('CTF{team_a}');
    expect(await out('grep -o "CTF{[a-z_]*}" README.txt', other)).toBe('CTF{team_b}');
  });

  it('gzb64 tokens round-trip through base64 | gunzip', async () => {
    expect(await out('cat layers.b64 | base64 -d | gunzip')).toBe('CTF{test_9}');
    expect(await out('cat layers.b64 | base64 -d | zcat')).toBe('CTF{test_9}');
  });
});

describe('base64', () => {
  it('encodes and decodes', async () => {
    expect(await out('echo hello | base64')).toBe('aGVsbG8K');
    expect(await out('echo aGVsbG8K | base64 -d')).toBe('hello');
    expect(await out('echo aGVsbG8K | base64 --decode')).toBe('hello');
    expect(await out('printf "%0100d" 0 | base64 | head -n 1 | wc -c')).toBe('77');
    expect(await out('printf "%0100d" 0 | base64 -w 0 | wc -l')).toBe('0');
    expect(await out('cat notes.txt | base64 | base64 -d | head -n 1')).toBe('alpha');
  });

  it('reports invalid input but still prints what it could decode', async () => {
    const result = await run('echo "aGVsbG8K!!" | base64 -d');
    expect(result.output).toContain('base64: invalid input');
    expect(result.exit).toBe(1);
    expect((await run('base64 nope')).output).toBe('base64: nope: No such file or directory');
  });
});

describe('xxd, hexdump, od, strings', () => {
  it('formats xxd like the real tool', async () => {
    expect(await out('echo "Hello world" | xxd')).toBe('00000000: 4865 6c6c 6f20 776f 726c 640a            Hello world.');
    expect(await out('xxd -l 4 bin.dat')).toBe(`00000000: ${'0001 0203'.padEnd(39)}  ....`);
    expect(await out('xxd -s 4 -l 3 bin.dat')).toBe(`00000004: ${'ff41 42'.padEnd(39)}  .AB`);
    expect(await out('xxd -p -l 4 bin.dat')).toBe('00010203');
    expect(await out('xxd -g1 -l 4 bin.dat')).toBe(`00000000: ${'00 01 02 03'.padEnd(47)}  ....`);
    expect(await out('xxd -u -p -l 5 bin.dat')).toBe('00010203FF');
  });

  it('reverses hex back to bytes', async () => {
    expect(await out('echo 48656c6c6f | xxd -r -p')).toBe('Hello');
    expect(await out('echo "Hello" | xxd | xxd -r')).toBe('Hello');
    expect(await out('echo 48656c6c6f | xxd -r -p | md5sum')).toBe(`${createHash('md5').update('Hello').digest('hex')}  -`);
  });

  it('prints canonical hexdump', async () => {
    expect(await out('hexdump -C bin.dat')).toBe('00000000  00 01 02 03 ff 41 42 43  44 45 00                 |.....ABCDE.|\n0000000b');
    expect(await out('printf "%032d" 0 | hexdump -C | head -n 3')).toContain('00000000  30 30 30 30 30 30 30 30  30 30 30 30 30 30 30 30  |0000000000000000|');
    expect(await out('hexdump bin.dat | head -n 1')).toBe('0000000 0100 0302 41ff 4342 4544 0000');
  });

  it('collapses repeated hexdump rows', async () => {
    const text = await out('printf "%064d" 0 | hexdump -C');
    expect(text.split('\n')).toHaveLength(3); // first row, `*`, final offset
    expect(text.split('\n')[1]).toBe('*');
  });

  it('od -c shows escapes', async () => {
    expect(await out('printf "a\\tb\\n" | od -c')).toBe('0000000   a  \\t   b  \\n\n0000004');
  });

  it('finds printable runs with strings', async () => {
    expect(await out('strings bin.dat')).toBe('ABCDE');
    expect(await out('strings -n 6 bin.dat')).toBe('');
    expect(await out('strings -n 3 bin.dat')).toBe('ABCDE');
    expect(await out('strings -t x bin.dat')).toBe('      5 ABCDE');
  });
});

describe('gzip family', () => {
  it('decompresses via gunzip, zcat and gzip -d', async () => {
    expect(await out('gunzip -c blob.gz')).toBe('hello gzip');
    expect(await out('zcat blob.gz')).toBe('hello gzip');
    expect(await out('gzip -dc blob.gz')).toBe('hello gzip');
    expect(await out('cat blob.gz | gunzip')).toBe('hello gzip');
    expect(await out('cat blob.gz | gzip -d')).toBe('hello gzip');
  });

  it('compresses to stdout and round-trips', async () => {
    expect(await out('echo data | gzip | gunzip')).toBe('data');
    expect(await out('echo data | gzip | file -')).toContain('gzip compressed data');
  });

  it('works on files under /tmp and refuses the read-only tree with a hint', async () => {
    expect(await out('cp blob.gz /tmp && gunzip /tmp/blob.gz && cat /tmp/blob && ls /tmp')).toBe('hello gzip\nblob');
    const result = await run('gunzip blob.gz');
    expect(result.output).toContain('Read-only file system');
    expect(result.output).toContain('zcat blob.gz');
    expect((await run('gunzip notes.txt')).output).toContain('unknown suffix -- ignored');
    expect((await run('zcat notes.txt')).output).toBe('zcat: notes.txt: not in gzip format');
    expect((await run('echo nope | gunzip')).output).toBe('gunzip: stdin: not in gzip format');
  });

  it('refuses zip bombs', async () => {
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 'a')).toString('base64');
    const ctx = makeTestCtx();
    ctx.mode.fs = dir({ home: dir({ guest: dir({ 'bomb.gz': binary(bomb) }) }) });
    const result = await run('zcat bomb.gz | wc -c', ctx);
    expect(result.exit).toBe(137);
    expect(result.output).toBe('bash: resource limit exceeded');
  });
});

describe('checksums and factor', () => {
  const md5 = (text) => createHash('md5').update(text).digest('hex');
  it('hashes files and stdin with GNU formatting', async () => {
    expect(await out('echo -n hi | md5sum')).toBe(`${md5('hi')}  -`);
    expect(await out('md5sum docs/a.txt')).toBe(`${md5('one\ntwo\nthree\n')}  docs/a.txt`);
    expect(await out('sha1sum docs/a.txt')).toBe(`${createHash('sha1').update('one\ntwo\nthree\n').digest('hex')}  docs/a.txt`);
    expect(await out('sha256sum docs/a.txt | cut -c1-8')).toBe(createHash('sha256').update('one\ntwo\nthree\n').digest('hex').slice(0, 8));
    expect(await out('sha512sum docs/a.txt | cut -c1-8')).toBe(createHash('sha512').update('one\ntwo\nthree\n').digest('hex').slice(0, 8));
    expect((await run('md5sum nope')).output).toBe('md5sum: nope: No such file or directory');
    expect((await run('md5sum docs')).output).toBe('md5sum: docs: Is a directory');
  });

  it('matches files by checksum and verifies with -c', async () => {
    const hash = md5('one\ntwo\nthree\n');
    expect(await out(`md5sum docs/*.txt | grep ${hash} | cut -d" " -f3`)).toBe('docs/a.txt');
    expect(await out(`echo "${hash}  docs/a.txt" > /tmp/sums; md5sum -c /tmp/sums`)).toBe('docs/a.txt: OK');
    const bad = await run(`echo "${'0'.repeat(32)}  docs/a.txt" > /tmp/sums; md5sum -c /tmp/sums`);
    expect(bad.output).toContain('docs/a.txt: FAILED');
    expect(bad.output).toContain('WARNING: 1 computed checksum did NOT match');
    expect(bad.exit).toBe(1);
  });

  it('factors numbers', async () => {
    expect(await out('factor 360')).toBe('360: 2 2 2 3 3 5');
    expect(await out('factor 97')).toBe('97: 97');
    expect((await run('factor abc')).output).toContain('not a valid positive integer');
  });
});
