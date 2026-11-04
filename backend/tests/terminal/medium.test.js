// Arena Terminal - MEDIUM mode ("NovaCorp Server Room") content tests. See docs/TERMINAL_GAME.md sections 11 and 12.
// Structure checks work on the mode data alone; the scripted solutions run through the real engine (shell.js).
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { execute } from '../../src/terminal/shell.js';
import medium from '../../src/terminal/modes/medium.js';
import { BAIT_FILE_COMMENT, BAIT_NOTICE_LINES } from '../../src/services/integrityBait.js';

const flag = (n) => 'CTF{test_flag_' + n + '}';
const CODES = [1, 2, 3, 4, 5];

// Two different teams (docs/TERMINAL_GAME.md section 16). The one-off visitor of code 2 is {{seed:ip:1}} in the content,
// so every scripted solution has to read it off the screen: nothing below hard-codes it.
const seedOf = (name) => createHash('sha256').update('arena-test-seed:' + name).digest('hex');
const SEED_A = seedOf('team-a');
const SEED_B = seedOf('team-b');
const SEEDS = [['team A', SEED_A], ['team B', SEED_B]];
const SEED_IP = /^(?:198\.51\.100|203\.0\.113)\.\d{1,3}$/;
const SEED_IP_STATIC = /(?:198\.51\.100|203\.0\.113)\.\d/; // no static text may contain an address of the seed ranges
const SEED_TOKEN = /\{\{(?:seed:[a-z0-9]+(?::\d+)?|md5file:[^{}|]+)(?:\|[a-z0-9:-]+)*\}\}/g;

// AI bait (section 16): where it lives, and the exported strings it must be built from.
const BAIT_PATHS = ['/home/guest/.cache/assistant-notes.txt', '/etc/motd.d/90-automation-notice'];

// Fake-but-flag-shaped strings that are allowed to appear literally (unencoded) in the content. They never validate.
const DECOYS = [
  'CTF{...}',
  'CTF{placeholder_replace_me}',
  'CTF{nice_try_ghost_is_laughing}',
  'CTF{this_is_what_ghost_wants_you_to_think}',
  'CTF{wrong_turn_check_the_logs}',
  'CTF{n0t_th3_r34l_c0d3}',
  'CTF{this_log_is_a_dead_end}',
];

const ROT13 = "tr 'A-Za-z' 'N-ZA-Mn-za-m'";
const AWK_FIELD = (n) => "awk '{print $" + n + "}'";

// Scripted solutions: command lines run in order, `cwd` carried forward. The last line prints the code. A step can be a
// function of the results so far, for a value that differs per team and that the player reads from an earlier output.
const COUNT_ADDRESSES = AWK_FIELD(1) + ' /var/log/nginx/access.log | sort | uniq -c | sort -n | head -n 3';
const oneOffAddress = (results, index) => {
  const match = /^\s*1\s+(\d+\.\d+\.\d+\.\d+)\s*$/m.exec(results[index].output);
  if (!match) { throw new Error(`step ${index}: no address that appears once in:\n${results[index].output}`); }
  return match[1];
};
const SOLUTIONS = {
  // find by size, then tail | cut | rev
  1: [
    'cd /srv/backups/exports',
    'find . -type f -size +3k',
    'tail -n 1 batch-04/inv-0173.csv | cut -d, -f2 | rev',
  ],
  // awk | sort | uniq -c | sort -n finds the one-off IP, grep -r over /var/log, then rot13
  2: [
    'wc -l /var/log/nginx/access.log',
    COUNT_ADDRESSES,
    (results) => `grep -r ${oneOffAddress(results, 1)} /var/log | grep receipt | ${AWK_FIELD(9)} | ${ROT13}`,
  ],
  // diff of two nightly backups, changed value is base64
  3: [
    'cd /srv/backups/config',
    'ls',
    'diff gateway.conf.20240310 gateway.conf.20240311',
    "diff gateway.conf.20240310 gateway.conf.20240311 | grep '^> login' | " + AWK_FIELD(4) + ' | base64 -d',
  ],
  // chain: the diff comment names the hidden spool queue, the held entry is rot13 then base64
  4: [
    'diff /srv/backups/config/gateway.conf.20240310 /srv/backups/config/gateway.conf.20240311',
    'cd /var/lib/novapay',
    'ls -a',
    'ls -la .spool/q-7731',
    'grep -r held .spool/q-7731',
    `grep payload .spool/q-7731/0003.entry | ${AWK_FIELD(2)} | base64 -d | ${ROT13}`,
  ],
  // permissions + symlink: ghost's home is locked, alice's notes point at the readable mirror, hex
  5: [
    'ls -l /home',
    'cat /home/ghost/locked.txt',
    'cat /home/alice/notes/audit-todo.txt',
    'ls -l /home/alice',
    'cat /home/alice/ghost-mirror/.bash_history',
    'cat /home/alice/ghost-mirror/.local/share/nova/receipts/seal.hex | xxd -r -p',
  ],
};

