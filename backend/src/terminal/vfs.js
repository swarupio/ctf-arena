// Virtual filesystem node constructors for the terminal game. See docs/TERMINAL_GAME.md section 4.
// The shapes below are a contract shared by the engine and every mode file: do not change them.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { DEFAULT_SEED, seedValue } from './seed.js';

export const DEFAULT_MTIME = '2024-03-14T09:26:53Z';

export function dir(children = {}, { mode = 0o755, owner = 'guest', group = 'guest', mtime = DEFAULT_MTIME } = {}) {
  return { type: 'dir', mode, owner, group, mtime, children };
}

export function file(content, { mode = 0o644, owner = 'guest', group = 'guest', mtime = DEFAULT_MTIME } = {}) {
  return { type: 'file', mode, owner, group, mtime, content: String(content) };
}

export function binary(base64, { mode = 0o644, owner = 'guest', group = 'guest', mtime = DEFAULT_MTIME } = {}) {
  return { type: 'file', binary: true, mode, owner, group, mtime, contentBase64: String(base64) };
}

export function link(target, { owner = 'guest', mtime = DEFAULT_MTIME } = {}) {
  return { type: 'link', mode: 0o777, owner, group: owner, mtime, target: String(target) };
}

// `cat` shows a header plus a deterministic hex blob; `vault open <file> <passphrase>` reveals `plain`.
export function vault(plain, passphrase, { mode = 0o644, owner = 'guest', group = 'guest', mtime = DEFAULT_MTIME } = {}) {
  let blob = '';
  let seed = `arena-vault:${passphrase}`;
  while (blob.length < 192) {
    seed = createHash('sha256').update(seed).digest('hex');
    blob += seed;
  }
  const hexLines = blob.slice(0, 192).match(/.{1,64}/g).join('\n');
  return {
    type: 'file', mode, owner, group, mtime,
    content: `ARENAVAULT1\n${hexLines}\n`,
    vault: { plain: String(plain), passphrase: String(passphrase) },
  };
}

// ---------------------------------------------------------------------------------------------
// Traversal helpers, appended by the engine agent. Everything above this line is the frozen
// constructor contract; everything below is the read side used by the shell (docs section 5-7).
// ---------------------------------------------------------------------------------------------

// The in-universe "now": `date`, `find -mtime`, `ls -l` all agree on it (docs section 6).
export const FIXED_NOW_ISO = '2024-03-14T09:30:00Z';
export const FIXED_NOW = Date.parse(FIXED_NOW_ISO);
const MAX_SYMLINKS = 40;

export const cmpBytes = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // C-locale order

