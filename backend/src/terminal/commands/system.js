// Core shell builtins and "system-ish" commands. Everything is static or derived from the mode definition:
// the sandbox never reads host data. `date` is fixed to Thu Mar 14 09:30:00 UTC 2024.
import { FIXED_NOW, renderTokens } from '../vfs.js';
import { DAYS, MONTHS, pad, parseArgs, usageError } from './util.js';

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KERNEL = '5.15.0-97-generic';
const KERNEL_BUILD = '#107-Ubuntu SMP Wed Feb 7 13:26:48 UTC 2024';

const mapStatic = (c, name, fallback) => {
  const extra = c.rc.mode.extraCommands;
  const value = extra && Object.hasOwn(extra, name) ? extra[name] : undefined;
  return typeof value === 'string' ? renderTokens(value, c.rc.flag) : fallback;
};
const withNewline = (text) => (text === '' || text.endsWith('\n') ? text : `${text}\n`);

// ---------------------------------------------------------------- escapes, echo, printf

export function unescape(text, { stopAtC = false } = {}) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '\\' || i + 1 >= text.length) { out += ch; continue; }
    i += 1;
    const next = text[i];
    const simple = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'" };
    if (next === 'c' && stopAtC) return { text: out, stop: true };
    if (Object.hasOwn(simple, next)) { out += simple[next]; continue; }
    if (next === 'x') {
      const hex = /^[0-9A-Fa-f]{1,2}/.exec(text.slice(i + 1));
      if (hex) { out += String.fromCharCode(parseInt(hex[0], 16)); i += hex[0].length; continue; }
    }
    if (next === 'u') {
      const hex = /^[0-9A-Fa-f]{1,4}/.exec(text.slice(i + 1));
      if (hex) { out += String.fromCharCode(parseInt(hex[0], 16)); i += hex[0].length; continue; }
    }
    if (/[0-7]/.test(next)) {
      const oct = /^0?[0-7]{1,3}/.exec(text.slice(i));
      out += String.fromCharCode(parseInt(oct[0], 8) & 0xff);
      i += oct[0].length - 1;
      continue;
    }
    out += `\\${next}`;
  }
  return stopAtC ? { text: out, stop: false } : out;
}

function echo(c) {
  let newline = true;
  let escapes = false;
  let args = [...c.args];
  while (args.length > 0 && /^-[neE]+$/.test(args[0])) {
    for (const flag of args[0].slice(1)) {
      if (flag === 'n') newline = false;
      else if (flag === 'e') escapes = true;
      else escapes = false;
    }
    args = args.slice(1);
  }
  let text = args.join(' ');
  if (escapes) {
    const result = unescape(text, { stopAtC: true });
    text = result.text;
    if (result.stop) newline = false;
  }
  c.out(newline ? `${text}\n` : text);
  return 0;
}

