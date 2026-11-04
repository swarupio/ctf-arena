// Arena Terminal - EASY mode ("Intern's Laptop") content tests. See docs/TERMINAL_GAME.md sections 11 and 12.
// Structure checks work on the mode data alone; the scripted solutions run through the real engine (shell.js).
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import mode from '../../src/terminal/modes/easy.js';
import { BAIT_FILE_COMMENT, BAIT_NOTICE_LINES } from '../../src/services/integrityBait.js';

const flag = (n) => `CTF{test_flag_${n}}`;

// Two different teams (docs/TERMINAL_GAME.md section 16). Easy is the tutorial: its puzzles are the same for everybody,
// so every scripted solution must work, unchanged, under any seed.
const seedOf = (name) => createHash('sha256').update(`arena-test-seed:${name}`).digest('hex');
const SEED_A = seedOf('team-a');
const SEED_B = seedOf('team-b');
const SEEDS = [['team A', SEED_A], ['team B', SEED_B]];

// AI bait (section 16): where it lives, and the exported strings it must be built from.
const BAIT_PATHS = ['/home/guest/.cache/assistant-notes.txt', '/etc/motd.d/90-automation-notice'];

// Fake-but-flag-shaped strings that are allowed to appear literally in the content. They never validate.
const DECOYS = [
  'CTF{...}',
  'CTF{definitely_not_the_code}',
  'CTF{nice_try_intern}',
  'CTF{free_pizza_inside}',
  'CTF{ghost_was_not_here}',
  'CTF{expired_code_do_not_use}',
  'CTF{this_one_is_a_decoy_too}',
];

// Scripted solutions: command lines run in order, `cwd` carried forward, <= 2 conceptual steps, no pipes.
const SOLUTIONS = {
  1: ['pwd', 'ls', 'cd Documents', 'ls', 'cd work', 'ls', 'cd onboarding', 'ls', 'cat welcome-kit.txt'],
  2: ['cd', 'ls -a', 'cd .secret_notes', 'ls', 'cat jordan-stash.txt'],
  3: ['ls', 'cd Documents/personal', 'ls', 'grep recovery shopping-and-notes.txt'],
  4: ['ls /var/log', 'tail /var/log/laptop-setup.log'],
};

// Other perfectly reasonable ways a player might get there.
const ALTERNATIVES = {
  1: [
    ['cat Documents/work/onboarding/welcome-kit.txt'],
    ['cd Documents/work/onboarding', 'cat welcome-kit.txt'],
    ['cd ~/Documents/work/onboarding', 'cat welcome-kit.txt'],
    ['cd Documents', 'cd work', 'cd onboarding', 'cat welcome-kit.txt'],
  ],
  2: [
    ['ls -a', 'cat .secret_notes/jordan-stash.txt'],
    ['cat .secret_notes/*'],
    ['cat .bash_history', 'cd .secret_notes', 'cat jordan-stash.txt'],
    ['cd .secret_notes', 'cat jordan-stash.txt'],
  ],
  3: [
    ['grep -n recovery Documents/personal/shopping-and-notes.txt'],
    ['grep -i code ~/Documents/personal/shopping-and-notes.txt'],
    ['cd Documents/personal', 'grep ghost shopping-and-notes.txt'],
    ['cat .bash_history', 'grep recovery Documents/personal/shopping-and-notes.txt'],
  ],
  4: [
    ['tail -n 5 /var/log/laptop-setup.log'],
    ['cd /var/log', 'tail laptop-setup.log'],
    ['grep recovery /var/log/laptop-setup.log'],
  ],
};

const TAUGHT_COMMANDS = new Set(['ls', 'cd', 'pwd', 'cat', 'head', 'tail', 'grep']);

// ---------------------------------------------------------------------------------------------------------------
// VFS helpers (data only)
// ---------------------------------------------------------------------------------------------------------------

function walk(node, path, visit) {
  visit(node, path);
  if (node.type === 'dir') {
    for (const [name, child] of Object.entries(node.children)) {
      walk(child, path === '/' ? `/${name}` : `${path}/${name}`, visit);
    }
  }
}

function allNodes() {
  const nodes = [];
  walk(mode.fs, '/', (node, path) => nodes.push({ node, path }));
  return nodes;
}

const textFiles = () => allNodes().filter(({ node }) => node.type === 'file' && typeof node.content === 'string');

