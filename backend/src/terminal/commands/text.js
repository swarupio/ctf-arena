// Text filters: sort uniq cut tr rev paste column comm seq xargs. Sorting is C-locale (byte order).
import { LIMITS } from '../limits.js';
import {
  asText, cmpBytes, forEachInput, joinLines, pad, parseArgs, pushAll, readOperand, splitLines, usageError,
} from './util.js';

// ---------------------------------------------------------------- sort

const HUMAN = { '': 0, K: 1, M: 2, G: 3, T: 4, P: 5, E: 6 };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function numberOf(text) {
  const match = /^[ \t]*([-+]?)(\d*)(?:\.(\d*))?/.exec(text);
  const value = Number(`${match[2] || '0'}.${match[3] || '0'}`);
  return match[1] === '-' ? -value : value;
}

function humanOf(text) {
  const match = /^[ \t]*([-+]?)(\d*\.?\d*)([KMGTPE]?)/.exec(text);
  const value = Number(match[2] || '0') * 1024 ** HUMAN[match[3]];
  return match[1] === '-' ? -value : value;
}

function versionCompare(a, b) {
  const pa = a.match(/\d+|\D+/g) ?? [];
  const pb = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (x !== y) return cmpBytes(x, y);
  }
  return pa.length - pb.length;
}

function parseKey(spec, globalOpts, sep) {
  const match = /^(\d+)(?:\.(\d+))?([a-zA-Z]*)(?:,(\d+)(?:\.(\d+))?([a-zA-Z]*))?$/.exec(spec);
  if (!match) return null;
  const letters = `${match[3]}${match[6] ?? ''}`;
  const own = new Set(letters.split('').filter((l) => 'nrfbhMVdi'.includes(l)));
  const bad = letters.split('').find((l) => !'nrfbhMVdi'.includes(l));
  if (bad) return null;
  return {
    startField: Number(match[1]), startChar: Number(match[2] ?? 1), endField: match[4] ? Number(match[4]) : Infinity,
    endChar: match[5] ? Number(match[5]) : 0, opts: own.size > 0 ? own : globalOpts, sep,
  };
}

function splitFields(line, sep) {
  if (sep !== null) return line.split(sep);
  return line.match(/[ \t]*[^ \t]*/g).slice(0, -1);
}

function extractKey(line, key) {
  const fields = splitFields(line, key.sep);
  if (key.startField > fields.length) return '';
  const startFieldText = fields[key.startField - 1];
  let start = Math.max(0, key.startChar - 1);
  let head = startFieldText.slice(start);
  if (key.opts.has('b')) head = head.replace(/^[ \t]+/, '');
  const joiner = key.sep ?? '';
  if (key.endField === Infinity) {
    return [head, ...fields.slice(key.startField)].join(joiner);
  }
  if (key.endField === key.startField) {
    start = 0;
    return key.endChar > 0 ? startFieldText.slice(Math.max(0, key.startChar - 1), key.endChar).replace(key.opts.has('b') ? /^[ \t]+/ : /^$/, '') : head;
  }
  const middle = fields.slice(key.startField, key.endField - 1);
  const endText = fields[key.endField - 1] ?? '';
  const tail = key.endChar > 0 ? endText.slice(0, key.endChar) : endText;
  return [head, ...middle, ...(key.endField <= fields.length ? [tail] : [])].join(joiner);
}

function keyValue(text, opts) {
  let value = text;
  if (opts.has('b') && !opts.has('n')) value = value.replace(/^[ \t]+/, '');
  if (opts.has('d')) value = value.replace(/[^A-Za-z0-9 \t]/g, '');
  if (opts.has('f')) value = value.toUpperCase();
  if (opts.has('n')) return numberOf(value);
  if (opts.has('h')) return humanOf(value);
  if (opts.has('M')) {
    const idx = MONTHS.indexOf(value.trim().slice(0, 3).toUpperCase());
    return idx + 1;
  }
  return value;
}

function compareKeys(a, b, opts) {
  let result;
  if (typeof a === 'number') result = a < b ? -1 : a > b ? 1 : 0;
  else if (opts.has('V')) result = versionCompare(a, b);
  else result = cmpBytes(a, b);
  return opts.has('r') ? -result : result;
}

