import { describe, expect, it } from 'vitest';
import { suggest } from '../../src/terminal/shell.js';
import { makeTestCtx, out, run } from './_helpers.js';

describe('help and man', () => {
  it('prints a beginner guide with every group of commands', async () => {
    const text = await out('help');
    expect(text).toContain('Arena Terminal - beginner guide');
    expect(text).toContain('submit CTF{the_code_you_found}');
    expect(text).toContain('ALL COMMANDS');
    for (const name of ['ls', 'cd', 'cat', 'grep', 'find', 'sort', 'awk', 'base64', 'xxd', 'sudo', 'vault', 'hint', 'status']) {
      expect(text, name).toContain(name);
    }
    expect(text).toContain('C-locale');
    expect(text).toContain('Only /tmp is writable');
    expect(text.toLowerCase()).not.toContain(['gd', 'gc'].join(''));
    expect(await out('help | head -n 1')).toBe('Arena Terminal - beginner guide');
  });

  it('explains single commands with help <cmd> and man <cmd>', async () => {
    for (const line of ['help grep', 'man grep']) {
      const text = await out(line);
      expect(text).toContain('GREP(1)');
      expect(text).toContain('NAME');
      expect(text).toContain('SYNOPSIS');
      expect(text).toContain('-r / -R');
      expect(text).toContain('EXAMPLES');
    }
    expect(await out('man ls')).toContain('-a');
    expect(await out('man')).toContain('What manual page do you want?');
  });

  it('suggests close names for unknown manual pages', async () => {
    const result = await run('man gerp');
    expect(result.output).toContain('No manual entry for gerp');
    expect(result.exit).toBe(16);
    expect((await run('help nothing')).exit).toBe(1);
  });

  it('has a manual page for every command mentioned in the guide', async () => {
    const text = await out('help');
    const names = ['ls', 'cd', 'pwd', 'tree', 'file', 'stat', 'du', 'cat', 'head', 'tail', 'less', 'more', 'tac', 'nl', 'wc', 'strings', 'xxd', 'hexdump', 'od', 'grep', 'find', 'sort', 'uniq', 'cut', 'tr', 'rev', 'sed', 'awk', 'diff', 'comm', 'paste', 'column', 'xargs', 'seq', 'base64', 'gunzip', 'zcat', 'md5sum', 'sha256sum'];
    for (const name of names) {
      expect(text, name).toContain(name);
      expect((await run(`man ${name}`)).output, name).toContain('SYNOPSIS');
    }
  });
});

describe('hint', () => {
  it('prints the requested tier for the lowest unsolved code', async () => {
    expect(await out('hint')).toBe('[hint 1/3 for code 1] h1a');
    expect(await out('hint 2')).toBe('[hint 2/3 for code 1] h1b');
    expect(await out('hint 3')).toBe('[hint 3/3 for code 1] h1c');
    expect(await out('hint 9')).toBe('[hint 3/3 for code 1] h1c');
    expect(await out('hint 0')).toBe('[hint 1/3 for code 1] h1a');
  });

  it('skips solved codes and congratulates when everything is solved', async () => {
    expect(await out('hint', makeTestCtx({ solved: [1] }))).toBe('[hint 1/3 for code 2] h2a');
    expect(await out('hint 2', makeTestCtx({ solved: [2] }))).toBe('[hint 2/3 for code 1] h1b');
    expect(await out('hint', makeTestCtx({ solved: [1, 2] }))).toContain('Congratulations');
  });

  it('validates its argument and survives a failing progress call', async () => {
    expect(await out('hint abc')).toContain('usage: hint [1-3]');
    expect((await run('hint 1 2')).exit).toBe(2);
    const broken = makeTestCtx();
    broken.progress = async () => { throw new Error('db down'); };
    const result = await run('hint', broken);
    expect(result.output).toBe('hint: could not load your progress, try again in a moment');
    expect(result.exit).toBe(1);
  });

  it('works inside pipes', async () => {
    expect(await out('hint | tr a-z A-Z')).toBe('[HINT 1/3 FOR CODE 1] H1A');
  });
});

describe('status and codes', () => {
  it('lists found codes with titles and hides the rest', async () => {
    expect(await out('status')).toBe('Codes found: 0/2\n[ ] 1  ???\n[ ] 2  ???');
    expect(await out('codes', makeTestCtx({ solved: [2] }))).toBe('Codes found: 1/2\n[ ] 1  ???\n[x] 2  Second');
    expect(await out('status', makeTestCtx({ solved: [1, 2] }))).toBe('Codes found: 2/2\n[x] 1  First\n[x] 2  Second');
  });

  it('never prints titles of unsolved codes', async () => {
    const text = await out('status');
    expect(text).not.toContain('First');
    expect(text).not.toContain('Second');
  });
});