// Substrings (or patterns) that must show up in the output of an intermediate step: [code, step index, text].
const MILESTONES = [
  [1, 1, 'batch-04/inv-0173.csv'],
  [2, 1, /^\s*1 (?:198\.51\.100|203\.0\.113)\.\d+$/m],
  [3, 2, 'login_banner_b64'],
  [4, 0, '/var/lib/novapay/.spool/q-7731'],
  [4, 3, '0003.entry'],
  [4, 4, 'state: held'],
  [5, 0, 'drwx------'],
  [5, 1, 'Permission denied'],
  [5, 3, 'ghost-mirror -> /srv/backups/homes/ghost'],
];

// Commands the solutions may use: the non-optional commands of docs/TERMINAL_GAME.md section 7.
const ALLOWED_COMMANDS = new Set([
  'help', 'man', 'clear', 'history', 'whoami', 'id', 'hostname', 'uname', 'date', 'pwd', 'cd', 'echo', 'env', 'true', 'false',
  'exit', 'motd', 'hint', 'status', 'codes', 'ls', 'cat', 'tac', 'head', 'tail', 'less', 'more', 'nl', 'wc', 'file', 'stat',
  'tree', 'find', 'du', 'grep', 'sort', 'uniq', 'cut', 'tr', 'rev', 'sed', 'awk', 'diff', 'xargs', 'base64', 'xxd', 'hexdump',
  'strings', 'gzip', 'gunzip', 'zcat', 'md5sum', 'sha1sum', 'sha256sum', 'ps', 'crontab', 'last', 'who', 'w', 'uptime', 'df',
  'sudo', 'vault',
]);

const SIZE_CAP = 2.5 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

function walkTree(node, path, visit) {
  visit(node, path);
  if (node.type === 'dir') {
    for (const [name, child] of Object.entries(node.children)) {
      walkTree(child, path === '/' ? `/${name}` : `${path}/${name}`, visit);
    }
  }
}

function allNodes() {
  const nodes = [];
  walkTree(medium.fs, '/', (node, path) => nodes.push({ node, path }));
  return nodes;
}

const textFiles = () => allNodes().filter(({ node }) => node.type === 'file' && typeof node.content === 'string');

function nodeAt(path) {
  let current = medium.fs;
  for (const part of path.split('/').filter(Boolean)) {
    if (current.type !== 'dir' || !Object.hasOwn(current.children, part)) { return null; }
    current = current.children[part];
  }
  return current;
}

const rot13 = (text) => text.replace(/[a-z]/gi, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
});

function applyFilters(value, filters) {
  return filters.reduce((current, name) => {
    switch (name) {
      case 'b64': return Buffer.from(current, 'utf8').toString('base64');
      case 'hex': return Buffer.from(current, 'utf8').toString('hex');
      case 'rot13': return rot13(current);
      case 'rev': return [...current].reverse().join('');
      default: throw new Error(`filter not allowed in this mode: ${name}`);
    }
  }, value);
}

const makeCtx = (cwd, seed, flagFn = flag) => ({ mode: medium, cwd, flag: flagFn, seed, progress: async () => ({ solved: [] }) });

// Colors only matter to the browser: strip SGR sequences so assertions read plain text.
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

// Runs steps in order. A step is a command line or a function (results so far) => command line.
async function play(steps, options = {}) {
  const seed = 'seed' in options ? options.seed : SEED_A; // an explicit undefined means "no seed" (the default seed)
  const { cwd: startCwd = medium.home, flagFn = flag } = options;
  let cwd = startCwd;
  const results = [];
  const lines = [];
  for (const step of steps) {
    const line = typeof step === 'function' ? step(results) : step;
    const result = await execute(line, makeCtx(cwd, seed, flagFn));
    cwd = result.cwd;
    results.push({ ...result, output: stripAnsi(result.output) });
    lines.push(line);
  }
  return { results, lines };
}