function resolveNode(path, depth = 0) {
  let current = mode.fs;
  let here = '/';
  const expanded = path.startsWith('~') ? `${mode.home}${path.slice(1)}` : path;
  for (const part of expanded.split('/').filter(Boolean)) {
    if (current.type !== 'dir' || !Object.hasOwn(current.children, part)) return null;
    current = current.children[part];
    here = here === '/' ? `/${part}` : `${here}/${part}`;
    if (current.type === 'link') {
      if (depth > 8) return null;
      current = resolveNode(current.target, depth + 1);
      if (!current) return null;
    }
  }
  return current;
}

// ---------------------------------------------------------------------------------------------------------------
// Static structure and content rules
// ---------------------------------------------------------------------------------------------------------------

describe('easy mode definition', () => {
  it('has the contract fields', () => {
    expect(mode.mode).toBe('easy');
    expect(mode.difficulty).toBe('easy');
    expect(mode.title).toBe("Intern's Laptop");
    expect(mode.user).toBe('guest');
    expect(mode.host).toBe('arena');
    expect(mode.home).toBe('/home/guest');
    expect(typeof mode.tagline).toBe('string');
    expect(mode.tagline.length).toBeGreaterThan(5);
    expect(typeof mode.motd).toBe('string');
    expect(mode.motd.length).toBeGreaterThan(20);
    expect(resolveNode(mode.home)?.type).toBe('dir');
  });

  it('has exactly 4 codes worth 40 points each, numbered 1..4, with titles and 3+ hints', () => {
    expect(mode.codes).toHaveLength(4);
    expect(mode.codes.map((code) => code.n)).toEqual([1, 2, 3, 4]);
    for (const code of mode.codes) {
      expect(code.points).toBe(40);
      expect(typeof code.title).toBe('string');
      expect(code.title.length).toBeGreaterThan(3);
      expect(code.hints.length).toBeGreaterThanOrEqual(3);
      for (const hint of code.hints) {
        expect(typeof hint).toBe('string');
        expect(hint.length).toBeGreaterThan(10);
      }
    }
    expect(new Set(mode.codes.map((code) => code.title)).size).toBe(4);
  });

  it('keeps the boot text short and ending with the begin prompt', () => {
    expect(mode.lore.length).toBeLessThanOrEqual(14);
    expect(mode.lore.length).toBeGreaterThanOrEqual(6);
    expect(mode.lore.at(-1)).toBe('Type help to begin.');
    for (const line of mode.lore) expect(line.length).toBeLessThanOrEqual(100);
  });

  it('never mentions a club name and uses the prompt guest@arena', () => {
    const everything = JSON.stringify(mode).toLowerCase();
    expect(everything).not.toContain('gdgc');
    expect(mode.user).toBe('guest');
  });

  it('stays small and uses plain ASCII text only', () => {
    let size = 0;
    for (const { node } of allNodes()) {
      if (node.type === 'file') size += node.content !== undefined ? node.content.length : node.contentBase64.length;
    }
    expect(size).toBeLessThan(400 * 1024);
    for (const { node, path } of textFiles()) {
      // eslint-disable-next-line no-control-regex
      expect(/^[\n\t\x20-\x7e]*$/.test(node.content), `non-ASCII or control character in ${path}`).toBe(true);
    }
  });

  it('has file modes and owners that make ls -l look real', () => {
    for (const { node, path } of allNodes()) {
      expect(typeof node.mode, path).toBe('number');
      expect(typeof node.owner, path).toBe('string');
      expect(Number.isNaN(Date.parse(node.mtime)), `bad mtime on ${path}`).toBe(false);
    }
    expect(resolveNode('/etc/shadow').mode & 0o004).toBe(0);
    expect(resolveNode('/var/log/laptop-setup.log').mode & 0o004).not.toBe(0);
    expect(resolveNode('/root').mode & 0o005).toBe(0);
    for (const dirPath of ['/', '/etc', '/tmp', '/var/log', '/usr/share/doc', '/home/guest']) {
      expect(resolveNode(dirPath)?.type, dirPath).toBe('dir');
    }
    expect(resolveNode('/etc/motd')?.content).toContain('Intern Laptop 17');
  });
});

