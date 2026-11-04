// `sed`: s///[g|p|i|N], p d q Q = y a i c, addresses N, $, /re/, N,M, /re/,/re/, and `!`. In-place edits are refused.
import { PatternError, compilePattern, globalRegExp, matchesLine } from '../regex.js';
import {
  asText, forEachInput, joinLines, parseArgs, pushAll, splitLines, usageError,
} from './util.js';

class SedError extends Error {}

function unescapeTabs(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === '\\' && i + 1 < pattern.length) {
      if (pattern[i + 1] === 't') out += '\t';
      else out += pattern[i] + pattern[i + 1];
      i += 1;
    } else out += pattern[i];
  }
  return out;
}

function parseScript(script, { extended }) {
  const commands = [];
  let i = 0;
  const fail = (message) => { throw new SedError(`-e expression #1, char ${i}: ${message}`); };
  const skipSpace = () => { while (i < script.length && /[ \t]/.test(script[i])) i += 1; };
  const compile = (pattern, ignoreCase) => {
    try {
      return compilePattern(unescapeTabs(pattern), { flavor: extended ? 'ere' : 'bre', ignoreCase });
    } catch (error) {
      if (error instanceof PatternError) throw new SedError(error.message);
      throw error;
    }
  };
  const readDelimited = (delim) => {
    let out = '';
    while (i < script.length) {
      const ch = script[i];
      if (ch === '\\' && i + 1 < script.length) {
        if (script[i + 1] === delim) out += delim;
        else if (script[i + 1] === 'n') out += '\n';
        else out += ch + script[i + 1];
        i += 2;
        continue;
      }
      if (ch === delim) { i += 1; return out; }
      out += ch;
      i += 1;
    }
    return null;
  };
  const readAddress = () => {
    if (/\d/.test(script[i] ?? '')) {
      let num = '';
      while (/\d/.test(script[i] ?? '')) { num += script[i]; i += 1; }
      return { type: 'line', n: Number(num) };
    }
    if (script[i] === '$') { i += 1; return { type: 'last' }; }
    if (script[i] === '/') {
      i += 1;
      const pattern = readDelimited('/');
      if (pattern === null) fail('unterminated address regex');
      let ignoreCase = false;
      if (script[i] === 'I') { ignoreCase = true; i += 1; }
      return { type: 're', compiled: compile(pattern, ignoreCase) };
    }
    return null;
  };

  while (i < script.length) {
    while (i < script.length && /[\s;]/.test(script[i])) i += 1;
    if (i >= script.length) break;
    const cmd = { addr1: null, addr2: null, negate: false, active: false };
    cmd.addr1 = readAddress();
    if (cmd.addr1 && script[i] === ',') {
      i += 1;
      cmd.addr2 = readAddress();
      if (!cmd.addr2) fail('unexpected `,\'');
    }
    skipSpace();
    while (script[i] === '!') { cmd.negate = true; i += 1; skipSpace(); }
    const letter = script[i];
    if (letter === undefined) fail('missing command');
    i += 1;
    if (letter === 's') {
      const delim = script[i];
      if (delim === undefined || delim === '\n' || delim === '\\') fail('unterminated `s\' command');
      i += 1;
      const pattern = readDelimited(delim);
      if (pattern === null) fail('unterminated `s\' command');
      const replacement = [];
      let literal = '';
      let closed = false;
      while (i < script.length) {
        const ch = script[i];
        if (ch === '\\' && i + 1 < script.length) {
          const next = script[i + 1];
          i += 2;
          if (/[0-9]/.test(next)) { if (literal) replacement.push(literal); literal = ''; replacement.push({ ref: Number(next) }); }
          else if (next === 'n') literal += '\n';
          else if (next === 't') literal += '\t';
          else literal += next;
          continue;
        }
        if (ch === delim) { i += 1; closed = true; break; }
        if (ch === '&') { if (literal) replacement.push(literal); literal = ''; replacement.push({ ref: 0 }); } else literal += ch;
        i += 1;
      }
      if (!closed) fail('unterminated `s\' command');
      if (literal) replacement.push(literal);
      let global = false;
      let print = false;
      let ignoreCase = false;
      let nth = 0;
      while (i < script.length && !/[;\n}]/.test(script[i])) {
        const flag = script[i];
        if (flag === 'g') global = true;
        else if (flag === 'p') print = true;
        else if (flag === 'i' || flag === 'I') ignoreCase = true;
        else if (/[0-9]/.test(flag)) { let num = flag; while (/[0-9]/.test(script[i + 1] ?? '')) { i += 1; num += script[i]; } nth = Number(num); }
        else if (flag === ' ') { /* ignore */ } else fail('unknown option to `s\'');
        i += 1;
      }
      const compiled = compile(pattern, ignoreCase);
      for (const part of replacement) if (typeof part === 'object' && part.ref > compiled.groups) fail(`invalid reference \\${part.ref} on \`s' command's RHS`);
      Object.assign(cmd, { type: 's', compiled, replacement, global, print, nth });
    } else if (letter === 'y') {
      const delim = script[i];
      i += 1;
      const from = readDelimited(delim);
      const to = from === null ? null : readDelimited(delim);
      if (from === null || to === null) fail('unterminated `y\' command');
      if (Array.from(from).length !== Array.from(to).length) fail('strings for `y\' command are different lengths');
      cmd.type = 'y';
      cmd.map = new Map(Array.from(from).map((ch, index) => [ch, Array.from(to)[index]]));
    } else if (['p', 'd', '=', 'q', 'Q'].includes(letter)) {
      cmd.type = letter;
      if (letter === 'q' || letter === 'Q') {
        skipSpace();
        let num = '';
        while (/\d/.test(script[i] ?? '')) { num += script[i]; i += 1; }
        cmd.exit = Number(num || 0);
      }
    } else if (['a', 'i', 'c'].includes(letter)) {
      skipSpace();
      if (script[i] === '\\') { i += 1; if (script[i] === '\n') i += 1; skipSpace(); }
      let text = '';
      while (i < script.length && script[i] !== '\n') { text += script[i]; i += 1; }
      cmd.type = letter;
      cmd.text = text;
    } else if (letter === '{' || letter === '}') {
      fail('blocks ({ }) are not supported in this sandbox');
    } else {
      fail(`unknown command: \`${letter}'`);
    }
    skipSpace();
    if (i < script.length && !/[;\n}]/.test(script[i])) fail('extra characters after command');
    commands.push(cmd);
  }
  return commands;
}

