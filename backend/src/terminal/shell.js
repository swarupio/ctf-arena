// The Arena Terminal shell: a safe, deterministic, bounded interpreter over the virtual filesystem.
// Contract: docs/TERMINAL_GAME.md sections 1, 5, 6, 7. Nothing real is executed; every command is a
// JavaScript function working on the in-memory VFS built by the mode definition.
import {
  Budget, LIMITS, ResourceLimitError, capOutput,
} from './limits.js';
import {
  ShellSyntaxError, expandOne, expandWords, parse,
} from './parser.js';
import {
  FsView, cmpBytes, dir, joinPath, readFileBytes, renderTokens, resolvePath, tokenSource,
} from './vfs.js';
import { buildRegistry } from './commands/index.js';
import {
  asBuf, asText, errnoText, levenshtein,
} from './commands/util.js';

const { registry, extraNames, hiddenNames } = buildRegistry();

// Every command name the shell knows (core + extras), sorted in C order. Useful for Tab completion.
export const COMMAND_NAMES = [...registry.keys()].filter((name) => !hiddenNames.has(name)).sort(cmpBytes);

const BIN_PATH = /^\/(?:usr\/)?(?:local\/)?s?bin\/([^/]+)$/;
const FIXED_PID = '1337';

// ---- run context ----