describe('easy mode secrets', () => {
  it('has exactly one plain {{flag:N}} token per code and no other flag tokens', () => {
    const found = {};
    for (const { node, path } of textFiles()) {
      for (const match of node.content.matchAll(/\{\{([^}]*)\}\}/g)) {
        expect(match[1], `token in ${path}`).toMatch(/^flag:[1-4]$/); // no filters in easy mode
        const n = Number(match[1].split(':')[1]);
        (found[n] ||= []).push(path);
      }
    }
    expect(Object.keys(found).sort()).toEqual(['1', '2', '3', '4']);
    for (const paths of Object.values(found)) expect(paths).toHaveLength(1);
  });

  it('puts each code where the design says', () => {
    const where = {};
    for (const { node, path } of textFiles()) {
      for (const match of node.content.matchAll(/\{\{flag:([1-4])\}\}/g)) where[match[1]] = path;
    }
    expect(where).toEqual({
      1: '/home/guest/Documents/work/onboarding/welcome-kit.txt',
      2: '/home/guest/.secret_notes/jordan-stash.txt',
      3: '/home/guest/Documents/personal/shopping-and-notes.txt',
      4: '/var/log/laptop-setup.log',
    });
  });

  it('contains no literal CTF{...} string except the allow-listed decoys', () => {
    const seen = new Set();
    for (const { node } of textFiles()) {
      for (const match of node.content.matchAll(/CTF\{[^}]*\}/g)) seen.add(match[0]);
    }
    for (const text of [mode.motd, ...mode.lore, ...mode.codes.flatMap((code) => [code.title, ...code.hints])]) {
      for (const match of text.matchAll(/CTF\{[^}]*\}/g)) seen.add(match[0]);
    }
    for (const found of seen) expect(DECOYS, `un-allow-listed flag-looking string ${found}`).toContain(found);
    // The decoys really exist in the content, so the allow-list is not stale.
    for (const decoy of DECOYS) expect(seen.has(decoy), `decoy ${decoy} is not used anywhere`).toBe(true);
  });

  it('never uses a decoy that equals a real-looking per-team flag', () => {
    for (const decoy of DECOYS) expect(decoy).not.toMatch(/^CTF\{terminal_easy_[1-4]_[0-9a-f]{12}\}$/);
  });
});

