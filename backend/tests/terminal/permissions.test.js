import { describe, expect, it } from 'vitest';
import {
  FsView, canExec, canRead, canWrite, dir, file, link, modeString,
} from '../../src/terminal/vfs.js';
import { makeTestCtx, out, run } from './_helpers.js';

describe('permission helpers', () => {
  it('picks owner, group or other bits', () => {
    const node = file('x', { mode: 0o640, owner: 'alice', group: 'staff' });
    expect(canRead(node, 'alice', 'x')).toBe(true);
    expect(canWrite(node, 'alice', 'x')).toBe(true);
    expect(canRead(node, 'bob', 'staff')).toBe(true);
    expect(canWrite(node, 'bob', 'staff')).toBe(false);
    expect(canRead(node, 'carol', 'other')).toBe(false);
    expect(canRead(node, 'root', 'root')).toBe(true);
    expect(canExec(dir({}, { mode: 0o711, owner: 'root', group: 'root' }), 'guest', 'guest')).toBe(true);
  });

  it('owner bits win even when they are more restrictive than other', () => {
    const node = file('x', { mode: 0o044, owner: 'guest', group: 'guest' });
    expect(canRead(node, 'guest', 'guest')).toBe(false);
  });

  it('renders mode strings with setuid, setgid and sticky bits', () => {
    expect(modeString(file('', { mode: 0o755 }))).toBe('-rwxr-xr-x');
    expect(modeString(file('', { mode: 0o4755 }))).toBe('-rwsr-xr-x');
    expect(modeString(file('', { mode: 0o4644 }))).toBe('-rwSr--r--');
    expect(modeString(file('', { mode: 0o2755 }))).toBe('-rwxr-sr-x');
    expect(modeString(dir({}, { mode: 0o1777 }))).toBe('drwxrwxrwt');
    expect(modeString(dir({}, { mode: 0o1776 }))).toBe('drwxrwxrwT');
    expect(modeString(link('x'))).toBe('lrwxrwxrwx');
  });
});

describe('FsView lookup', () => {
  const root = dir({
    a: dir({ b: dir({ f: file('x') }), l: link('b'), up: link('../a/b/f'), abs: link('/a/b') }),
    locked: dir({ inside: file('x') }, { mode: 0o600, owner: 'root', group: 'root' }),
  }, { owner: 'root', group: 'root' });
  const view = new FsView(root);

  it('resolves through symlinks and physical ..', () => {
    expect(view.lookup('/a/l/f').path).toBe('/a/b/f');
    expect(view.lookup('/a/up').path).toBe('/a/b/f');
    expect(view.lookup('/a/abs/f').path).toBe('/a/b/f');
    expect(view.lookup('/a/l/../l').path).toBe('/a/b'); // `..` after a link is the physical parent of b
    expect(view.lookup('/a/l', { follow: false }).node.type).toBe('link');
  });

  it('reports ENOENT, ENOTDIR, EACCES and ELOOP', () => {
    expect(view.lookup('/nope').error).toBe('ENOENT');
    expect(view.lookup('/a/b/f/x').error).toBe('ENOTDIR');
    expect(view.lookup('/a/b/f/').error).toBe('ENOTDIR');
    expect(view.lookup('/locked/inside').error).toBe('EACCES');
    expect(view.withUser('root').lookup('/locked/inside').node.type).toBe('file');
    const loop = new FsView(dir({ x: link('y'), y: link('x') }));
    expect(loop.lookup('/x').error).toBe('ELOOP');
  });

  it('keeps /tmp writes in a per-view overlay', () => {
    const fresh = new FsView(root);
    const parent = fresh.parentFor('/tmp/new');
    expect(parent.error).toBeUndefined();
    fresh.setNode(parent.phys, fresh.newFile(Buffer.from('hi')));
    expect(fresh.lookup('/tmp/new').node.bytes.toString()).toBe('hi');
    expect(new FsView(root).lookup('/tmp/new').error).toBe('ENOENT');
    expect(fresh.parentFor('/a/new').error).toBe('EROFS');
  });
});