function defaultEnv(mode, user, host, home) {
  const env = new Map([
    ['USER', user], ['LOGNAME', user], ['HOME', home], ['HOSTNAME', host], ['SHELL', '/bin/bash'],
    ['PATH', '/usr/local/bin:/usr/bin:/bin'], ['TERM', 'xterm-256color'], ['LANG', 'C'], ['LC_ALL', 'C'],
    ['PWD', home], ['EDITOR', 'nano'],
  ]);
  if (mode.env && typeof mode.env === 'object') {
    for (const [key, value] of Object.entries(mode.env)) if (typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env.set(key, value);
  }
  return env;
}

function makeRc(ctx) {
  const mode = ctx.mode && typeof ctx.mode === 'object' ? ctx.mode : {};
  const user = String(ctx.user ?? mode.user ?? 'guest');
  const host = String(ctx.host ?? mode.host ?? 'arena');
  const home = typeof mode.home === 'string' && mode.home.startsWith('/') ? mode.home : `/home/${user}`;
  const budget = new Budget();
  const tick = (units) => budget.tick(units);
  const tickLines = (count) => budget.tickLines(count);
  const fs = new FsView(mode.fs ?? dir({}), { user, group: user, tick });
  // Token source for {{flag:N}}, {{seed:KIND}} and {{md5file:PATH}}. md5file looks at the mode's own static tree
  // (as root, with a fresh /tmp overlay), never at what the player wrote during this command line.
  let staticView;
  const flag = tokenSource(ctx.flag, {
    seed: ctx.seed,
    tick,
    lookup(path) {
      staticView ??= new FsView(mode.fs ?? dir({}), { user: 'root', group: 'root' });
      const found = staticView.lookup(path);
      return found.error ? null : found.node;
    },
  });
  const shared = { effect: undefined, termBytes: 0 };
  const term = [];

  let cwd = typeof ctx.cwd === 'string' && ctx.cwd.startsWith('/') ? resolvePath('/', ctx.cwd) : home;
  const start = fs.lookup(cwd);
  if (start.error || start.node.type !== 'dir' || !fs.canExec(start.node)) cwd = home;
  const homeCheck = fs.lookup(cwd);
  if (homeCheck.error || homeCheck.node.type !== 'dir') cwd = '/';

  const env = defaultEnv(mode, user, host, home);
  for (const [key, value] of env) env.set(key, renderTokens(value, flag));
  const rc = {
    ctx, mode, user, host, home, budget, tick, tickLines, flag, fs, cwd, env, shared, term,
    registry, extraNames, hiddenNames, commandNames: COMMAND_NAMES,
    lastExit: 0, substDepth: 0, xargsDepth: 0, inheritedStdin: null, oldpwd: undefined,
    color: ctx.color !== false,
    runCommand,
    read: (node) => readFileBytes(node, { flag, tick }),
    writeTerm(text) {
      if (shared.termBytes > LIMITS.MAX_STREAM * 2) return;
      shared.termBytes += text.length;
      term.push(text);
    },
  };
  return rc;
}

function forkRc(rc) {
  const child = Object.create(rc);
  child.cwd = rc.cwd;
  child.env = new Map(rc.env);
  child.lastExit = rc.lastExit;
  return child;
}

function getVar(rc, name) {
  switch (name) {
    case '?': return String(rc.lastExit);
    case '$': return FIXED_PID;
    case '#': return '0';
    case '0': return '-bash';
    case '@': case '*': case '!': case '-': return '';
    case 'PWD': return rc.cwd;
    default: return rc.env.get(name);
  }
}

function expansionEnv(rc) {
  return {
    home: rc.home,
    getVar: (name) => getVar(rc, name),
    setVar: (name, value) => rc.env.set(name, value),
    subst: (src) => runSubst(src, rc),
    glob: (pattern) => rc.fs.glob(pattern, rc.cwd, { cap: LIMITS.GLOB_CAP }),
  };
}

// ---- sinks and chunks ----

const joinData = (chunks) => {
  if (chunks.length === 0) return '';
  if (chunks.every((part) => typeof part === 'string')) return chunks.join('');
  return Buffer.concat(chunks.map(asBuf));
};

function captureSink() {
  const chunks = [];
  let bytes = 0;
  return {
    tty: false,
    write(data) {
      bytes += data.length;
      if (bytes > LIMITS.MAX_STREAM) throw new ResourceLimitError();
      chunks.push(data);
    },
    joined: () => joinData(chunks),
  };
}

const termSink = (rc) => ({ tty: true, write: (data) => rc.writeTerm(asText(data)) });

// ---- command dispatch ----

export function suggest(name, names) {
  if (name.length < 2 || name.length > 24) return null;
  const stem = name.replace(/[-./].*$/, '');
  if (stem !== name && stem !== '' && names.includes(stem)) return stem;
  const lower = name.toLowerCase();
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of names) {
    const distance = levenshtein(lower, candidate);
    if (distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return bestDistance <= 1 || (bestDistance <= 2 && name.length >= 4) ? best : null;
}

function notFound(c, name) {
  c.err(`bash: ${name}: command not found\n`);
  const hint = suggest(name, c.rc.commandNames);
  if (hint) c.err(`Did you mean '${hint}'?\n`);
  return 127;
}

function execPath(c, name) {
  const found = c.rc.fs.lookup(name, { cwd: c.rc.cwd });
  if (found.error) { c.err(`bash: ${name}: ${errnoText(found.error)}\n`); return 127; }
  if (found.node.type === 'dir') { c.err(`bash: ${name}: Is a directory\n`); return 126; }
  if (!c.rc.fs.canExec(found.node) || (found.node.mode & 0o111) === 0) { c.err(`bash: ${name}: Permission denied\n`); return 126; }
  c.err(`bash: ${name}: cannot execute binary file: Exec format error\n`);
  return 126;
}

async function runCommand(rc, rawName, args, stdin, tty) {
  const chunks = [];
  let bytes = 0;
  const push = (isErr, data) => {
    bytes += data.length;
    if (bytes > LIMITS.MAX_STREAM) throw new ResourceLimitError();
    chunks.push({ e: isErr, d: data });
  };
  const c = {
    name: rawName,
    args,
    stdin,
    rc,
    ctx: rc.ctx,
    tty,
    effect: undefined,
    out: (data) => push(false, data),
    err: (data) => push(true, data),
    relay(result) {
      for (const chunk of result.chunks) push(chunk.e, chunk.d);
      if (result.effect) c.effect = result.effect;
    },
  };
  rc.tick(1);
  let exit = 0;
  try {
    const name = rawName.includes('/') ? (BIN_PATH.exec(rawName)?.[1] ?? null) : rawName;
    if (name === null) {
      exit = execPath(c, rawName);
    } else {
      c.name = name;
      const handler = rc.registry.get(name);
      const staticOut = rc.mode.extraCommands && Object.hasOwn(rc.mode.extraCommands, name) ? rc.mode.extraCommands[name] : undefined;
      if (handler) {
        const result = await handler(c);
        exit = typeof result === 'number' ? result : (result && result.exit) ?? 0;
      } else if (typeof staticOut === 'string') {
        const text = renderTokens(staticOut, rc.flag);
        c.out(text.endsWith('\n') || text === '' ? text : `${text}\n`);
      } else {
        exit = notFound(c, name);
      }
    }
  } catch (error) {
    if (error instanceof ResourceLimitError || error instanceof ShellSyntaxError) throw error;
    if (process.env.ARENA_TERMINAL_DEBUG) throw error;
    chunks.push({ e: true, d: `${rawName}: internal error\n` });
    exit = 1;
  }
  if (c.effect) rc.shared.effect = c.effect;
  return { chunks, exit, effect: c.effect };
}

// ---- redirection helpers ----

function prepareRedirect(rc, target) {
  const parent = rc.fs.parentFor(target.path, rc.cwd);
  if (parent.error) return parent.error === 'EEXIST' ? 'EISDIR' : parent.error;
  const existing = rc.fs.lookup(parent.phys, { follow: false });
  if (!existing.error && existing.node.type === 'dir') return 'EISDIR';
  if (!existing.error && !rc.fs.canWrite(existing.node)) return 'EACCES';
  target.phys = parent.phys;
  if (existing.error || !target.append) rc.fs.setNode(parent.phys, rc.fs.newFile(Buffer.alloc(0)));
  return null;
}

function finalizeRedirect(rc, target) {
  const data = Buffer.concat(target.chunks.map(asBuf));
  let existing = Buffer.alloc(0);
  if (target.append) {
    const found = rc.fs.lookup(target.phys, { follow: false });
    if (!found.error && found.node.type === 'file') existing = readFileBytes(found.node, { flag: rc.flag });
  }
  rc.fs.setNode(target.phys, rc.fs.newFile(Buffer.concat([existing, data])));
}

function route(rc, target, sink, data) {
  if (target.kind === 'sink') sink.write(data);
  else if (target.kind === 'term') rc.writeTerm(asText(data));
  else if (target.kind === 'file') target.chunks.push(data);
}

// ---- statements ----

async function runSubst(src, rc) {
  if (rc.substDepth >= LIMITS.MAX_SUBST_DEPTH) throw new ShellSyntaxError('command substitution nested too deeply', 1);
  rc.tick(5);
  const sub = forkRc(rc);
  sub.substDepth = rc.substDepth + 1;
  const sink = captureSink();
  await runSeq(parse(src), sub, sink);
  return asText(sink.joined()).replace(/\n+$/, '');
}

async function runSimple(cmd, rc, stdin, sink) {
  const env = expansionEnv(rc);
  const assigns = [];
  for (const assign of cmd.assigns) assigns.push([assign.name, await expandOne(assign.items, env)]);
  const argv = await expandWords(cmd.words, env);

  let input = stdin ?? rc.inheritedStdin ?? null;
  let out = { kind: 'sink' };
  let err = { kind: 'term' };
  const files = [];
  for (const redir of cmd.redirs) {
    if (redir.op === 'dup') {
      if (redir.fd === 2 && redir.to === '1') err = out;
      else if (redir.fd === 1 && redir.to === '2') out = err;
      continue;
    }
    const path = await expandOne(redir.target, env);
    if (redir.op === '<<<') { input = `${path}\n`; continue; }
    if (redir.op === '<') {
      const found = rc.fs.lookup(path, { cwd: rc.cwd });
      if (found.error || found.node.type === 'dir' || !rc.fs.canRead(found.node)) {
        const reason = found.error ? errnoText(found.error) : found.node.type === 'dir' ? 'Is a directory' : 'Permission denied';
        rc.writeTerm(`bash: ${path}: ${reason}\n`);
        return 1;
      }
      input = rc.read(found.node);
      continue;
    }
    let target;
    if (resolvePath(rc.cwd, path, rc.home) === '/dev/null') target = { kind: 'null' };
    else {
      target = { kind: 'file', path, append: redir.op === '>>', chunks: [] };
      const failure = prepareRedirect(rc, target);
      if (failure) { rc.writeTerm(`bash: ${path}: ${errnoText(failure)}\n`); return 1; }
      files.push(target);
    }
    if (redir.fd === 'both') { out = target; err = target; }
    else if (redir.fd === 2) err = target;
    else out = target;
  }

  if (argv.length === 0) {
    for (const [name, value] of assigns) rc.env.set(name, value);
    for (const target of files) finalizeRedirect(rc, target);
    return 0;
  }
  const saved = assigns.map(([name]) => [name, rc.env.get(name)]);
  for (const [name, value] of assigns) rc.env.set(name, value);
  const tty = out.kind === 'sink' && sink.tty && rc.color;
  const result = await runCommand(rc, argv[0], argv.slice(1), input, tty);
  for (const [name, value] of saved) { if (value === undefined) rc.env.delete(name); else rc.env.set(name, value); }
  for (const chunk of result.chunks) route(rc, chunk.e ? err : out, sink, chunk.d);
  for (const target of files) finalizeRedirect(rc, target);
  return result.exit;
}

async function runFor(node, rc, sink) {
  const items = node.words === null ? [] : await expandWords(node.words, expansionEnv(rc));
  let exit = 0;
  for (const item of items) {
    rc.tick(LIMITS.LOOP_COST);
    rc.env.set(node.name, item);
    exit = await runSeq(node.body, rc, sink);
    rc.lastExit = exit;
  }
  return exit;
}

async function runIf(node, rc, sink) {
  for (const branch of node.branches) {
    const status = await runSeq(branch.cond, rc, sink);
    rc.lastExit = status;
    if (status === 0) return runSeq(branch.body, rc, sink);
  }
  return node.orelse ? runSeq(node.orelse, rc, sink) : 0;
}

async function runStage(node, rc, stdin, sink) {
  if (node.type === 'simple') return runSimple(node, rc, stdin, sink);
  rc.inheritedStdin = stdin ?? rc.inheritedStdin;
  if (node.type === 'for') return runFor(node, rc, sink);
  if (node.type === 'if') return runIf(node, rc, sink);
  const sub = forkRc(rc); // ( ... ) is a subshell: cwd and variables do not leak out
  return runSeq(node.body, sub, sink);
}

async function runPipeline(node, rc, sink) {
  const { stages } = node;
  if (stages.length > LIMITS.MAX_STAGES) {
    rc.writeTerm(`bash: pipeline too long (limit ${LIMITS.MAX_STAGES} commands)\n`);
    return 2;
  }
  let stdin = null;
  let exit = 0;
  for (let index = 0; index < stages.length; index += 1) {
    const last = index === stages.length - 1;
    const stageRc = stages.length > 1 ? forkRc(rc) : rc;
    const stageSink = last ? sink : captureSink();
    exit = await runStage(stages[index], stageRc, stdin, stageSink);
    stdin = last ? null : stageSink.joined();
  }
  return node.negate ? (exit === 0 ? 1 : 0) : exit;
}

async function runSeq(seq, rc, sink) {
  let status = rc.lastExit;
  for (const item of seq.items) {
    if (item.conn === '&&' && status !== 0) continue;
    if (item.conn === '||' && status === 0) continue;
    status = await runPipeline(item.node, rc, sink);
    rc.lastExit = status;
  }
  return status;
}

// ---- public API ----

function sanitize(text) {
  return text
    .replace(/\x1b(?!\[[0-9;]*m)/g, '^[')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');
}

export async function execute(line, ctx = {}) {
  const safeCtx = ctx && typeof ctx === 'object' ? ctx : {};
  let rc;
  try {
    rc = makeRc(safeCtx);
  } catch {
    return { output: 'bash: internal error', cwd: '/', exit: 1 };
  }
  const text = typeof line === 'string' ? line : '';
  let exit = 0;
  try {
    if (text.length > LIMITS.MAX_LINE) {
      rc.writeTerm(`bash: command line too long (limit ${LIMITS.MAX_LINE} characters)\n`);
      exit = 1;
    } else if (text.trim() !== '') {
      exit = await runSeq(parse(text), rc, termSink(rc));
    }
  } catch (error) {
    if (process.env.ARENA_TERMINAL_DEBUG && !(error instanceof ResourceLimitError) && !(error instanceof ShellSyntaxError)) throw error;
    rc.term.length = 0;
    if (error instanceof ResourceLimitError) {
      rc.writeTerm('bash: resource limit exceeded\n');
      exit = 137;
    } else if (error instanceof ShellSyntaxError) {
      rc.writeTerm(`bash: ${error.message}\n`);
      exit = error.exit;
    } else {
      rc.writeTerm('bash: internal error\n');
      exit = 1;
    }
  }
  let raw = rc.term.join('');
  if (raw.length > 262144) raw = raw.slice(0, 262144);
  raw = sanitize(raw);
  if (raw.endsWith('\n')) raw = raw.slice(0, -1);
  const result = { output: capOutput(raw).text, cwd: rc.cwd, exit };
  if (rc.shared.effect) result.effect = rc.shared.effect;
  return result;
}

// ---- Tab completion ----

const unescapeWord = (text) => text.replace(/\\(.)/g, '$1');
const escapeWord = (text) => text.replace(/[ !"#$&'()*;<>?[\\\]`{|}~]/g, '\\$&');

export function complete(partial, ctx = {}) {
  try {
    const text = String(partial ?? '').slice(0, 300);
    const rc = makeRc(ctx && typeof ctx === 'object' ? ctx : {});
    let wordStart = 0;
    let commandPosition = true;
    let commandWord = '';
    let quote = null;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '\\') { i += 1; continue; }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === ' ' || ch === '\t') {
        const word = text.slice(wordStart, i);
        if (word !== '' && commandPosition && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) { commandPosition = false; commandWord = word; }
        wordStart = i + 1;
      } else if (ch === '|' || ch === ';' || ch === '&' || ch === '(') {
        commandPosition = true;
        commandWord = '';
        wordStart = i + 1;
      }
    }
    const rawFragment = text.slice(wordStart);
    const openQuote = rawFragment[0] === "'" || rawFragment[0] === '"' ? rawFragment[0] : '';
    const fragment = openQuote ? rawFragment.slice(1) : unescapeWord(rawFragment);
    const results = new Set();
    if (commandPosition && !fragment.includes('/') && !/^[.~]/.test(fragment)) {
      for (const name of COMMAND_NAMES) if (name.startsWith(fragment)) results.add(name);
      return [...results].slice(0, 50);
    }
    const slash = fragment.lastIndexOf('/');
    const dirPart = slash >= 0 ? fragment.slice(0, slash + 1) : '';
    const namePart = slash >= 0 ? fragment.slice(slash + 1) : fragment;
    const dirPath = resolvePath(rc.cwd, dirPart === '' ? '.' : dirPart, rc.home);
    const found = rc.fs.lookup(dirPath);
    if (found.error || found.node.type !== 'dir' || !rc.fs.canRead(found.node)) return [];
    const dirsOnly = commandWord === 'cd' || commandWord === 'pushd';
    const names = rc.fs.entries(found.path, found.node).map(([name]) => name).sort(cmpBytes);
    for (const name of names) {
      if (!name.startsWith(namePart)) continue;
      if (name.startsWith('.') && !namePart.startsWith('.')) continue;
      const child = rc.fs.lookup(joinPath(found.path, name));
      const isDir = !child.error && child.node.type === 'dir';
      if (dirsOnly && !isDir) continue;
      const shown = `${dirPart}${name}${isDir ? '/' : ''}`;
      results.add(openQuote ? `${openQuote}${shown}` : escapeWord(shown).replace(/^\\~/, '~'));
      if (results.size >= 50) break;
    }
    return [...results];
  } catch {
    return [];
  }
}
