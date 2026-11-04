// Arena Terminal - HARD mode ("The Vault") content tests. See docs/TERMINAL_GAME.md sections 11, 12 and 16.
// Data-level checks work on the mode definition alone; the scripted solutions run through the real engine (shell.js).
//
// Per team variation (section 16): the one-off address of code 1, the three kids, the archive key secret and the master
// passphrase are seed tokens, so no scripted solution below hard-codes them. Each solution reads the team's values off the
// screen (a step can be a function of the earlier outputs) and runs under two different seeds.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { execute } from '../../src/terminal/shell.js';
import hard, { buildHardFs } from '../../src/terminal/modes/hard.js';
import { BAIT_FILE_COMMENT, BAIT_NOTICE_LINES } from '../../src/services/integrityBait.js';

const flag = (n) => 'CTF{test_flag_' + n + '}';
const real33 = (n) => `CTF{terminal_hard_${n}_0123456789ab}`; // the real shape: CTF{<slug>_<12 hex>}
const long36 = (n) => `CTF{x${n}_abcdefghijklmnopqrstuvwxyz01}`;
const CODES = [1, 2, 3, 4, 5, 6];

const LIB = '/usr/lib/x86_64-linux-gnu/libnss_ghost.so.2';
const ACCESS = '/var/log/nginx/access.log';
const RECEIPT = '/var/secure/ledger/current/receipt-0313.rec';
const ONION = '/var/backups/.stash/onion.b64';
const ROT13 = "tr 'A-Za-z' 'N-ZA-Mn-za-m'";

// Two different teams, plus "no seed" (the engine then falls back to its default seed).
const seedOf = (name) => createHash('sha256').update('arena-test-seed:' + name).digest('hex');
const SEED_A = seedOf('team-a');
const SEED_B = seedOf('team-b');
const SEEDS = [['team A', SEED_A], ['team B', SEED_B]];
const ALL_SEEDS = [...SEEDS, ['no seed (default)', undefined]];
const SEED_IP = /^(?:198\.51\.100|203\.0\.113)\.\d{1,3}$/;
const SEED_IP_STATIC = /(?:198\.51\.100|203\.0\.113)\.\d/; // no static text may contain an address of the seed ranges
const SEED_TOKEN = /\{\{(?:seed:[a-z0-9]+(?::\d+)?|md5file:[^{}|]+)(?:\|[a-z0-9:-]+)*\}\}/g;

// AI bait (section 16): where it lives, and the exported strings it must be built from.
const BAIT_PATHS = ['/home/guest/.cache/assistant-notes.txt', '/etc/motd.d/90-automation-notice'];

// Fake-but-flag-shaped strings that may appear literally (un-encoded) in the content. They never validate.
const DECOYS = [
  'CTF{...}',
  'CTF{nice_try_this_file_is_a_tripwire}',
  'CTF{recovery_codes_are_never_in_a_csv}',
  'CTF{ls_is_not_enough}',
  'CTF{symbols_are_not_secrets}',
  'CTF{backup_of_nothing}',
  'CTF{the_old_master_is_dead}',
];

// Commands the solutions may use: the non-optional commands of docs/TERMINAL_GAME.md section 7.
const ALLOWED_COMMANDS = new Set([
  'help', 'man', 'clear', 'history', 'whoami', 'id', 'hostname', 'uname', 'date', 'pwd', 'cd', 'echo', 'env', 'true', 'false',
  'exit', 'motd', 'hint', 'status', 'codes', 'ls', 'cat', 'tac', 'head', 'tail', 'less', 'more', 'nl', 'wc', 'file', 'stat',
  'tree', 'find', 'du', 'grep', 'sort', 'uniq', 'cut', 'tr', 'rev', 'sed', 'awk', 'diff', 'xargs', 'base64', 'xxd', 'hexdump',
  'strings', 'gzip', 'gunzip', 'zcat', 'md5sum', 'sha1sum', 'sha256sum', 'ps', 'crontab', 'last', 'who', 'w', 'uptime', 'df',
  'sudo', 'vault',
]);

const SIZE_CAP = 3 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

const md5 = (text) => createHash('md5').update(text).digest('hex');

function walkTree(node, path, visit) {
  visit(node, path);
  if (node.type === 'dir') {
    for (const [name, child] of Object.entries(node.children)) {
      walkTree(child, path === '/' ? `/${name}` : `${path}/${name}`, visit);
    }
  }
}

function allNodes(root = hard.fs) {
  const nodes = [];
  walkTree(root, '/', (node, path) => nodes.push({ node, path }));
  return nodes;
}

// Every string a player can ever read as text: file content and vault plaintext.
function textSources(root = hard.fs) {
  const sources = [];
  for (const { node, path } of allNodes(root)) {
    if (node.type === 'file' && typeof node.content === 'string') { sources.push({ path, text: node.content, vault: false }); }
    if (node.vault) { sources.push({ path: `${path} (vault)`, text: node.vault.plain, vault: true }); }
    if (node.type === 'file' && node.binary) { sources.push({ path, text: Buffer.from(node.contentBase64, 'base64').toString('latin1'), vault: false }); }
  }
  return sources;
}

function nodeAt(path) {
  let current = hard.fs;
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
    if (name.startsWith('slice:')) {
      const [from, to] = name.slice(6).split('-').map(Number);
      return current.slice(from, to);
    }
    switch (name) {
      case 'b64': return Buffer.from(current, 'utf8').toString('base64');
      case 'hex': return Buffer.from(current, 'utf8').toString('hex');
      case 'rot13': return rot13(current);
      case 'rev': return [...current].reverse().join('');
      case 'upper': return current.toUpperCase();
      case 'lower': return current.toLowerCase();
      case 'gzb64': return gzipSync(Buffer.from(current, 'utf8')).toString('base64');
      default: throw new Error(`filter not allowed in this mode: ${name}`);
    }
  }, value);
}

const TOKEN = /\{\{flag:(\d+)((?:\|[a-z0-9:-]+)*)\}\}/g;

function allTokens() {
  const found = [];
  for (const source of textSources()) {
    for (const match of source.text.matchAll(TOKEN)) {
      found.push({ path: source.path, vault: source.vault, n: Number(match[1]), filters: match[2].split('|').filter(Boolean) });
    }
  }
  return found;
}

