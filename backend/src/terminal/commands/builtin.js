// Game builtins: help, man, hint, status/codes, motd.
import { renderTokens } from '../vfs.js';
import { CATEGORIES, MANUAL } from './manual.js';
import { levenshtein } from './util.js';

const GUIDE = `Arena Terminal - beginner guide
================================
You are inside a pretend Linux machine. Look around with real Unix commands and
find hidden CODES that look like CTF{...}. Each code is worth points. When you
find one, submit it with:

    submit CTF{the_code_you_found}

START WITH THESE
  ls              list the files here          (try ls -la to see hidden files)
  cd <folder>     walk into a folder           (cd .. goes up, cd alone goes home)
  pwd             where am I?
  cat <file>      print a file                 (start with the README!)
  hint            a nudge for your next code   (hint 2 / hint 3 = bigger nudges)
  status          how many codes have I found?

`;

const TIPS = `
GOOD TO KNOW
  - Press Tab to complete names, the up arrow to repeat commands, Ctrl+L to clear.
  - Combine commands with a pipe:  grep error log | sort | uniq -c
  - Use man <command> or help <command> for flags and examples.
  - Hidden files start with a dot. ls -a shows them.
  - Sorting is C-locale (byte order): UPPERCASE comes before lowercase.
  - Only /tmp is writable. Files you create there last for one command line only,
    and variables you set last for one command line too.
  - Stuck? Read what you found again. Every clue points to the next step.
`;

function wrap(names, indent = '    ', width = 78) {
  const lines = [];
  let line = indent;
  for (const name of names) {
    if (line.length + name.length + 1 > width && line.trim() !== '') { lines.push(line.trimEnd()); line = indent; }
    line += `${name} `;
  }
  if (line.trim() !== '') lines.push(line.trimEnd());
  return lines.join('\n');
}

const ALIASES = { sha1sum: 'md5sum', sha256sum: 'md5sum', sha512sum: 'md5sum', egrep: 'grep', fgrep: 'grep', gzcat: 'zcat', '[': 'test', logout: 'exit', gawk: 'awk', mawk: 'awk', printenv: 'env' };
const manualFor = (name) => (Object.hasOwn(MANUAL, name) ? MANUAL[name] : Object.hasOwn(ALIASES, name) && Object.hasOwn(MANUAL, ALIASES[name]) ? MANUAL[ALIASES[name]] : null);

function manPage(name, entry) {
  const [synopsis, summary, options, examples] = entry;
  const lines = [`${name.toUpperCase()}(1)`, '', 'NAME', `    ${name} - ${summary}`, '', 'SYNOPSIS', `    ${synopsis}`];
  if (options.length > 0) {
    lines.push('', 'OPTIONS');
    const width = Math.min(26, Math.max(...options.map(([flag]) => flag.length)) + 2);
    for (const [flag, meaning] of options) lines.push(`    ${flag.padEnd(width)}${meaning}`);
  }
  if (examples.length > 0) {
    lines.push('', 'EXAMPLES');
    const width = Math.min(44, Math.max(...examples.map(([cmd]) => cmd.length)) + 2);
    for (const [cmd, meaning] of examples) lines.push(`    ${cmd.padEnd(width)}${meaning}`);
  }
  lines.push('', 'NOTES', '    This is a sandboxed teaching shell: sorting is C-locale and only /tmp is writable.');
  return `${lines.join('\n')}\n`;
}