function sort(c) {
  const parsed = parseArgs(c.args, {
    flags: 'rnuhfbsVcMRdiCgz', values: 'ktTo',
    long: {
      reverse: 'r', 'numeric-sort': 'n', unique: 'u', 'human-numeric-sort': 'h', 'ignore-case': 'f', 'ignore-leading-blanks': 'b', stable: 's',
      'version-sort': 'V', check: 'c', 'month-sort': 'M', 'random-sort': 'R', 'dictionary-order': 'd', key: 'k', 'field-separator': 't', output: 'o',
    },
  });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  if (opts.R) { c.err('sort: random sort is disabled in this sandbox (output must be deterministic)\n'); return 2; }
  if (opts.o) { c.err(`sort: open failed: ${opts.o}: Read-only file system\n`); return 2; }
  const sep = opts.t === undefined ? null : opts.t === '\\0' ? '\0' : opts.t;
  if (sep !== null && sep.length !== 1) { c.err('sort: multi-character tab \'' + sep + "'\n"); return 2; }
  const globalOpts = new Set('nrfbhMVdi'.split('').filter((l) => opts[l] || (l === 'n' && opts.g)));
  const keys = [];
  for (const spec of parsed.all.k ?? []) {
    const key = parseKey(spec, globalOpts, sep);
    if (!key) { c.err(`sort: invalid number at field start: invalid count at start of '${spec}'\n`); return 2; }
    keys.push(key);
  }
  const keyed = keys.length > 0;
  const lines = [];
  const failures = forEachInput(c, 'sort', parsed.operands, (buf) => { pushAll(lines, splitLines(asText(buf))); });
  c.rc.tickLines(lines.length * 2);
  const entries = lines.map((line) => ({
    line,
    vals: keyed ? keys.map((key) => keyValue(extractKey(line, key), key.opts)) : [keyValue(line, globalOpts)],
  }));
  const keyOpts = keyed ? keys.map((key) => key.opts) : [globalOpts];
  const compareEntries = (x, y) => {
    for (let i = 0; i < keyOpts.length; i += 1) {
      const r = compareKeys(x.vals[i], y.vals[i], keyOpts[i]);
      if (r !== 0) return r;
    }
    return 0;
  };
  if (opts.c || opts.C) {
    for (let i = 1; i < entries.length; i += 1) {
      const r = compareEntries(entries[i - 1], entries[i]) || (keyed && !opts.s ? (globalOpts.has('r') ? -1 : 1) * cmpBytes(entries[i - 1].line, entries[i].line) : 0);
      if (r > 0 || (opts.u && r === 0)) {
        if (opts.c) c.err(`sort: ${parsed.operands[0] ?? '-'}:${i + 1}: disorder: ${entries[i].line}\n`);
        return 1;
      }
    }
    return failures > 0 ? 2 : 0;
  }
  entries.sort((x, y) => {
    const r = compareEntries(x, y);
    if (r !== 0 || opts.s || opts.u) return r;
    const last = cmpBytes(x.line, y.line);
    return globalOpts.has('r') ? -last : last;
  });
  let out = entries;
  if (opts.u) out = entries.filter((entry, i) => i === 0 || compareEntries(entries[i - 1], entry) !== 0);
  c.out(joinLines(out.map((entry) => entry.line)));
  return failures > 0 ? 2 : 0;
}

// ---------------------------------------------------------------- uniq

function skipChars(line, fields, chars) {
  let rest = line;
  for (let i = 0; i < fields; i += 1) rest = rest.replace(/^[ \t]*[^ \t]*/, '');
  return rest.slice(chars);
}

