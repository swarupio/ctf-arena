// `find`: path expression language with -name -iname -type -size -perm -user -mtime -newer -maxdepth
// -mindepth -empty -regex -print -prune. There is no -exec / -delete (the sandbox never writes).
import {
  FIXED_NOW, basenameOf, compileGlob, nodeSize,
} from '../vfs.js';
import { PatternError, compilePattern, matchesLine } from '../regex.js';
import { errnoText, mtimeMs } from './util.js';

const DAY = 86400000;
const UNIT = { c: 1, w: 2, b: 512, k: 1024, M: 1048576, G: 1073741824 };
const BLOCKED = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprintf', '-fls', '-printf', '-ls']);

class FindError extends Error {}

function numericCompare(sign, actual, wanted) {
  if (sign === '+') return actual > wanted;
  if (sign === '-') return actual < wanted;
  return actual === wanted;
}

function parseExpression(c, args, config) {
  let pos = 0;
  let hasAction = false;
  const need = (flag) => {
    if (pos >= args.length) throw new FindError(`missing argument to \`${flag}'`);
    pos += 1;
    return args[pos - 1];
  };
  const stringPredicate = (flag) => {
    const value = need(flag);
    const nocase = flag.startsWith('-i') || flag === '-ipath' || flag === '-iwholename';
    if (flag === '-name' || flag === '-iname') {
      const match = compileGlob(value, { nocase });
      return (item) => match(item.name);
    }
    const match = compileGlob(value, { nocase });
    return (item) => match(item.path);
  };

  const primary = () => {
    const tok = args[pos];
    if (tok === undefined) throw new FindError('invalid expression');
    pos += 1;
    if (tok === '(') {
      const inner = parseOr();
      if (args[pos] !== ')') throw new FindError('unmatched `(\'');
      pos += 1;
      return inner;
    }
    if (BLOCKED.has(tok)) {
      throw new FindError(`'${tok}' is not available in this sandbox (try: find ... | xargs <command>)`);
    }
    switch (tok) {
      case '-name': case '-iname': case '-path': case '-ipath': case '-wholename': case '-iwholename':
        return stringPredicate(tok);
      case '-regex': case '-iregex': {
        const value = need(tok);
        let compiled;
        try { compiled = compilePattern(value, { flavor: 'ere', ignoreCase: tok === '-iregex', line: true }); } catch (error) {
          if (error instanceof PatternError) throw new FindError(`unsupported pattern: '${value}'`);
          throw error;
        }
        return (item) => matchesLine(compiled, item.path);
      }
      case '-type': {
        const value = need(tok);
        const kinds = value.split(',');
        for (const kind of kinds) if (!/^[bcdpfls]$/.test(kind)) throw new FindError(`Unknown argument to -type: ${value}`);
        return (item) => kinds.some((kind) => (kind === 'f' ? item.node.type === 'file' : kind === 'd' ? item.node.type === 'dir' : kind === 'l' && item.node.type === 'link'));
      }
      case '-size': {
        const value = need(tok);
        const match = /^([+-]?)(\d+)([cwbkMG]?)$/.exec(value);
        if (!match) throw new FindError(`invalid argument \`${value}' to \`-size'`);
        const unit = UNIT[match[3] || 'b'];
        return (item) => numericCompare(match[1], Math.ceil(nodeSize(item.node, c.rc.flag) / unit), Number(match[2]));
      }
      case '-perm': {
        const value = need(tok);
        const match = /^([-/+]?)([0-7]{1,4})$/.exec(value);
        if (!match) throw new FindError(`invalid mode \`${value}'`);
        const wanted = parseInt(match[2], 8);
        return (item) => {
          const mode = item.node.mode & 0o7777;
          if (match[1] === '-') return (mode & wanted) === wanted;
          if (match[1] === '/' || match[1] === '+') return wanted === 0 || (mode & wanted) !== 0;
          return mode === wanted;
        };
      }
      case '-user': { const value = need(tok); return (item) => item.node.owner === value; }
      case '-group': { const value = need(tok); return (item) => item.node.group === value; }
      case '-mtime': case '-atime': case '-ctime': {
        const value = need(tok);
        const match = /^([+-]?)(\d+)$/.exec(value);
        if (!match) throw new FindError(`invalid argument \`${value}' to \`${tok}'`);
        return (item) => numericCompare(match[1], Math.floor((FIXED_NOW - mtimeMs(item.node)) / DAY), Number(match[2]));
      }
      case '-mmin': case '-amin': case '-cmin': {
        const value = need(tok);
        const match = /^([+-]?)(\d+)$/.exec(value);
        if (!match) throw new FindError(`invalid argument \`${value}' to \`${tok}'`);
        return (item) => numericCompare(match[1], Math.floor((FIXED_NOW - mtimeMs(item.node)) / 60000), Number(match[2]));
      }
      case '-newer': case '-anewer': case '-cnewer': {
        const value = need(tok);
        const ref = c.rc.fs.lookup(value, { cwd: c.rc.cwd });
        if (ref.error) throw new FindError(`'${value}': ${errnoText(ref.error)}`);
        const refTime = mtimeMs(ref.node);
        return (item) => mtimeMs(item.node) > refTime;
      }
      case '-empty':
        return (item) => (item.node.type === 'dir' ? c.rc.fs.entries(item.phys, item.node).length === 0 : item.node.type === 'file' && nodeSize(item.node, c.rc.flag) === 0);
      case '-readable': return (item) => c.rc.fs.canRead(item.node);
      case '-writable': return (item) => c.rc.fs.canWrite(item.node);
      case '-executable': return (item) => c.rc.fs.canExec(item.node) && (item.node.type === 'dir' || (item.node.mode & 0o111) !== 0);
      case '-true': return () => true;
      case '-false': return () => false;
      case '-print': case '-print0':
        hasAction = true;
        return (item) => { config.emit(item.path, tok === '-print0'); return true; };
      case '-prune': return (item) => { item.prune = true; return true; };
      case '-maxdepth': config.maxDepth = Number(need(tok)); return () => true;
      case '-mindepth': config.minDepth = Number(need(tok)); return () => true;
      case '-depth': case '-mount': case '-xdev': case '-noleaf': case '-ignore_readdir_race': return () => true;
      default:
        throw new FindError(`unknown predicate \`${tok}'`);
    }
  };

  const notExpr = () => {
    if (args[pos] === '!' || args[pos] === '-not') { pos += 1; const inner = notExpr(); return (item) => !inner(item); }
    return primary();
  };
  const andExpr = () => {
    let left = notExpr();
    while (pos < args.length && args[pos] !== '-o' && args[pos] !== '-or' && args[pos] !== ')') {
      if (args[pos] === '-a' || args[pos] === '-and') pos += 1;
      const l = left;
      const r = notExpr();
      left = (item) => l(item) && r(item);
    }
    return left;
  };
  function parseOr() {
    let left = andExpr();
    while (args[pos] === '-o' || args[pos] === '-or') {
      pos += 1;
      const l = left;
      const r = andExpr();
      left = (item) => l(item) || r(item);
    }
    return left;
  }
  if (args.length === 0) return { test: () => true, hasAction: false };
  const test = parseOr();
  if (pos < args.length) throw new FindError(`paths must precede expression: \`${args[pos]}'`);
  return { test, hasAction };
}

