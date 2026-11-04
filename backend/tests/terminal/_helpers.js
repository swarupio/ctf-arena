// Shared helpers for the terminal tests. Other test files (modes, api) may reuse makeTestCtx / run / stripAnsi.
import {
  binary, dir, file, link, vault, gzipDeterministic,
} from '../../src/terminal/vfs.js';
import { execute } from '../../src/terminal/shell.js';

export const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  Buffer.from('IHDR'),
  Buffer.from([0, 0, 0, 16, 0, 0, 0, 8, 8, 6, 0, 0, 0]),
]);
const elf = Buffer.alloc(64);
Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]).copy(elf);
elf.writeUInt16LE(2, 16);
elf.writeUInt16LE(62, 18);
const gz = gzipDeterministic(Buffer.from('hello gzip\n'));
const gzLayered = gzipDeterministic(Buffer.from('layer: CTF{test_9}\n'));

const bigLog = Array.from({ length: 1000 }, (_, i) => `2024-03-14 09:${String(i % 60).padStart(2, '0')}:00 host${i % 7} ${i % 10 === 0 ? 'ERROR' : 'INFO'} request ${i}`).join('\n');

// A small but varied VFS covering permissions, links, binaries, vaults and tokens.
export function sampleFs() {
  return dir({
    home: dir({
      guest: dir({
        'README.txt': file('Welcome\nsecret: {{flag:1}}\nbye\n'),
        'notes.txt': file('alpha\nBeta\ngamma\nalpha\ndelta\nalpha\n'),
        '.hidden': file('hidden file\n'),
        'data.csv': file('name,age,city\nann,31,Paris\nbob,25,Oslo\ncy,40,Rome\ndee,25,Oslo\n'),
        'spaces here.txt': file('space\n'),
        docs: dir({
          'a.txt': file('one\ntwo\nthree\n'),
          'b.txt': file('one\n2\nthree\nfour\n'),
          sub: dir({ 'c.txt': file('deep CTF{decoy}\n'), empty: file('') }),
          'old.txt': file('old\n', { mtime: '2023-01-01T00:00:00Z' }),
        }),
        bin: dir({ 'run.sh': file('#!/bin/bash\necho hi\n', { mode: 0o755 }), tool: binary(elf.toString('base64'), { mode: 0o755 }) }),
        link: link('docs/a.txt'),
        dirlink: link('docs'),
        loop1: link('loop2'),
        loop2: link('loop1'),
        dangling: link('/nowhere'),
        'big.log': file(`${bigLog}\n`),
        'blob.gz': binary(gz.toString('base64')),
        'layers.b64': file('{{flag:9|gzb64}}\n'),
        'pic.png': binary(png.toString('base64')),
        'crlf.txt': file('a\r\nb\r\n'),
        'bin.dat': binary(Buffer.from([0, 1, 2, 3, 0xff, 0x41, 0x42, 0x43, 0x44, 0x45, 0]).toString('base64')),
        private: dir({ 'x.txt': file('x\n') }, { mode: 0o700, owner: 'root', group: 'root' }),
        'noread.txt': file('nope\n', { mode: 0o600, owner: 'root', group: 'root' }),
        'tokens.txt': file('b64={{flag:2|b64}}\nrot={{flag:2|rot13}}\nrev={{flag:2|rev}}\nhex={{flag:2|hex}}\nup={{flag:2|upper}}\nlow={{flag:2|lower}}\nsl={{flag:2|slice:0-4}}\nxor={{flag:2|xor:K}}\nchain={{flag:2|rev|b64}}\nbad={{flag:2|nope}}\nunk={{flag:77}}\n'),
      }),
      other: dir({ 'diary.txt': file('mine\n') }, { owner: 'other', group: 'other', mode: 0o700 }),
    }),
    etc: dir({
      passwd: file('root:x:0:0:root:/root:/bin/bash\nguest:x:1000:1000::/home/guest:/bin/bash\nbob:x:1001:1001::/home/bob:/usr/sbin/nologin\n'),
      shadow: file('root:$6$x:1:0:99999:7:::\n', { mode: 0o640, owner: 'root', group: 'shadow' }),
    }),
    var: dir({
      log: dir({ 'syslog': file('boot ok\nerror: disk\nwarn: temp\n'), 'auth.log': file('Failed password for bob\nAccepted password for guest\n') }),
      secure: dir({ 'root.txt': file('top: {{flag:3}}\n', { mode: 0o600, owner: 'root', group: 'root' }) }, { mode: 0o700, owner: 'root', group: 'root' }),
    }),
    opt: dir({ 'box.vault': vault('vault says {{flag:4}}', 'hunter2') }),
    root: dir({ 'r.txt': file('root only\n') }, { mode: 0o700, owner: 'root', group: 'root' }),
  }, { owner: 'root', group: 'root' });
}

// `seed` (optional) is the per-team seed string behind {{seed:...}} tokens; leave it out for the engine default.
export function makeTestCtx({
  fs, flags, cwd = '/home/guest', solved = [], mode = {}, color = false, seed,
} = {}) {
  const flag = typeof flags === 'function' ? flags : (n) => (flags && flags[n]) ?? `CTF{test_${n}}`;
  return {
    ...(seed === undefined ? {} : { seed }),
    mode: {
      mode: 'test',
      title: 'Test Box',
      user: 'guest',
      host: 'arena',
      home: '/home/guest',
      fs: fs ?? sampleFs(),
      motd: 'hello {{flag:1}}',
      codes: [
        { n: 1, title: 'First', points: 40, hints: ['h1a', 'h1b', 'h1c'] },
        { n: 2, title: 'Second', points: 40, hints: ['h2a', 'h2b', 'h2c'] },
      ],
      sudoers: [{ cmd: 'cat', pathPrefix: '/var/secure/' }, { cmd: 'ls' }],
      processes: 'PID USER CMD\n1 root init\n99 guest {{flag:1}}',
      extraCommands: { crontab: '* * * * * root /opt/backup.sh', who: 'guest pts/0' },
      env: { API_KEY: 'k-{{flag:2}}' },
      ...mode,
    },
    cwd,
    flag,
    color,
    progress: async () => ({ solved }),
  };
}

export const run = (line, ctx = makeTestCtx()) => execute(line, ctx);

export async function out(line, ctx = makeTestCtx()) {
  return (await execute(line, ctx)).output;
}