const ANSI = /\x1b\[[0-9;]*m/g;
const makeCtx = (cwd, flagFn, seed) => ({ mode: hard, cwd, flag: flagFn, seed, progress: async () => ({ solved: [] }) });

// A step is a command line, or a function of the results so far (for values the player reads off the screen).
// `seed`: the team's seed; an explicit undefined means "no seed" and the default is team A.
async function play(steps, options = {}) {
  const seed = 'seed' in options ? options.seed : SEED_A;
  const { flagFn = flag, cwd: startCwd = hard.home } = options;
  let cwd = startCwd;
  const results = [];
  const lines = [];
  for (const step of steps) {
    const line = typeof step === 'function' ? step(results) : step;
    const raw = await execute(line, makeCtx(cwd, flagFn, seed));
    const result = { ...raw, output: raw.output.replace(ANSI, '') }; // terminal colours (grep/ls) are not part of the answer
    cwd = result.cwd;
    results.push(result);
    lines.push(line);
  }
  return { results, lines };
}

const out = async (line, options = {}) => (await play([line], options)).results[0].output;

// stdout lines only: grep -r over / also prints "Permission denied" lines for the root-only files, like a real terminal.
const stdoutLines = (text) => text.split('\n').filter((line) => line !== '' && !/: Permission denied$/.test(line));

// The commands of a line: split at | || && ; that are outside quotes (a grep -E pattern may hold a | itself).
function stagesOf(line) {
  const stages = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) { quote = ''; }
      current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
    } else if (ch === '|' || ch === ';' || (ch === '&' && line[i + 1] === '&')) {
      if (current.trim()) { stages.push(current.trim()); }
      current = '';
      if (line[i + 1] === ch) { i += 1; } // || and &&
    } else {
      current += ch;
    }
  }
  if (current.trim()) { stages.push(current.trim()); }
  return stages;
}
const commandsOf = (line) => stagesOf(line).map((part) => part.split(/\s+/)[0]);
const grab = (results, index, regex) => {
  const match = regex.exec(results[index].output);
  if (!match) { throw new Error(`step ${index}: no match for ${regex} in:\n${results[index].output.slice(0, 400)}`); }
  return match[1] ?? '';
};

// --- reading the team's values off the screen (what a player does) ---

const ONE_OFFS = `awk '{print $1}' ${ACCESS} | sort | uniq -c | sort -n | head -n 5`;
const oneOffsOf = (results, at) => [...results[at].output.matchAll(/^\s*1\s+(\d+\.\d+\.\d+\.\d+)\s*$/gm)].map((match) => match[1]);
// of the three addresses that appear once, the one that was answered with a 200
const FIND_200 = (results, at) => `grep -E '^(${oneOffsOf(results, at).join('|')}) ' ${ACCESS} | grep ' 200 '`;
const addressOf = (results, at) => grab(results, at, /^(\d+\.\d+\.\d+\.\d+) /m);

// xxd text column of the row that starts with "k.i.d.=." plus the next row: the word is every other character
const asciiColumn = (line) => /^[0-9a-f]{8}:(?: [0-9a-f]{4})+ {2}(.*)$/.exec(line)?.[1] ?? '';
function wideKid(output) {
  const lines = output.split('\n');
  const at = lines.findIndex((line) => asciiColumn(line).startsWith('k.i.d.=.'));
  if (at < 0) { throw new Error(`no wide kid in:\n${output.slice(0, 400)}`); }
  const text = asciiColumn(lines[at]) + asciiColumn(lines[at + 1] ?? '');
  return /k\.i\.d\.=\.((?:[a-z]\.)+)/.exec(text)[1].replaceAll('.', '');
}

// ---------------------------------------------------------------------------------------------------------------
// Scripted solutions (the walkthroughs). The last step prints exactly the code.
// ---------------------------------------------------------------------------------------------------------------

const SOLUTIONS = {
  // one-off addresses -> the one answered with 200 -> ref= value -> hex -> reverse
  1: [
    ONE_OFFS,
    (results) => FIND_200(results, 0),
    (results) => `grep -c '^${addressOf(results, 1)} ' ${ACCESS}`,
    (results) => `grep '^${addressOf(results, 1)} ' ${ACCESS} | awk '{print $7}' | cut -d= -f2 | cut -d'&' -f1 | xxd -r -p | rev`,
  ],
  // cron -> hidden stash, seal.sh shows the layers going on (rev | gzip | base64), take them off in reverse
  2: [
    'crontab -l',
    'cat /opt/ghost/bin/seal.sh',
    `cat ${ONION}`,
    `grep -v '^#' ${ONION} | base64 -d | gunzip | rev`,
  ],
  // find -newer, file, strings (debug vs release), hex then rot13
  3: [
    'find / -type f -newer /etc/ghost/lockout.stamp',
    `file ${LIB}`,
    `strings -n 12 ${LIB} | grep ref.`,
    `strings -n 12 ${LIB} | grep ref.release | cut -d= -f2 | xxd -r -p | ${ROT13}`,
  ],
  // md5 matching picks the key, its secret opens the vault
  4: [
    'cat /srv/vault/archive.vlt',
    'grep archive.key /etc/ghost/trusted.md5',
    (results) => `md5sum /srv/keys/* | grep ${grab(results, 1, /^([0-9a-f]{32})\s+archive\.key/m)}`,
    (results) => `cat ${grab(results, 2, /(\/srv\/keys\/\S+\.key)/)}`,
    (results) => `vault open /srv/vault/archive.vlt ${grab(results, 3, /secret: (\S+)/)} | grep 'code:' | awk '{print $2}'`,
  ],
  // sudo rule, symlink hops, ps names the file, rot13
  5: [
    'sudo -l',
    'ls -l /home/guest',
    'ls -l /srv/mnt',
    'ps aux | grep ledger',
    `cat ${RECEIPT}`,
    `sudo cat ${RECEIPT} | ${ROT13} | grep 'recovery code' | awk '{print $4}'`,
  ],
  // three kids from the three leaks (web log, stash comment, wide characters in the library) -> master vault;
  // shares 1 (archive, opened with the key found by md5), 2 (ledger) and 3 (master) glued in order
  6: [
    'cat /srv/escrow/README.escrow', // 0
    ONE_OFFS, // 1
    (results) => FIND_200(results, 1), // 2
    (results) => `grep '^${addressOf(results, 2)} ' ${ACCESS} | awk '{print $7}' | cut -d= -f3`, // 3: kid of the web log
    `head -n 1 ${ONION}`, // 4: kid of the stash
    `xxd ${LIB} | grep -A1 'k.i.d'`, // 5: kid of the agent library (wide)
    'grep archive.key /etc/ghost/trusted.md5', // 6
    (results) => `md5sum /srv/keys/* | grep ${grab(results, 6, /^([0-9a-f]{32})\s+archive\.key/m)}`, // 7
    (results) => `cat ${grab(results, 7, /(\/srv\/keys\/\S+\.key)/)}`, // 8
    (results) => `vault open /srv/vault/archive.vlt ${grab(results, 8, /secret: (\S+)/)} | grep 'share 1/3' | awk '{print $4}'`, // 9
    `sudo cat ${RECEIPT} | ${ROT13} | grep 'share 2/3' | awk '{print $4}'`, // 10
    (results) => {
      const kids = [results[3].output.trim(), grab(results, 4, /kid=([a-z]+)/), wideKid(results[5].output)];
      return `vault open /srv/escrow/master.vlt ${kids.join('.')} | grep 'share 3/3' | awk '{print $4}'`;
    }, // 11
    (results) => `echo '${[9, 10, 11].map((i) => results[i].output.trim()).join('')}'`, // 12
  ],
};
const SHARE_STEPS = [9, 10, 11];

// The team's values, discovered by running code 6's walkthrough (it touches every one of them).
async function discover(seed) {
  const { results } = await play(SOLUTIONS[6], { seed });
  const kids = [results[3].output.trim(), grab(results, 4, /kid=([a-z]+)/), wideKid(results[5].output)];
  return {
    ip: addressOf(results, 2),
    kids,
    masterPass: kids.join('.'),
    archivePass: grab(results, 8, /secret: (\S+)/),
    archiveHash: grab(results, 6, /^([0-9a-f]{32})\s+archive\.key/m),
  };
}
const valuesCache = new Map();
async function valuesOf(seed) {
  if (!valuesCache.has(seed)) { valuesCache.set(seed, await discover(seed)); }
  return valuesCache.get(seed);
}