describe('easy mode puzzle layout', () => {
  it('hides code 1 exactly three folders below home', () => {
    const where = '/home/guest/Documents/work/onboarding/welcome-kit.txt';
    expect(where.slice(mode.home.length + 1).split('/')).toHaveLength(4); // 3 folders + the file
    expect(resolveNode(where).content).toContain('{{flag:1}}');
  });

  it('hides code 2 in a dot-folder that plain ls would not list', () => {
    const home = resolveNode(mode.home);
    const visible = Object.keys(home.children).filter((name) => !name.startsWith('.'));
    expect(visible).not.toContain('.secret_notes');
    expect(Object.keys(home.children)).toContain('.secret_notes');
    expect(Object.keys(home.children)).toContain('.bash_history');
    expect(resolveNode('~/.bash_history').content).toContain('.secret_notes');
  });

  it('buries code 3 in the middle of a ~150 line file (neither head nor tail shows it)', () => {
    const lines = resolveNode('~/Documents/personal/shopping-and-notes.txt').content.split('\n');
    if (lines.at(-1) === '') lines.pop();
    expect(lines.length).toBeGreaterThanOrEqual(140);
    expect(lines.length).toBeLessThanOrEqual(170);
    const at = lines.findIndex((line) => line.includes('{{flag:3}}'));
    expect(at).toBeGreaterThan(60);
    expect(at).toBeLessThan(lines.length - 20);
    expect(lines[at]).toContain('recovery');
    // grep -i code finds a handful of decoy lines, not the whole file
    expect(lines.filter((line) => /code/i.test(line)).length).toBeGreaterThan(4);
    expect(lines.filter((line) => /code/i.test(line)).length).toBeLessThan(15);
  });

  it('puts code 4 within the last 10 lines of a long log, and nothing interesting at the top', () => {
    const lines = resolveNode('/var/log/laptop-setup.log').content.split('\n');
    if (lines.at(-1) === '') lines.pop();
    expect(lines.length).toBeGreaterThan(100);
    expect(lines.slice(-10).join('\n')).toContain('{{flag:4}}');
    expect(lines.slice(0, 10).join('\n')).not.toContain('{{flag');
  });

  it('only references paths that exist', () => {
    const pathPattern = /(?<![\w./~-])(?:~\/|\/)(?:[\w.-]+\/)*[\w.-]*\.(?:txt|log|sh|md|enc)\b/g;
    const ignore = new Set(['/novacorp.example/']);
    for (const { node, path } of textFiles()) {
      for (const match of node.content.matchAll(pathPattern)) {
        if (ignore.has(match[0])) continue;
        expect(resolveNode(match[0]), `${path} mentions ${match[0]} which does not exist`).not.toBeNull();
      }
    }
    for (const rel of ['mail/01-welcome-from-hr.txt', 'README.txt']) {
      expect(resolveNode(`~/${rel}`), rel).not.toBeNull();
    }
  });

  it('the scripted solutions only use taught commands and no pipes', () => {
    const everyLine = [...Object.values(SOLUTIONS).flat(), ...Object.values(ALTERNATIVES).flat(2)];
    for (const line of everyLine) {
      expect(line).not.toMatch(/[|;&><]/);
      const [cmd] = line.split(' ');
      expect(TAUGHT_COMMANDS.has(cmd), `${cmd} is not taught in easy mode`).toBe(true);
    }
    for (const lines of Object.values(SOLUTIONS)) {
      expect(lines.filter((line) => !/^(ls|pwd|cd)\b/.test(line)).length).toBeLessThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Scripted solutions through the engine
// ---------------------------------------------------------------------------------------------------------------

describe('easy mode scripted solutions (engine)', () => {
  let execute;
  beforeAll(async () => {
    ({ execute } = await import('../../src/terminal/shell.js'));
  });

  async function run(lines, seed = SEED_A) {
    let cwd = mode.home;
    const steps = [];
    for (const line of lines) {
      const ctx = { mode, cwd, flag, seed, progress: async () => ({ solved: [] }) };
      const result = await execute(line, ctx);
      steps.push({ line, ...result });
      cwd = result.cwd;
    }
    return steps;
  }

  for (const [label, seed] of SEEDS) {
    it.each(Object.entries(SOLUTIONS))(`code %s is found by the scripted solution (${label})`, async (n, lines) => {
      const steps = await run(lines, seed);
      for (const step of steps) expect(step.exit, `${step.line} -> ${step.output}`).toBe(0);
      expect(steps.at(-1).output).toContain(flag(Number(n)));
    });
  }

  it('works without a seed too (the engine falls back to its default seed)', async () => {
    for (const [n, lines] of Object.entries(SOLUTIONS)) {
      const steps = await run(lines, undefined);
      expect(steps.at(-1).output).toContain(flag(Number(n)));
    }
  });

  for (const [n, variants] of Object.entries(ALTERNATIVES)) {
    it.each(variants.map((lines) => [lines.join(' ; '), lines]))(`code ${n} also via: %s (both seeds)`, async (_label, lines) => {
      for (const [, seed] of SEEDS) {
        const steps = await run(lines, seed);
        expect(steps.at(-1).output).toContain(flag(Number(n)));
      }
    });
  }

  it('a solution reveals only its own code (no one-command jackpot)', async () => {
    for (const [n, lines] of Object.entries(SOLUTIONS)) {
      for (const [, seed] of SEEDS) {
        const steps = await run(lines, seed);
        const output = steps.map((step) => step.output).join('\n');
        for (const other of [1, 2, 3, 4].filter((m) => m !== Number(n))) {
          expect(output).not.toContain(flag(other));
        }
      }
    }
  });

  it('is the tutorial for everybody: no seed token in the content, every output is identical for both teams', async () => {
    for (const { node, path } of textFiles()) expect(node.content, path).not.toContain('{{seed:');
    for (const lines of Object.values(SOLUTIONS)) {
      const first = await run(lines, SEED_A);
      const second = await run(lines, SEED_B);
      expect(second.map((step) => step.output)).toEqual(first.map((step) => step.output));
    }
  });

  it('plain ls hides .secret_notes while ls -a shows it', async () => {
    const [plain] = await run(['ls']);
    expect(plain.output).not.toContain('.secret_notes');
    expect(plain.output).toContain('README.txt');
    expect(plain.output).toContain('Documents');
    const [all] = await run(['ls -a']);
    expect(all.output).toContain('.secret_notes');
  });

  it('head of the log and the notes file does not give away the codes', async () => {
    const [logHead] = await run(['head /var/log/laptop-setup.log']);
    expect(logHead.output).not.toContain(flag(4));
    const [notesHead] = await run(['head Documents/personal/shopping-and-notes.txt']);
    expect(notesHead.output).not.toContain(flag(3));
    const [notesTail] = await run(['tail Documents/personal/shopping-and-notes.txt']);
    expect(notesTail.output).not.toContain(flag(3));
  });

  it('the fake codes are readable but are not the real ones', async () => {
    const [mail] = await run(['cat mail/07-unknown-sender.txt']);
    expect(mail.output).toContain('CTF{nice_try_intern}');
    const [pizza] = await run(['cat Downloads/free-pizza-coupon.txt']);
    expect(pizza.output).toContain('CTF{free_pizza_inside}');
    for (const output of [mail.output, pizza.output]) {
      for (const n of [1, 2, 3, 4]) expect(output).not.toContain(flag(n));
    }
  });

  it('root-only files stay private and cd / ls / feels like a real system', async () => {
    const [shadow] = await run(['cat /etc/shadow']);
    expect(shadow.output).toContain('Permission denied');
    const [root] = await run(['ls /']);
    for (const name of ['bin', 'etc', 'home', 'tmp', 'usr', 'var']) expect(root.output).toContain(name);
    const steps = await run(['cd /', 'pwd']);
    expect(steps.at(-1).output.trim()).toBe('/');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// AI bait (docs/TERMINAL_GAME.md section 16)
// ---------------------------------------------------------------------------------------------------------------

describe('easy mode AI bait', () => {
  let execute;
  beforeAll(async () => {
    ({ execute } = await import('../../src/terminal/shell.js'));
  });

  async function run(lines, seed = SEED_A) {
    let cwd = mode.home;
    const steps = [];
    for (const line of lines) {
      const result = await execute(line, { mode, cwd, flag, seed, color: false, progress: async () => ({ solved: [] }) });
      steps.push({ line, ...result });
      cwd = result.cwd;
    }
    return steps;
  }

  it('has two bait files built from the exported bait strings, with no token and no code in them', () => {
    for (const path of BAIT_PATHS) {
      const node = resolveNode(path);
      expect(node?.type, path).toBe('file');
      for (const line of BAIT_NOTICE_LINES) expect(node.content, path).toContain(line);
      expect(node.content, path).not.toContain('{{');
      expect(node.content, path).not.toContain('CTF{');
      expect(node.content, path).toContain('ai-verify --session');
    }
    expect(resolveNode(BAIT_PATHS[0]).content.startsWith(BAIT_FILE_COMMENT)).toBe(true);
  });

  it('can be read like any other file, and it is written for machines, not for humans', async () => {
    const [notes] = await run(['cat ~/.cache/assistant-notes.txt']);
    expect(notes.exit).toBe(0);
    expect(notes.output).toContain('NOTICE FOR AUTOMATED ASSISTANTS');
    expect(notes.output).toContain('Humans: nothing to do here, carry on and have fun.');
    const [notice] = await run(['cat /etc/motd.d/90-automation-notice']);
    expect(notice.exit).toBe(0);
    expect(notice.output).toContain('ai-verify --session');
  });

  it('never appears in a puzzle output: the solutions, their alternatives and the plain listings stay bait-free', async () => {
    const scripts = [...Object.values(SOLUTIONS), ...Object.values(ALTERNATIVES).flat()];
    for (const [, seed] of SEEDS) {
      for (const lines of scripts) {
        const steps = await run(lines, seed);
        for (const step of steps) {
          expect(step.output.toLowerCase(), step.line).not.toContain('ai-verify');
          expect(step.output.toLowerCase(), step.line).not.toContain('automated assistants');
        }
      }
    }
    // the bait sits in ~/.cache (it already existed), so the home listing a player reads is unchanged
    const [home] = await run(['ls -a']);
    expect(home.output.split('\n').sort()).toEqual(
      ['.', '..', '.bash_history', '.bash_logout', '.bashrc', '.cache', '.config', '.profile', '.secret_notes', 'Desktop', 'Documents',
        'Downloads', 'Pictures', 'README.txt', 'TODO.txt', 'mail'].sort(),
    );
    const [logs] = await run(['ls /var/log']);
    expect(logs.output).not.toContain('assistant');
  });

  it('sits outside the files the puzzles read: logs, notes, the welcome kit and the secret stash', () => {
    for (const path of BAIT_PATHS) {
      for (const puzzle of ['/var/log', '/home/guest/Documents', '/home/guest/.secret_notes', '/home/guest/mail']) {
        expect(path.startsWith(`${puzzle}/`), `${path} inside ${puzzle}`).toBe(false);
      }
    }
  });
});