export function normalize(path) {
  const out = [];
  for (const part of String(path).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

// Lexical resolution (no symlinks, no existence checks). `~` expands to `home`.
export function resolvePath(cwd, path, home = '/') {
  let target = String(path);
  if (target === '~' || target.startsWith('~/')) target = `${home}${target.slice(1)}`;
  if (!target.startsWith('/')) target = `${cwd}/${target}`;
  return normalize(target);
}

export const joinPath = (base, name) => (base === '/' ? `/${name}` : `${base}/${name}`);
export const dirnameOf = (path) => {
  const norm = normalize(path);
  const idx = norm.lastIndexOf('/');
  return idx <= 0 ? '/' : norm.slice(0, idx);
};
export const basenameOf = (path) => {
  const norm = normalize(path);
  return norm === '/' ? '/' : norm.slice(norm.lastIndexOf('/') + 1);
};

// Effective rwx bits (0-7) of `node` for a user. Owner bits win over group bits, like POSIX.
export function permBits(node, user = 'guest', group = 'guest') {
  const mode = node.mode ?? 0o644;
  if (node.owner === user) return (mode >> 6) & 7;
  if (node.group === group) return (mode >> 3) & 7;
  return mode & 7;
}
export const canRead = (node, user = 'guest', group = 'guest') => user === 'root' || (permBits(node, user, group) & 4) !== 0;
export const canWrite = (node, user = 'guest', group = 'guest') => user === 'root' || (permBits(node, user, group) & 2) !== 0;
export const canExec = (node, user = 'guest', group = 'guest') => user === 'root' || (permBits(node, user, group) & 1) !== 0;

// `-rwxr-xr-x` style string (with setuid/setgid/sticky letters).
export function modeString(node) {
  const mode = node.mode ?? 0;
  const kind = node.type === 'dir' ? 'd' : node.type === 'link' ? 'l' : '-';
  const triple = (shift, special, onLetter, offLetter) => {
    const bits = (mode >> shift) & 7;
    const x = (bits & 1) !== 0;
    return `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${special ? (x ? onLetter : offLetter) : (x ? 'x' : '-')}`;
  };
  return kind + triple(6, mode & 0o4000, 's', 'S') + triple(3, mode & 0o2000, 's', 'S') + triple(0, mode & 0o1000, 't', 'T');
}

// ---- tokens: {{flag:N}}, {{seed:KIND[:SLOT]}} and {{md5file:/abs/path}}, each with optional |filters ----

const TOKEN_RE = /\{\{(flag|seed|md5file):([^|{}]*)((?:\|[^|{}]*)*)\}\}/g;
const HAS_TOKEN = /\{\{(?:flag|seed|md5file):/;
const SEED_BODY = /^([a-z0-9]+)(?::(\d{1,6}))?$/;
const MD5_ZEROS = '0'.repeat(32);

export function gzipDeterministic(buffer) {
  const gz = gzipSync(buffer, { level: 9 });
  gz.writeUInt32LE(0, 4); // mtime
  gz[8] = 2; // XFL: max compression
  gz[9] = 3; // OS: unix, so every platform prints the same bytes
  return gz;
}

function applyFilter(value, spec) {
  const [name, ...rest] = spec.split(':');
  const arg = rest.join(':');
  switch (name) {
    case 'b64': return Buffer.from(value, 'utf8').toString('base64');
    case 'hex': return Buffer.from(value, 'utf8').toString('hex');
    case 'rot13': return value.replace(/[a-z]/gi, (ch) => {
      const base = ch <= 'Z' ? 65 : 97;
      return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
    });
    case 'rev': return Array.from(value).reverse().join('');
    case 'upper': return value.toUpperCase();
    case 'lower': return value.toLowerCase();
    case 'slice': {
      const match = /^(\d+)-(\d*)$/.exec(arg);
      if (!match) return null;
      return value.slice(Number(match[1]), match[2] === '' ? undefined : Number(match[2]));
    }
    case 'gzb64': return gzipDeterministic(Buffer.from(value, 'utf8')).toString('base64');
    case 'wide': return value.replace(/[\s\S]/gu, '$&\u0000'); // UTF-16LE look: every char followed by a NUL
    case 'md5': return createHash('md5').update(value, 'utf8').digest('hex');
    case 'xor': {
      if (!arg) return null;
      const key = Buffer.from(arg, 'utf8');
      const bytes = Buffer.from(value, 'utf8');
      const out = Buffer.alloc(bytes.length);
      for (let i = 0; i < bytes.length; i += 1) out[i] = bytes[i] ^ key[i % key.length];
      return out.toString('hex');
    }
    default: return null;
  }
}

// What renderTokens reads its values from: the flag function (n -> flag string) with the per-run extras attached.
// `seed` is the team's hex seed, `lookup(absPath)` returns a static VFS node or null (for md5file) and `tick(units)`
// charges the work budget. A plain function (or nothing) is a valid source too: seed tokens then use the default
// seed and md5file prints zeros. Every caller keeps passing the source where it used to pass the flag function.
export function tokenSource(flag, { seed, lookup, tick } = {}) {
  const source = (n) => (typeof flag === 'function' ? flag(n) : undefined);
  source.seed = typeof seed === 'string' && seed !== '' ? seed : DEFAULT_SEED;
  source.seedCache = new Map(); // one command line only: a log that repeats a token pays for its HMAC once
  source.lookup = lookup;
  source.tick = tick;
  return source;
}

// `nested` is true while a file is rendered only to be hashed by md5file. A md5file token seen there prints zeros,
// so a file that (directly or through another file) references itself can never recurse.
function tokenValue(type, body, source, nested) {
  if (type === 'flag') {
    if (typeof source !== 'function' || !/^\d+$/.test(body)) return undefined;
    try { return source(Number(body)); } catch { return undefined; }
  }
  if (type === 'seed') {
    const match = SEED_BODY.exec(body);
    if (!match) return undefined;
    const slot = match[2] === undefined ? 1 : Number(match[2]);
    const key = `${match[1]}:${slot}`;
    const cache = source?.seedCache;
    if (cache?.has(key)) return cache.get(key);
    const value = seedValue(source?.seed, match[1], slot) ?? undefined;
    cache?.set(key, value);
    return value;
  }
  return md5OfFile(body, source, nested);
}

function md5OfFile(path, source, nested) {
  if (nested || !path.startsWith('/') || typeof source?.lookup !== 'function') return MD5_ZEROS;
  const node = source.lookup(path);
  if (!node || node.type !== 'file') return MD5_ZEROS;
  const bytes = nodeBytes(node, source, true);
  if (typeof source.tick === 'function') source.tick(1 + (bytes.length >> 10));
  return createHash('md5').update(bytes).digest('hex');
}

function render(text, source, nested) {
  if (typeof text !== 'string' || !HAS_TOKEN.test(text)) return text;
  return text.replace(TOKEN_RE, (whole, type, body, chain) => {
    let value = tokenValue(type, body, source, nested);
    if (typeof value !== 'string' || value === '') return whole;
    for (const spec of chain.split('|').filter(Boolean)) {
      const next = applyFilter(value, spec);
      if (next === null) return whole;
      value = next;
    }
    return value;
  });
}

// Fills `{{flag:N|filters}}`, `{{seed:KIND[:SLOT]|filters}}` and `{{md5file:/abs/path|filters}}` tokens.
// Unknown tokens (bad filter, unknown code or kind) print literally.
export const renderTokens = (text, source) => render(text, source, false);

const staticBytes = new WeakMap(); // nodes never change after the mode module is loaded

function nodeBytes(node, source, nested) {
  if (node.bytes) return node.bytes; // /tmp overlay file (written by the player, never rendered)
  if (node.binary) {
    let buf = staticBytes.get(node);
    if (!buf) { buf = Buffer.from(node.contentBase64 ?? '', 'base64'); staticBytes.set(node, buf); }
    return buf;
  }
  const text = node.content ?? '';
  if (HAS_TOKEN.test(text)) return Buffer.from(render(text, source, nested), 'utf8');
  let buf = staticBytes.get(node);
  if (!buf) { buf = Buffer.from(text, 'utf8'); staticBytes.set(node, buf); }
  return buf;
}

// Raw bytes of a file node with tokens rendered. `tick` is charged for the read.
export function readFileBytes(node, { flag, tick } = {}) {
  const buf = nodeBytes(node, flag, false);
  if (tick) tick(1 + (buf.length >> 10));
  return buf;
}

export function nodeSize(node, flag) {
  if (node.type === 'dir') return 4096;
  if (node.type === 'link') return Buffer.byteLength(node.target ?? '');
  return readFileBytes(node, { flag }).length;
}

// ---- glob matching (no regex, so it can never backtrack badly) ----

const GLOB_CLASSES = {
  alpha: (c) => /[A-Za-z]/.test(c), digit: (c) => /[0-9]/.test(c), alnum: (c) => /[A-Za-z0-9]/.test(c),
  upper: (c) => /[A-Z]/.test(c), lower: (c) => /[a-z]/.test(c), space: (c) => /\s/.test(c),
  blank: (c) => c === ' ' || c === '\t', punct: (c) => /[!-/:-@[-`{-~]/.test(c), xdigit: (c) => /[0-9A-Fa-f]/.test(c),
  cntrl: (c) => c < ' ' || c === '\x7f', print: (c) => c >= ' ' && c <= '~', graph: (c) => c > ' ' && c <= '~',
};

function parseGlobClass(pattern, start) {
  let i = start + 1;
  let negate = false;
  if (pattern[i] === '!' || pattern[i] === '^') { negate = true; i += 1; }
  const items = [];
  let first = true;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === ']' && !first) {
      const test = (c) => items.some((item) => item(c)) !== negate;
      return { test, end: i };
    }
    first = false;
    if (ch === '[' && pattern[i + 1] === ':') {
      const close = pattern.indexOf(':]', i + 2);
      const fn = close > 0 ? GLOB_CLASSES[pattern.slice(i + 2, close)] : null;
      if (fn) { items.push(fn); i = close + 2; continue; }
    }
    let lo = ch;
    if (ch === '\\' && i + 1 < pattern.length) { i += 1; lo = pattern[i]; }
    if (pattern[i + 1] === '-' && i + 2 < pattern.length && pattern[i + 2] !== ']') {
      const hi = pattern[i + 2];
      items.push((c) => c >= lo && c <= hi);
      i += 3;
    } else {
      items.push((c) => c === lo);
      i += 1;
    }
  }
  return null; // unterminated: the `[` is a literal
}

export function hasGlobChars(pattern) {
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '*' || ch === '?') return true;
    if (ch === '[' && parseGlobClass(pattern, i)) return true;
  }
  return false;
}

export function unescapeGlob(pattern) {
  return pattern.replace(/\\(.)/g, '$1');
}

// Returns a function name -> boolean.
export function compileGlob(pattern, { nocase = false } = {}) {
  const toks = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) { i += 1; toks.push({ t: 'c', c: pattern[i] }); }
    else if (ch === '*') { if (toks.length === 0 || toks[toks.length - 1].t !== '*') toks.push({ t: '*' }); }
    else if (ch === '?') toks.push({ t: '?' });
    else if (ch === '[') {
      const cls = parseGlobClass(pattern, i);
      if (cls) { toks.push({ t: '[', test: cls.test }); i = cls.end; } else toks.push({ t: 'c', c: '[' });
    } else toks.push({ t: 'c', c: ch });
  }
  const fold = (c) => (nocase ? c.toLowerCase() : c);
  const one = (tok, c) => {
    if (tok.t === '?') return true;
    if (tok.t === 'c') return fold(tok.c) === fold(c);
    return tok.test(c) || (nocase && (tok.test(c.toLowerCase()) || tok.test(c.toUpperCase())));
  };
  return (str) => {
    let s = 0;
    let t = 0;
    let star = -1;
    let mark = 0;
    while (s < str.length) {
      const tok = toks[t];
      if (tok && tok.t !== '*' && one(tok, str[s])) { s += 1; t += 1; }
      else if (tok && tok.t === '*') { star = t; t += 1; mark = s; }
      else if (star >= 0) { t = star + 1; mark += 1; s = mark; }
      else return false;
    }
    while (toks[t] && toks[t].t === '*') t += 1;
    return t === toks.length;
  };
}

// ---- the filesystem view the shell works on ----

const TMP_DIR = () => dir({}, { mode: 0o1777, owner: 'root', group: 'root' });
const underTmp = (path) => path === '/tmp' || path.startsWith('/tmp/');
const own = (children, name) => (children && Object.hasOwn(children, name) ? children[name] : undefined);

function withTmp(root) {
  if (root.children && root.children.tmp && root.children.tmp.type === 'dir') return root;
  return { ...root, children: { ...(root.children ?? {}), tmp: TMP_DIR() } };
}

const joinDisplay = (base, name) => (base === '' ? name : base.endsWith('/') ? `${base}${name}` : `${base}/${name}`);

// A view over the mode's filesystem plus a /tmp overlay that lives for one command line.
// `user` decides permission checks ('root' bypasses them; used by `sudo`).
export class FsView {
  constructor(root, { user = 'guest', group = 'guest', overlay, tick } = {}) {
    this.root = withTmp(root);
    this.user = user;
    this.group = group;
    this.overlay = overlay ?? { nodes: new Map(), kids: new Map() };
    this.tick = tick ?? (() => {});
  }

  withUser(user, group = user) {
    return new FsView(this.root, { user, group, overlay: this.overlay, tick: this.tick });
  }

  canRead(node) { return canRead(node, this.user, this.group); }
  canWrite(node) { return canWrite(node, this.user, this.group); }
  canExec(node) { return canExec(node, this.user, this.group); }
  isTmp(path) { return underTmp(path); }

  child(dirInfo, name) {
    const path = joinPath(dirInfo.path, name);
    if (underTmp(dirInfo.path)) {
      const ov = this.overlay.nodes.get(path);
      if (ov !== undefined) return ov === null ? undefined : ov;
    }
    return own(dirInfo.node.children, name);
  }

  // [name, node] pairs of a directory in insertion order (base children first, then /tmp additions).
  entries(path, node) {
    const base = node.children ? Object.entries(node.children) : [];
    if (!underTmp(path)) return base;
    const out = [];
    const seen = new Set();
    for (const [name, child] of base) {
      seen.add(name);
      const ov = this.overlay.nodes.get(joinPath(path, name));
      if (ov === undefined) out.push([name, child]);
      else if (ov !== null) out.push([name, ov]);
    }
    const kids = this.overlay.kids.get(path);
    if (kids) {
      for (const name of kids) {
        if (seen.has(name)) continue;
        const ov = this.overlay.nodes.get(joinPath(path, name));
        if (ov) out.push([name, ov]);
      }
    }
    return out;
  }

  // Resolves a path (absolute, or relative to `cwd`) through symlinks. `..` is physical, like the kernel.
  // Returns { node, path } or { error: 'ENOENT' | 'EACCES' | 'ENOTDIR' | 'ELOOP' }.
  lookup(input, { follow = true, cwd = '/' } = {}) {
    const text = String(input);
    const full = text.startsWith('/') ? text : `${cwd}/${text}`;
    let queue = full.split('/');
    const trailingSlash = full.length > 1 && full.endsWith('/');
    const stack = [{ node: this.root, path: '/' }];
    let links = 0;
    let last = null;
    while (queue.length > 0) {
      const comp = queue.shift();
      if (comp === '' || comp === '.') continue;
      if (comp === '..') {
        if (stack.length > 1) stack.pop();
        last = null;
        continue;
      }
      const top = stack[stack.length - 1];
      if (!this.canExec(top.node)) return { error: 'EACCES' };
      const child = this.child(top, comp);
      if (child === undefined) return { error: 'ENOENT' };
      const isLast = queue.every((q) => q === '' || q === '.');
      if (child.type === 'link' && (follow || !isLast || trailingSlash)) {
        links += 1;
        if (links > MAX_SYMLINKS) return { error: 'ELOOP' };
        const target = String(child.target);
        if (target.startsWith('/')) stack.length = 1;
        queue = [...target.split('/'), ...queue];
        continue;
      }
      if (isLast) {
        last = { node: child, path: joinPath(top.path, comp), parentPath: top.path };
        if (trailingSlash && child.type !== 'dir') return { error: 'ENOTDIR' };
        return last;
      }
      if (child.type !== 'dir') return { error: 'ENOTDIR' };
      stack.push({ node: child, path: joinPath(top.path, comp) });
    }
    const top = stack[stack.length - 1];
    return { node: top.node, path: top.path, parentPath: stack.length > 1 ? stack[stack.length - 2].path : '/' };
  }

  // Depth-first pre-order traversal in insertion order. Yields { path (display), phys, node, depth }.
  * walk(display, phys, node, { follow = false, maxDepth = Infinity, onError } = {}) {
    const chain = new Set();
    const self = this;
    function* rec(shown, physical, current, depth) {
      let target = current;
      let targetPhys = physical;
      if (current.type === 'link' && follow) {
        const resolved = self.lookup(physical, { follow: true });
        if (resolved.error) {
          if (onError) onError(shown, resolved.error);
          yield { path: shown, phys: physical, node: current, depth };
          return;
        }
        target = resolved.node;
        targetPhys = resolved.path;
      }
      const item = { path: shown, phys: physical, node: target, depth, prune: false };
      yield item;
      if (item.prune || target.type !== 'dir' || depth >= maxDepth) return;
      if (chain.has(targetPhys)) { if (onError) onError(shown, 'ELOOPDIR'); return; }
      if (!self.canRead(target) || !self.canExec(target)) { if (onError) onError(shown, 'EACCES'); return; }
      chain.add(targetPhys);
      for (const [name, child] of self.entries(targetPhys, target)) {
        self.tick(1);
        yield* rec(joinDisplay(shown, name), joinPath(targetPhys, name), child, depth + 1);
      }
      chain.delete(targetPhys);
    }
    yield* rec(display, phys, node, 0);
  }

  // Shell glob expansion. Returns matching paths (as written, sorted in C order), capped.
  glob(pattern, cwd, { cap = 200 } = {}) {
    const absolute = pattern.startsWith('/');
    const trailing = pattern.length > 1 && pattern.endsWith('/');
    const comps = pattern.split('/').filter((c) => c !== '');
    const out = [];
    const visit = (display, logical, index) => {
      if (out.length >= cap) return;
      if (index === comps.length) {
        const found = this.lookup(logical, { follow: trailing, cwd });
        if (!found.error && (!trailing || found.node.type === 'dir')) out.push(trailing ? `${display}/` : display);
        return;
      }
      const comp = comps[index];
      if (!hasGlobChars(comp)) {
        const name = unescapeGlob(comp);
        visit(joinDisplay(display, name), joinDisplay(logical, name), index + 1);
        return;
      }
      const dirInfo = this.lookup(logical === '' ? cwd : logical, { follow: true, cwd });
      if (dirInfo.error || dirInfo.node.type !== 'dir' || !this.canRead(dirInfo.node) || !this.canExec(dirInfo.node)) return;
      const match = compileGlob(comp);
      const dotted = comp.startsWith('.');
      const names = this.entries(dirInfo.path, dirInfo.node).map(([name]) => name).sort(cmpBytes);
      for (const name of names) {
        this.tick(1);
        if (name.startsWith('.') && !dotted) continue;
        if (match(name)) visit(joinDisplay(display, name), joinDisplay(logical === '' ? cwd : logical, name), index + 1);
        if (out.length >= cap) return;
      }
    };
    if (absolute) visit('/', '/', 0);
    else visit('', cwd, 0);
    return out.sort(cmpBytes);
  }

  // ---- /tmp overlay writes (everything else is a read-only file system) ----

  // Resolves the parent directory of `path` for creation. Returns { dir, phys, name } or { error }.
  parentFor(path, cwd = '/') {
    const text = String(path);
    const trimmed = text.length > 1 ? text.replace(/\/+$/, '') : text;
    const slash = trimmed.lastIndexOf('/');
    const name = trimmed.slice(slash + 1);
    const parentText = slash < 0 ? '.' : slash === 0 ? '/' : trimmed.slice(0, slash);
    if (name === '' || name === '.' || name === '..') return { error: 'EEXIST' };
    const parent = this.lookup(parentText, { follow: true, cwd });
    if (parent.error) return { error: parent.error };
    if (parent.node.type !== 'dir') return { error: 'ENOTDIR' };
    const phys = joinPath(parent.path, name);
    if (!underTmp(phys)) return { error: 'EROFS' };
    return { dir: parent.node, dirPath: parent.path, phys, name };
  }

  setNode(phys, node) {
    this.overlay.nodes.set(phys, node);
    const parent = dirnameOf(phys);
    let kids = this.overlay.kids.get(parent);
    if (!kids) { kids = new Set(); this.overlay.kids.set(parent, kids); }
    kids.add(phys.slice(phys.lastIndexOf('/') + 1));
  }

  deleteNode(phys) {
    this.overlay.nodes.set(phys, null);
    const prefix = `${phys}/`;
    for (const key of [...this.overlay.nodes.keys()]) if (key.startsWith(prefix)) this.overlay.nodes.delete(key);
    this.overlay.kids.delete(phys);
    const kids = this.overlay.kids.get(dirnameOf(phys));
    if (kids) kids.delete(phys.slice(phys.lastIndexOf('/') + 1));
  }

  newFile(bytes) {
    return { type: 'file', mode: 0o644, owner: this.user, group: this.user, mtime: FIXED_NOW_ISO, bytes };
  }

  newDir() {
    return dir({}, { mode: 0o755, owner: this.user, group: this.user, mtime: FIXED_NOW_ISO });
  }
}

// Convenience wrappers named in the task brief.
export const getNode = (view, path, options) => view.lookup(path, options);
export function listDir(view, path, options = {}) {
  const found = view.lookup(path, options);
  if (found.error) return { error: found.error };
  if (found.node.type !== 'dir') return { error: 'ENOTDIR' };
  if (!view.canRead(found.node)) return { error: 'EACCES' };
  return { path: found.path, entries: view.entries(found.path, found.node) };
}
export const walk = (view, display, phys, node, options) => view.walk(display, phys, node, options);
export const glob = (view, pattern, cwd, options) => view.glob(pattern, cwd, options);