describe('small builtins', () => {
  it('motd fills flag tokens', async () => {
    expect(await out('motd')).toBe('hello CTF{test_1}');
  });

  it('clear asks the client to clear the screen', async () => {
    const result = await run('clear');
    expect(result).toMatchObject({ output: '', effect: 'clear', exit: 0 });
    expect((await run('echo hi')).effect).toBeUndefined();
  });

  it('history, exit, true, false', async () => {
    expect(await out('history')).toBe('history is kept in your browser, use the up arrow');
    expect(await out('exit')).toContain('logout');
    expect((await run('exit')).exit).toBe(0);
    expect((await run('true')).exit).toBe(0);
    expect((await run('false')).exit).toBe(1);
  });

  it('identity commands reflect the mode', async () => {
    expect(await out('whoami')).toBe('guest');
    expect(await out('hostname')).toBe('arena');
    expect(await out('id')).toBe('uid=1000(guest) gid=1000(guest) groups=1000(guest)');
    expect(await out('uname')).toBe('Linux');
    expect(await out('uname -a')).toContain('Linux arena 5.15.0-97-generic');
    expect(await out('whoami', makeTestCtx({ mode: { user: 'ada', host: 'lab' } }))).toBe('ada');
    expect(await out('hostname', makeTestCtx({ mode: { host: 'lab' } }))).toBe('lab');
  });

  it('env shows the mode environment and printenv reads one value', async () => {
    const text = await out('env');
    expect(text).toContain('HOME=/home/guest');
    expect(text).toContain('USER=guest');
    expect(text).toContain('SHELL=/bin/bash');
    expect(text).toContain('API_KEY=k-CTF{test_2}');
    expect(await out('printenv HOME')).toBe('/home/guest');
    expect((await run('printenv NOPE')).exit).toBe(1);
    expect(await out('export A=1; echo $A')).toBe('1');
    expect(await out('A=1; unset A; echo "[$A]"')).toBe('[]');
    expect(await out('env A=1 printenv A')).toBe('1');
  });

  it('which, type and command -v', async () => {
    expect(await out('which ls')).toBe('/usr/bin/ls');
    expect((await run('which nope')).exit).toBe(1);
    expect(await out('type cd')).toBe('cd is a shell builtin');
    expect(await out('type ls')).toBe('ls is /usr/bin/ls');
    expect((await run('type nope')).output).toBe('bash: type: nope: not found');
    expect(await out('command -v ls')).toBe('/usr/bin/ls');
    expect(await out('command echo hi')).toBe('hi');
  });

  it('static system views come from the mode definition', async () => {
    expect(await out('ps')).toBe('PID USER CMD\n1 root init\n99 guest CTF{test_1}');
    expect(await out('ps aux | wc -l')).toBe('3');
    expect(await out('crontab -l')).toBe('* * * * * root /opt/backup.sh');
    expect(await out('who')).toBe('guest pts/0');
    const bare = makeTestCtx({ mode: { processes: undefined, extraCommands: undefined } });
    expect(await out('ps', bare)).toContain('PID TTY');
    expect(await out('ps aux', bare)).toContain('USER         PID %CPU');
    expect((await run('crontab -l', bare)).output).toBe('no crontab for guest');
    expect((await run('crontab -e', bare)).exit).toBe(1);
    expect(await out('last', bare)).toContain('wtmp begins');
    expect(await out('uptime', bare)).toContain('up 2 days');
    expect(await out('df -h', bare)).toContain('Filesystem');
    expect(await out('free -h', bare)).toContain('Mem:');
  });

  it('static per-mode outputs work for arbitrary command names', async () => {
    const ctx = makeTestCtx({ mode: { extraCommands: { 'mystery-tool': 'status: {{flag:1}}' } } });
    expect(await out('mystery-tool', ctx)).toBe('status: CTF{test_1}');
    expect(await out('mystery-tool | wc -w', ctx)).toBe('2');
  });

  it('blocks network and interactive tools with friendly messages', async () => {
    expect(await out('ping 1.1.1.1')).toBe('ping: network access is disabled in this sandbox');
    for (const name of ['curl', 'wget', 'ssh', 'nc']) expect(await out(`${name} example.com`)).toBe(`${name}: network access is disabled in this sandbox`);
    expect(await out('ss')).toBe('command not available in this sandbox');
    expect(await out('netstat -an')).toBe('command not available in this sandbox');
    expect(await out('vim notes.txt')).toContain('interactive programs are disabled');
    expect(await out('python -c 1')).toContain('only has the built-in commands');
    expect(await out('bash')).toContain('nested shells are disabled');
    expect(await out('su')).toBe('su: Authentication failure');
    expect(await out('kill 1')).toBe('bash: kill: (1) - Operation not permitted');
  });

  it('never executes or evaluates anything real', async () => {
    expect(await out('eval ls')).toContain('command not found');
    expect(await out('node -e "process.exit()"')).toContain('only has the built-in commands');
    expect(await out('source /etc/passwd')).toContain('not supported');
    expect(await out('. /etc/passwd')).toContain('not supported');
  });
});

describe('command not found', () => {
  it('prints bash style errors with exit 127', async () => {
    const result = await run('foo');
    expect(result.output).toBe('bash: foo: command not found');
    expect(result.exit).toBe(127);
    expect((await run('qqqqzz --flag')).output).toBe('bash: qqqqzz: command not found');
  });

  it('suggests near misses', async () => {
    expect(await out('catt notes.txt')).toBe("bash: catt: command not found\nDid you mean 'cat'?");
    expect(await out('cd..')).toBe("bash: cd..: command not found\nDid you mean 'cd'?");
    expect(await out('ls-l')).toBe("bash: ls-l: command not found\nDid you mean 'ls'?");
    expect(await out('grpe x')).toContain("Did you mean 'grep'?");
    expect(suggest('sl', ['ls', 'cat'])).toBe('ls');
    expect(suggest('zzzzzzzz', ['ls', 'cat'])).toBeNull();
    expect(suggest('x', ['ls'])).toBeNull();
  });

  it('runs commands by absolute path under the usual bin directories', async () => {
    expect(await out('/bin/echo hi')).toBe('hi');
    expect(await out('/usr/bin/cat docs/a.txt')).toBe('one\ntwo\nthree');
    expect((await run('/opt/mystery')).output).toBe('bash: /opt/mystery: No such file or directory');
  });
});