export function find(c) {
  let args = [...c.args];
  let follow = false;
  while (args[0] === '-L' || args[0] === '-H' || args[0] === '-P') { follow = follow || args[0] === '-L'; args = args.slice(1); }
  const starts = [];
  while (args.length > 0 && !args[0].startsWith('-') && args[0] !== '!' && args[0] !== '(') starts.push(args.shift());
  if (starts.length === 0) starts.push('.');
  const lines = [];
  const config = {
    maxDepth: Infinity,
    minDepth: 0,
    emit: (path, nul) => { lines.push(path + (nul ? '\0' : '\n')); },
  };
  let expr;
  try {
    expr = parseExpression(c, args, config);
  } catch (error) {
    if (error instanceof FindError) { c.err(`find: ${error.message}\n`); return 1; }
    throw error;
  }
  const printAll = !expr.hasAction;
  let exit = 0;
  for (const start of starts) {
    const found = c.rc.fs.lookup(start, { follow, cwd: c.rc.cwd });
    if (found.error) { c.err(`find: '${start}': ${errnoText(found.error)}\n`); exit = 1; continue; }
    const walker = c.rc.fs.walk(start, found.path, found.node, {
      follow,
      maxDepth: config.maxDepth,
      onError: (path, code) => {
        c.err(code === 'ELOOPDIR' ? `find: File system loop detected; '${path}' is part of the same file system loop.\n` : `find: '${path}': ${errnoText(code)}\n`);
        exit = 1;
      },
    });
    for (const item of walker) {
      if (item.depth === 0) item.name = item.path === '/' ? '/' : item.path.replace(/\/+$/, '').split('/').pop() || '/';
      else item.name = basenameOf(item.path);
      if (item.depth < config.minDepth) continue;
      if (expr.test(item) && printAll) config.emit(item.path, false);
      if (lines.length > 200000) break;
    }
    c.rc.tickLines(lines.length);
  }
  if (lines.length > 0) c.out(lines.join(''));
  return exit;
}

export const commands = { find };