function formatNumber(c, raw, base = 10) {
  if (raw === undefined || raw === '') return 0;
  if (/^['"]./.test(raw)) return raw.charCodeAt(1);
  const text = raw.trim();
  const value = /^[-+]?0[xX][0-9a-fA-F]+$/.test(text) ? parseInt(text, 16)
    : /^[-+]?0[0-7]+$/.test(text) ? parseInt(text, 8)
      : /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text) ? Number(text) : NaN;
  if (Number.isNaN(value)) { c.err(`printf: '${raw}': invalid number\n`); c.printfFailed = true; return 0; }
  return base === 10 ? value : Math.trunc(value);
}

function printfFormat(c, format, args) {
  let out = '';
  let index = 0;
  const next = () => (index < args.length ? args[index++] : undefined);
  let stop = false;
  const pass = () => {
    for (let i = 0; i < format.length && !stop; i += 1) {
      const ch = format[i];
      if (ch === '\\') {
        let end = i + 2;
        if (format[i + 1] === 'x') end = i + 2 + (/^[0-9A-Fa-f]{1,2}/.exec(format.slice(i + 2))?.[0].length ?? 0);
        else if (/[0-7]/.test(format[i + 1] ?? '')) end = i + 1 + /^[0-7]{1,3}/.exec(format.slice(i + 1))[0].length;
        out += unescape(format.slice(i, end));
        i = end - 1;
        continue;
      }
      if (ch !== '%') { out += ch; continue; }
      const match = /^%([-+ 0#]*)(\d*|\*)(?:\.(\d*|\*))?([a-zA-Z%])/.exec(format.slice(i));
      if (!match) { out += ch; continue; }
      i += match[0].length - 1;
      const [, flags, widthSpec, precSpec, conv] = match;
      const width = widthSpec === '*' ? Number(next() ?? 0) : Number(widthSpec || 0);
      const precision = precSpec === undefined ? undefined : precSpec === '*' ? Number(next() ?? 0) : Number(precSpec || 0);
      const left = flags.includes('-') || width < 0;
      const zero = flags.includes('0') && !left;
      const padTo = (text, numeric = false) => {
        const size = Math.abs(width);
        if (text.length >= size) return text;
        if (left) return text.padEnd(size);
        if (zero && numeric) {
          const sign = /^[-+ ]/.test(text) ? text[0] : '';
          return sign + text.slice(sign.length).padStart(size - sign.length, '0');
        }
        return text.padStart(size);
      };
      const signed = (n, text) => (n >= 0 ? (flags.includes('+') ? `+${text}` : flags.includes(' ') ? ` ${text}` : text) : text);
      switch (conv) {
        case '%': out += '%'; break;
        case 's': { let s = next() ?? ''; if (precision !== undefined) s = s.slice(0, precision); out += padTo(s); break; }
        case 'b': { const r = unescape(next() ?? '', { stopAtC: true }); out += padTo(r.text); if (r.stop) stop = true; break; }
        case 'c': out += padTo((next() ?? '').slice(0, 1)); break;
        case 'd': case 'i': { const n = Math.trunc(formatNumber(c, next(), 0)); out += padTo(signed(n, String(n)), true); break; }
        case 'u': { const n = Math.abs(Math.trunc(formatNumber(c, next(), 0))); out += padTo(String(n), true); break; }
        case 'x': case 'X': case 'o': {
          const n = Math.trunc(formatNumber(c, next(), 0));
          let text = (n < 0 ? (BigInt(n) + (1n << 64n)) : BigInt(n)).toString(conv === 'o' ? 8 : 16);
          if (conv === 'X') text = text.toUpperCase();
          if (flags.includes('#') && n !== 0) text = (conv === 'o' ? '0' : conv === 'x' ? '0x' : '0X') + text;
          out += padTo(text, true);
          break;
        }
        case 'f': case 'F': { const n = formatNumber(c, next(), 10); out += padTo(signed(n, n.toFixed(precision ?? 6)), true); break; }
        case 'e': case 'E': { const n = formatNumber(c, next(), 10); let t = n.toExponential(precision ?? 6).replace(/e([-+])(\d)$/, 'e$10$2'); if (conv === 'E') t = t.toUpperCase(); out += padTo(signed(n, t), true); break; }
        case 'g': case 'G': { const n = formatNumber(c, next(), 10); out += padTo(signed(n, String(Number(n.toPrecision(precision || 6)))), true); break; }
        default: out += match[0];
      }
    }
  };
  let before;
  do {
    before = index;
    pass();
  } while (!stop && index < args.length && index > before);
  return out;
}

function printf(c) {
  if (c.args.length === 0) { c.err('printf: usage: printf format [arguments]\n'); return 2; }
  const [format, ...args] = c.args[0] === '--' ? c.args.slice(1) : c.args;
  c.out(printfFormat(c, format ?? '', args));
  return c.printfFailed ? 1 : 0;
}

// ---------------------------------------------------------------- identity

const userOf = (c) => c.rc.fs.user;

function whoami(c) { c.out(`${userOf(c)}\n`); return 0; }

function id(c) {
  const root = userOf(c) === 'root';
  const uid = root ? 0 : 1000;
  const name = root ? 'root' : c.rc.user;
  const flags = c.args.join('');
  if (/n/.test(flags) && /u/.test(flags)) c.out(`${name}\n`);
  else if (/n/.test(flags) && /g/.test(flags)) c.out(`${name}\n`);
  else if (/u/.test(flags)) c.out(`${uid}\n`);
  else if (/g/.test(flags)) c.out(`${uid}\n`);
  else c.out(`uid=${uid}(${name}) gid=${uid}(${name}) groups=${uid}(${name})\n`);
  return 0;
}

function groups(c) { c.out(`${userOf(c) === 'root' ? 'root' : c.rc.user}\n`); return 0; }
function hostname(c) { c.out(`${c.rc.host}\n`); return 0; }

function uname(c) {
  const parsed = parseArgs(c.args, { flags: 'asnrvmpio', long: { all: 'a', 'kernel-name': 's', 'nodename': 'n', 'kernel-release': 'r', 'kernel-version': 'v', machine: 'm', 'operating-system': 'o' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const parts = [];
  const all = Boolean(opts.a);
  if (all || opts.s || Object.keys(opts).length === 0) parts.push('Linux');
  if (all || opts.n) parts.push(c.rc.host);
  if (all || opts.r) parts.push(KERNEL);
  if (all || opts.v) parts.push(KERNEL_BUILD);
  if (all || opts.m) parts.push('x86_64');
  if (all || opts.p) parts.push('x86_64');
  if (all || opts.i) parts.push('x86_64');
  if (all || opts.o) parts.push('GNU/Linux');
  c.out(`${parts.join(' ')}\n`);
  return 0;
}

// ---------------------------------------------------------------- date

const two = (n) => String(n).padStart(2, '0');

export function strftime(date, format) {
  const yday = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  const hours12 = date.getUTCHours() % 12 || 12;
  const table = {
    Y: String(date.getUTCFullYear()), y: two(date.getUTCFullYear() % 100), m: two(date.getUTCMonth() + 1), d: two(date.getUTCDate()),
    e: pad(date.getUTCDate(), 2), H: two(date.getUTCHours()), M: two(date.getUTCMinutes()), S: two(date.getUTCSeconds()),
    I: two(hours12), p: date.getUTCHours() < 12 ? 'AM' : 'PM', a: DAYS[date.getUTCDay()], A: FULL_DAYS[date.getUTCDay()],
    b: MONTHS[date.getUTCMonth()], h: MONTHS[date.getUTCMonth()], B: FULL_MONTHS[date.getUTCMonth()], j: String(yday).padStart(3, '0'),
    u: String(date.getUTCDay() || 7), w: String(date.getUTCDay()), Z: 'UTC', z: '+0000', s: String(Math.floor(date.getTime() / 1000)),
    F: `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`,
    T: `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())}`,
    R: `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`,
    D: `${two(date.getUTCMonth() + 1)}/${two(date.getUTCDate())}/${two(date.getUTCFullYear() % 100)}`,
    c: `${DAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCDate(), 2)} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} ${date.getUTCFullYear()}`,
    n: '\n', t: '\t', '%': '%', N: '000000000',
  };
  return format.replace(/%[-_0^#]?([a-zA-Z%])/g, (whole, key) => (Object.hasOwn(table, key) ? table[key] : whole));
}

function parseDateArg(text) {
  const spec = text.trim();
  if (spec === '' || spec === 'now' || spec === 'today') return FIXED_NOW;
  if (spec === 'yesterday') return FIXED_NOW - 86400000;
  if (spec === 'tomorrow') return FIXED_NOW + 86400000;
  const epoch = /^@(-?\d+)$/.exec(spec);
  if (epoch) return Number(epoch[1]) * 1000;
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?(?: ?(?:UTC|Z))?$/.exec(spec);
  if (iso) {
    const when = Date.parse(`${iso[1]}T${iso[2] ?? '00:00'}${iso[2] && iso[2].length === 5 ? ':00' : ''}Z`);
    return Number.isNaN(when) ? null : when;
  }
  return null;
}

function date(c) {
  const parsed = parseArgs(c.args, { flags: 'u', values: 'dr', long: { utc: 'u', date: 'd', universal: 'u' } });
  if (parsed.error) return usageError(c, parsed.error);
  let when = FIXED_NOW;
  if (parsed.opts.d !== undefined) {
    const value = parseDateArg(parsed.opts.d);
    if (value === null) { c.err(`date: invalid date '${parsed.opts.d}'\n`); return 1; }
    when = value;
  }
  const format = parsed.operands.find((operand) => operand.startsWith('+'));
  const moment = new Date(when);
  c.out(`${format ? strftime(moment, format.slice(1)) : strftime(moment, '%a %b %e %H:%M:%S UTC %Y')}\n`);
  return 0;
}

// ---------------------------------------------------------------- environment

function env(c) {
  const args = [...c.args];
  const overrides = [];
  while (args.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) overrides.push(args.shift());
  if (args.length > 0) return env.run(c, args, overrides);
  const merged = new Map(c.rc.env);
  for (const pair of overrides) merged.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
  merged.set('PWD', c.rc.cwd);
  merged.set('_', '/usr/bin/env');
  c.out([...merged].map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  return 0;
}
env.run = async (c, args, overrides) => {
  const saved = overrides.map((pair) => [pair.slice(0, pair.indexOf('=')), c.rc.env.get(pair.slice(0, pair.indexOf('=')))]);
  for (const pair of overrides) c.rc.env.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1));
  const result = await c.rc.runCommand(c.rc, args[0], args.slice(1), c.stdin, c.tty);
  for (const [key, value] of saved) { if (value === undefined) c.rc.env.delete(key); else c.rc.env.set(key, value); }
  c.relay(result);
  return result.exit;
};

function printenv(c) {
  if (c.args.length === 0) return env(c);
  let exit = 0;
  for (const name of c.args) {
    const value = name === 'PWD' ? c.rc.cwd : c.rc.env.get(name);
    if (value === undefined) exit = 1; else c.out(`${value}\n`);
  }
  return exit;
}

function exportCommand(c) {
  if (c.args.length === 0 || c.args[0] === '-p') {
    c.out([...c.rc.env].map(([key, value]) => `declare -x ${key}="${value}"`).join('\n') + '\n');
    return 0;
  }
  let exit = 0;
  for (const arg of c.args) {
    if (arg.startsWith('-')) continue;
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg : arg.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { c.err(`bash: export: \`${arg}': not a valid identifier\n`); exit = 1; continue; }
    if (eq >= 0) c.rc.env.set(name, arg.slice(eq + 1));
  }
  return exit;
}

function unset(c) {
  for (const name of c.args) if (!name.startsWith('-')) c.rc.env.delete(name);
  return 0;
}

// ---------------------------------------------------------------- tiny utilities

const trueCommand = () => 0;
const falseCommand = () => 1;

function exitCommand(c) {
  c.out('logout\n(this is a simulated shell: there is no session to close, keep exploring or just close the tab)\n');
  return 0;
}

function history(c) { c.out('history is kept in your browser, use the up arrow\n'); return 0; }

function clear(c) { c.effect = 'clear'; return 0; }

function sleep(c) {
  if (c.args.length === 0) { c.err("sleep: missing operand\nTry 'sleep --help' for more information.\n"); return 1; }
  for (const arg of c.args) {
    if (!/^\d+(\.\d+)?[smhd]?$/.test(arg)) { c.err(`sleep: invalid time interval '${arg}'\nTry 'sleep --help' for more information.\n`); return 1; }
  }
  return 0;
}

function expr(c) {
  const args = c.args;
  if (args.length === 0) { c.err('expr: missing operand\n'); return 2; }
  if (args[0] === 'length' && args.length === 2) { c.out(`${Array.from(args[1]).length}\n`); return args[1] === '' ? 1 : 0; }
  if (args.length === 3) {
    const [a, op, b] = args;
    const x = Number(a);
    const y = Number(b);
    const numeric = !Number.isNaN(x) && !Number.isNaN(y) && a !== '' && b !== '';
    let result;
    if (['+', '-', '*', '/', '%'].includes(op)) {
      if (!numeric) { c.err('expr: non-integer argument\n'); return 2; }
      if ((op === '/' || op === '%') && y === 0) { c.err('expr: division by zero\n'); return 2; }
      result = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? Math.trunc(x / y) : x % y;
    } else if (['<', '<=', '=', '==', '!=', '>=', '>'].includes(op)) {
      const l = numeric ? x : a;
      const r = numeric ? y : b;
      result = { '<': l < r, '<=': l <= r, '=': l === r, '==': l === r, '!=': l !== r, '>=': l >= r, '>': l > r }[op] ? 1 : 0;
    } else { c.err('expr: syntax error\n'); return 2; }
    c.out(`${result}\n`);
    return String(result) === '0' ? 1 : 0;
  }
  if (args.length === 1) { c.out(`${args[0]}\n`); return args[0] === '' || args[0] === '0' ? 1 : 0; }
  c.err('expr: syntax error\n');
  return 2;
}

const BUILTIN_NAMES = new Set(['cd', 'echo', 'pwd', 'export', 'unset', 'exit', 'history', 'help', 'type', 'command', 'true', 'false', 'test', '[', 'hint', 'status', 'codes', 'printf']);

function which(c) {
  let exit = 0;
  for (const name of c.args.filter((arg) => !arg.startsWith('-'))) {
    if (c.rc.registry.has(name)) c.out(`/usr/bin/${name}\n`);
    else exit = 1;
  }
  return exit;
}

function type(c) {
  let exit = 0;
  for (const name of c.args.filter((arg) => !arg.startsWith('-'))) {
    if (BUILTIN_NAMES.has(name)) c.out(`${name} is a shell builtin\n`);
    else if (c.rc.registry.has(name)) c.out(`${name} is /usr/bin/${name}\n`);
    else { c.err(`bash: type: ${name}: not found\n`); exit = 1; }
  }
  return exit;
}

async function command(c) {
  const args = [...c.args];
  if (args[0] === '-v' || args[0] === '-V') {
    let exit = 0;
    for (const name of args.slice(1)) {
      if (BUILTIN_NAMES.has(name)) c.out(args[0] === '-V' ? `${name} is a shell builtin\n` : `${name}\n`);
      else if (c.rc.registry.has(name)) c.out(args[0] === '-V' ? `${name} is /usr/bin/${name}\n` : `/usr/bin/${name}\n`);
      else exit = 1;
    }
    return exit;
  }
  if (args.length === 0) return 0;
  const result = await c.rc.runCommand(c.rc, args[0], args.slice(1), c.stdin, c.tty);
  c.relay(result);
  return result.exit;
}

// ---------------------------------------------------------------- static system views

const DEFAULT_PS_AUX = `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.1 168936 11924 ?        Ss   Mar12   0:04 /sbin/init
root         412  0.0  0.1  72308  6212 ?        Ss   Mar12   0:00 /usr/sbin/sshd -D
root         518  0.0  0.0  10240  3144 ?        Ss   Mar12   0:00 /usr/sbin/cron -f
guest       1337  0.0  0.0  12488  5120 pts/0    Ss   09:26   0:00 -bash
guest       1402  0.0  0.0  13576  3328 pts/0    R+   09:30   0:00 ps aux
`;

function ps(c) {
  const processes = c.rc.mode.processes;
  if (typeof processes === 'string' && processes !== '') {
    c.out(withNewline(renderTokens(processes, c.rc.flag)));
    return 0;
  }
  const flags = c.args.join(' ');
  if (/(^|\s)-?[a-zA-Z]*[aAe][a-zA-Z]*(\s|$)/.test(flags) && c.args.length > 0) c.out(DEFAULT_PS_AUX);
  else c.out('    PID TTY          TIME CMD\n   1337 pts/0    00:00:00 bash\n   1402 pts/0    00:00:00 ps\n');
  return 0;
}

function crontab(c) {
  if (c.args.includes('-l')) {
    const text = mapStatic(c, 'crontab', null);
    if (text === null) { c.err(`no crontab for ${c.rc.user}\n`); return 1; }
    c.out(withNewline(text));
    return 0;
  }
  if (c.args.includes('-e') || c.args.includes('-r') || c.args.length > 0) {
    c.err('crontab: the crontab is read-only in this sandbox (use crontab -l to read it)\n');
    return 1;
  }
  c.err('usage: crontab [-l]\n');
  return 1;
}

function last(c) {
  const text = mapStatic(c, 'last', null);
  c.out(text !== null ? withNewline(text) : `${c.rc.user}   pts/0        10.0.2.2         Thu Mar 14 09:26   still logged in\nreboot   system boot  ${KERNEL} Tue Mar 12 07:14   still running\n\nwtmp begins Tue Mar 12 07:14:02 2024\n`);
  return 0;
}

function who(c) {
  const text = mapStatic(c, 'who', null);
  c.out(text !== null ? withNewline(text) : `${c.rc.user}     pts/0        2024-03-14 09:26 (10.0.2.2)\n`);
  return 0;
}

function w(c) {
  const text = mapStatic(c, 'w', null);
  if (text !== null) { c.out(withNewline(text)); return 0; }
  c.out(` 09:30:00 up 2 days,  2:16,  1 user,  load average: 0.08, 0.03, 0.01\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n${c.rc.user.padEnd(8)} pts/0    10.0.2.2         09:26    0.00s  0.02s  0.00s w\n`);
  return 0;
}

function uptime(c) {
  const text = mapStatic(c, 'uptime', null);
  c.out(text !== null ? withNewline(text) : ' 09:30:00 up 2 days,  2:16,  1 user,  load average: 0.08, 0.03, 0.01\n');
  return 0;
}

function df(c) {
  const text = mapStatic(c, 'df', null);
  if (text !== null) { c.out(withNewline(text)); return 0; }
  if (c.args.some((arg) => /^-[a-zA-Z]*h/.test(arg))) {
    c.out('Filesystem      Size  Used Avail Use% Mounted on\noverlay          59G   12G   44G  22% /\ntmpfs            64M     0   64M   0% /dev\ntmpfs           1.9G     0  1.9G   0% /sys/fs/cgroup\n/dev/sda1        59G   12G   44G  22% /etc/hosts\nshm              64M     0   64M   0% /dev/shm\n');
  } else {
    c.out('Filesystem     1K-blocks     Used Available Use% Mounted on\noverlay         61255492 12238552  45880776  22% /\ntmpfs              65536        0     65536   0% /dev\ntmpfs            1983112        0   1983112   0% /sys/fs/cgroup\n/dev/sda1       61255492 12238552  45880776  22% /etc/hosts\nshm                65536        0     65536   0% /dev/shm\n');
  }
  return 0;
}

function free(c) {
  const text = mapStatic(c, 'free', null);
  if (text !== null) { c.out(withNewline(text)); return 0; }
  c.out(c.args.some((arg) => /h/.test(arg))
    ? '               total        used        free      shared  buff/cache   available\nMem:           3.8Gi       1.1Gi       1.9Gi        12Mi       812Mi       2.5Gi\nSwap:             0B          0B          0B\n'
    : '               total        used        free      shared  buff/cache   available\nMem:         3944204     1153212     1992344       12480      831912     2623420\nSwap:              0           0           0\n');
  return 0;
}

const notAvailable = (c) => { c.err('command not available in this sandbox\n'); return 1; };
const networkDisabled = (c) => { c.err(`${c.name}: network access is disabled in this sandbox\n`); return 1; };
const interactiveDisabled = (c) => { c.err(`${c.name}: interactive programs are disabled in this sandbox (read files with cat, head, tail, grep)\n`); return 1; };
const onlyBuiltins = (c) => { c.err(`${c.name}: this sandbox only has the built-in commands (type help to list them)\n`); return 127; };
const nestedShell = (c) => { c.err(`${c.name}: nested shells are disabled in this sandbox\n`); return 1; };
const notPermitted = (c) => { c.err(`${c.name}: Operation not permitted\n`); return 1; };

function su(c) { c.err('su: Authentication failure\n'); return 1; }
function kill(c) {
  if (c.args.length === 0) { c.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n'); return 2; }
  if (c.args[0] === '-l') { c.out('HUP INT QUIT KILL TERM\n'); return 0; }
  c.err(`bash: kill: (${c.args[c.args.length - 1]}) - Operation not permitted\n`);
  return 1;
}

function source(c) { c.err(`bash: ${c.name}: scripts are not supported in this sandbox\n`); return 1; }
function alias() { return 0; }

export const commands = {
  echo, printf, whoami, id, groups, hostname, uname, date, env, printenv, export: exportCommand, unset,
  true: trueCommand, false: falseCommand, exit: exitCommand, logout: exitCommand, history, clear, sleep, expr, which, type, command,
  ps, crontab, last, who, w, uptime, df, free,
  ss: notAvailable, netstat: notAvailable, ifconfig: notAvailable, ip: notAvailable,
  ping: networkDisabled, curl: networkDisabled, wget: networkDisabled, ssh: networkDisabled, scp: networkDisabled, nc: networkDisabled,
  ncat: networkDisabled, telnet: networkDisabled, ftp: networkDisabled, nmap: networkDisabled, dig: networkDisabled,
  nslookup: networkDisabled, traceroute: networkDisabled,
  vi: interactiveDisabled, vim: interactiveDisabled, nano: interactiveDisabled, emacs: interactiveDisabled, top: interactiveDisabled, htop: interactiveDisabled,
  python: onlyBuiltins, python3: onlyBuiltins, perl: onlyBuiltins, ruby: onlyBuiltins, node: onlyBuiltins, php: onlyBuiltins, gcc: onlyBuiltins, make: onlyBuiltins,
  apt: notPermitted, 'apt-get': notPermitted, dpkg: notPermitted, pip: notPermitted, pip3: notPermitted, systemctl: notPermitted, service: notPermitted,
  passwd: notPermitted, mount: notPermitted, umount: notPermitted,
  sh: nestedShell, bash: nestedShell, zsh: nestedShell, dash: nestedShell,
  su, kill, pkill: kill, killall: kill, source, '.': source, alias,
};

