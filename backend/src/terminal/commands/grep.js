// `grep` / `egrep` / `fgrep`. Patterns go through the safe translator in regex.js (never raw `new RegExp`).
import { compileGlob } from '../vfs.js';
import { PatternError, compilePattern, globalRegExp, matchesLine } from '../regex.js';
import { asText, errnoText, parseArgs, pushAll } from './util.js';

const RED = '\x1b[1;31m';
const MAGENTA = '\x1b[35m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

const SPEC = {
  flags: 'ivncrRlLwxEFPoHhqsaIyzUT',
  values: 'eAfBCm',
  numeric: 'C',
  long: {
    'ignore-case': 'i', 'invert-match': 'v', 'line-number': 'n', count: 'c', recursive: 'r', 'dereference-recursive': 'R',
    'files-with-matches': 'l', 'files-without-match': 'L', 'word-regexp': 'w', 'line-regexp': 'x', 'extended-regexp': 'E',
    'fixed-strings': 'F', 'perl-regexp': 'P', 'only-matching': 'o', 'with-filename': 'H', 'no-filename': 'h', quiet: 'q',
    silent: 'q', 'no-messages': 's', text: 'a', regexp: 'e', file: 'f', 'after-context': 'A', 'before-context': 'B',
    context: 'C', 'max-count': 'm', color: { key: 'color', arg: 'optional' }, colour: { key: 'color', arg: 'optional' },
    include: { key: 'include', arg: 'required' }, exclude: { key: 'exclude', arg: 'required' },
    'exclude-dir': { key: 'exclude-dir', arg: 'required' }, 'line-buffered': { key: 'lb', arg: 'none' },
    'binary-files': { key: 'binary-files', arg: 'required' },
  },
};

function usage(c) {
  c.err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n");
  return 2;
}

