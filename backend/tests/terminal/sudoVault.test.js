import { describe, expect, it } from 'vitest';
import {
  dir, file, link, vault,
} from '../../src/terminal/vfs.js';
import { makeTestCtx, out, run } from './_helpers.js';

const DENIED = 'guest is not in the sudoers file. This incident will be reported.';

describe('sudo', () => {
  it('runs allowed commands as root and refuses everything else', async () => {
    expect(await out('sudo cat /var/secure/root.txt')).toBe('top: CTF{test_3}');
    expect(await out('sudo cat /etc/shadow')).toBe(DENIED);
    expect(await out('sudo cat /var/secure/root.txt /etc/shadow')).toBe(DENIED);
    expect(await out('sudo rm -rf /tmp')).toBe(DENIED);
    expect(await out('sudo whoami')).toBe(DENIED);
    expect(await out('sudo')).toContain('usage: sudo');
    expect((await run('sudo cat /etc/shadow')).exit).toBe(1);
  });

  it('matches the command name and prefix after normalising the path', async () => {
    expect(await out('sudo cat /var/secure/../../etc/shadow')).toBe(DENIED);
    expect(await out('sudo cat /var/secure/./root.txt')).toBe('top: CTF{test_3}');
    expect(await out('sudo cat root.txt', makeTestCtx({ cwd: '/var' }))).toBe(DENIED);
    expect(await out('cd /var; sudo cat secure/root.txt')).toBe('top: CTF{test_3}');
    expect(await out('sudo /usr/bin/cat /var/secure/root.txt')).toBe('top: CTF{test_3}');
    expect(await out('sudo cat -n /var/secure/root.txt')).toBe('     1\ttop: CTF{test_3}');
    expect(await out('sudo cat')).toBe(DENIED);
    expect(await out('sudo cat /var/securex/root.txt')).toBe(DENIED);
    expect(await out('sudo ls /root')).toBe('r.txt'); // `ls` is allowed without a prefix
  });

  it('accepts -n and -u root, rejects other users', async () => {
    expect(await out('sudo -n cat /var/secure/root.txt')).toBe('top: CTF{test_3}');
    expect(await out('sudo -u root cat /var/secure/root.txt')).toBe('top: CTF{test_3}');
    expect(await out('sudo -u bob cat /var/secure/root.txt')).toBe('sudo: unknown user bob');
  });

  it('lists the allow-list with sudo -l', async () => {
    const text = await out('sudo -l');
    expect(text).toContain('Matching Defaults entries for guest on arena:');
    expect(text).toContain('User guest may run the following commands on arena:');
    expect(text).toContain('(root) NOPASSWD: /usr/bin/cat /var/secure/*');
    expect(text).toContain('(root) NOPASSWD: /usr/bin/ls');
  });

  it('denies everything when the mode has no sudoers', async () => {
    const ctx = makeTestCtx({ mode: { sudoers: undefined } });
    expect(await out('sudo ls', ctx)).toBe(DENIED);
    expect(await out('sudo -l', ctx)).toBe('Sorry, user guest may not run sudo on arena.');
    const empty = makeTestCtx({ mode: { sudoers: [] } });
    expect(await out('sudo cat /etc/passwd', empty)).toBe(DENIED);
  });

  it('runs the command as root only for that command', async () => {
    const ctx = makeTestCtx({ mode: { sudoers: [{ cmd: 'id' }, { cmd: 'whoami' }, { cmd: 'cat', pathPrefix: '/var/secure/' }] } });
    expect(await out('sudo whoami; whoami', ctx)).toBe('root\nguest');
    expect(await out('sudo id; id', ctx)).toBe('uid=0(root) gid=0(root) groups=0(root)\nuid=1000(guest) gid=1000(guest) groups=1000(guest)');
    expect(await out('sudo cat /var/secure/root.txt | wc -c', ctx)).toBe('17');
    expect(await out('sudo cat /var/secure/root.txt > /tmp/x; cat /tmp/x', ctx)).toBe('top: CTF{test_3}');
  });

  it('keeps sudo inside the read-only world', async () => {
    const ctx = makeTestCtx({ mode: { sudoers: [{ cmd: 'touch' }, { cmd: 'cp' }] } });
    expect(await out('sudo touch /etc/x', ctx)).toBe("touch: cannot touch '/etc/x': Read-only file system");
    expect(await out('sudo cp /etc/shadow /tmp/s; cat /tmp/s', ctx)).toBe('cat: /tmp/s: Permission denied'); // the copy is root-owned, like the real thing
  });

  it('allows symlinks inside the prefix to point elsewhere (a puzzle can use that)', async () => {
    const fs = sampleFs2();
    const ctx = makeTestCtx({ fs });
    expect(await out('sudo cat /var/secure/pointer', ctx)).toBe('top secret');
  });
});