function uniq(c) {
  const parsed = parseArgs(c.args, { flags: 'cduiz', values: 'fsw', long: { count: 'c', repeated: 'd', unique: 'u', 'ignore-case': 'i', 'skip-fields': 'f', 'skip-chars': 's', 'check-chars': 'w' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const skipF = Number(opts.f ?? 0);
  const skipS = Number(opts.s ?? 0);
  const checkW = opts.w === undefined ? Infinity : Number(opts.w);
  if ([skipF, skipS].some((n) => !Number.isInteger(n) || n < 0)) { c.err("uniq: invalid number of fields to skip\n"); return 1; }
  const data = readOperand(c, 'uniq', parsed.operands[0] ?? '-');
  if (data === null) return 1;
  const lines = splitLines(asText(data));
  c.rc.tickLines(lines.length);
  const norm = (line) => {
    let text = skipChars(line, skipF, skipS).slice(0, checkW);
    if (opts.i) text = text.toLowerCase();
    return text;
  };
  const groups = [];
  for (const line of lines) {
    const key = norm(line);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.count += 1;
    else groups.push({ key, line, count: 1 });
  }
  const out = [];
  for (const group of groups) {
    if (opts.d && group.count < 2) continue;
    if (opts.u && group.count > 1) continue;
    out.push(opts.c ? `${pad(group.count, 7)} ${group.line}` : group.line);
  }
  c.out(joinLines(out));
  return 0;
}

// ---------------------------------------------------------------- cut

function parseList(spec) {
  const ranges = [];
  for (const part of spec.split(',')) {
    const match = /^(\d*)(-?)(\d*)$/.exec(part);
    if (!match || part === '' || part === '-') return null;
    const from = match[1] === '' ? 1 : Number(match[1]);
    const to = match[2] === '' ? from : match[3] === '' ? Infinity : Number(match[3]);
    if (from === 0 || to < from) return null;
    ranges.push([from, to]);
  }
  return ranges;
}
const inRanges = (ranges, index) => ranges.some(([from, to]) => index >= from && index <= to);

function cut(c) {
  const parsed = parseArgs(c.args, {
    flags: 'sz', values: 'dfcb', long: { delimiter: 'd', fields: 'f', characters: 'c', bytes: 'b', 'only-delimited': 's', complement: { key: 'complement', arg: 'none' }, 'output-delimiter': { key: 'od', arg: 'required' } },
  });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const mode = opts.f !== undefined ? 'f' : opts.c !== undefined ? 'c' : opts.b !== undefined ? 'b' : null;
  if (!mode) { c.err('cut: you must specify a list of bytes, characters, or fields\nTry \'cut --help\' for more information.\n'); return 1; }
  const ranges = parseList(String(opts[mode]));
  if (!ranges) { c.err(`cut: invalid ${mode === 'f' ? 'field' : 'byte/character position'} range\nTry 'cut --help' for more information.\n`); return 1; }
  const delim = opts.d === undefined ? '\t' : opts.d;
  if (delim.length !== 1) { c.err('cut: the delimiter must be a single character\nTry \'cut --help\' for more information.\n'); return 1; }
  const outDelim = opts.od ?? delim;
  const pick = (index) => inRanges(ranges, index) !== Boolean(opts.complement);
  const failures = forEachInput(c, 'cut', parsed.operands, (buf) => {
    const lines = splitLines(asText(buf));
    c.rc.tickLines(lines.length);
    const out = [];
    for (const line of lines) {
      if (mode === 'f') {
        if (!line.includes(delim)) { if (!opts.s) out.push(line); continue; }
        out.push(line.split(delim).filter((_, i) => pick(i + 1)).join(outDelim));
      } else {
        out.push(Array.from(line).filter((_, i) => pick(i + 1)).join(''));
      }
    }
    c.out(joinLines(out));
  });
  return failures > 0 ? 1 : 0;
}

// ---------------------------------------------------------------- tr

const CLASS_TEST = {
  alpha: (ch) => /[A-Za-z]/.test(ch), digit: (ch) => /[0-9]/.test(ch), alnum: (ch) => /[A-Za-z0-9]/.test(ch),
  upper: (ch) => /[A-Z]/.test(ch), lower: (ch) => /[a-z]/.test(ch), space: (ch) => /[ \t\n\v\f\r]/.test(ch),
  blank: (ch) => ch === ' ' || ch === '\t', punct: (ch) => /[!-/:-@[-`{-~]/.test(ch), xdigit: (ch) => /[0-9A-Fa-f]/.test(ch),
  cntrl: (ch) => ch < ' ' || ch === '\x7f', print: (ch) => ch >= ' ' && ch <= '~', graph: (ch) => ch > ' ' && ch <= '~',
};

function expandSet(spec) {
  // First pass: unescape into tokens { ch, literal }.
  const tokens = [];
  for (let i = 0; i < spec.length; i += 1) {
    const ch = spec[i];
    if (ch === '[' && spec[i + 1] === ':') {
      const close = spec.indexOf(':]', i + 2);
      if (close > 0) {
        const name = spec.slice(i + 2, close);
        const test = CLASS_TEST[name];
        if (!test) throw new Error(`invalid character class '${name}'`);
        for (let code = 0; code < 128; code += 1) if (test(String.fromCharCode(code))) tokens.push({ ch: String.fromCharCode(code), cls: true });
        i = close + 1;
        continue;
      }
    }
    if (ch === '\\' && i + 1 < spec.length) {
      const next = spec[i + 1];
      const simple = { n: '\n', t: '\t', r: '\r', '\\': '\\', a: '\x07', b: '\b', f: '\f', v: '\v' };
      if (Object.hasOwn(simple, next)) { tokens.push({ ch: simple[next] }); i += 1; continue; }
      const oct = /^[0-7]{1,3}/.exec(spec.slice(i + 1));
      if (oct) { tokens.push({ ch: String.fromCharCode(parseInt(oct[0], 8) & 0xff) }); i += oct[0].length; continue; }
      tokens.push({ ch: next });
      i += 1;
      continue;
    }
    tokens.push({ ch });
  }
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tokens[i + 1] && tokens[i + 1].ch === '-' && !tokens[i + 1].cls && tokens[i + 2] && !tok.cls) {
      const from = tok.ch.charCodeAt(0);
      const to = tokens[i + 2].ch.charCodeAt(0);
      if (to < from) throw new Error(`range-endpoints of '${tok.ch}-${tokens[i + 2].ch}' are in reverse collating sequence order`);
      for (let code = from; code <= to; code += 1) out.push(String.fromCharCode(code));
      i += 2;
    } else out.push(tok.ch);
  }
  return out;
}

function tr(c) {
  const parsed = parseArgs(c.args, { flags: 'dscCt', long: { delete: 'd', 'squeeze-repeats': 's', complement: 'c', 'truncate-set1': 't' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts, operands } = parsed;
  const complement = Boolean(opts.c || opts.C);
  if (operands.length === 0) { c.err("tr: missing operand\nTry 'tr --help' for more information.\n"); return 1; }
  // Translating needs two strings; -d alone and -s alone take one (-s with two translates then squeezes).
  const translating = !opts.d && !opts.s;
  if ((translating || (opts.d && opts.s)) && operands.length < 2) {
    const why = translating ? 'translating' : 'both deleting and squeezing repeats';
    c.err(`tr: missing operand after '${operands[0]}'\nTwo strings must be given when ${why}.\nTry 'tr --help' for more information.\n`);
    return 1;
  }
  if (operands.length > 2) { c.err(`tr: extra operand '${operands[2]}'\nTry 'tr --help' for more information.\n`); return 1; }
  let set1;
  let set2;
  try {
    set1 = expandSet(operands[0]);
    set2 = operands[1] === undefined ? null : expandSet(operands[1]);
  } catch (error) {
    c.err(`tr: ${error.message}\n`);
    return 1;
  }
  const member = new Set(set1);
  const inSet1 = (ch) => member.has(ch) !== complement;
  const translate = !opts.d && set2 !== null;
  let mapping = null;
  let lastOfSet2 = null;
  if (translate) {
    if (set2.length === 0) { c.err('tr: when not truncating set1, string2 must be non-empty\n'); return 1; }
    lastOfSet2 = set2[set2.length - 1];
    mapping = new Map();
    if (!complement) {
      const source = opts.t ? set1.slice(0, set2.length) : set1;
      source.forEach((ch, i) => { if (!mapping.has(ch)) mapping.set(ch, set2[Math.min(i, set2.length - 1)]); });
    } else {
      let i = 0;
      for (let code = 0; code < 256; code += 1) {
        const ch = String.fromCharCode(code);
        if (!member.has(ch)) { mapping.set(ch, set2[Math.min(i, set2.length - 1)]); i += 1; }
      }
    }
  }
  const squeezeSet = opts.s ? new Set(set2 ?? set1) : null;
  const squeezeIsComplement = opts.s && set2 === null && complement;
  const data = asText(c.stdin);
  c.rc.tick(1 + (data.length >> 10));
  let out = '';
  let previous = null;
  for (const ch of data) {
    let current = ch;
    if (opts.d && inSet1(ch)) { continue; }
    if (translate && inSet1(ch)) current = mapping.has(ch) ? mapping.get(ch) : lastOfSet2;
    if (squeezeSet) {
      const squeezable = squeezeIsComplement ? !squeezeSet.has(current) : squeezeSet.has(current);
      if (squeezable && previous === current) continue;
    }
    out += current;
    previous = current;
  }
  c.out(out);
  return 0;
}

// ---------------------------------------------------------------- small filters

function rev(c) {
  const parsed = parseArgs(c.args, {});
  if (parsed.error) return usageError(c, parsed.error);
  const failures = forEachInput(c, 'rev', parsed.operands, (buf) => {
    const lines = splitLines(asText(buf));
    c.rc.tickLines(lines.length);
    c.out(joinLines(lines.map((line) => Array.from(line).reverse().join(''))));
  });
  return failures > 0 ? 1 : 0;
}

function paste(c) {
  const parsed = parseArgs(c.args, { flags: 's', values: 'd', long: { serial: 's', delimiters: 'd' } });
  if (parsed.error) return usageError(c, parsed.error);
  const delims = (parsed.opts.d ?? '\t').replace(/\\t/g, '\t').replace(/\\n/g, '\n').split('');
  const files = (parsed.operands.length > 0 ? parsed.operands : ['-']).map((operand) => {
    const data = readOperand(c, 'paste', operand);
    return data === null ? null : splitLines(asText(data));
  });
  if (files.includes(null)) return 1;
  c.rc.tickLines(files.reduce((sum, f) => sum + f.length, 0));
  const joinWith = (parts) => parts.reduce((acc, part, i) => (i === 0 ? part : acc + delims[(i - 1) % delims.length] + part), '');
  if (parsed.opts.s) { c.out(joinLines(files.map((lines) => joinWith(lines)))); return 0; }
  const rows = Math.max(0, ...files.map((f) => f.length));
  const out = [];
  for (let i = 0; i < rows; i += 1) out.push(joinWith(files.map((f) => f[i] ?? '')));
  c.out(joinLines(out));
  return 0;
}

function column(c) {
  const parsed = parseArgs(c.args, { flags: 't', values: 'soN', long: { table: 't', separator: 's', 'output-separator': 'o' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const failures = forEachInput(c, 'column', parsed.operands, (buf) => {
    const lines = splitLines(asText(buf));
    c.rc.tickLines(lines.length);
    if (!opts.t) { c.out(joinLines(lines)); return; }
    const splitOn = (line, chars) => {
      const parts = [''];
      for (const ch of line) { if (chars.includes(ch)) parts.push(''); else parts[parts.length - 1] += ch; }
      return parts;
    };
    const rows = lines.map((line) => (opts.s === undefined ? line.trim().split(/[ \t]+/) : splitOn(line, opts.s))).filter((row) => row.length > 1 || row[0] !== '');
    const widths = [];
    for (const row of rows) row.forEach((cell, i) => { widths[i] = Math.max(widths[i] ?? 0, cell.length); });
    const sepOut = opts.o ?? '  ';
    c.out(joinLines(rows.map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]) + sepOut)).join(''))));
  });
  return failures > 0 ? 1 : 0;
}

function comm(c) {
  const parsed = parseArgs(c.args, { flags: '123', long: {} });
  if (parsed.error) return usageError(c, parsed.error);
  if (parsed.operands.length !== 2) { c.err("comm: missing operand\nTry 'comm --help' for more information.\n"); return 1; }
  const [a, b] = parsed.operands.map((operand) => {
    const data = readOperand(c, 'comm', operand);
    return data === null ? null : splitLines(asText(data));
  });
  if (!a || !b) return 1;
  c.rc.tickLines(a.length + b.length);
  const { opts } = parsed;
  const col2 = opts['1'] ? '' : '\t';
  const col3 = (opts['1'] ? '' : '\t') + (opts['2'] ? '' : '\t');
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const r = i >= a.length ? 1 : j >= b.length ? -1 : cmpBytes(a[i], b[j]);
    if (r < 0) { if (!opts['1']) out.push(a[i]); i += 1; }
    else if (r > 0) { if (!opts['2']) out.push(col2 + b[j]); j += 1; }
    else { if (!opts['3']) out.push(col3 + a[i]); i += 1; j += 1; }
  }
  c.out(joinLines(out));
  return 0;
}

function seq(c) {
  const parsed = parseArgs(c.args, { flags: 'w', values: 's', long: { 'equal-width': 'w', separator: 's' } });
  if (parsed.error) {
    // allow negative numbers such as `seq -3 3`
    const negatives = c.args.filter((arg) => /^-\d/.test(arg));
    if (negatives.length === 0) return usageError(c, parsed.error);
  }
  const nums = c.args.filter((arg) => /^-?\d+(\.\d+)?$/.test(arg)).map(Number);
  if (nums.length === 0 || nums.length > 3) { c.err("seq: missing operand\nTry 'seq --help' for more information.\n"); return 1; }
  const [first, step, last] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
  if (step === 0) { c.err("seq: invalid Zero increment value: '0'\nTry 'seq --help' for more information.\n"); return 1; }
  const values = [];
  const decimals = Math.max(...c.args.filter((arg) => /^-?\d+\.\d+$/.test(arg)).map((arg) => arg.split('.')[1].length), 0);
  for (let v = first; step > 0 ? v <= last + 1e-9 : v >= last - 1e-9; v += step) {
    values.push(decimals > 0 ? v.toFixed(decimals) : String(v));
    if (values.length % 1000 === 0) c.rc.tick(250);
    if (values.length > 200000) { c.rc.tick(LIMITS.MAX_WORK); }
  }
  const width = parsed.opts?.w ? values.reduce((max, v) => Math.max(max, v.length), 0) : 0;
  const sepOut = parsed.opts?.s ?? '\n';
  c.out(values.map((v) => (width ? v.padStart(width, '0') : v)).join(sepOut) + (values.length > 0 ? '\n' : ''));
  return 0;
}

// ---------------------------------------------------------------- xargs

function splitItems(text, { nul, delimiter, byLine }) {
  if (nul) return text.split('\0').filter((item, i, all) => !(i === all.length - 1 && item === ''));
  if (delimiter !== null) return text.split(delimiter).filter((item, i, all) => !(i === all.length - 1 && item === ''));
  if (byLine) return text.split('\n').filter((item) => item !== '').map((item) => item.replace(/^[ \t]+/, ''));
  const items = [];
  let current = '';
  let started = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) { current += text[i + 1]; started = true; i += 1; continue; }
    if (ch === "'" || ch === '"') {
      const close = text.indexOf(ch, i + 1);
      if (close < 0) throw new Error(`unmatched ${ch === '"' ? 'double' : 'single'} quote; by default quotes are special to xargs unless you use the -0 option`);
      current += text.slice(i + 1, close);
      started = true;
      i = close;
      continue;
    }
    if (/\s/.test(ch)) { if (started) { items.push(current); current = ''; started = false; } continue; }
    current += ch;
    started = true;
  }
  if (started) items.push(current);
  return items;
}

async function xargs(c) {
  const parsed = parseArgs(c.args, {
    flags: '0rtpx', values: 'nIiLdPsE', stopAtOperand: true,
    long: { 'null': '0', 'max-args': 'n', 'replace': 'I', delimiter: 'd', 'no-run-if-empty': 'r', 'max-procs': 'P' },
  });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  if ((c.rc.xargsDepth ?? 0) >= LIMITS.MAX_XARGS_DEPTH) { c.err('xargs: command nesting too deep\n'); return 126; }
  const replace = opts.I ?? opts.i;
  const perBatch = opts.n === undefined ? (opts.L === undefined ? 5000 : Number(opts.L)) : Number(opts.n);
  if (!Number.isInteger(perBatch) || perBatch < 1) { c.err(`xargs: invalid number for -n option\n`); return 1; }
  const delimiter = opts.d === undefined ? null : opts.d.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\0/g, '\0');
  let items;
  try {
    items = splitItems(asText(c.stdin), { nul: Boolean(opts['0']), delimiter, byLine: replace !== undefined });
  } catch (error) {
    c.err(`xargs: ${error.message}\n`);
    return 1;
  }
  const command = parsed.operands.length > 0 ? parsed.operands : ['echo'];
  if (items.length === 0 && opts.r) return 0;
  const batches = [];
  if (replace !== undefined) for (const item of items) batches.push([item]);
  else if (items.length === 0) batches.push([]);
  else for (let i = 0; i < items.length; i += perBatch) batches.push(items.slice(i, i + perBatch));
  const sub = Object.create(c.rc);
  sub.xargsDepth = (c.rc.xargsDepth ?? 0) + 1;
  let exit = 0;
  for (const batch of batches) {
    c.rc.tick(LIMITS.LOOP_COST);
    const argv = replace !== undefined
      ? command.map((word) => word.split(replace).join(batch[0]))
      : [...command, ...batch];
    if (opts.t) c.err(`${argv.join(' ')}\n`);
    const result = await c.rc.runCommand(sub, argv[0], argv.slice(1), null, false);
    c.relay(result);
    if (result.exit !== 0) exit = result.exit === 127 || result.exit === 126 ? result.exit : 123;
  }
  return exit;
}

export const commands = { sort, uniq, cut, tr, rev, paste, column, comm, seq, xargs };