function grepImpl(c, forced) {
  const parsed = parseArgs(c.args, SPEC);
  if (parsed.error) { c.err(`grep: ${parsed.error}\nUsage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n`); return 2; }
  const { opts } = parsed;
  if (forced === 'E') opts.E = true;
  if (forced === 'F') opts.F = true;
  const operands = [...parsed.operands];
  const patterns = [];
  for (const raw of parsed.all.e ?? []) patterns.push(...String(raw).split('\n'));
  for (const name of parsed.all.f ?? []) {
    const found = c.rc.fs.lookup(name, { cwd: c.rc.cwd });
    if (found.error || found.node.type !== 'file' || !c.rc.fs.canRead(found.node)) {
      c.err(`grep: ${name}: ${errnoText(found.error ?? (found.node.type === 'dir' ? 'EISDIR' : 'EACCES'))}\n`);
      return 2;
    }
    const lines = asText(c.rc.read(found.node)).split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    pushAll(patterns, lines);
  }
  if (!parsed.all.e && !parsed.all.f) {
    if (operands.length === 0) return usage(c);
    patterns.push(...operands.shift().split('\n'));
  }
  let compiled;
  try {
    compiled = compilePattern(patterns, {
      flavor: opts.P ? 'pcre' : opts.E ? 'ere' : 'bre', fixed: Boolean(opts.F),
      ignoreCase: Boolean(opts.i || opts.y), word: Boolean(opts.w), line: Boolean(opts.x),
    });
  } catch (error) {
    if (error instanceof PatternError) { c.err(`grep: ${error.message}\n`); return 2; }
    throw error;
  }
  const colorMode = opts.color === undefined || opts.color === true ? 'auto' : String(opts.color);
  const colored = ['always', 'yes', 'force'].includes(colorMode) || (['auto', 'tty', 'if-tty'].includes(colorMode) && c.tty);
  const paint = (text, code) => (colored ? `${code}${text}${RESET}` : text);
  const recursive = Boolean(opts.r || opts.R);
  const before = Number(opts.B ?? opts.C ?? 0);
  const after = Number(opts.A ?? opts.C ?? 0);
  if (Number.isNaN(before) || Number.isNaN(after) || before < 0 || after < 0) { c.err(`grep: ${opts.A ?? opts.B ?? opts.C}: invalid context length argument\n`); return 2; }
  const maxCount = opts.m === undefined ? Infinity : Number(opts.m);
  if (Number.isNaN(maxCount)) { c.err(`grep: invalid max count\n`); return 2; }
  const contextMode = before > 0 || after > 0;
  const includes = (parsed.all.include ?? []).map((glob) => compileGlob(glob));
  const excludes = (parsed.all.exclude ?? []).map((glob) => compileGlob(glob));
  const excludeDirs = (parsed.all['exclude-dir'] ?? []).map((glob) => compileGlob(glob));
  const implicitDot = operands.length === 0 && recursive;
  const inputs = operands.length > 0 ? operands : [recursive ? '.' : '-'];

  let anySelected = false;
  let hadError = false;
  let quitEarly = false;
  let printedGroup = false; // for the `--` separator between context groups across files
  const outLines = [];
  const emit = (text) => { outLines.push(text); };
  const error = (text) => { if (!opts.s) c.err(text); hadError = true; };

  const processBuffer = (buf, label, showName) => {
    c.rc.tick(1);
    const binaryFile = !opts.a && buf.includes(0);
    const text = asText(buf);
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    c.rc.tickLines(lines.length);
    const name = paint(label, MAGENTA);
    const sep = (ch) => paint(ch, CYAN);
    const linePrefix = (num, ch) => `${showName ? name + sep(ch) : ''}${opts.n ? paint(String(num), GREEN) + sep(ch) : ''}`;
    let count = 0;
    let lastPrinted = -1;
    let afterLeft = 0;
    let selectedHere = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const selected = matchesLine(compiled, line) !== Boolean(opts.v);
      if (selected && count >= maxCount) { if (afterLeft <= 0) break; }
      if (selected && count < maxCount) {
        count += 1;
        selectedHere = true;
        anySelected = true;
        if (opts.q) { quitEarly = true; return; }
        if (opts.l || opts.L) break;
        if (opts.c || binaryFile) continue;
        if (contextMode) {
          const start = Math.max(lastPrinted + 1, i - before);
          if (printedGroup && start > lastPrinted + 1 || (printedGroup && lastPrinted === -1)) emit('--');
          for (let j = start; j < i; j += 1) emit(`${linePrefix(j + 1, '-')}${lines[j]}`);
          printedGroup = true;
        }
        if (opts.o) {
          if (!opts.v) {
            const re = globalRegExp(compiled);
            let match = re.exec(line);
            while (match) {
              if (match[0] === '') re.lastIndex += 1;
              else emit(`${linePrefix(i + 1, ':')}${paint(match[0], RED)}`);
              match = re.exec(line);
            }
          }
        } else if (colored && !opts.v) {
          // Never split a CTF{...} token with colour codes: the client highlights those itself and copy/paste stays clean.
          const spans = [];
          const flagRe = /CTF\{[^}\n]*\}/g;
          for (let f = flagRe.exec(line); f; f = flagRe.exec(line)) spans.push([f.index, f.index + f[0].length]);
          const re = globalRegExp(compiled);
          let out = '';
          let last = 0;
          let match = re.exec(line);
          while (match) {
            if (match[0] === '') { re.lastIndex += 1; match = re.exec(line); continue; }
            const end = match.index + match[0].length;
            const inFlag = spans.some(([from, to]) => match.index < to && end > from);
            out += line.slice(last, match.index) + (inFlag ? match[0] : paint(match[0], RED));
            last = end;
            match = re.exec(line);
          }
          emit(`${linePrefix(i + 1, ':')}${out}${line.slice(last)}`);
        } else emit(`${linePrefix(i + 1, ':')}${line}`);
        lastPrinted = i;
        afterLeft = after;
      } else if (contextMode && afterLeft > 0 && !opts.c && !opts.l && !opts.L && !binaryFile) {
        emit(`${linePrefix(i + 1, '-')}${line}`);
        lastPrinted = i;
        afterLeft -= 1;
      }
    }
    if (opts.c) emit(`${showName ? name + sep(':') : ''}${count}`);
    if (opts.l && selectedHere) emit(name);
    if (opts.L && !selectedHere) emit(name);
    if (binaryFile && selectedHere && !opts.c && !opts.l && !opts.L) emit(`Binary file ${label} matches`);
  };

  const openFile = (operand, node, showName, label) => {
    if (node.type === 'dir') {
      error(`grep: ${operand}: Is a directory\n`);
      return;
    }
    if (!c.rc.fs.canRead(node)) { error(`grep: ${operand}: Permission denied\n`); return; }
    processBuffer(c.rc.read(node), label, showName);
  };

  const forced_H = opts.H ? true : opts.h ? false : null;
  for (const operand of inputs) {
    if (quitEarly) break;
    if (operand === '-') {
      processBuffer(Buffer.from(typeof c.stdin === 'string' ? c.stdin : (c.stdin ?? '')), '(standard input)', forced_H ?? inputs.length > 1);
      continue;
    }
    const found = c.rc.fs.lookup(operand, { follow: true, cwd: c.rc.cwd });
    if (found.error) { error(`grep: ${operand}: ${errnoText(found.error)}\n`); continue; }
    if (found.node.type === 'dir' && recursive) {
      const start = c.rc.fs.lookup(operand, { follow: false, cwd: c.rc.cwd });
      const base = start.node.type === 'link' ? found : start;
      const walker = c.rc.fs.walk(operand, base.path, base.node, {
        follow: Boolean(opts.R),
        onError: (path, code) => {
          if (code === 'ELOOPDIR') error(`grep: warning: ${path}: recursive directory loop\n`);
          else error(`grep: ${path}: ${errnoText(code)}\n`);
        },
      });
      for (const item of walker) {
        if (quitEarly) break;
        const shownPath = implicitDot ? item.path.replace(/^\.\//, '') : item.path;
        const baseName = item.path.slice(item.path.lastIndexOf('/') + 1);
        if (item.node.type === 'dir') {
          if (item.depth > 0 && excludeDirs.some((match) => match(baseName))) item.prune = true;
          continue;
        }
        if (item.node.type === 'link') continue; // -r skips symlinks met while recursing
        if (includes.length > 0 && !includes.some((match) => match(baseName))) continue;
        if (excludes.some((match) => match(baseName))) continue;
        openFile(shownPath, item.node, forced_H ?? true, shownPath);
      }
      continue;
    }
    openFile(operand, found.node, forced_H ?? inputs.length > 1, operand);
  }
  if (outLines.length > 0) c.out(`${outLines.join('\n')}\n`);
  if (hadError && !(opts.q && anySelected)) return 2;
  return anySelected ? 0 : 1;
}

export const commands = {
  grep: (c) => grepImpl(c, null),
  egrep: (c) => grepImpl(c, 'E'),
  fgrep: (c) => grepImpl(c, 'F'),
};