// code 6 once the values are known: used where a test only cares about the glued shares
const shortSix = (v) => [
  `vault open /srv/vault/archive.vlt ${v.archivePass} | grep 'share 1/3' | awk '{print $4}'`,
  `sudo cat ${RECEIPT} | ${ROT13} | grep 'share 2/3' | awk '{print $4}'`,
  `vault open /srv/escrow/master.vlt ${v.masterPass} | grep 'share 3/3' | awk '{print $4}'`,
  (results) => `echo '${[0, 1, 2].map((i) => results[i].output.trim()).join('')}'`,
];

// Substrings that must show up in the output of an intermediate step: [code, step index, text or (values) => text].
const MILESTONES = [
  [1, 0, '1 192.0.2.14'],
  [1, 0, '1 192.0.2.177'],
  [1, 0, (v) => `1 ${v.ip}`],
  [1, 1, ' 200 '],
  [1, 1, 'POST /internal/rotate?ref='],
  [1, 2, '1'],
  [2, 0, '/var/backups/.stash/onion.b64'],
  [2, 1, 'rev | gzip -9 | base64'],
  [2, 2, (v) => `kid=${v.kids[1]}`],
  [3, 0, LIB],
  [3, 0, '/var/backups/.stash/onion.b64'],
  [3, 1, 'ELF'],
  [3, 2, 'ref.debug='],
  [3, 2, 'ref.release='],
  [4, 0, 'ARENAVAULT1'],
  [4, 2, '.key'],
  [4, 3, (v) => `secret: ${v.archivePass}`],
  [5, 0, '/var/secure/'],
  [5, 1, 'ledger-link -> /srv/mnt/hop1'],
  [5, 2, 'hop3 -> /var/secure/ledger/current'],
  [5, 3, 'receipt-0313.rec'],
  [5, 4, 'Permission denied'],
  [6, 0, 'share 3/3'],
  [6, 3, (v) => v.kids[0]],
  [6, 4, (v) => `kid=${v.kids[1]}`],
  [6, 5, 'k.i.d.=.'],
  [6, 5, (v) => `k.i.d.=.${[...v.kids[2].slice(0, 4)].map((c) => `${c}.`).join('')}`],
];

// ---------------------------------------------------------------------------------------------------------------
// Definition and content rules (data only)
// ---------------------------------------------------------------------------------------------------------------