function substitute(line, cmd) {
  const re = globalRegExp(cmd.compiled);
  let out = '';
  let last = 0;
  let count = 0;
  let previousEnd = -1;
  let replaced = false;
  let match = re.exec(line);
  while (match !== null) {
    if (match[0] === '' && match.index === previousEnd) {
      re.lastIndex = match.index + 1;
      if (re.lastIndex > line.length) break;
      match = re.exec(line);
      continue;
    }
    count += 1;
    const wanted = cmd.nth > 0 ? (cmd.global ? count >= cmd.nth : count === cmd.nth) : true;
    if (wanted) {
      out += line.slice(last, match.index);
      for (const part of cmd.replacement) out += typeof part === 'string' ? part : (match[part.ref] ?? '');
      last = match.index + match[0].length;
      replaced = true;
      if (!cmd.global) break;
    }
    previousEnd = match.index + match[0].length;
    if (match[0] === '') { re.lastIndex = match.index + 1; if (re.lastIndex > line.length + 1) break; }
    match = re.exec(line);
  }
  return { text: out + line.slice(last), replaced };
}

function sed(c) {
  const parsed = parseArgs(c.args, {
    flags: 'nEriszu', values: 'ef', long: { quiet: 'n', silent: 'n', expression: 'e', 'regexp-extended': 'E', 'in-place': { key: 'i', arg: 'optional' }, file: 'f', separate: 's' },
  });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  if (opts.i) { c.err('sed: couldn\'t open temporary file ./sedBA0Q3x: Read-only file system\n'); return 4; }
  if (opts.f) { c.err('sed: script files (-f) are not supported in this sandbox\n'); return 1; }
  const operands = [...parsed.operands];
  const scripts = parsed.all.e ? [...parsed.all.e] : [];
  if (scripts.length === 0) {
    if (operands.length === 0) { c.err('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n'); return 1; }
    scripts.push(operands.shift());
  }
  let commands;
  try {
    commands = parseScript(scripts.join('\n'), { extended: Boolean(opts.E || opts.r) });
  } catch (error) {
    if (error instanceof SedError) { c.err(`sed: ${error.message}\n`); return 1; }
    throw error;
  }
  const lines = [];
  const failures = forEachInput(c, 'sed', operands, (buf) => { pushAll(lines, splitLines(asText(buf))); });
  c.rc.tickLines(lines.length * (1 + commands.length));
  const out = [];
  let quitCode = null;
  const matchAddr = (addr, lineNo, isLast, line) => {
    if (addr.type === 'line') return lineNo === addr.n;
    if (addr.type === 'last') return isLast;
    return matchesLine(addr.compiled, line);
  };
  for (let index = 0; index < lines.length && quitCode === null; index += 1) {
    let pattern = lines[index];
    const lineNo = index + 1;
    const isLast = index === lines.length - 1;
    let deleted = false;
    const appended = [];
    for (const cmd of commands) {
      let selected;
      if (!cmd.addr1) selected = true;
      else if (!cmd.addr2) selected = matchAddr(cmd.addr1, lineNo, isLast, pattern);
      else if (cmd.active) {
        selected = true;
        if (cmd.addr2.type === 'line' ? lineNo >= cmd.addr2.n : matchAddr(cmd.addr2, lineNo, isLast, pattern)) cmd.active = false;
      } else if (matchAddr(cmd.addr1, lineNo, isLast, pattern)) {
        selected = true;
        cmd.active = !(cmd.addr2.type === 'line' ? lineNo >= cmd.addr2.n : cmd.addr2.type === 'last' && isLast);
      } else selected = false;
      if (selected === cmd.negate) continue;
      if (cmd.type === 's') {
        const result = substitute(pattern, cmd);
        pattern = result.text;
        if (result.replaced && cmd.print) out.push(pattern);
      } else if (cmd.type === 'p') out.push(pattern);
      else if (cmd.type === 'd') { deleted = true; break; }
      else if (cmd.type === '=') out.push(String(lineNo));
      else if (cmd.type === 'y') pattern = Array.from(pattern, (ch) => (cmd.map.has(ch) ? cmd.map.get(ch) : ch)).join('');
      else if (cmd.type === 'i') out.push(cmd.text);
      else if (cmd.type === 'a') appended.push(cmd.text);
      else if (cmd.type === 'c') { deleted = true; if (!cmd.addr2 || !cmd.active) out.push(cmd.text); break; }
      else if (cmd.type === 'q') { if (!opts.n) out.push(pattern); deleted = true; quitCode = cmd.exit; break; }
      else if (cmd.type === 'Q') { deleted = true; quitCode = cmd.exit; break; }
    }
    if (!deleted && !opts.n) out.push(pattern);
    out.push(...appended);
  }
  c.out(joinLines(out));
  if (failures > 0) return 2;
  return quitCode ?? 0;
}

export const commands = { sed };