function sampleFs2() {
  return dir({
    home: dir({ guest: dir({}) }),
    var: dir({ secure: dir({ pointer: link('/root/real') }, { mode: 0o755 }) }),
    root: dir({ real: file('top secret\n', { mode: 0o600, owner: 'root', group: 'root' }) }, { mode: 0o700, owner: 'root', group: 'root' }),
  }, { owner: 'root', group: 'root' });
}

describe('vault', () => {
  it('opens a vault with the right passphrase and fills flag tokens', async () => {
    expect(await out('vault open /opt/box.vault hunter2')).toBe('vault says CTF{test_4}');
    expect(await out("vault open /opt/box.vault 'hunter2'")).toBe('vault says CTF{test_4}');
    expect(await out('cd /opt; vault open box.vault hunter2')).toBe('vault says CTF{test_4}');
  });

  it('rejects wrong passphrases and bad usage', async () => {
    const wrong = await run('vault open /opt/box.vault nope');
    expect(wrong.output).toBe('vault: wrong passphrase');
    expect(wrong.exit).toBe(1);
    expect(await out('vault open /opt/box.vault ""')).toBe('vault: wrong passphrase');
    expect(await out('vault open /opt/box.vault hunter22')).toBe('vault: wrong passphrase');
    expect(await out('vault open /opt/box.vault HUNTER2')).toBe('vault: wrong passphrase');
    expect(await out('vault')).toBe('usage: vault open <file> <passphrase>');
    expect(await out('vault open /opt/box.vault')).toBe('usage: vault open <file> <passphrase>');
    expect(await out('vault close /opt/box.vault x')).toBe('usage: vault open <file> <passphrase>');
  });

  it('reports file problems', async () => {
    expect(await out('vault open nope x')).toBe('vault: nope: No such file or directory');
    expect(await out('vault open docs x')).toBe('vault: docs: Is a directory');
    expect(await out('vault open notes.txt x')).toBe('vault: notes.txt: not a vault file');
    expect(await out('vault open noread.txt x')).toBe('vault: noread.txt: Permission denied');
  });

  it('shows only the header and a deterministic blob when catted', async () => {
    const text = await out('cat /opt/box.vault');
    expect(text.startsWith('ARENAVAULT1\n')).toBe(true);
    expect(text).not.toContain('CTF{');
    expect(text).not.toContain('vault says');
    expect(await out('cat /opt/box.vault')).toBe(text);
    expect(text.split('\n')).toHaveLength(4);
  });

  it('works through sudo and does not leak the passphrase', async () => {
    const ctx = makeTestCtx({ mode: { sudoers: [{ cmd: 'vault' }] } });
    expect(await out('sudo vault open /opt/box.vault hunter2', ctx)).toBe('vault says CTF{test_4}');
    expect(await out('grep -r hunter2 / 2>/dev/null', ctx)).toBe('');
    expect(await out('strings /opt/box.vault | grep -c hunter', ctx)).toBe('0');
  });
});