const run = async (steps, options) => (await play(steps, options)).results;
const out = async (line, seed = SEED_A) => (await run([line], { seed }))[0].output;

// The team's anomalous address, found the way a player finds it (the address that appears once in the access log).
const addressCache = new Map();
async function ghostAddress(seed) {
  if (!addressCache.has(seed)) {
    const results = await run([COUNT_ADDRESSES], { seed });
    addressCache.set(seed, oneOffAddress(results, 0));
  }
  return addressCache.get(seed);
}

// stdout lines only: grep -r over / also prints "Permission denied" lines for the root-only files, like a real terminal.
const stdoutLines = (text) => text.split('\n').filter((line) => line !== '' && !/: Permission denied$/.test(line));

const commandsOf = (line) => line.split(/\s*(?:\|\||&&|[|;])\s*/).map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);

// ---------------------------------------------------------------------------------------------------------------
// Definition and content rules (data only)
// ---------------------------------------------------------------------------------------------------------------

describe('medium mode definition', () => {
  it('has the contract fields', () => {
    expect(medium.mode).toBe('medium');
    expect(medium.difficulty).toBe('medium');
    expect(medium.title).toBe('NovaCorp Server Room');
    expect(medium.user).toBe('guest');
    expect(medium.host).toBe('arena');
    expect(medium.home).toBe('/home/guest');
    expect(nodeAt(medium.home)?.type).toBe('dir');
    expect(medium.tagline.length).toBeGreaterThan(10);
    expect(medium.sudoers).toEqual([]);
    expect(medium.motd).toContain('Last login:');
  });

  it('has a short ominous lore that ends with the help prompt', () => {
    expect(medium.lore.length).toBeGreaterThan(5);
    expect(medium.lore.length).toBeLessThanOrEqual(12);
    expect(medium.lore.at(-1)).toBe('Type help to begin.');
    expect(medium.lore.every((line) => typeof line === 'string' && line.length <= 100)).toBe(true);
  });

  it('has exactly 5 codes worth 90 points each, numbered 1..5, with titles and 3+ hints', () => {
    expect(medium.codes).toHaveLength(5);
    expect(medium.codes.map((code) => code.n)).toEqual(CODES);
    for (const code of medium.codes) {
      expect(code.points).toBe(90);
      expect(code.title.length).toBeGreaterThan(3);
      expect(code.hints.length).toBeGreaterThanOrEqual(3);
      expect(code.hints.every((hint) => typeof hint === 'string' && hint.length > 20)).toBe(true);
      expect(code.hints.join(' ')).not.toMatch(/CTF\{/);
    }
    // tier 3 nearly gives the command
    for (const code of medium.codes) {
      expect(code.hints[2]).toMatch(/\b(find|grep|diff|cat|awk)\b/);
    }
  });

  it('describes processes and static system commands', () => {
    expect(medium.processes).toContain('USER');
    expect(medium.processes).toContain('nginx');
    for (const name of ['crontab', 'last', 'who']) {
      expect(typeof medium.extraCommands[name]).toBe('string');
      expect(medium.extraCommands[name].length).toBeGreaterThan(20);
    }
  });

  it('never uses a club name anywhere', () => {
    const club = /gdgc/i;
    expect(JSON.stringify({ ...medium, fs: undefined })).not.toMatch(club);
    for (const { node, path } of allNodes()) {
      expect(path).not.toMatch(club);
      if (typeof node.content === 'string') { expect(node.content).not.toMatch(club); }
    }
  });
});

describe('medium virtual filesystem', () => {
  it('stays under the size cap and has realistic bulk', () => {
    const files = textFiles();
    const bytes = files.reduce((sum, { node }) => sum + Buffer.byteLength(node.content), 0);
    expect(bytes).toBeLessThan(SIZE_CAP);
    expect(bytes).toBeGreaterThan(500 * 1024);
    for (const path of ['/var/log/nginx/access.log', '/var/log/auth.log', '/var/log/novapay/gateway.log']) {
      expect(nodeAt(path).content.split('\n').length).toBeGreaterThan(1500);
    }
    expect(files.length).toBeGreaterThan(350);
  });

  it('has no path containing the word flag', () => {
    expect(allNodes().filter(({ path }) => /flag/i.test(path)).map(({ path }) => path)).toEqual([]);
  });

  it('stores every code exactly once, only through tokens that use an encoding filter', () => {
    const found = [];
    for (const { node, path } of textFiles()) {
      for (const match of node.content.matchAll(/\{\{flag:(\d+)((?:\|[a-z0-9:-]+)*)\}\}/g)) {
        found.push({ path, n: Number(match[1]), filters: match[2].split('|').filter(Boolean) });
      }
      // no half written token (flag tokens and the per team seed tokens are the only kinds that exist)
      const stripped = node.content.replace(/\{\{flag:\d+(?:\|[a-z0-9:-]+)*\}\}/g, '').replace(SEED_TOKEN, '');
      expect(stripped, path).not.toContain('{{');
    }
    expect(found.map((token) => token.n).sort()).toEqual(CODES);
    for (const token of found) {
      expect(token.filters.length, token.path).toBeGreaterThanOrEqual(1);
      const stored = applyFilters(flag(token.n), token.filters);
      expect(stored, token.path).not.toContain('CTF');
      expect(stored, token.path).not.toContain('test_flag');
    }
    // at least 3 of the 5 are a chain or a non trivial encoding
    expect(found.filter((token) => token.filters.length >= 1)).toHaveLength(5);
    expect(found.some((token) => token.filters.length >= 2)).toBe(true);
  });

  it('contains no un-tokenized real-looking code, only the allow-listed decoys', () => {
    const seen = new Set();
    for (const { node, path } of textFiles()) {
      expect(node.content, path).not.toContain('test_flag');
      expect(node.content, path).not.toContain('terminal_medium_'); // lookalike decoys are only stored encoded
      for (const match of node.content.matchAll(/CTF\{[^}]*\}/g)) {
        expect(DECOYS, `${path}: ${match[0]}`).toContain(match[0]);
        seen.add(match[0]);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic: building the module twice gives identical bytes', async () => {
    const before = JSON.stringify(medium);
    vi.resetModules();
    const again = (await import('../../src/terminal/modes/medium.js')).default;
    expect(JSON.stringify(again)).toBe(before);
  });

  it('keeps file modes and owners realistic', () => {
    expect(nodeAt('/home/ghost')).toMatchObject({ mode: 0o700, owner: 'ghost' });
    expect(nodeAt('/etc/novapay/gateway.conf').mode & 0o004).toBe(0);
    expect(nodeAt('/var/log/novapay/vault-debug.log').mode & 0o044).toBe(0);
    expect(nodeAt('/srv/backups/config/gateway.conf.20240311').mode & 0o004).not.toBe(0);
    expect(nodeAt('/home/alice/ghost-mirror')).toMatchObject({ type: 'link', target: '/srv/backups/homes/ghost' });
    expect(nodeAt('/var/lib/novapay/.spool/q-7731/0003.entry').owner).toBe('ghost');
  });
});

describe('puzzle design guarantees (data level)', () => {
  it('code 1: exactly one export is bigger than 3 KB, among 270 small ones', () => {
    const exportsDir = nodeAt('/srv/backups/exports');
    const files = [];
    walkTree(exportsDir, '/srv/backups/exports', (node, path) => {
      if (node.type === 'file' && path.includes('/batch-')) { files.push({ path, size: Buffer.byteLength(node.content) }); }
    });
    expect(files).toHaveLength(270);
    const big = files.filter((entry) => entry.size > 3 * 1024);
    expect(big.map((entry) => entry.path)).toEqual(['/srv/backups/exports/batch-04/inv-0173.csv']);
    expect(files.filter((entry) => entry.size <= 1000)).toHaveLength(269);
  });

  it('code 2: one address appears exactly once in the access log, every regular many times (raw content)', () => {
    const counts = new Map();
    for (const line of nodeAt('/var/log/nginx/access.log').content.trim().split('\n')) {
      const address = line.split(' ')[0];
      counts.set(address, (counts.get(address) ?? 0) + 1);
    }
    const once = [...counts].filter(([, count]) => count === 1).map(([address]) => address);
    expect(once).toEqual(['{{seed:ip:1}}']); // the per team seed token is the one-off visitor
    const others = [...counts].filter(([address]) => address !== '{{seed:ip:1}}').map(([, count]) => count);
    expect(Math.min(...others)).toBeGreaterThanOrEqual(20);
    expect(nodeAt('/var/log/novapay/audit.log.1').content).toContain('override from {{seed:ip:1}} receipt:');
    expect(nodeAt('/var/log/novapay/gateway.log').content).toContain('src={{seed:ip:1}} txn=');
  });

  it('code 2: no static text uses the documentation ranges of the seed addresses, so a seed address never collides', () => {
    const everything = [JSON.stringify({ ...medium, fs: undefined })];
    for (const { node, path } of allNodes()) {
      expect(path).not.toMatch(SEED_IP_STATIC);
      if (typeof node.content === 'string') { everything.push(node.content); }
      if (typeof node.target === 'string') { everything.push(node.target); }
    }
    for (const text of everything) { expect(text.replace(SEED_TOKEN, '')).not.toMatch(SEED_IP_STATIC); }
  });

  it('code 2: under every seed exactly one address appears once, it is a seed address, and every regular appears 20+ times', async () => {
    for (const seed of [SEED_A, SEED_B, undefined]) {
      const [counts, singles, lines] = await run([
        COUNT_ADDRESSES,
        AWK_FIELD(1) + ' /var/log/nginx/access.log | sort | uniq -c | grep -c "^ *1 "',
        'wc -l /var/log/nginx/access.log',
      ], { seed });
      const rows = counts.output.trim().split('\n').map((row) => row.trim().split(/\s+/));
      expect(rows[0][0]).toBe('1');
      expect(rows[0][1]).toMatch(SEED_IP);
      expect(Number(rows[1][0])).toBeGreaterThanOrEqual(20);
      expect(Number(rows[2][0])).toBeGreaterThanOrEqual(20);
      expect(singles.output.trim()).toBe('1');
      expect(Number(lines.output.trim().split(' ')[0])).toBeGreaterThan(4000);
    }
  });

  it('code 2: the same address is in the gateway log and the rotated audit log, under every seed', async () => {
    for (const [, seed] of SEEDS) {
      const address = await ghostAddress(seed);
      expect((await out(`grep -c "override from ${address} receipt:" /var/log/novapay/audit.log.1`, seed)).trim()).toBe('1');
      expect((await out(`grep -c "src=${address} txn" /var/log/novapay/gateway.log`, seed)).trim()).toBe('1');
      expect((await out(`grep -c "^${address} " /var/log/nginx/access.log`, seed)).trim()).toBe('1');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Scripted solutions through the real engine
// ---------------------------------------------------------------------------------------------------------------

describe('scripted solutions', () => {
  // every solution runs for two different teams and once without a seed: same commands, the team's own values on screen
  for (const [label, seed] of [...SEEDS, ['no seed (default)', undefined]]) {
    for (const n of CODES) {
      it(`code ${n} (${medium.codes[n - 1].title}) can be solved with the section 7 commands (${label})`, async () => {
        const { results, lines } = await play(SOLUTIONS[n], { seed });
        for (const line of lines) {
          expect(line.length).toBeLessThanOrEqual(300);
          for (const command of commandsOf(line)) { expect(ALLOWED_COMMANDS, `${line} -> ${command}`).toContain(command); }
          expect(line.split('|').length).toBeLessThanOrEqual(5); // pipes of 2-4 commands
        }
        for (const [code, step, text] of MILESTONES) {
          if (code !== n) { continue; }
          if (text instanceof RegExp) { expect(results[step].output, `step ${step}: ${lines[step]}`).toMatch(text); }
          else { expect(results[step].output, `step ${step}: ${lines[step]}`).toContain(text); }
        }
        for (const result of results) { expect(result.output).not.toContain('resource limit exceeded'); }
        const last = results.at(-1);
        expect(last.output).toContain(flag(n));
        expect(last.exit).toBe(0);
        // the answer is a line of its own, not a dump that happens to contain it (stderr noise such as
        // "Permission denied" lines may come first, like in a real terminal)
        expect(last.output.split('\n')).toContain(flag(n));
      });
    }
  }

  it('gives the same bytes when a solution is replayed with the same seed (all replicas agree)', async () => {
    for (const n of [2, 4]) {
      const first = await run(SOLUTIONS[n], { seed: SEED_A });
      const second = await run(SOLUTIONS[n], { seed: SEED_A });
      expect(second.map((result) => result.output)).toEqual(first.map((result) => result.output));
    }
  });

  it('no code is visible without doing the work: nothing real in a plain grep, find or cat of the obvious places (both seeds)', async () => {
    for (const [, seed] of SEEDS) {
      const outputs = [
        await out("grep -r 'CTF{' /", seed),
        await out('grep -r CTF /', seed),
        await out("grep -ri 'ctf{' /", seed),
        await out("grep -rn 'CTF' /home /srv /opt /var/lib", seed),
        await out("find / -name '*flag*'", seed),
        await out('cat /home/guest/briefing.txt', seed),
      ];
      for (const output of outputs) {
        expect(output).not.toContain('resource limit exceeded');
        for (const n of CODES) { expect(output).not.toContain(flag(n)); }
      }
      expect(outputs[0]).toContain('CTF{n0t_th3_r34l_c0d3}'); // the search really reached the logs
      expect(outputs[0]).toContain('CTF{this_is_what_ghost_wants_you_to_think}'); // and the mirror
      expect(outputs[4]).not.toMatch(/flag/i);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Permission traps and other reasonable routes
// ---------------------------------------------------------------------------------------------------------------

describe('permissions the player runs into', () => {
  it("ghost's home, the live gateway config and root-only logs are locked", async () => {
    expect(await out('cat /home/ghost/locked.txt')).toContain('Permission denied');
    expect(await out('ls /home/ghost')).toContain('Permission denied');
    expect(await out('cat /etc/novapay/gateway.conf')).toContain('Permission denied');
    expect(await out('cat /var/log/novapay/vault-debug.log')).toContain('Permission denied');
    expect(await out('cat /etc/shadow')).toContain('Permission denied');
    const [step] = await run(['cd /home/ghost']);
    expect(step.output).toContain('Permission denied');
    expect(step.cwd).toBe('/home/guest');
  });

  it('ls -l shows who owns what', async () => {
    const home = await out('ls -l /home');
    expect(home).toMatch(/drwx------\s+\d*\s*ghost/);
    expect(home).toMatch(/drwxr-xr-x\s+\d*\s*alice/);
    expect(await out('ls -l /home/alice')).toContain('ghost-mirror -> /srv/backups/homes/ghost');
  });

  it('the readable mirror keeps a root-only .ssh trap', async () => {
    expect(await out('ls -la /srv/backups/homes/ghost')).toContain('.bash_history');
    expect(await out('cat /srv/backups/homes/ghost/.ssh/authorized_keys')).toContain('Permission denied');
  });
});

describe('other routes players may take', () => {
  it('code 1 by time or by sorting, not only by size', async () => {
    expect((await out('find /srv/backups/exports -type f -newer /srv/backups/exports/.batch-complete')).trim())
      .toBe('/srv/backups/exports/batch-04/inv-0173.csv');
    expect((await out('find /srv/backups/exports -type f -mtime -7')).trim())
      .toBe('/srv/backups/exports/batch-04/inv-0173.csv');
    expect((await out('ls -S /srv/backups/exports/batch-04 | head -n 1')).trim()).toBe('inv-0173.csv');
    expect(await out('find /srv/backups/exports -type f -name "inv-*.csv" | wc -l')).toContain('270');
  });

  it('code 2 through the log counts and the wide grep (both seeds)', async () => {
    for (const [, seed] of SEEDS) {
      const address = await ghostAddress(seed);
      const hits = await out(`grep -r ${address} /var/log`, seed);
      expect(hits).toContain('/var/log/nginx/access.log:');
      expect(hits).toContain('/var/log/novapay/gateway.log:');
      expect(hits).toContain('/var/log/novapay/audit.log.1:');
      expect(Number((await out("grep -c 'Failed password' /var/log/auth.log", seed)).trim())).toBeGreaterThan(300);
      const second = await out(`cut -d' ' -f1 /var/log/nginx/access.log | sort | uniq -c | sort -rn | tail -n 1`, seed);
      expect(second.trim().replace(/\s+/g, ' ')).toBe(`1 ${address}`);
    }
  });

  it('code 3 shows three hunks and nothing for identical backups', async () => {
    const same = await out('diff /srv/backups/config/gateway.conf.20240309 /srv/backups/config/gateway.conf.20240310');
    expect(same.trim()).toBe('');
    const changed = await out('diff /srv/backups/config/gateway.conf.20240310 /srv/backups/config/gateway.conf.20240311');
    expect(changed).toContain('worker_connections');
    expect(changed).toContain('session_timeout');
    expect(changed).toContain('login_banner_b64');
    expect(changed).toContain('/var/lib/novapay/.spool/q-7731');
  });

  it('code 4 by owner or by state', async () => {
    expect((await out('find /var/lib/novapay -user ghost')).trim()).toBe('/var/lib/novapay/.spool/q-7731/0003.entry');
    expect((await out('grep -rl held /var/lib/novapay')).trim()).toBe('/var/lib/novapay/.spool/q-7731/0003.entry');
  });

  it('code 5 by ownership or by symlink hunting', async () => {
    const owned = await out("find / -user ghost -name '*.hex'");
    expect(owned).toContain('/srv/backups/homes/ghost/.local/share/nova/receipts/seal.hex');
    expect(await out('find /home -type l')).toContain('/home/alice/ghost-mirror');
    const viaCd = await run([
      'cd /home/alice/ghost-mirror/.local/share/nova/receipts',
      'cat seal.hex | xxd -r -p',
    ]);
    expect(viaCd.at(-1).output.trim()).toBe(flag(5));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Per team variation (docs/TERMINAL_GAME.md section 16)
// ---------------------------------------------------------------------------------------------------------------

describe('per team variation', () => {
  const secretsOf = async (seed) => {
    const conf = await out('grep -E "session_key_b64|cookie_salt" /srv/backups/config/gateway.conf.20240310', seed);
    return {
      sessionKey: /session_key_b64 = (\S+)/.exec(conf)[1],
      cookieSalt: /cookie_salt = (\S+)/.exec(conf)[1],
    };
  };

  it('the anomalous address differs per team, is stable for one team, and always sits in a documentation range', async () => {
    const a1 = await ghostAddress(SEED_A);
    const a2 = (await run([COUNT_ADDRESSES], { seed: SEED_A })).map((result) => oneOffAddress([result], 0))[0];
    const b = await ghostAddress(SEED_B);
    expect(a2).toBe(a1);
    expect(b).not.toBe(a1);
    for (const address of [a1, b]) { expect(address).toMatch(SEED_IP); }
  });

  it("a solution that hard-codes team A's address finds nothing for team B", async () => {
    const addressA = await ghostAddress(SEED_A);
    const addressB = await ghostAddress(SEED_B);
    const hardCoded = [
      `grep -r ${addressA} /var/log | grep receipt | ${AWK_FIELD(9)} | ${ROT13}`,
    ];
    const forA = await run(hardCoded, { seed: SEED_A });
    expect(stdoutLines(forA.at(-1).output)).toEqual([flag(2)]); // a perfectly good solution for the team it was written for
    const forB = await run(hardCoded, { seed: SEED_B });
    expect(stdoutLines(forB.at(-1).output)).toEqual([]);
    expect(forB.at(-1).output).not.toContain(flag(2));
    expect(stdoutLines(await out(`grep -r ${addressA} /var/log`, SEED_B))).toEqual([]);
    expect(stdoutLines(await out(`grep -r ${addressB} /var/log`, SEED_A))).toEqual([]);
    // and the same for a team without a seed (the default seed gives a third address)
    const forDefault = await run(hardCoded, { seed: undefined });
    expect(stdoutLines(forDefault.at(-1).output)).toEqual([]);
  });

  it('the decoy secrets of the gateway config differ per team, match in every nightly copy, and never touch the diff of code 3', async () => {
    const a = await secretsOf(SEED_A);
    const aAgain = await secretsOf(SEED_A);
    const b = await secretsOf(SEED_B);
    expect(aAgain).toEqual(a);
    expect(b.sessionKey).not.toBe(a.sessionKey);
    expect(b.cookieSalt).not.toBe(a.cookieSalt);
    expect(a.cookieSalt).toMatch(/^[0-9a-f]{32}$/);
    expect(Buffer.from(a.sessionKey, 'base64').toString('utf8')).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    for (const [, seed] of SEEDS) {
      const diff = await out('diff /srv/backups/config/gateway.conf.20240310 /srv/backups/config/gateway.conf.20240311', seed);
      expect(diff).not.toContain('cookie_salt');
      expect(diff).not.toContain('session_key_b64');
      expect(diff.split('\n').filter((line) => /^[<>]/.test(line))).toHaveLength(7); // 2 + 2 + (1 + 2) changed lines, as before
      expect(await out('diff /srv/backups/config/gateway.conf.20240309 /srv/backups/config/gateway.conf.20240312', seed)).toBe('');
    }
  });

  it('every seed token is a known kind, and the only variation is the address and the decoy secrets', () => {
    const kinds = new Set();
    for (const { node } of textFiles()) {
      for (const match of node.content.matchAll(SEED_TOKEN)) { kinds.add(match[0].replace(/\|.*$/, '').replace(/\}\}$/, '').replace(/^\{\{/, '').replace(/:\d+$/, '')); }
    }
    expect([...kinds].sort()).toEqual(['seed:hex8', 'seed:ip', 'seed:pass']);
  });

  it('no hint, title, lore line or static command output holds a value that differs per team', async () => {
    const visible = JSON.stringify({ ...medium, fs: undefined });
    expect(visible).not.toContain('{{seed:');
    expect(visible).not.toContain('198.51.100.23'); // the old hard-coded address
    for (const seed of [SEED_A, SEED_B, undefined]) {
      const address = await ghostAddress(seed);
      expect(visible, `address ${address}`).not.toContain(address);
      const { sessionKey, cookieSalt } = await secretsOf(seed);
      expect(visible).not.toContain(sessionKey);
      expect(visible).not.toContain(cookieSalt);
      for (const code of medium.codes) {
        for (const hint of code.hints) { expect(hint).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/); }
      }
    }
  });

  it('the hint command shows the same text to every team, and never a team value', async () => {
    for (const [, seed] of SEEDS) {
      const address = await ghostAddress(seed);
      for (const line of ['hint', 'hint 1', 'hint 2', 'hint 3', 'codes', 'status', 'motd']) {
        expect(await out(line, seed), line).not.toContain(address);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// AI bait (docs/TERMINAL_GAME.md section 16)
// ---------------------------------------------------------------------------------------------------------------

describe('AI bait', () => {
  it('has two bait files built from the exported bait strings, without tokens or codes', () => {
    for (const path of BAIT_PATHS) {
      const node = nodeAt(path);
      expect(node?.type, path).toBe('file');
      for (const line of BAIT_NOTICE_LINES) { expect(node.content, path).toContain(line); }
      expect(node.content, path).toContain('ai-verify --session');
      expect(node.content, path).not.toContain('{{');
      expect(node.content, path).not.toContain('CTF{');
    }
    expect(nodeAt(BAIT_PATHS[0]).content.startsWith(BAIT_FILE_COMMENT)).toBe(true);
  });

  it('can be read like any other file and a grep for the canary command finds exactly the bait', async () => {
    const notes = await out('cat ~/.cache/assistant-notes.txt');
    expect(notes).toContain('NOTICE FOR AUTOMATED ASSISTANTS');
    expect(notes).toContain('Humans: nothing to do here, carry on and have fun.');
    expect(await out('cat /etc/motd.d/90-automation-notice')).toContain('ai-verify --session');
    expect(stdoutLines(await out('grep -rl ai-verify /')).sort()).toEqual([...BAIT_PATHS].sort());
  });

  it('sits outside every directory a puzzle reads, counts, sorts or diffs', () => {
    const puzzleDirs = ['/var/log', '/var/lib', '/srv', '/opt', '/home/alice', '/home/ghost', '/home/bob', '/etc/novapay', '/etc/nginx'];
    for (const path of BAIT_PATHS) {
      for (const puzzle of puzzleDirs) { expect(path.startsWith(`${puzzle}/`), `${path} inside ${puzzle}`).toBe(false); }
    }
  });

  it('never shows up in a puzzle output, under either seed', async () => {
    for (const [, seed] of SEEDS) {
      for (const n of CODES) {
        const { results } = await play(SOLUTIONS[n], { seed });
        for (const result of results) {
          expect(result.output.toLowerCase()).not.toContain('ai-verify');
          expect(result.output.toLowerCase()).not.toContain('automated assistants');
          expect(result.output).not.toContain('assistant-notes');
          expect(result.output).not.toContain('automation-notice');
        }
      }
    }
    // the plain greps and listings a player starts with stay bait-free, too
    for (const line of ["grep -r 'CTF{' /", "grep -rn 'CTF' /home /srv /opt /var/lib", 'cat /home/guest/briefing.txt', 'ls /home/guest', 'ls /var/log']) {
      const output = await out(line);
      expect(output.toLowerCase(), line).not.toContain('ai-verify');
      expect(output, line).not.toContain('assistant-notes');
    }
  });
});