describe('hard mode definition', () => {
  it('has the contract fields', () => {
    expect(hard.mode).toBe('hard');
    expect(hard.difficulty).toBe('hard');
    expect(hard.title).toBe('The Vault');
    expect(hard.user).toBe('guest');
    expect(hard.host).toBe('arena');
    expect(hard.home).toBe('/home/guest');
    expect(nodeAt(hard.home)?.type).toBe('dir');
    expect(hard.tagline.length).toBeGreaterThan(10);
    expect(hard.motd.length).toBeGreaterThan(30);
    expect(hard.sudoers).toEqual([{ cmd: 'cat', pathPrefix: '/var/secure/' }]);
  });

  it('has a short tense lore that ends with the help prompt', () => {
    expect(hard.lore.length).toBeGreaterThan(5);
    expect(hard.lore.length).toBeLessThanOrEqual(12);
    expect(hard.lore.at(-1)).toBe('Type help to begin.');
    expect(hard.lore.every((line) => typeof line === 'string' && line.length <= 100)).toBe(true);
  });

  it('has exactly 6 codes worth 180 points each, numbered 1..6, with titles and 3+ hints', () => {
    expect(hard.codes).toHaveLength(6);
    expect(hard.codes.map((code) => code.n)).toEqual(CODES);
    for (const code of hard.codes) {
      expect(code.points).toBe(180);
      expect(code.title.length).toBeGreaterThan(3);
      expect(code.hints.length).toBeGreaterThanOrEqual(3);
      expect(code.hints.every((hint) => typeof hint === 'string' && hint.length > 20)).toBe(true);
      expect(code.hints.join(' ')).not.toMatch(/CTF\{/);
      // tier 3 nearly gives the command chain
      expect(code.hints[2]).toMatch(/\b(awk|grep|find|vault|sudo)\b/);
    }
    expect(new Set(hard.codes.map((code) => code.title)).size).toBe(6);
  });

  it('describes processes (with a suspicious one) and static system commands', () => {
    expect(hard.processes).toContain('USER');
    expect(hard.processes).toContain('ghost-ledgerd --write receipt-0313.rec');
    expect(hard.processes).toContain('stratum+tcp'); // the loud decoy process
    for (const name of ['crontab', 'last', 'who']) {
      expect(typeof hard.extraCommands[name]).toBe('string');
      expect(hard.extraCommands[name].length).toBeGreaterThan(20);
    }
    expect(hard.extraCommands.crontab).toContain('/var/backups/.stash/onion.b64');
  });

  it('never uses a club name anywhere', () => {
    const club = /gdgc/i;
    expect(JSON.stringify({ ...hard, fs: undefined })).not.toMatch(club);
    for (const { node, path } of allNodes()) {
      expect(path).not.toMatch(club);
      if (typeof node.content === 'string') { expect(node.content).not.toMatch(club); }
    }
  });
});

describe('hard virtual filesystem', () => {
  it('stays under the size cap and has realistic bulk', () => {
    const bytes = allNodes().reduce((sum, { node }) => {
      if (node.type !== 'file') { return sum; }
      return sum + (node.binary ? node.contentBase64.length : Buffer.byteLength(node.content));
    }, 0);
    expect(bytes).toBeLessThan(SIZE_CAP);
    expect(bytes).toBeGreaterThan(500 * 1024);
    expect(nodeAt(ACCESS).content.split('\n').length - 1).toBeGreaterThanOrEqual(8000);
    for (const path of ['/var/log/auth.log', '/var/log/syslog', '/var/log/nginx/access.log.1']) {
      expect(nodeAt(path).content.split('\n').length).toBeGreaterThan(500);
    }
    expect(allNodes().filter(({ node }) => node.type === 'file').length).toBeGreaterThan(100);
  });

  it('has no path and no content that uses the word flag (tokens aside)', () => {
    expect(allNodes().filter(({ path }) => /flag/i.test(path)).map(({ path }) => path)).toEqual([]);
    for (const source of textSources()) {
      expect(source.text.replace(TOKEN, ''), source.path).not.toMatch(/flag/i);
    }
  });

  it('stores every code only through well formed tokens with known filters', () => {
    const tokens = allTokens();
    for (const source of textSources()) {
      // no half written token (flag tokens and the per team seed / md5file tokens are the only kinds that exist)
      expect(source.text.replace(TOKEN, '').replace(SEED_TOKEN, ''), source.path).not.toContain('{{');
    }
    const countOf = (n) => tokens.filter((token) => token.n === n).length;
    for (const n of [1, 2, 3, 4, 5]) { expect(countOf(n), `code ${n}`).toBe(1); }
    expect(countOf(6)).toBe(3); // three shares
    for (const token of tokens) { applyFilters('probe', token.filters); } // throws on an unknown filter
  });

  it('uses seed tokens only where the design says: address, kids, archive passphrase, and the md5 of the genuine key', () => {
    const seen = {};
    for (const source of textSources()) {
      for (const match of source.text.matchAll(SEED_TOKEN)) {
        const token = match[0].slice(2, -2);
        (seen[token] ||= []).push(source.path);
      }
    }
    const md5Token = Object.keys(seen).find((token) => token.startsWith('md5file:'));
    expect(md5Token).toMatch(/^md5file:\/srv\/keys\/nk-[0-9a-f]{4}\.key$/);
    expect(Object.keys(seen).filter((token) => token !== md5Token).sort())
      .toEqual(['seed:ip:1', 'seed:pass:1', 'seed:word:1', 'seed:word:2', 'seed:word:3|wide']);
    expect(seen['seed:ip:1']).toEqual([ACCESS]);
    expect(seen['seed:word:1']).toEqual([ACCESS]);
    expect(seen['seed:word:2'].sort()).toEqual(['/etc/ghost/kid', ONION].sort());
    expect(seen['seed:word:3|wide']).toEqual([LIB]);
    expect(seen['seed:pass:1']).toEqual([md5Token.slice('md5file:'.length)]); // only the genuine key holds it
    expect(seen[md5Token]).toEqual(['/etc/ghost/trusted.md5']);
    // the md5file token points at a real key, and that key is the one holding the seed passphrase
    const keyPath = md5Token.slice('md5file:'.length);
    expect(nodeAt(keyPath)?.content).toContain('secret: {{seed:pass:1}}');
    expect(nodeAt('/srv/escrow/master.vlt').vault.passphrase).toBe('{{seed:word:1}}.{{seed:word:2}}.{{seed:word:3}}');
  });

  it('never leaves a real code readable without an encoding or a vault', () => {
    for (const token of allTokens()) {
      if (token.vault) { continue; } // only reachable through `vault open` with the right passphrase
      expect(token.filters.length, token.path).toBeGreaterThanOrEqual(1);
      for (const make of [flag, real33, long36]) {
        const stored = applyFilters(make(token.n), token.filters);
        expect(stored, token.path).not.toContain('CTF');
        expect(stored, token.path).not.toContain('test_flag');
        expect(stored, token.path).not.toContain('terminal_hard');
      }
    }
    // codes 1, 2, 3 and 5 are encoded; at least two of them are chains of 2+ filters
    const plain = allTokens().filter((token) => !token.vault);
    expect(plain.filter((token) => token.filters.length >= 2).length).toBeGreaterThanOrEqual(3);
    // the vaults hold codes 4 and shares 1 and 3 of code 6
    const inVaults = allTokens().filter((token) => token.vault).map((token) => token.n).sort();
    expect(inVaults).toEqual([4, 6, 6]);
  });

  it('contains no un-tokenized real-looking code, only the allow-listed decoys', () => {
    const seen = new Set();
    for (const source of textSources()) {
      expect(source.text, source.path).not.toContain('test_flag');
      expect(source.text, source.path).not.toContain('terminal_hard_');
      for (const match of source.text.matchAll(/CTF\{[^}]*\}/g)) {
        expect(DECOYS, `${source.path}: ${match[0]}`).toContain(match[0]);
        for (const n of CODES) {
          for (const make of [flag, real33, long36]) { expect(match[0]).not.toBe(make(n)); }
        }
        seen.add(match[0]);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('is deterministic: building the tree twice gives identical bytes, and matches the exported mode', () => {
    const hash = (root) => createHash('sha256').update(JSON.stringify(root)).digest('hex');
    expect(hash(buildHardFs())).toBe(hash(buildHardFs()));
    expect(hash(buildHardFs())).toBe(hash(hard.fs));
  });

  it('keeps file modes, owners and mtimes realistic', () => {
    expect(nodeAt('/var/secure')).toMatchObject({ mode: 0o700, owner: 'root' });
    expect(nodeAt('/var/secure/ledger/w11/receipt-0313.rec')).toMatchObject({ mode: 0o600, owner: 'root' });
    expect(nodeAt('/home/ghost')).toMatchObject({ mode: 0o700, owner: 'ghost' });
    expect(nodeAt('/etc/shadow').mode & 0o004).toBe(0);
    expect(nodeAt('/etc/ghost/kid').mode & 0o004).toBe(0);
    expect(nodeAt(ACCESS).mode & 0o004).not.toBe(0);
    expect(nodeAt('/opt/ghost/bin/seal.sh').mode & 0o111).not.toBe(0);
    expect(nodeAt('/etc/ghost/lockout.stamp').mtime).toBe('2024-03-13T23:41:07Z');
    // every mtime is a plain ISO string without milliseconds
    for (const { node, path } of allNodes()) { expect(node.mtime, path).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/); }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Puzzle design guarantees (data level)
// ---------------------------------------------------------------------------------------------------------------

describe('puzzle design guarantees (data level)', () => {
  it('code 1: exactly three addresses appear once, only one of them was answered with 200 (raw content)', () => {
    const counts = new Map();
    const statusOf = new Map();
    for (const line of nodeAt(ACCESS).content.trim().split('\n')) {
      const address = line.split(' ')[0];
      counts.set(address, (counts.get(address) ?? 0) + 1);
      statusOf.set(address, line.split(' ')[8]);
    }
    const once = [...counts].filter(([, count]) => count === 1).map(([address]) => address).sort();
    expect(once).toEqual(['192.0.2.14', '192.0.2.177', '{{seed:ip:1}}']); // the seed token is the real one
    expect(once.filter((address) => statusOf.get(address) === '200')).toEqual(['{{seed:ip:1}}']);
    const others = [...counts].filter(([address]) => !once.includes(address)).map(([, count]) => count);
    expect(Math.min(...others)).toBeGreaterThanOrEqual(10);
    const loudest = [...counts].sort((a, b) => b[1] - a[1])[0];
    expect(loudest).toEqual(['45.155.205.233', 381]); // the scanner is the loudest, and a red herring
  });

  it('code 1: no static text uses the documentation ranges of the seed addresses, so a seed address never collides', () => {
    const everything = [JSON.stringify({ ...hard, fs: undefined })];
    for (const { node, path } of allNodes()) {
      expect(path).not.toMatch(SEED_IP_STATIC);
      if (typeof node.content === 'string') { everything.push(node.content); }
      if (typeof node.target === 'string') { everything.push(node.target); }
      if (node.binary) { everything.push(Buffer.from(node.contentBase64, 'base64').toString('latin1')); }
      if (node.vault) { everything.push(node.vault.plain); }
    }
    for (const text of everything) { expect(text.replace(SEED_TOKEN, '')).not.toMatch(SEED_IP_STATIC); }
  });

  it('code 1: under every seed exactly three addresses appear once, and only the seed address was answered with 200', async () => {
    for (const [, seed] of ALL_SEEDS) {
      const v = await valuesOf(seed);
      expect(v.ip).toMatch(SEED_IP);
      const { results } = await play(SOLUTIONS[1], { seed });
      expect(oneOffsOf(results, 0).sort()).toEqual(['192.0.2.14', '192.0.2.177', v.ip].sort());
      const answered = stdoutLines(results[1].output);
      expect(answered).toHaveLength(1);
      expect(answered[0].startsWith(`${v.ip} `)).toBe(true);
      expect(results[2].output.trim()).toBe('1');
      expect((await out(`awk '{print $1}' ${ACCESS} | sort | uniq -c | sort -rn | head -n 1`, { seed })).trim().replace(/\s+/g, ' '))
        .toBe('381 45.155.205.233');
      expect(Number((await out(`grep -c 'POST /internal/rotate?ref=' ${ACCESS}`, { seed })).trim())).toBe(2);
    }
  });

  it('code 1: the real request is the only 200 POST /internal/rotate that carries a ref (raw content)', () => {
    const lines = nodeAt(ACCESS).content.split('\n').filter((line) => line.includes('POST /internal/rotate?ref='));
    expect(lines).toHaveLength(2);
    expect(lines.filter((line) => line.includes('" 200 '))).toHaveLength(1);
    expect(lines.find((line) => line.includes('" 200 '))).toContain('{{flag:1|rev|hex}}&kid={{seed:word:1}}');
  });

  it('code 3: exactly one binary is newer than the lockout stamp', () => {
    const stamp = Date.parse('2024-03-13T23:41:07Z');
    const newer = allNodes().filter(({ node }) => node.type === 'file' && Date.parse(node.mtime) > stamp);
    const elfs = newer.filter(({ node }) => (node.content ?? '').startsWith('\x7fELF'));
    expect(elfs.map(({ path }) => path)).toEqual([LIB]);
    expect(newer.length).toBeLessThan(15);
    // older ELF decoys exist (so strings on everything is not a plan)
    const oldElfs = allNodes().filter(({ node }) => node.type === 'file' && (node.content ?? '').startsWith('\x7fELF') && Date.parse(node.mtime) < stamp);
    expect(oldElfs.length).toBeGreaterThan(10);
  });

  it('code 3: the library hides its kid in wide characters that strings cannot see (raw content)', () => {
    const content = nodeAt(LIB).content;
    const wideAt = content.indexOf('k\0i\0d\0=\0{{seed:word:3|wide}}');
    expect(wideAt).toBeGreaterThan(0);
    expect(wideAt % 16).toBe(0); // starts a hex dump row
    expect(content).not.toContain('kid=');
    expect(content).toContain('ref.release={{flag:3|rot13|hex}}');
  });

  it('code 3: under every seed strings never shows the third kid, xxd always does', async () => {
    for (const [, seed] of ALL_SEEDS) {
      const v = await valuesOf(seed);
      const kid = v.kids[2];
      for (const line of [`strings ${LIB}`, `strings -n 3 ${LIB}`, `strings -n 12 ${LIB}`]) {
        const output = await out(line, { seed });
        expect(output, line).not.toContain(kid);
        expect(output, line).not.toContain('kid=');
      }
      const dump = await out(`xxd ${LIB} | grep -A1 'k.i.d'`, { seed });
      expect(wideKid(dump)).toBe(kid);
      expect(dump).toContain(`k.i.d.=.${[...kid.slice(0, 4)].map((c) => `${c}.`).join('')}`);
      // the rest of the code 3 puzzle does not depend on the team
      expect((await out(`strings -n 12 ${LIB} | grep ref.release | cut -d= -f2 | xxd -r -p | ${ROT13}`, { seed })).trim()).toBe(flag(3));
    }
  });

  it('code 4: the manifest holds the md5 of the genuine key as rendered, and exactly one key matches it, under every seed', async () => {
    const manifest = nodeAt('/etc/ghost/trusted.md5').content;
    // the other manifest lines are honest fingerprints of real files
    for (const [, hash, path] of manifest.matchAll(/^([0-9a-f]{32})\s+(\/\S+)$/gm)) {
      expect(md5(nodeAt(path).content), path).toBe(hash);
    }
    expect(manifest).toMatch(/^\{\{md5file:\/srv\/keys\/nk-[0-9a-f]{4}\.key\}\} {2}archive\.key$/m);
    const keyNames = Object.keys(nodeAt('/srv/keys').children);
    expect(keyNames).toHaveLength(40);
    // raw: forty distinct secrets, the genuine one is the seed passphrase token
    const rawSecrets = keyNames.map((name) => /secret: (\S+)/.exec(nodeAt(`/srv/keys/${name}`).content)[1]);
    expect(new Set(rawSecrets).size).toBe(40);
    expect(rawSecrets.filter((secret) => secret.includes('{{'))).toEqual(['{{seed:pass:1}}']);
    expect(nodeAt('/srv/vault/archive.vlt').vault.passphrase).toBe('{{seed:pass:1}}');

    for (const [, seed] of ALL_SEEDS) {
      const wanted = /^([0-9a-f]{32})\s+archive\.key$/m.exec(await out('cat /etc/ghost/trusted.md5', { seed }))[1];
      const sums = (await out('md5sum /srv/keys/*', { seed })).trim().split('\n');
      expect(sums).toHaveLength(40);
      const matching = sums.filter((line) => line.startsWith(`${wanted} `));
      expect(matching).toHaveLength(1);
      const keyPath = /(\/srv\/keys\/\S+)$/.exec(matching[0])[1];
      const keyText = await out(`cat ${keyPath}`, { seed });
      expect(md5(`${keyText}\n`)).toBe(wanted); // the fingerprint is the md5 of exactly what cat prints
      const secret = /secret: (\S+)/.exec(keyText)[1];
      expect(secret).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
      // all forty rendered secrets are different, so the genuine one is not a duplicate of a decoy
      const secrets = (await out('cat /srv/keys/* | grep secret:', { seed })).trim().split('\n');
      expect(new Set(secrets).size).toBe(40);
      expect(await out(`vault open /srv/vault/archive.vlt ${secret}`, { seed })).toContain(flag(4));
    }
  });

  it('code 5: the sudo rule, the locked directory and the symlink hops line up', () => {
    expect(nodeAt('/srv/mnt/hop1')).toMatchObject({ type: 'link', target: 'hop2' });
    expect(nodeAt('/srv/mnt/hop2')).toMatchObject({ type: 'link', target: '/srv/mnt/hop3' });
    expect(nodeAt('/srv/mnt/hop3')).toMatchObject({ type: 'link', target: '/var/secure/ledger/current' });
    expect(nodeAt('/srv/mnt/loop-a').target).toBe('loop-b');
    expect(nodeAt('/srv/mnt/loop-b').target).toBe('loop-a');
    expect(nodeAt('/var/secure/ledger/current')).toMatchObject({ type: 'link', target: 'w11' });
    expect(nodeAt('/home/guest/ledger-link').target).toBe('/srv/mnt/hop1');
    expect(nodeAt('/var/secure/ledger/w11/receipt-0313.rec')).toBeTruthy();
  });

  it('code 6: the shares always glue back into the whole code, for flags of 16 to 40 characters', () => {
    const shares = allTokens().filter((token) => token.n === 6);
    const bySlice = (name) => shares.find((token) => token.filters.includes(name));
    expect(shares.map((token) => token.filters[0])).toEqual(expect.arrayContaining(['slice:0-24', 'slice:24-28', 'slice:28-99']));
    expect(bySlice('slice:0-24').vault).toBe(true); // share 1: archive
    expect(bySlice('slice:24-28').path).toContain('receipt-0313.rec'); // share 2: ledger
    expect(bySlice('slice:28-99').path).toContain('master.vlt'); // share 3: master
    for (let length = 16; length <= 40; length += 1) {
      const text = Array.from({ length }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
      const whole = `CTF{${text.slice(0, length - 5)}}`;
      expect(whole).toHaveLength(length);
      const glued = ['slice:0-24', 'slice:24-28', 'slice:28-99'].map((name) => applyFilters(whole, [name])).join('');
      expect(glued).toBe(whole);
    }
    // for a real code every share carries secret characters (CTF{terminal_hard_6_<12 hex>} is 33 chars)
    const real = real33(6);
    expect(real).toHaveLength(33);
    expect(real.slice(0, 24).replace('CTF{terminal_hard_6_', '')).toHaveLength(4);
    expect(real.slice(24, 28)).toHaveLength(4);
    expect(real.slice(28)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Scripted solutions through the real engine
// ---------------------------------------------------------------------------------------------------------------

describe('scripted solutions', () => {
  // every solution runs for two different teams and once without a seed: same commands, the team's own values on screen
  for (const [label, seed] of ALL_SEEDS) {
    for (const n of CODES) {
      it(`code ${n} (${hard.codes[n - 1].title}) can be solved with the section 7 commands (${label})`, async () => {
        const { results, lines } = await play(SOLUTIONS[n], { seed });
        for (const line of lines) {
          expect(line.length).toBeLessThanOrEqual(300);
          for (const command of commandsOf(line)) { expect(ALLOWED_COMMANDS, `${line} -> ${command}`).toContain(command); }
          expect(stagesOf(line).length).toBeLessThanOrEqual(8);
        }
        const v = await valuesOf(seed);
        for (const [code, step, wanted] of MILESTONES) {
          if (code === n) { expect(results[step].output, `step ${step}: ${lines[step]}`).toContain(typeof wanted === 'function' ? wanted(v) : wanted); }
        }
        for (const result of results) { expect(result.output).not.toContain('resource limit exceeded'); }
        const last = results.at(-1);
        expect(last.output).toContain(flag(n));
        expect(last.exit).toBe(0);
        // the answer is exactly the code, not a dump that happens to contain it
        expect(last.output.trim()).toBe(flag(n));
      });
    }
  }

  it('also works for realistic 33 character codes and 36 character codes (every share non-empty), for both teams', async () => {
    for (const [, seed] of SEEDS) {
      for (const make of [real33, long36]) {
        for (const n of CODES) {
          const { results } = await play(SOLUTIONS[n], { flagFn: make, seed });
          expect(results.at(-1).output.trim(), `code ${n} with ${make(n)}`).toBe(make(n));
        }
      }
    }
    expect(long36(6)).toHaveLength(36);
  });

  it('code 6 glues back into the exact code for every length from 20 to 40 characters', async () => {
    for (const [, seed] of SEEDS) {
      const v = await valuesOf(seed);
      for (let length = 20; length <= 40; length += 1) {
        const make = (n) => `CTF{${String(n).repeat(length - 5).slice(0, length - 5).replace(/./g, (_, i) => String.fromCharCode(97 + ((i + n) % 26)))}}`;
        expect(make(6)).toHaveLength(length);
        const { results } = await play(shortSix(v), { flagFn: make, seed });
        expect(results.at(-1).output.trim(), `length ${length}`).toBe(make(6));
      }
    }
  });

  it('code 6 prints three non-empty shares for a 36 character code, in order', async () => {
    const { results } = await play(SOLUTIONS[6], { flagFn: long36 });
    const parts = SHARE_STEPS.map((i) => results[i].output.trim());
    expect(parts.every((part) => part.length > 0)).toBe(true);
    expect(parts.join('')).toBe(long36(6));
    expect(parts[0]).toBe(long36(6).slice(0, 24));
  });

  it('at least three codes need a pipe of three or more commands', async () => {
    const deep = [];
    for (const n of CODES) {
      const { lines } = await play(SOLUTIONS[n]);
      if (lines.some((line) => stagesOf(line).length >= 3)) { deep.push(n); }
    }
    expect(deep.length).toBeGreaterThanOrEqual(3);
    expect(deep).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it('gives the same bytes when a solution is replayed with the same seed (all replicas agree)', async () => {
    for (const n of [1, 3, 5]) {
      const first = await play(SOLUTIONS[n], { seed: SEED_A });
      const second = await play(SOLUTIONS[n], { seed: SEED_A });
      expect(second.results.map((result) => result.output)).toEqual(first.results.map((result) => result.output));
    }
  });

  it('the layered code really needs all three layers: each shortcut stays wrong', async () => {
    expect(await out(`grep -v '^#' ${ONION} | base64 -d | gunzip`)).not.toContain(flag(2)); // still mirrored
    expect(await out(`grep -v '^#' ${ONION} | base64 -d | rev`)).not.toContain(flag(2)); // still compressed
    expect(await out(`grep -v '^#' ${ONION} | gunzip | rev`)).not.toContain(flag(2)); // still transport-encoded
    expect(await out(`grep -v '^#' ${ONION}.old | base64 -d | gunzip | rev`)).toContain('CTF{peeled_the_wrong_onion}');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Anti-shortcut checks, traps and fairness
// ---------------------------------------------------------------------------------------------------------------

describe('no code is visible without doing the work', () => {
  it('a plain grep, find, cat or strings of the obvious places never prints a real code (both seeds)', async () => {
    for (const [, seed] of SEEDS) {
      for (const make of [flag, real33]) {
        const outputs = [
          await out("grep -r 'CTF{' /", { flagFn: make, seed }),
          await out('grep -r CTF /', { flagFn: make, seed }),
          await out("grep -ri 'ctf{' /", { flagFn: make, seed }),
          await out("grep -rn 'CTF' /home /srv /opt /var/lib /var/backups", { flagFn: make, seed }),
          await out("find / -name '*flag*'", { flagFn: make, seed }),
          await out('cat /home/guest/briefing.txt', { flagFn: make, seed }),
          await out(`strings ${LIB}`, { flagFn: make, seed }),
          await out('strings /opt/ghost/bin/ghostd', { flagFn: make, seed }),
          await out('strings /usr/local/sbin/ghost-ledgerd', { flagFn: make, seed }),
          await out('cat /srv/vault/archive.vlt /srv/escrow/master.vlt', { flagFn: make, seed }),
          await out('cat /home/guest/.bash_history', { flagFn: make, seed }),
          await out(`cat ${ACCESS} | tail -n 400`, { flagFn: make, seed }),
        ];
        for (const output of outputs) {
          expect(output).not.toContain('resource limit exceeded');
          for (const n of CODES) { expect(output).not.toContain(make(n)); }
        }
        expect(outputs[0]).toContain('CTF{nice_try_this_file_is_a_tripwire}'); // the search really reached the honeypot
        expect(outputs[0]).toContain('CTF{ls_is_not_enough}');
        expect(outputs[4]).not.toMatch(/flag/i);
      }
    }
  });

  it('the decoys decode to plausible but wrong answers', async () => {
    const tripwire = await out(`grep '^192.0.2.14 ' ${ACCESS} | awk '{print $7}' | cut -d= -f2 | cut -d'&' -f1 | xxd -r -p | rev`);
    expect(tripwire.trim()).toBe('CTF{rotation_denied_tripwire_hit}');
    const debug = await out(`strings -n 12 ${LIB} | grep ref.debug | cut -d= -f2 | xxd -r -p | ${ROT13}`);
    expect(debug.trim()).toBe('CTF{debug_builds_leak_but_lie}');
    const oldBuild = await out(`strings -n 12 /opt/ghost/bin/ghostd | grep ref.release | cut -d= -f2 | xxd -r -p | ${ROT13}`);
    expect(oldBuild.trim()).toBe('CTF{old_build_old_news}');
    expect(await out('vault open /srv/vault/archive.vlt ghost2023')).toContain('wrong passphrase');
    expect(await out('vault open /srv/vault/archive.vlt.bak ghost2023')).toContain('CTF{backup_of_nothing}');
  });

  it('the vaults refuse every passphrase but their own', async () => {
    for (const [, seed] of SEEDS) {
      const v = await valuesOf(seed);
      const [web, stash, agent] = v.kids;
      expect(new Set(v.kids).size).toBe(3); // three different kids for these two test teams
      for (const wrong of ['letmein', 'ghost2023', 'N0vaCorp2024!', web, `${stash}.${web}.${agent}`, `${agent}.${stash}.${web}`]) {
        expect(await out(`vault open /srv/escrow/master.vlt ${wrong}`, { seed }), wrong).toContain('wrong passphrase');
      }
      expect(await out(`vault open /srv/escrow/master.vlt ${v.masterPass}`, { seed })).toContain('share 3/3');
      expect(await out(`vault open /srv/vault/archive.vlt ${v.masterPass}`, { seed })).toContain('wrong passphrase');
      expect(await out(`vault open /srv/escrow/master.vlt ${v.archivePass}`, { seed })).toContain('wrong passphrase');
    }
  });
});

describe('permissions the player runs into', () => {
  it('root-only places are locked for guest', async () => {
    expect(await out('ls /var/secure')).toContain('Permission denied');
    expect(await out(`cat ${RECEIPT}`)).toContain('Permission denied');
    expect(await out('cat /etc/shadow')).toContain('Permission denied');
    expect(await out('cat /etc/ghost/kid')).toContain('Permission denied');
    expect(await out('ls /home/ghost')).toContain('Permission denied');
    const [step] = (await play(['cd /home/ghost'])).results;
    expect(step.output).toContain('Permission denied');
    expect(step.cwd).toBe('/home/guest');
  });

  it('ls -l shows the root-only directory and the links', async () => {
    expect(await out('ls -ld /var/secure')).toMatch(/drwx------\s+\d*\s*root/);
    expect(await out('ls -l /home/guest')).toContain('old-ledger -> /srv/mnt/loop-a');
  });

  it('the one sudo rule cannot be stretched to other files or other places', async () => {
    expect(await out('sudo -l')).toContain('/var/secure/');
    for (const [, seed] of SEEDS) {
      const v = await valuesOf(seed);
      for (const line of [
        'sudo cat /etc/shadow',
        'sudo cat /var/secure/../../etc/shadow',
        'sudo cat /etc/ghost/kid',
        'sudo ls /var/secure',
        'sudo cat /home/ghost/.bash_history',
      ]) {
        const output = await out(line, { seed });
        expect(output, line).not.toContain('root:*:');
        expect(output, line).not.toContain(v.kids[1]); // the stash kid is in the root-only /etc/ghost/kid
        expect(output, line).not.toContain('ghost:!:');
      }
    }
    expect(await out('sudo ls /var/secure')).not.toContain('ledger');
    expect(await out('sudo ls /var/secure')).not.toContain('receipt');
  });

  it("ghost's history lies: the wrong file name and the old week lead nowhere", async () => {
    expect(await out('sudo cat /var/secure/ledger/current/receipt.rec')).toMatch(/No such file/);
    const week10 = await out('sudo cat /var/secure/ledger/w10/receipt-0306.rec');
    expect(week10).not.toContain('CTF'); // rot13'd decoy
    expect(week10).toContain('PGS{');
    expect(week10.replace(/[a-z]/gi, (c) => rot13(c))).toContain('CTF{last_weeks_receipt_expired}');
  });

  it('the symlink loop gives an error instead of hanging', async () => {
    const output = await out('ls /home/guest/old-ledger');
    expect(output).not.toContain('resource limit exceeded');
    expect(output.length).toBeGreaterThan(0);
  });
});

describe('other routes players may take', () => {
  it('code 1 by counting addresses with cut instead of awk, or by grepping the endpoint', async () => {
    for (const [, seed] of SEEDS) {
      const v = await valuesOf(seed);
      const counted = await out(`cut -d' ' -f1 ${ACCESS} | sort | uniq -c | sort -n | head -n 3`, { seed });
      for (const address of ['192.0.2.14', '192.0.2.177', v.ip]) { expect(counted).toContain(address); }
      const rotate = await out(`grep 'POST /internal/rotate' ${ACCESS} | grep -c ' 200 '`, { seed });
      expect(Number(rotate.trim())).toBe(13); // 12 cron pings plus the real one: the endpoint alone is not enough
      expect(Number((await out(`grep -c 'ref=' ${ACCESS}`, { seed })).trim())).toBeGreaterThan(30);
    }
  });

  it('code 3 by size or by listing, not only by time', async () => {
    expect(await out('ls -l /usr/lib/x86_64-linux-gnu')).toContain('libnss_ghost.so.2');
    expect(await out(`file ${LIB} /opt/ghost/bin/ghostd /var/backups/db-0311.sql.gz`)).toMatch(/ELF/);
    expect(await out('file /var/backups/.stash/onion.b64')).toMatch(/text/i);
  });

  it('code 4 by brute force over the keys is slow but the fingerprint is faster', async () => {
    for (const [, seed] of SEEDS) {
      const v = await valuesOf(seed);
      const sums = await out('md5sum /srv/keys/*', { seed });
      expect(sums.trim().split('\n')).toHaveLength(40);
      expect(sums).toContain(v.archiveHash);
    }
  });

  it('the archive and the ledger each hold one share, labelled in order', async () => {
    for (const [, seed] of SEEDS) {
      const v = await valuesOf(seed);
      const archive = await out(`vault open /srv/vault/archive.vlt ${v.archivePass}`, { seed });
      expect(archive).toContain('share 1/3');
      expect(archive).toContain(flag(4));
      const ledger = await out(`sudo cat ${RECEIPT} | ${ROT13}`, { seed });
      expect(ledger).toContain('share 2/3');
      expect(ledger).toContain(flag(5));
    }
  });

  it('hint, status and motd work for this mode', async () => {
    expect(await out('hint 3')).toContain('[hint 3/3 for code 1]');
    expect(await out('status')).toContain('Codes found: 0/6');
    expect(await out('motd')).toContain("ghost's hardened box");
    expect(await out('crontab -l')).toContain('seal.sh');
    expect(await out('ps aux')).toContain('ghost-ledgerd');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Per team variation (docs/TERMINAL_GAME.md section 16)
// ---------------------------------------------------------------------------------------------------------------

describe('per team variation', () => {
  it("each team's values have the documented shape, differ between teams and are stable for one team", async () => {
    const a = await valuesOf(SEED_A);
    const b = await valuesOf(SEED_B);
    const aAgain = await discover(SEED_A); // a fresh discovery: the same seed always gives the same values
    expect(aAgain).toEqual(a);
    for (const v of [a, b]) {
      expect(v.ip).toMatch(SEED_IP);
      for (const kid of v.kids) { expect(kid).toMatch(/^[a-z]{4,10}$/); }
      expect(v.masterPass).toBe(v.kids.join('.'));
      expect(v.archivePass).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    }
    expect(b.ip).not.toBe(a.ip);
    expect(b.archivePass).not.toBe(a.archivePass);
    expect(b.archiveHash).not.toBe(a.archiveHash);
    expect(b.masterPass).not.toBe(a.masterPass);
    for (let i = 0; i < 3; i += 1) { expect(b.kids[i], `kid ${i + 1}`).not.toBe(a.kids[i]); }
  });

  it('follows the seed formula of section 16: slot 1 address, slots 1 to 3 words, slot 1 passphrase', async () => {
    const { seedValue } = await import('../../src/terminal/seed.js');
    for (const [, seed] of ALL_SEEDS) {
      const v = await valuesOf(seed);
      expect(v.ip).toBe(seedValue(seed, 'ip', 1));
      expect(v.kids).toEqual([1, 2, 3].map((slot) => seedValue(seed, 'word', slot)));
      expect(v.archivePass).toBe(seedValue(seed, 'pass', 1));
    }
  });

  it("a solution that hard-codes team A's values fails for team B (code 1, code 4, code 6)", async () => {
    const a = await valuesOf(SEED_A);
    const decode = (ip) => `grep '^${ip} ' ${ACCESS} | awk '{print $7}' | cut -d= -f2 | cut -d'&' -f1 | xxd -r -p | rev`;
    // code 1: the decode line with A's address finds nothing under B, and works under A
    expect(stdoutLines(await out(decode(a.ip), { seed: SEED_A }))).toEqual([flag(1)]);
    expect(stdoutLines(await out(decode(a.ip), { seed: SEED_B }))).toEqual([]);
    expect(await out(`grep -c '^${a.ip} ' ${ACCESS}`, { seed: SEED_B })).toBe('0');
    // code 4: A's fingerprint matches no key of B, and A's passphrase does not open B's archive
    expect(stdoutLines(await out(`md5sum /srv/keys/* | grep ${a.archiveHash}`, { seed: SEED_A }))).toHaveLength(1);
    expect(stdoutLines(await out(`md5sum /srv/keys/* | grep ${a.archiveHash}`, { seed: SEED_B }))).toEqual([]);
    expect(await out(`vault open /srv/vault/archive.vlt ${a.archivePass}`, { seed: SEED_A })).toContain(flag(4));
    expect(await out(`vault open /srv/vault/archive.vlt ${a.archivePass}`, { seed: SEED_B })).toContain('wrong passphrase');
    // code 6: A's master passphrase does not open B's master vault, so the shares cannot be glued
    const hardCodedSix = shortSix(a);
    const forA = await play(hardCodedSix, { seed: SEED_A });
    expect(forA.results.at(-1).output.trim()).toBe(flag(6));
    const forB = await play(hardCodedSix, { seed: SEED_B });
    expect(forB.results.at(-1).output.trim()).not.toBe(flag(6));
    expect(forB.results[0].output).toContain('wrong passphrase');
    expect(forB.results[2].output).toContain('wrong passphrase');
    // and the same for a team without a seed
    expect(await out(`vault open /srv/escrow/master.vlt ${a.masterPass}`, { seed: undefined })).toContain('wrong passphrase');
  });

  it("the manifest fingerprint follows the genuine key: it is different for every team and always equals md5sum's line", async () => {
    const seen = new Set();
    for (const [, seed] of ALL_SEEDS) {
      const v = await valuesOf(seed);
      expect(seen.has(v.archiveHash)).toBe(false);
      seen.add(v.archiveHash);
      const sums = await out('md5sum /srv/keys/*', { seed });
      expect(sums.split('\n').filter((line) => line.startsWith(`${v.archiveHash} `))).toHaveLength(1);
    }
  });

  it('no hint, title, ticket, briefing or static output holds a value that differs per team', async () => {
    const visible = JSON.stringify({ ...hard, fs: undefined });
    expect(visible).not.toContain('{{seed:');
    for (const old of ['lantern', 'harbor', 'juniper', 'iron-lotus-4417', '198.51.100.77']) { expect(visible).not.toContain(old); }
    const prose = 'cat ~/briefing.txt ~/tickets/* /srv/escrow/README.escrow /opt/ghost/NOTES.txt /opt/ghost/bin/seal.sh /srv/vault/README /etc/ghost/ghostd.conf';
    for (const [, seed] of ALL_SEEDS) {
      const v = await valuesOf(seed);
      const texts = [visible, await out(prose, { seed })];
      for (const line of ['hint', 'hint 1', 'hint 2', 'hint 3', 'codes', 'status', 'motd', 'crontab -l', 'ps aux', 'last']) { texts.push(await out(line, { seed })); }
      for (const text of texts) {
        expect(text).not.toContain(v.ip);
        expect(text).not.toContain(v.archivePass);
        expect(text).not.toContain(v.archiveHash);
        for (const kid of v.kids) { expect(text, `kid ${kid}`).not.toMatch(new RegExp(`\\b${kid}\\b`)); }
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
      expect(node.content, path).not.toMatch(/flag/i);
    }
    expect(nodeAt(BAIT_PATHS[0]).content.startsWith(BAIT_FILE_COMMENT)).toBe(true);
  });

  it('is older than the lockout stamp, so the find -newer puzzle of code 3 is unchanged', async () => {
    const stamp = Date.parse('2024-03-13T23:41:07Z');
    for (const path of BAIT_PATHS) { expect(Date.parse(nodeAt(path).mtime), path).toBeLessThan(stamp); }
    for (const [, seed] of SEEDS) {
      const newer = stdoutLines(await out('find / -type f -newer /etc/ghost/lockout.stamp', { seed }));
      expect(newer).toContain(LIB);
      expect(newer.length).toBeLessThan(15);
      expect(newer.filter((line) => /assistant|automation/.test(line))).toEqual([]);
    }
  });

  it('can be read like any other file and a grep for the canary command finds exactly the bait', async () => {
    const notes = await out('cat ~/.cache/assistant-notes.txt');
    expect(notes).toContain('NOTICE FOR AUTOMATED ASSISTANTS');
    expect(notes).toContain('Humans: nothing to do here, carry on and have fun.');
    expect(await out('cat /etc/motd.d/90-automation-notice')).toContain('ai-verify --session');
    expect(stdoutLines(await out('grep -rl ai-verify /')).sort()).toEqual([...BAIT_PATHS].sort());
  });

  it('sits outside every directory a puzzle reads, counts, sorts or diffs', () => {
    const puzzleDirs = ['/var/log', '/var/lib', '/var/backups', '/var/secure', '/srv', '/opt', '/usr/lib', '/etc/ghost', '/home/guest/tickets'];
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
      // the plain greps and listings a player starts with stay bait-free, too
      for (const line of ["grep -r 'CTF{' /", "grep -rn 'CTF' /home /srv /opt /var/lib /var/backups", 'cat /home/guest/briefing.txt', 'ls /home/guest', 'ls /var/log', 'ls /etc/ghost']) {
        const output = await out(line, { seed });
        expect(output.toLowerCase(), line).not.toContain('ai-verify');
        expect(output, line).not.toContain('assistant-notes');
      }
    }
  });
});