describe('permissions in the shell', () => {
  it('denies reading without the read bit', async () => {
    expect(await out('cat noread.txt')).toBe('cat: noread.txt: Permission denied');
    expect(await out('head noread.txt')).toBe('head: noread.txt: Permission denied');
    expect(await out('grep x noread.txt')).toBe('grep: noread.txt: Permission denied');
    expect(await out('wc noread.txt')).toBe('wc: noread.txt: Permission denied');
    expect(await out('xxd noread.txt')).toBe('xxd: noread.txt: Permission denied');
    expect(await out('md5sum noread.txt')).toBe('md5sum: noread.txt: Permission denied');
    expect(await out('cp noread.txt /tmp/x')).toContain('Permission denied');
    expect(await out('cat /etc/shadow')).toBe('cat: /etc/shadow: Permission denied');
    expect(await out('cat /var/secure/root.txt')).toBe('cat: /var/secure/root.txt: Permission denied');
    expect((await run('cat noread.txt')).exit).toBe(1);
  });

  it('denies entering and listing directories without x / r', async () => {
    expect(await out('cd private')).toBe('bash: cd: private: Permission denied');
    expect(await out('cd /root')).toBe('bash: cd: /root: Permission denied');
    expect(await out('ls /root')).toBe("ls: cannot open directory '/root': Permission denied");
    expect(await out('cat /root/r.txt')).toBe('cat: /root/r.txt: Permission denied');
    expect(await out('ls /home/other')).toBe("ls: cannot open directory '/home/other': Permission denied");
    expect(await out('tree /root')).toContain('[error opening dir]');
    expect(await out('du /root')).toBe("du: cannot read directory '/root': Permission denied\n4\t/root");
  });

  it('still lets find and grep -r continue past unreadable directories', async () => {
    const found = await run('find /home /var -name "*.txt"');
    expect(found.output).toContain("find: '/var/secure': Permission denied");
    expect(found.output).toContain('/home/guest/notes.txt');
    expect(found.exit).toBe(1);
    const searched = await run('grep -rl mine /home');
    expect(searched.output).toContain("grep: /home/other: Permission denied");
    expect(searched.exit).toBe(2);
    expect(await out('grep -rsl alpha /home')).toBe('/home/guest/notes.txt');
  });

  it('shows owners and modes in ls -l and stat', async () => {
    expect(await out('ls -l noread.txt')).toMatch(/^-rw------- 1 root root +5 Mar 14 09:26 noread\.txt$/);
    expect(await out('ls -ld private')).toMatch(/^drwx------ 2 root root 4096 /);
    expect(await out('stat -c "%A %U %G %a" /etc/shadow')).toBe('-rw-r----- root shadow 640');
    expect(await out('ls -ld /root')).toMatch(/^drwx------ 2 root root 4096 /);
  });

  it('applies permissions to symlink targets and test builtins', async () => {
    const ctx = makeTestCtx();
    ctx.mode.fs.children.home.children.guest.children.shadowlink = link('/etc/shadow');
    expect(await out('cat shadowlink', ctx)).toBe('cat: shadowlink: Permission denied');
    expect((await run('[ -r /etc/shadow ]')).exit).toBe(1);
    expect((await run('[ -r /etc/passwd ]')).exit).toBe(0);
    expect((await run('[ -x bin/run.sh ]')).exit).toBe(0);
    expect((await run('[ -x notes.txt ]')).exit).toBe(1);
  });

  it('sudo bypasses permissions only for allowed commands', async () => {
    expect(await out('sudo cat /var/secure/root.txt')).toBe('top: CTF{test_3}');
    expect(await out('sudo ls /root')).toBe('r.txt');
    expect(await out('sudo cat /etc/shadow')).toContain('not in the sudoers file');
    expect(await out('cat /var/secure/root.txt')).toContain('Permission denied');
  });

  it('refuses executing non-executable files', async () => {
    expect(await out('./notes.txt')).toBe('bash: ./notes.txt: Permission denied');
    expect(await out('./nope')).toBe('bash: ./nope: No such file or directory');
    expect(await out('./docs')).toBe('bash: ./docs: Is a directory');
    expect((await run('./bin/run.sh')).exit).toBe(126);
  });
});
