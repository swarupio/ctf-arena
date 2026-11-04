// Shared helpers for command handlers: option parsing, stream conversion, filesystem errors.
import { cmpBytes, resolvePath } from '../vfs.js';

export { cmpBytes };

export const asText = (data) => (data == null ? '' : typeof data === 'string' ? data : data.toString('utf8'));
export const asBuf = (data) => (data == null ? Buffer.alloc(0) : typeof data === 'string' ? Buffer.from(data, 'utf8') : data);

// "a\nb\n" -> ['a', 'b'];  "a\nb" -> ['a', 'b'];  "" -> []
export function splitLines(text) {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
// push(...bigArray) overflows the stack on large inputs, so append in a loop.
export function pushAll(target, items) {
  for (let i = 0; i < items.length; i += 1) target.push(items[i]);
  return target;
}
export const joinLines = (lines) => (lines.length > 0 ? `${lines.join('\n')}\n` : '');

export const ERRNO_TEXT = {
  ENOENT: 'No such file or directory',
  EACCES: 'Permission denied',
  ENOTDIR: 'Not a directory',
  ELOOP: 'Too many levels of symbolic links',
  EISDIR: 'Is a directory',
  EROFS: 'Read-only file system',
  EEXIST: 'File exists',
  ENOTEMPTY: 'Directory not empty',
  ELOOPDIR: 'Too many levels of symbolic links',
};
export const errnoText = (code) => ERRNO_TEXT[code] ?? 'Input/output error';

// spec: { flags: 'alh', values: 'nc', long: { all: 'a', lines: 'n', color: { key: 'color', arg: 'optional' } },
//         numeric: 'n' (treat -NUM as that key), stopAtOperand: bool }
// Returns { opts, all, operands, error }. Long options map to a short key; value-ness comes from `values`.
export function parseArgs(args, spec = {}) {
  const flags = spec.flags ?? '';
  const values = spec.values ?? '';
  const long = spec.long ?? {};
  const opts = {};
  const all = {};
  const operands = [];
  const setValue = (key, value) => { opts[key] = value; (all[key] ??= []).push(value); };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') { operands.push(...args.slice(i + 1)); break; }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
      let target = Object.hasOwn(long, name) ? long[name] : undefined;
      if (target === undefined) {
        const candidates = Object.keys(long).filter((k) => k.startsWith(name));
        if (name !== '' && candidates.length === 1) target = long[candidates[0]];
      }
      if (target === undefined) return { opts, all, operands, error: `unrecognized option '--${name}'` };
      const key = typeof target === 'string' ? target : target.key;
      const argMode = typeof target === 'string' ? (values.includes(key) ? 'required' : 'none') : (target.arg ?? 'none');
      if (argMode === 'none') {
        if (eq >= 0) return { opts, all, operands, error: `option '--${name}' doesn't allow an argument` };
        opts[key] = true;
      } else if (eq >= 0) {
        setValue(key, arg.slice(eq + 1));
      } else if (argMode === 'optional') {
        setValue(key, true);
      } else {
        if (i + 1 >= args.length) return { opts, all, operands, error: `option '--${name}' requires an argument` };
        i += 1;
        setValue(key, args[i]);
      }
      continue;
    }
    if (arg.length > 1 && arg[0] === '-') {
      if (spec.numeric && /^-\d+$/.test(arg)) { setValue(spec.numeric, arg.slice(1)); continue; }
      for (let j = 1; j < arg.length; j += 1) {
        const flag = arg[j];
        if (values.includes(flag)) {
          let value = arg.slice(j + 1);
          if (value === '') {
            if (i + 1 >= args.length) return { opts, all, operands, error: `option requires an argument -- '${flag}'` };
            i += 1;
            value = args[i];
          }
          setValue(flag, value);
          break;
        }
        if (flags.includes(flag)) { opts[flag] = true; continue; }
        return { opts, all, operands, error: `invalid option -- '${flag}'` };
      }
      continue;
    }
    operands.push(arg);
    if (spec.stopAtOperand) { operands.push(...args.slice(i + 1)); break; }
  }
  return { opts, all, operands, error: null };
}

// Prints the standard "bad option" message; returns exit code 2.
export function usageError(c, message) {
  c.err(`${c.name}: ${message}\nTry '${c.name} --help' for more information.\n`);
  return 2;
}

export const absPath = (c, path) => resolvePath(c.rc.cwd, path, c.rc.home);

export function isDevNull(c, path) {
  return absPath(c, path) === '/dev/null';
}

// Looks up an operand for reading. Prints `<cmd>: <operand>: <reason>` and returns null on failure.
// Returns { node, path } on success. Directories are returned too (callers decide).
export function openOperand(c, cmd, operand, { follow = true } = {}) {
  const found = c.rc.fs.lookup(operand === '' ? '.' : operand, { follow, cwd: c.rc.cwd });
  if (found.error) {
    c.err(`${cmd}: ${operand}: ${errnoText(found.error)}\n`);
    return null;
  }
  return found;
}

// Reads a regular file operand. `-` reads stdin. Returns a Buffer or null (error printed).
export function readOperand(c, cmd, operand, { stdin = true } = {}) {
  if (operand === '-' && stdin) return asBuf(c.stdin);
  if (isDevNull(c, operand)) return Buffer.alloc(0);
  const found = openOperand(c, cmd, operand);
  if (!found) return null;
  if (found.node.type === 'dir') {
    c.err(`${cmd}: ${operand}: Is a directory\n`);
    return null;
  }
  if (!c.rc.fs.canRead(found.node)) {
    c.err(`${cmd}: ${operand}: Permission denied\n`);
    return null;
  }
  return c.rc.read(found.node);
}

// Input for filter commands: the listed files (or `-`), or stdin when there are none.
// Calls fn(buffer, label) for each; returns the number of failures.
export function forEachInput(c, cmd, operands, fn) {
  const list = operands.length > 0 ? operands : ['-'];
  let failures = 0;
  for (const operand of list) {
    const data = readOperand(c, cmd, operand);
    if (data === null) { failures += 1; continue; }
    fn(data, operand === '-' ? '-' : operand);
  }
  return failures;
}

// GNU style human readable size: 1.5K, 12K, 4.0K (rounded up).
export function humanSize(bytes) {
  const units = ['', 'K', 'M', 'G', 'T'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  if (unit === 0) return String(bytes);
  const rounded = value < 10 ? Math.ceil(value * 10) / 10 : Math.ceil(value);
  return `${value < 10 ? rounded.toFixed(1) : rounded}${units[unit]}`;
}

// Optimal string alignment distance: insert, delete, substitute and adjacent swap each cost 1.
export function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export { MONTHS };

// ls -l style date: `Mar 14 09:26` for recent files, `Mar 14  2023` for old ones.
export function lsDate(iso, now) {
  const when = new Date(iso);
  const age = now - when.getTime();
  const day = String(when.getUTCDate()).padStart(2, ' ');
  if (age > 15778476000 || age < 0) return `${MONTHS[when.getUTCMonth()]} ${day}  ${when.getUTCFullYear()}`;
  const hh = String(when.getUTCHours()).padStart(2, '0');
  const mm = String(when.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[when.getUTCMonth()]} ${day} ${hh}:${mm}`;
}

export const mtimeMs = (node) => {
  const ms = Date.parse(node.mtime);
  return Number.isNaN(ms) ? 0 : ms;
};

export const pad = (value, width) => String(value).padStart(width, ' ');