function help(c) {
  const topic = c.args.find((arg) => !arg.startsWith('-'));
  if (topic) {
    const entry = manualFor(topic);
    if (!entry) {
      if (c.rc.registry.has(topic)) c.out(`${topic}: no short manual here, but the command exists. Try: ${topic} --help\n`);
      else c.err(`help: no help topics match '${topic}'. Try 'help' or 'man -k'.\n`);
      return c.rc.registry.has(topic) ? 0 : 1;
    }
    c.out(manPage(topic, entry));
    return 0;
  }
  const lines = [GUIDE.trimEnd(), '', 'ALL COMMANDS'];
  for (const [title, names] of CATEGORIES) {
    lines.push(`  ${title}:`, wrap(names.split(' ').filter((name) => c.rc.registry.has(name))));
  }
  const extras = [...c.rc.extraNames].sort();
  if (extras.length > 0) lines.push('  extras (just for fun):', wrap(extras));
  lines.push('  files (read-only here, except /tmp):', wrap(['touch', 'mkdir', 'rm', 'cp', 'mv', 'ln', 'chmod', 'tee']));
  c.out(`${lines.join('\n')}\n${TIPS}`);
  return 0;
}

function man(c) {
  const names = c.args.filter((arg) => !arg.startsWith('-'));
  if (names.length === 0) { c.err('What manual page do you want?\nFor example, try \'man ls\'.\n'); return 1; }
  let exit = 0;
  for (const name of names) {
    if (manualFor(name)) c.out(manPage(name, manualFor(name)));
    else if (c.rc.registry.has(name)) c.out(`${name.toUpperCase()}(1)\n\nNAME\n    ${name} - a built-in command of this sandbox\n\nTry:  ${name} --help\n`);
    else {
      c.err(`No manual entry for ${name}\n`);
      const close = Object.keys(MANUAL).filter((candidate) => levenshtein(name, candidate) <= 1);
      if (close.length > 0) c.err(`Did you mean '${close[0]}'?\n`);
      exit = 16;
    }
  }
  return exit;
}

async function loadProgress(c, label) {
  try {
    const progress = typeof c.ctx.progress === 'function' ? await c.ctx.progress() : { solved: [] };
    return new Set(Array.isArray(progress?.solved) ? progress.solved.map(Number) : []);
  } catch {
    c.err(`${label}: could not load your progress, try again in a moment\n`);
    return null;
  }
}

async function hint(c) {
  const codes = Array.isArray(c.rc.mode.codes) ? [...c.rc.mode.codes].sort((a, b) => a.n - b.n) : [];
  let requested = 1;
  if (c.args.length > 0) {
    if (!/^\d+$/.test(c.args[0]) || c.args.length > 1) { c.err(`usage: hint [1-${Math.max(1, ...codes.map((code) => (code.hints ?? []).length))}]\n`); return 2; }
    requested = Number(c.args[0]);
  }
  const solved = await loadProgress(c, 'hint');
  if (!solved) return 1;
  const next = codes.find((code) => !solved.has(code.n));
  if (!next) { c.out('You found every code in this mode. Congratulations! Try another mode for more points.\n'); return 0; }
  const tiers = Array.isArray(next.hints) ? next.hints : [];
  if (tiers.length === 0) { c.out(`No hints are available for code ${next.n}. Look around with ls -la and read everything.\n`); return 0; }
  const tier = Math.min(Math.max(requested, 1), tiers.length);
  c.out(`[hint ${tier}/${tiers.length} for code ${next.n}] ${tiers[tier - 1]}\n`);
  return 0;
}

async function status(c) {
  const codes = Array.isArray(c.rc.mode.codes) ? [...c.rc.mode.codes].sort((a, b) => a.n - b.n) : [];
  const solved = await loadProgress(c, c.name);
  if (!solved) return 1;
  const found = codes.filter((code) => solved.has(code.n)).length;
  const lines = [`Codes found: ${found}/${codes.length}`];
  for (const code of codes) lines.push(solved.has(code.n) ? `[x] ${code.n}  ${code.title}` : `[ ] ${code.n}  ???`);
  c.out(`${lines.join('\n')}\n`);
  return 0;
}

function motd(c) {
  const text = renderTokens(String(c.rc.mode.motd ?? ''), c.rc.flag);
  c.out(text === '' || text.endsWith('\n') ? text : `${text}\n`);
  return 0;
}

export const commands = { help, man, hint, status, codes: status, motd };
