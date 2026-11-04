// Filesystem commands: ls cd pwd cat tac head tail nl wc stat file tree du and the /tmp-only mutators.
// Sorting is C-locale (byte order) everywhere, like `LC_ALL=C ls`.
import {
  FIXED_NOW, FIXED_NOW_ISO, basenameOf, cmpBytes, dirnameOf, joinPath, modeString, nodeSize, resolvePath,
} from '../vfs.js';
import {
  absPath, asBuf, asText, errnoText, forEachInput, humanSize, isDevNull, joinLines, lsDate, mtimeMs, openOperand, pad,
  parseArgs, readOperand, splitLines, usageError,
} from './util.js';

const SGR = { dir: '1;34', link: '1;36', exec: '1;32' };
const paint = (text, code) => `\x1b[${code}m${text}\x1b[0m`;
const kindOf = (node) => (node.type === 'dir' ? 'dir' : node.type === 'link' ? 'link' : (node.mode & 0o111) !== 0 ? 'exec' : 'file');
const colorName = (name, node, color) => (color && SGR[kindOf(node)] ? paint(name, SGR[kindOf(node)]) : name);
const sizeOf = (c, node) => nodeSize(node, c.rc.flag);

// ---------------------------------------------------------------- ls

function colorWanted(c, value) {
  if (value === 'never' || value === 'no' || value === 'none') return false;
  if (value === 'always' || value === 'yes' || value === 'force' || value === true) return true;
  return c.tty;
}

function indicatorFor(node, opts) {
  if (opts.F) {
    if (node.type === 'dir') return '/';
    if (node.type === 'link') return '@';
    if (node.mode & 0o111) return '*';
  } else if (opts.p && node.type === 'dir') return '/';
  return '';
}

function columnLayout(items, width = 80) {
  const n = items.length;
  if (n === 0) return '';
  const widths = items.map((item) => item.plain.length);
  for (let cols = Math.min(n, Math.floor(width / 3)); cols >= 1; cols -= 1) {
    const rows = Math.ceil(n / cols);
    if (Math.ceil(n / rows) !== cols) continue;
    const colWidths = [];
    for (let col = 0; col < cols; col += 1) {
      let max = 0;
      for (let row = 0; row < rows; row += 1) {
        const index = col * rows + row;
        if (index < n) max = Math.max(max, widths[index]);
      }
      colWidths.push(max);
    }
    const total = colWidths.reduce((sum, w) => sum + w, 0) + 2 * (cols - 1);
    if (total > width && cols > 1) continue;
    const lines = [];
    for (let row = 0; row < rows; row += 1) {
      let line = '';
      for (let col = 0; col < cols; col += 1) {
        const index = col * rows + row;
        if (index >= n) break;
        const isLast = index + rows >= n;
        line += isLast ? items[index].shown : items[index].shown + ' '.repeat(colWidths[col] - widths[index] + 2);
      }
      lines.push(line);
    }
    return `${lines.join('\n')}\n`;
  }
  return `${items.map((item) => item.shown).join('\n')}\n`;
}

function sortEntries(c, entries, opts) {
  const list = [...entries];
  if (!opts.U) {
    if (opts.t) list.sort((a, b) => (mtimeMs(b.node) - mtimeMs(a.node)) || cmpBytes(a.name, b.name));
    else if (opts.S) list.sort((a, b) => (sizeOf(c, b.node) - sizeOf(c, a.node)) || cmpBytes(a.name, b.name));
    else list.sort((a, b) => cmpBytes(a.name, b.name));
  }
  if (opts.r) list.reverse();
  return list;
}

function formatEntries(c, entries, opts, color) {
  if (!opts.l) {
    const items = entries.map((entry) => {
      const mark = indicatorFor(entry.node, opts);
      return { plain: entry.name + mark, shown: colorName(entry.name, entry.node, color) + mark };
    });
    if (c.tty && !opts['1']) return columnLayout(items);
    return items.length > 0 ? `${items.map((item) => item.shown).join('\n')}\n` : '';
  }
  const rows = entries.map((entry) => {
    const { node } = entry;
    const size = sizeOf(c, node);
    let links = 1;
    if (node.type === 'dir') {
      links = 2;
      for (const [, child] of c.rc.fs.entries(entry.phys ?? '/', node)) if (child.type === 'dir') links += 1;
    }
    const mark = indicatorFor(node, opts);
    let name = colorName(entry.name, node, color) + mark;
    if (node.type === 'link') name += ` -> ${node.target}`;
    return {
      perm: modeString(node), links: String(links), owner: node.owner ?? 'guest', group: node.group ?? 'guest',
      size: opts.h ? humanSize(size) : String(size), date: lsDate(node.mtime, FIXED_NOW), name,
    };
  });
  const w = (key) => rows.reduce((max, row) => Math.max(max, row[key].length), 0);
  const [wl, wo, wg, ws] = [w('links'), w('owner'), w('group'), w('size')];
  return rows.map((r) => `${r.perm} ${pad(r.links, wl)} ${r.owner.padEnd(wo)} ${r.group.padEnd(wg)} ${pad(r.size, ws)} ${r.date} ${r.name}\n`).join('');
}

function totalBlocks(c, entries, opts) {
  let kb = 0;
  for (const { node } of entries) {
    if (node.type === 'link') continue;
    kb += node.type === 'dir' ? 4 : Math.ceil(sizeOf(c, node) / 4096) * 4;
  }
  return opts.h ? humanSize(kb * 1024) : String(kb);
}

function ls(c) {
  const parsed = parseArgs(c.args, {
    flags: 'aAl1hRtrSdFpUCxGginskm',
    long: {
      all: 'a', 'almost-all': 'A', 'human-readable': 'h', recursive: 'R', reverse: 'r', directory: 'd', classify: 'F',
      color: { key: 'color', arg: 'optional' }, 'group-directories-first': 'G',
    },
  });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const color = colorWanted(c, opts.color);
  const operands = parsed.operands.length > 0 ? parsed.operands : ['.'];
  const { fs } = c.rc;
  let exit = 0;
  const files = [];
  const dirs = [];
  for (const operand of operands) {
    const noFollow = fs.lookup(operand, { follow: false, cwd: c.rc.cwd });
    if (noFollow.error) {
      c.err(`ls: cannot access '${operand}': ${errnoText(noFollow.error)}\n`);
      exit = 2;
      continue;
    }
    let { node, path } = noFollow;
    if (node.type === 'link' && !opts.l && !opts.d && !opts.F) {
      const followed = fs.lookup(operand, { follow: true, cwd: c.rc.cwd });
      if (followed.error) { c.err(`ls: cannot access '${operand}': ${errnoText(followed.error)}\n`); exit = 2; continue; }
      ({ node, path } = followed);
    }
    if (node.type === 'dir' && !opts.d) dirs.push({ name: operand, node, phys: path });
    else files.push({ name: operand, node, phys: path });
  }
  let printed = false;
  if (files.length > 0) {
    c.out(formatEntries(c, sortEntries(c, files, opts), opts, color));
    printed = true;
  }
  const showHeaders = operands.length > 1 || opts.R;
  const state = { count: 0 };
  const listDir = (display, phys, node) => {
    c.rc.tick(1);
    if (!fs.canRead(node)) {
      c.err(`ls: cannot open directory '${display}': Permission denied\n`);
      exit = 2;
      return;
    }
    if (printed) c.out('\n');
    if (showHeaders) c.out(`${display}:\n`);
    printed = true;
    let entries = fs.entries(phys, node).map(([name, child]) => ({ name, node: child, phys: joinPath(phys, name) }));
    const subdirs = entries.filter((entry) => entry.node.type === 'dir' && !(entry.name.startsWith('.') && !opts.a && !opts.A));
    if (!opts.a && !opts.A) entries = entries.filter((entry) => !entry.name.startsWith('.'));
    if (opts.a) {
      const parent = fs.lookup(joinPath(phys, '..'));
      entries = [{ name: '.', node, phys }, { name: '..', node: parent.error ? node : parent.node, phys: parent.path ?? phys }, ...entries];
    }
    const sorted = sortEntries(c, entries, opts);
    if (opts.l) c.out(`total ${totalBlocks(c, sorted, opts)}\n`);
    c.out(formatEntries(c, sorted, opts, color));
    if (opts.R) {
      for (const sub of sortEntries(c, subdirs, opts)) {
        state.count += 1;
        if (state.count > 2000) return;
        const child = fs.lookup(sub.phys, { follow: false });
        if (!child.error) listDir(display === '/' ? `/${sub.name}` : `${display}/${sub.name}`, child.path, child.node);
      }
    }
  };
  for (const dirEntry of dirs) listDir(dirEntry.name, dirEntry.phys, dirEntry.node);
  return exit;
}

// ---------------------------------------------------------------- cd / pwd

function cd(c) {
  const args = c.args.filter((arg) => arg !== '-P' && arg !== '-L' && arg !== '--');
  if (args.length > 1) { c.err('bash: cd: too many arguments\n'); return 1; }
  let target = args[0] ?? c.rc.home;
  let echoed = false;
  if (target === '-') {
    if (!c.rc.oldpwd) { c.err('bash: cd: OLDPWD not set\n'); return 1; }
    target = c.rc.oldpwd;
    echoed = true;
  }
  const abs = resolvePath(c.rc.cwd, target, c.rc.home);
  const found = c.rc.fs.lookup(abs);
  if (found.error) { c.err(`bash: cd: ${args[0] ?? target}: ${errnoText(found.error)}\n`); return 1; }
  if (found.node.type !== 'dir') { c.err(`bash: cd: ${args[0] ?? target}: Not a directory\n`); return 1; }
  if (!c.rc.fs.canExec(found.node)) { c.err(`bash: cd: ${args[0] ?? target}: Permission denied\n`); return 1; }
  c.rc.oldpwd = c.rc.cwd;
  c.rc.env.set('OLDPWD', c.rc.cwd);
  c.rc.cwd = abs;
  if (echoed) c.out(`${abs}\n`);
  return 0;
}

function pwd(c) {
  if (c.args.includes('-P')) {
    const found = c.rc.fs.lookup(c.rc.cwd);
    c.out(`${found.error ? c.rc.cwd : found.path}\n`);
  } else c.out(`${c.rc.cwd}\n`);
  return 0;
}

// ---------------------------------------------------------------- cat family

function visible(buf, { showTabs, showEnds, showNonPrinting }) {
  let out = '';
  for (const b of buf) {
    if (b === 0x0a) out += showEnds ? '$\n' : '\n';
    else if (b === 0x09) out += showTabs ? '^I' : '\t';
    else if (showNonPrinting && b < 32) out += `^${String.fromCharCode(b + 64)}`;
    else if (showNonPrinting && b === 127) out += '^?';
    else if (showNonPrinting && b >= 128) out += `M-${b >= 160 && b < 255 ? String.fromCharCode(b - 128) : `^${String.fromCharCode((b - 128 + 64) & 127)}`}`;
    else out += String.fromCharCode(b);
  }
  return out;
}

function cat(c) {
  const parsed = parseArgs(c.args, { flags: 'nbsETAvu', long: { number: 'n', 'number-nonblank': 'b', 'squeeze-blank': 's', 'show-all': 'A', 'show-ends': 'E', 'show-tabs': 'T' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const formatted = opts.n || opts.b || opts.s || opts.E || opts.T || opts.A || opts.v;
  let lineNo = 0;
  let exit = 0;
  let previousBlank = false;
  const failures = forEachInput(c, c.name, parsed.operands, (buf) => {
    if (!formatted) { c.out(buf); return; }
    const text = visible(buf, { showTabs: opts.T || opts.A, showEnds: opts.E || opts.A, showNonPrinting: opts.v || opts.A });
    const hadNewline = text.endsWith('\n');
    let lines = text.split('\n');
    if (hadNewline) lines.pop();
    const out = [];
    c.rc.tickLines(lines.length);
    for (const line of lines) {
      const blank = line === '' || line === '$';
      if (opts.s && blank && previousBlank) continue;
      previousBlank = blank;
      if (opts.b ? !blank : opts.n) { lineNo += 1; out.push(`${pad(lineNo, 6)}\t${line}`); } else out.push(line);
    }
    lines = out;
    c.out(lines.join('\n') + (hadNewline && lines.length > 0 ? '\n' : ''));
  });
  if (failures > 0) exit = 1;
  return exit;
}

function tac(c) {
  const parsed = parseArgs(c.args, {});
  if (parsed.error) return usageError(c, parsed.error);
  const failures = forEachInput(c, 'tac', parsed.operands, (buf) => {
    const lines = splitLines(asText(buf));
    c.rc.tickLines(lines.length);
    c.out(joinLines(lines.reverse()));
  });
  return failures > 0 ? 1 : 0;
}

function parseCount(c, cmd, value, what) {
  const match = /^([+-]?)(\d+)([kKmM]?)$/.exec(value);
  if (!match) { c.err(`${cmd}: invalid number of ${what}: '${value}'\n`); return null; }
  const mult = { '': 1, k: 1024, K: 1024, m: 1048576, M: 1048576 }[match[3]];
  return { sign: match[1], n: Number(match[2]) * mult };
}

function headTail(isHead) {
  const cmd = isHead ? 'head' : 'tail';
  return (c) => {
    const parsed = parseArgs(c.args, {
      flags: 'qvf', values: 'nc', numeric: 'n',
      long: { lines: 'n', bytes: 'c', quiet: 'q', silent: 'q', verbose: 'v', follow: { key: 'f', arg: 'optional' } },
    });
    if (parsed.error) return usageError(c, parsed.error);
    const { opts } = parsed;
    const byBytes = opts.c !== undefined;
    const count = parseCount(c, cmd, String(byBytes ? opts.c : (opts.n ?? '10')), byBytes ? 'bytes' : 'lines');
    if (!count) return 1;
    const operands = parsed.operands.length > 0 ? parsed.operands : ['-'];
    const showNames = (operands.length > 1 && !opts.q) || opts.v;
    let first = true;
    let exit = 0;
    for (const operand of operands) {
      const buf = readOperand(c, cmd, operand);
      if (buf === null) { exit = 1; continue; }
      if (showNames) { c.out(`${first ? '' : '\n'}==> ${operand === '-' ? 'standard input' : operand} <==\n`); }
      first = false;
      if (byBytes) {
        const { n, sign } = count;
        if (isHead) c.out(sign === '-' ? buf.subarray(0, Math.max(0, buf.length - n)) : buf.subarray(0, n));
        else c.out(sign === '+' ? buf.subarray(Math.max(0, n - 1)) : buf.subarray(Math.max(0, buf.length - n)));
        continue;
      }
      const text = asText(buf);
      const lines = splitLines(text);
      c.rc.tickLines(lines.length);
      const endsNl = text.endsWith('\n') || text === '';
      let selected;
      if (isHead) selected = count.sign === '-' ? lines.slice(0, Math.max(0, lines.length - count.n)) : lines.slice(0, count.n);
      else if (count.sign === '+') selected = lines.slice(Math.max(0, count.n - 1));
      else selected = count.n === 0 ? [] : lines.slice(Math.max(0, lines.length - count.n));
      const includesLast = selected.length > 0 && lines.length > 0 && lines[lines.length - 1] === selected[selected.length - 1]
        && (isHead ? selected.length === lines.length : true);
      c.out(joinLines(selected).slice(0, !endsNl && includesLast ? -1 : undefined));
    }
    return exit;
  };
}

function nl(c) {
  const parsed = parseArgs(c.args, { values: 'bnwsv', long: { 'body-numbering': 'b', 'number-format': 'n', 'number-width': 'w', 'number-separator': 's', 'starting-line-number': 'v' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const style = opts.b ?? 't';
  const fmt = opts.n ?? 'rn';
  const width = Number(opts.w ?? 6) || 6;
  const sep = opts.s ?? '\t';
  let number = Number(opts.v ?? 1) || 1;
  const failures = forEachInput(c, 'nl', parsed.operands, (buf) => {
    const lines = splitLines(asText(buf));
    c.rc.tickLines(lines.length);
    c.out(lines.map((line) => {
      if (style === 'n' || (style === 't' && line === '')) return `${' '.repeat(width + sep.length)}${line}\n`;
      const value = String(number);
      number += 1;
      const label = fmt === 'ln' ? value.padEnd(width) : fmt === 'rz' ? value.padStart(width, '0') : value.padStart(width);
      return `${label}${sep}${line}\n`;
    }).join(''));
  });
  return failures > 0 ? 1 : 0;
}

// ---------------------------------------------------------------- wc

function wc(c) {
  const parsed = parseArgs(c.args, { flags: 'lwcmL', long: { lines: 'l', words: 'w', bytes: 'c', chars: 'm', 'max-line-length': 'L' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const any = opts.l || opts.w || opts.c || opts.m || opts.L;
  const show = any ? { l: opts.l, w: opts.w, m: opts.m, c: opts.c, L: opts.L } : { l: true, w: true, c: true };
  const selected = ['l', 'w', 'm', 'c', 'L'].filter((key) => show[key]);
  const operands = parsed.operands.length > 0 ? parsed.operands : ['-'];
  const rows = [];
  let exit = 0;
  for (const operand of operands) {
    const buf = readOperand(c, 'wc', operand);
    if (buf === null) { exit = 1; continue; }
    const text = asText(buf);
    let lines = 0;
    for (let i = 0; i < buf.length; i += 1) if (buf[i] === 0x0a) lines += 1;
    c.rc.tick(1 + (buf.length >> 10));
    const words = (text.match(/[^ \t\n\v\f\r]+/g) ?? []).length;
    let maxLine = 0;
    for (const line of text.split('\n')) maxLine = Math.max(maxLine, line.replace(/\t/g, '        ').length);
    rows.push({ name: operand, l: lines, w: words, m: Array.from(text).length, c: buf.length, L: maxLine });
  }
  const totals = { l: 0, w: 0, m: 0, c: 0, L: 0 };
  for (const row of rows) { for (const key of ['l', 'w', 'm', 'c']) totals[key] += row[key]; totals.L = Math.max(totals.L, row.L); }
  let width = 1;
  const fromStdin = operands.some((o) => o === '-');
  if (selected.length > 1 || operands.length > 1) {
    if (fromStdin) width = 7;
    else { width = String(totals.c).length; }
  }
  const line = (row, label) => `${selected.map((key) => pad(row[key], width)).join(' ')}${label ? ` ${label}` : ''}\n`;
  for (const row of rows) c.out(line(row, row.name === '-' && operands.length === 1 ? '' : row.name));
  if (operands.length > 1) c.out(line(totals, 'total'));
  return exit;
}

// ---------------------------------------------------------------- file / stat

const ELF_MACHINES = { 3: 'Intel 80386', 40: 'ARM', 62: 'x86-64', 183: 'ARM aarch64', 243: 'UCB RISC-V' };

function describeBytes(buf, node) {
  if (buf.length === 0) return 'empty';
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const size = buf.length >= 4 ? buf.readUInt32LE(buf.length - 4) : 0;
    return `gzip compressed data, from ${buf[9] === 0 ? 'FAT filesystem (MS-DOS, OS/2, NT)' : 'Unix'}, original size modulo 2^32 ${size}`;
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    if (buf.length >= 26 && buf.toString('latin1', 12, 16) === 'IHDR') {
      const depth = buf[24];
      const colorType = { 0: 'grayscale', 2: 'RGB', 3: 'colormap', 4: 'gray+alpha', 6: 'RGBA' }[buf[25]] ?? 'RGB';
      const unit = buf[25] === 3 ? `${depth}-bit` : `${depth}-bit/color`;
      return `PNG image data, ${buf.readUInt32BE(16)} x ${buf.readUInt32BE(20)}, ${unit} ${colorType}, non-interlaced`;
    }
    return 'PNG image data';
  }
  if (buf.length >= 20 && buf[0] === 0x7f && buf.toString('latin1', 1, 4) === 'ELF') {
    const bits = buf[4] === 2 ? '64-bit' : '32-bit';
    const endian = buf[5] === 2 ? 'MSB' : 'LSB';
    const type = buf.readUInt16LE(16);
    const kind = type === 2 ? 'executable' : type === 3 ? 'shared object' : type === 1 ? 'relocatable' : 'core file';
    const machine = ELF_MACHINES[buf.readUInt16LE(18)] ?? 'unknown arch';
    return `ELF ${bits} ${endian} ${kind}, ${machine}, version 1 (SYSV)${type === 2 ? ', statically linked' : ''}`;
  }
  if (buf.toString('latin1', 0, 4) === '%PDF') return 'PDF document, version 1.4';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'Zip archive data, at least v2.0 to extract';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'JPEG image data, JFIF standard 1.01';
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'GIF image data, version 89a';
  if (buf.toString('latin1', 0, 3) === 'BZh') return 'bzip2 compressed data, block size = 900k';
  if (buf.toString('latin1', 0, 15) === 'SQLite format 3') return 'SQLite 3.x database';
  if (buf[0] === 0xfd && buf.toString('latin1', 1, 5) === '7zXZ') return 'XZ compressed data';
  let binaryBytes = 0;
  let highBytes = 0;
  for (const b of buf) {
    if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 27 && b !== 12 && b !== 8 && b !== 7 && b !== 11)) binaryBytes += 1;
    else if (b >= 128) highBytes += 1;
  }
  if (binaryBytes > 0) return 'data';
  const text = buf.toString('utf8');
  const utf8 = highBytes > 0 && !text.includes('�');
  if (highBytes > 0 && !utf8) return 'ISO-8859 text';
  const firstLine = text.split('\n', 1)[0];
  if (firstLine.startsWith('#!')) {
    const interp = firstLine.slice(2).trim().split(/\s+/);
    const name = basenameOf(interp[0] === '/usr/bin/env' ? (interp[1] ?? 'sh') : interp[0]);
    const kind = { bash: 'Bourne-Again shell script', sh: 'POSIX shell script', python: 'Python script', python3: 'Python script', perl: 'Perl script', node: 'Node.js script', ruby: 'Ruby script' }[name];
    if (kind) return `${kind}, ${utf8 ? 'Unicode text, UTF-8 text' : 'ASCII text'} executable`;
  }
  const lines = text.split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const base = utf8 ? 'Unicode text, UTF-8 text' : 'ASCII text';
  const extras = [];
  if (longest > 300) extras.push(`with very long lines (${longest})`);
  if (/\r\n/.test(text)) extras.push('with CRLF line terminators');
  else if (/\r/.test(text)) extras.push('with CR line terminators');
  if (!text.endsWith('\n') && text.length > 0 && lines.length === 1) extras.push('with no line terminators');
  if (/\x1b/.test(text)) extras.push('with escape sequences');
  if (node && /^\s*[{[]/.test(text) && /[}\]]\s*$/.test(text) && longest > 0) {
    try { JSON.parse(text); return 'JSON text data'; } catch { /* not json */ }
  }
  return [base, ...extras].join(', ');
}

const MIME = (desc) => {
  if (desc === 'empty') return 'inode/x-empty; charset=binary';
  if (desc.startsWith('gzip')) return 'application/gzip; charset=binary';
  if (desc.startsWith('PNG')) return 'image/png; charset=binary';
  if (desc.startsWith('ELF')) return 'application/x-executable; charset=binary';
  if (desc === 'data') return 'application/octet-stream; charset=binary';
  if (desc.startsWith('directory')) return 'inode/directory; charset=binary';
  return `text/plain; charset=${desc.startsWith('ASCII') ? 'us-ascii' : 'utf-8'}`;
};

function file(c) {
  const parsed = parseArgs(c.args, { flags: 'biLs', long: { brief: 'b', mime: 'i', dereference: 'L' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  if (parsed.operands.length === 0) { c.err('Usage: file [-bhi] FILE...\n'); return 1; }
  const labelOf = (operand) => (operand === '-' ? '/dev/stdin' : operand);
  const width = Math.max(...parsed.operands.map((o) => labelOf(o).length)) + 1;
  let exit = 0;
  for (const operand of parsed.operands) {
    if (operand === '-') {
      const description = describeBytes(asBuf(c.stdin), null);
      c.out(opts.b ? `${description}\n` : `${'/dev/stdin:'.padEnd(width + 1)}${opts.i ? MIME(description) : description}\n`);
      continue;
    }
    const found = c.rc.fs.lookup(operand, { follow: Boolean(opts.L), cwd: c.rc.cwd });
    let description;
    if (found.error) {
      description = found.error === 'EACCES' ? 'cannot open (Permission denied)' : 'cannot open (No such file or directory)';
      if (found.error !== 'EACCES' && found.error !== 'ENOENT') description = `cannot open (${errnoText(found.error)})`;
    } else if (found.node.type === 'dir') description = 'directory';
    else if (found.node.type === 'link') description = `symbolic link to ${found.node.target}`;
    else if (!c.rc.fs.canRead(found.node)) description = 'regular file, no read permission';
    else description = describeBytes(c.rc.read(found.node), found.node);
    if (opts.i && !found.error) description = MIME(description);
    c.out(opts.b ? `${description}\n` : `${`${operand}:`.padEnd(width + 1)}${description}\n`);
  }
  return exit;
}

function inodeFor(path) {
  let h = 2166136261;
  for (let i = 0; i < path.length; i += 1) { h ^= path.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return 100000 + (h % 900000);
}
const uidOf = (name) => (name === 'root' ? 0 : name === 'guest' ? 1000 : 1001 + (inodeFor(name) % 500));
const stamp = (iso) => `${new Date(iso).toISOString().replace('T', ' ').replace('Z', '')}000000 +0000`.replace(/\.(\d{3})000000/, '.$1000000');

function statFormat(c, format, found, operand) {
  const { node } = found;
  const size = sizeOf(c, node);
  const typeName = node.type === 'dir' ? 'directory' : node.type === 'link' ? 'symbolic link' : size === 0 ? 'regular empty file' : 'regular file';
  const table = {
    n: operand, N: node.type === 'link' ? `'${operand}' -> '${node.target}'` : `'${operand}'`, s: String(size),
    a: (node.mode & 0o7777).toString(8).padStart(3, '0'), A: modeString(node), U: node.owner, G: node.group,
    u: String(uidOf(node.owner)), g: String(uidOf(node.group)), F: typeName, i: String(inodeFor(found.path)),
    h: node.type === 'dir' ? '2' : '1', y: stamp(node.mtime), Y: String(Math.floor(mtimeMs(node) / 1000)),
    x: stamp(node.mtime), z: stamp(node.mtime), b: String(Math.ceil(size / 512)), '%': '%',
  };
  return format.replace(/%([a-zA-Z%])/g, (whole, key) => (Object.hasOwn(table, key) ? table[key] : whole));
}

function stat(c) {
  const parsed = parseArgs(c.args, { flags: 'L', values: 'c', long: { format: 'c', 'printf': 'c', dereference: 'L' } });
  if (parsed.error) return usageError(c, parsed.error);
  if (parsed.operands.length === 0) { c.err("stat: missing operand\nTry 'stat --help' for more information.\n"); return 1; }
  let exit = 0;
  for (const operand of parsed.operands) {
    const found = c.rc.fs.lookup(operand, { follow: Boolean(parsed.opts.L), cwd: c.rc.cwd });
    if (found.error) { c.err(`stat: cannot statx '${operand}': ${errnoText(found.error)}\n`); exit = 1; continue; }
    if (parsed.opts.c !== undefined) { c.out(`${statFormat(c, parsed.opts.c, found, operand)}\n`); continue; }
    const { node } = found;
    const size = sizeOf(c, node);
    const typeName = node.type === 'dir' ? 'directory' : node.type === 'link' ? 'symbolic link' : size === 0 ? 'regular empty file' : 'regular file';
    const octal = (node.mode & 0o7777).toString(8).padStart(4, '0');
    c.out([
      `  File: ${node.type === 'link' ? `${operand} -> ${node.target}` : operand}`,
      `  Size: ${String(size).padEnd(10)}\tBlocks: ${String(node.type === 'link' ? 0 : Math.ceil(size / 4096) * 8).padEnd(10)} IO Block: 4096   ${typeName}`,
      `Device: 801h/2049d\tInode: ${String(inodeFor(found.path)).padEnd(10)} Links: ${node.type === 'dir' ? 2 : 1}`,
      `Access: (${octal}/${modeString(node)})  Uid: (${pad(uidOf(node.owner), 5)}/${pad(node.owner, 8)})   Gid: (${pad(uidOf(node.group), 5)}/${pad(node.group, 8)})`,
      `Access: ${stamp(node.mtime)}`, `Modify: ${stamp(node.mtime)}`, `Change: ${stamp(node.mtime)}`, ' Birth: -', '',
    ].join('\n'));
  }
  return exit;
}

// ---------------------------------------------------------------- tree / du

function tree(c) {
  const parsed = parseArgs(c.args, {
    flags: 'adCnfi', values: 'L', long: { all: 'a', 'dirs-only': 'd', noreport: 'noreport', charset: { key: 'charset', arg: 'required' }, level: 'L', 'full-path': 'f' },
  });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const limit = opts.L === undefined ? Infinity : Number(opts.L);
  if (!(limit >= 1)) { c.err('tree: Invalid level, must be greater than 0.\n'); return 1; }
  const color = opts.n ? false : opts.C ? true : c.tty;
  const ascii = opts.charset === 'ascii';
  const glyph = ascii ? { mid: '|-- ', last: '`-- ', bar: '|   ', gap: '    ' } : { mid: '├── ', last: '└── ', bar: '│   ', gap: '    ' };
  const operands = parsed.operands.length > 0 ? parsed.operands : ['.'];
  const { fs } = c.rc;
  let exit = 0;
  let dirCount = 0;
  let fileCount = 0;
  for (const operand of operands) {
    const found = fs.lookup(operand, { cwd: c.rc.cwd });
    if (found.error || found.node.type !== 'dir') {
      if (found.error) { c.out(`${operand} [error opening dir]\n`); exit = 2; } else { c.out(`${operand}\n`); fileCount += 1; }
      continue;
    }
    c.out(`${color ? colorName(operand, found.node, true) : operand}\n`);
    const walk = (phys, node, prefix, depth, shown) => {
      if (!fs.canRead(node) || !fs.canExec(node)) { c.out(`${prefix}[error opening dir]\n`); return; }
      let entries = fs.entries(phys, node).filter(([name]) => opts.a || !name.startsWith('.'));
      if (opts.d) entries = entries.filter(([, child]) => child.type === 'dir');
      entries.sort((a, b) => cmpBytes(a[0], b[0]));
      entries.forEach(([name, child], index) => {
        c.rc.tick(1);
        const last = index === entries.length - 1;
        const childPhys = joinPath(phys, name);
        const label = opts.f ? `${shown === '/' ? '' : shown}/${name}` : name;
        let text = colorName(label, child, color);
        if (child.type === 'link') text += ` -> ${child.target}`;
        c.out(`${prefix}${last ? glyph.last : glyph.mid}${text}\n`);
        if (child.type === 'dir') {
          dirCount += 1;
          if (depth < limit) walk(childPhys, child, prefix + (last ? glyph.gap : glyph.bar), depth + 1, label);
        } else fileCount += 1;
      });
    };
    walk(found.path, found.node, '', 1, operand);
  }
  if (!opts.noreport) {
    const dirs = `${dirCount} director${dirCount === 1 ? 'y' : 'ies'}`;
    c.out(opts.d ? `\n${dirs}\n` : `\n${dirs}, ${fileCount} file${fileCount === 1 ? '' : 's'}\n`);
  }
  return exit;
}

function du(c) {
  const parsed = parseArgs(c.args, {
    flags: 'ashcbkx', values: 'd', long: { 'human-readable': 'h', summarize: 's', total: 'c', 'apparent-size': 'b', all: 'a', 'max-depth': 'd' },
  });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const operands = parsed.operands.length > 0 ? parsed.operands : ['.'];
  const maxDepth = opts.d === undefined ? Infinity : Number(opts.d);
  const { fs } = c.rc;
  let exit = 0;
  let grand = 0;
  const unit = (bytes) => (opts.h ? humanSize(bytes) : opts.b ? String(bytes) : String(Math.ceil(bytes / 1024)));
  const own = (node) => {
    if (node.type === 'link') return opts.b ? Buffer.byteLength(node.target ?? '') : 0;
    if (node.type === 'dir') return opts.b ? 4096 : 4096;
    const size = sizeOf(c, node);
    return opts.b ? size : Math.ceil(size / 4096) * 4096;
  };
  const lines = [];
  const sizeTree = (display, phys, node, depth) => {
    c.rc.tick(1);
    let total = own(node);
    if (node.type === 'dir') {
      if (!fs.canRead(node) || !fs.canExec(node)) {
        c.err(`du: cannot read directory '${display}': Permission denied\n`);
        exit = 1;
      } else {
        for (const [name, child] of fs.entries(phys, node)) {
          total += sizeTree(display.endsWith('/') ? `${display}${name}` : `${display}/${name}`, joinPath(phys, name), child, depth + 1);
        }
      }
    }
    const emit = node.type === 'dir' ? depth <= maxDepth && !opts.s : opts.a && depth <= maxDepth && !opts.s;
    if (emit) lines.push(`${unit(total)}\t${display}`);
    return total;
  };
  for (const operand of operands) {
    const found = fs.lookup(operand, { follow: false, cwd: c.rc.cwd });
    if (found.error) { c.err(`du: cannot access '${operand}': ${errnoText(found.error)}\n`); exit = 1; continue; }
    const total = sizeTree(operand, found.path, found.node, 0);
    if (opts.s) lines.push(`${unit(total)}\t${operand}`);
    else if (found.node.type !== 'dir' && !opts.a) lines.push(`${unit(total)}\t${operand}`);
    grand += total;
  }
  if (opts.c) lines.push(`${unit(grand)}\ttotal`);
  c.out(lines.length > 0 ? `${lines.join('\n')}\n` : '');
  return exit;
}

// ---------------------------------------------------------------- mutators (only /tmp is writable)

const rofs = (c, text) => { c.err(`${c.name}: ${text}: Read-only file system\n`); return 1; };

function parentOrFail(c, path, what) {
  const parent = c.rc.fs.parentFor(path, c.rc.cwd);
  if (parent.error) {
    const reason = parent.error === 'EEXIST' ? 'File exists' : errnoText(parent.error);
    c.err(`${c.name}: ${what.replace('%s', path)}: ${reason}\n`);
    return null;
  }
  return parent;
}

function touch(c) {
  const parsed = parseArgs(c.args, { flags: 'camh', values: 'dtr', long: { 'no-create': 'c' } });
  if (parsed.error) return usageError(c, parsed.error);
  if (parsed.operands.length === 0) { c.err("touch: missing file operand\nTry 'touch --help' for more information.\n"); return 1; }
  let exit = 0;
  for (const operand of parsed.operands) {
    const found = c.rc.fs.lookup(operand, { cwd: c.rc.cwd });
    if (!found.error) {
      if (!c.rc.fs.isTmp(found.path)) exit = rofs(c, `cannot touch '${operand}'`);
      continue;
    }
    if (found.error !== 'ENOENT') { c.err(`touch: cannot touch '${operand}': ${errnoText(found.error)}\n`); exit = 1; continue; }
    if (parsed.opts.c) continue;
    const parent = parentOrFail(c, operand, "cannot touch '%s'");
    if (!parent) { exit = 1; continue; }
    c.rc.fs.setNode(parent.phys, c.rc.fs.newFile(Buffer.alloc(0)));
  }
  return exit;
}

function mkdir(c) {
  const parsed = parseArgs(c.args, { flags: 'pv', values: 'm', long: { parents: 'p', verbose: 'v', mode: 'm' } });
  if (parsed.error) return usageError(c, parsed.error);
  if (parsed.operands.length === 0) { c.err("mkdir: missing operand\nTry 'mkdir --help' for more information.\n"); return 1; }
  let exit = 0;
  for (const operand of parsed.operands) {
    const targets = [];
    if (parsed.opts.p) {
      const abs = absPath(c, operand);
      const parts = abs.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i += 1) targets.push(`/${parts.slice(0, i).join('/')}`);
    } else targets.push(operand);
    for (const [index, target] of targets.entries()) {
      const exists = c.rc.fs.lookup(target, { cwd: c.rc.cwd });
      const isLast = index === targets.length - 1;
      if (!exists.error) {
        if (!parsed.opts.p) { c.err(`mkdir: cannot create directory '${operand}': File exists\n`); exit = 1; } else if (exists.node.type !== 'dir' && isLast) { c.err(`mkdir: cannot create directory '${operand}': File exists\n`); exit = 1; }
        continue;
      }
      const parent = parentOrFail(c, target, `cannot create directory '${parsed.opts.p ? operand : '%s'}'`);
      if (!parent) { exit = 1; break; }
      c.rc.fs.setNode(parent.phys, c.rc.fs.newDir());
      if (parsed.opts.v) c.out(`mkdir: created directory '${target}'\n`);
    }
  }
  return exit;
}

function rm(c) {
  const parsed = parseArgs(c.args, { flags: 'rRfdvi', long: { recursive: 'r', force: 'f', verbose: 'v', dir: 'd', 'no-preserve-root': 'N' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  if (parsed.operands.length === 0) {
    if (opts.f) return 0;
    c.err("rm: missing operand\nTry 'rm --help' for more information.\n");
    return 1;
  }
  let exit = 0;
  for (const operand of parsed.operands) {
    if (absPath(c, operand) === '/' && (opts.r || opts.R)) {
      c.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
      exit = 1;
      continue;
    }
    const found = c.rc.fs.lookup(operand, { follow: false, cwd: c.rc.cwd });
    if (found.error) {
      if (!(opts.f && found.error === 'ENOENT')) { c.err(`rm: cannot remove '${operand}': ${errnoText(found.error)}\n`); exit = 1; }
      continue;
    }
    if (found.node.type === 'dir' && !opts.r && !opts.R && !opts.d) { c.err(`rm: cannot remove '${operand}': Is a directory\n`); exit = 1; continue; }
    if (!c.rc.fs.isTmp(found.path) || found.path === '/tmp') { exit = rofs(c, `cannot remove '${operand}'`); continue; }
    if (found.node.type === 'dir' && opts.d && !opts.r && !opts.R && c.rc.fs.entries(found.path, found.node).length > 0) {
      c.err(`rm: cannot remove '${operand}': Directory not empty\n`);
      exit = 1;
      continue;
    }
    c.rc.fs.deleteNode(found.path);
    if (opts.v) c.out(`removed '${operand}'\n`);
  }
  return exit;
}

function rmdir(c) {
  if (c.args.length === 0) { c.err("rmdir: missing operand\nTry 'rmdir --help' for more information.\n"); return 1; }
  let exit = 0;
  for (const operand of c.args.filter((a) => !a.startsWith('-'))) {
    const found = c.rc.fs.lookup(operand, { follow: false, cwd: c.rc.cwd });
    if (found.error) { c.err(`rmdir: failed to remove '${operand}': ${errnoText(found.error)}\n`); exit = 1; continue; }
    if (found.node.type !== 'dir') { c.err(`rmdir: failed to remove '${operand}': Not a directory\n`); exit = 1; continue; }
    if (c.rc.fs.entries(found.path, found.node).length > 0) { c.err(`rmdir: failed to remove '${operand}': Directory not empty\n`); exit = 1; continue; }
    if (!c.rc.fs.isTmp(found.path) || found.path === '/tmp') { c.err(`rmdir: failed to remove '${operand}': Read-only file system\n`); exit = 1; continue; }
    c.rc.fs.deleteNode(found.path);
  }
  return exit;
}

// Copies a node (recursively) into the overlay at `phys`.
function copyInto(c, node, srcPhys, phys, recursive, depth = 0) {
  c.rc.tick(1);
  const { fs } = c.rc;
  if (depth > 40) return;
  if (node.type === 'dir') {
    fs.setNode(phys, { ...fs.newDir(), mode: node.mode });
    if (!recursive) return;
    for (const [name, child] of fs.entries(srcPhys, node)) {
      if (!fs.canRead(child)) continue;
      copyInto(c, child, joinPath(srcPhys, name), joinPath(phys, name), true, depth + 1);
    }
  } else if (node.type === 'link') {
    fs.setNode(phys, { type: 'link', mode: 0o777, owner: fs.user, group: fs.user, mtime: FIXED_NOW_ISO, target: node.target });
  } else {
    fs.setNode(phys, { ...fs.newFile(Buffer.from(c.rc.read(node))), mode: node.mode & 0o777 });
  }
}

function copyOrMove(isMove) {
  const verb = isMove ? 'move' : 'copy';
  return (c) => {
    const parsed = parseArgs(c.args, { flags: 'rRafvnpPuT', long: { recursive: 'r', force: 'f', verbose: 'v', archive: 'a', 'no-clobber': 'n' } });
    if (parsed.error) return usageError(c, parsed.error);
    const { opts, operands } = parsed;
    if (operands.length < 2) {
      c.err(`${c.name}: missing destination file operand after '${operands[0] ?? ''}'\nTry '${c.name} --help' for more information.\n`);
      return 1;
    }
    const dest = operands[operands.length - 1];
    const sources = operands.slice(0, -1);
    const destInfo = c.rc.fs.lookup(dest, { cwd: c.rc.cwd });
    const destIsDir = !destInfo.error && destInfo.node.type === 'dir';
    if (sources.length > 1 && !destIsDir) { c.err(`${c.name}: target '${dest}' is not a directory\n`); return 1; }
    let exit = 0;
    for (const source of sources) {
      const src = c.rc.fs.lookup(source, { follow: !isMove && !opts.a && !opts.r && !opts.R ? true : false, cwd: c.rc.cwd });
      if (src.error) { c.err(`${c.name}: cannot stat '${source}': ${errnoText(src.error)}\n`); exit = 1; continue; }
      const real = src.node.type === 'link' && !isMove ? c.rc.fs.lookup(source, { cwd: c.rc.cwd }) : src;
      if (real.error) { c.err(`${c.name}: cannot stat '${source}': ${errnoText(real.error)}\n`); exit = 1; continue; }
      if (!isMove && real.node.type === 'dir' && !opts.r && !opts.R && !opts.a) { c.err(`cp: -r not specified; omitting directory '${source}'\n`); exit = 1; continue; }
      if (real.node.type !== 'dir' && !c.rc.fs.canRead(real.node)) { c.err(`${c.name}: cannot open '${source}' for reading: Permission denied\n`); exit = 1; continue; }
      const target = destIsDir ? joinPath(destInfo.path, basenameOf(source)) : dest;
      const parent = c.rc.fs.parentFor(target, c.rc.cwd);
      if (parent.error) {
        const reason = parent.error === 'EEXIST' ? 'File exists' : errnoText(parent.error);
        const what = isMove ? `cannot ${verb} '${source}' to '${dest}'` : `cannot create ${real.node.type === 'dir' ? 'directory' : 'regular file'} '${dest}'`;
        c.err(`${c.name}: ${what}: ${reason}\n`);
        exit = 1;
        continue;
      }
      if (isMove && !c.rc.fs.isTmp(src.path)) { c.err(`mv: cannot move '${source}' to '${dest}': Read-only file system\n`); exit = 1; continue; }
      if (opts.n && !c.rc.fs.lookup(parent.phys, { follow: false }).error) continue;
      copyInto(c, real.node, real.path, parent.phys, Boolean(isMove || opts.r || opts.R || opts.a));
      if (isMove) c.rc.fs.deleteNode(src.path);
      if (opts.v) c.out(`'${source}' -> '${target}'\n`);
    }
    return exit;
  };
}

function ln(c) {
  const parsed = parseArgs(c.args, { flags: 'sfvnT', long: { symbolic: 's', force: 'f', verbose: 'v' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { operands, opts } = parsed;
  if (operands.length < 1) { c.err("ln: missing file operand\nTry 'ln --help' for more information.\n"); return 1; }
  const target = operands[0];
  let linkName = operands[1] ?? basenameOf(target);
  const existing = c.rc.fs.lookup(linkName, { cwd: c.rc.cwd });
  if (!existing.error && existing.node.type === 'dir') linkName = `${linkName.replace(/\/+$/, '')}/${basenameOf(target)}`;
  const parent = c.rc.fs.parentFor(linkName, c.rc.cwd);
  if (parent.error) {
    const reason = parent.error === 'EEXIST' ? 'File exists' : errnoText(parent.error);
    c.err(`ln: failed to create ${opts.s ? 'symbolic' : 'hard'} link '${linkName}': ${reason}\n`);
    return 1;
  }
  if (!c.rc.fs.lookup(parent.phys, { follow: false }).error && !opts.f) {
    c.err(`ln: failed to create ${opts.s ? 'symbolic' : 'hard'} link '${linkName}': File exists\n`);
    return 1;
  }
  if (opts.s) {
    c.rc.fs.setNode(parent.phys, { type: 'link', mode: 0o777, owner: c.rc.fs.user, group: c.rc.fs.user, mtime: FIXED_NOW_ISO, target });
  } else {
    const src = openOperand(c, 'ln', target);
    if (!src) return 1;
    if (src.node.type === 'dir') { c.err(`ln: ${target}: hard link not allowed for directory\n`); return 1; }
    copyInto(c, src.node, src.path, parent.phys, false);
  }
  return 0;
}

function parseChmod(spec, current, isDir) {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
  let mode = current & 0o7777;
  for (const clause of spec.split(',')) {
    const match = /^([ugoa]*)([-+=])([rwxXst]*)$/.exec(clause);
    if (!match) return null;
    const who = match[1] === '' ? 'a' : match[1];
    let bits = 0;
    for (const perm of match[3]) {
      if (perm === 'r') bits |= 4;
      if (perm === 'w') bits |= 2;
      if (perm === 'x' || (perm === 'X' && (isDir || (current & 0o111)))) bits |= 1;
    }
    let mask = 0;
    for (const target of who === 'a' ? 'ugo' : who) mask |= bits << ({ u: 6, g: 3, o: 0 }[target]);
    let clear = 0;
    for (const target of who === 'a' ? 'ugo' : who) clear |= 7 << ({ u: 6, g: 3, o: 0 }[target]);
    if (match[2] === '+') mode |= mask;
    else if (match[2] === '-') mode &= ~mask;
    else mode = (mode & ~clear) | mask;
  }
  return mode;
}

function chmod(c) {
  const parsed = parseArgs(c.args, { flags: 'Rvf', long: { recursive: 'R' } });
  if (parsed.error) return usageError(c, parsed.error);
  const [spec, ...targets] = parsed.operands;
  if (!spec || targets.length === 0) { c.err(`chmod: missing operand${spec ? ` after '${spec}'` : ''}\nTry 'chmod --help' for more information.\n`); return 1; }
  let exit = 0;
  for (const operand of targets) {
    const found = c.rc.fs.lookup(operand, { cwd: c.rc.cwd });
    if (found.error) { c.err(`chmod: cannot access '${operand}': ${errnoText(found.error)}\n`); exit = 1; continue; }
    const mode = parseChmod(spec, found.node.mode, found.node.type === 'dir');
    if (mode === null) { c.err(`chmod: invalid mode: '${spec}'\nTry 'chmod --help' for more information.\n`); return 1; }
    if (!c.rc.fs.isTmp(found.path)) { c.err(`chmod: changing permissions of '${operand}': Read-only file system\n`); exit = 1; continue; }
    c.rc.fs.setNode(found.path, { ...found.node, mode });
  }
  return exit;
}

function chown(c) {
  const operands = c.args.filter((arg) => !arg.startsWith('-'));
  if (operands.length < 2) { c.err("chown: missing operand\nTry 'chown --help' for more information.\n"); return 1; }
  c.err(`chown: changing ownership of '${operands[1]}': Operation not permitted\n`);
  return 1;
}

function tee(c) {
  const parsed = parseArgs(c.args, { flags: 'ai', long: { append: 'a' } });
  if (parsed.error) return usageError(c, parsed.error);
  const data = asBuf(c.stdin);
  c.out(data);
  let exit = 0;
  for (const operand of parsed.operands) {
    if (isDevNull(c, operand)) continue;
    const parent = c.rc.fs.parentFor(operand, c.rc.cwd);
    if (parent.error) { c.err(`tee: ${operand}: ${parent.error === 'EROFS' ? 'Read-only file system' : errnoText(parent.error)}\n`); exit = 1; continue; }
    let existing = Buffer.alloc(0);
    const found = c.rc.fs.lookup(parent.phys, { follow: false });
    if (!found.error && found.node.type === 'dir') { c.err(`tee: ${operand}: Is a directory\n`); exit = 1; continue; }
    if (parsed.opts.a && !found.error) existing = c.rc.read(found.node);
    c.rc.fs.setNode(parent.phys, c.rc.fs.newFile(Buffer.concat([existing, data])));
  }
  return exit;
}

// ---------------------------------------------------------------- path utilities and test

function basename(c) {
  const operands = c.args.filter((arg) => !arg.startsWith('-') || arg === '-');
  if (operands.length === 0) { c.err("basename: missing operand\nTry 'basename --help' for more information.\n"); return 1; }
  let name = operands[0].replace(/\/+$/, '');
  name = name === '' && operands[0].startsWith('/') ? '/' : name.slice(name.lastIndexOf('/') + 1);
  const suffix = operands[1];
  if (suffix && name.endsWith(suffix) && name !== suffix) name = name.slice(0, -suffix.length);
  c.out(`${name}\n`);
  return 0;
}

function dirname(c) {
  const operands = c.args.filter((arg) => !arg.startsWith('-') || arg === '-');
  if (operands.length === 0) { c.err("dirname: missing operand\nTry 'dirname --help' for more information.\n"); return 1; }
  for (const operand of operands) {
    const trimmed = operand.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    c.out(`${idx < 0 ? '.' : idx === 0 ? '/' : trimmed.slice(0, idx).replace(/\/+$/, '') || '/'}\n`);
  }
  return 0;
}

function realpath(c) {
  const parsed = parseArgs(c.args, { flags: 'emsqL', long: {} });
  if (parsed.error) return usageError(c, parsed.error);
  let exit = 0;
  for (const operand of parsed.operands) {
    const found = c.rc.fs.lookup(operand, { cwd: c.rc.cwd });
    if (found.error) { if (!parsed.opts.m) { c.err(`realpath: ${operand}: ${errnoText(found.error)}\n`); exit = 1; } else c.out(`${absPath(c, operand)}\n`); continue; }
    c.out(`${found.path}\n`);
  }
  return exit;
}

function readlink(c) {
  const parsed = parseArgs(c.args, { flags: 'fenmqs', long: {} });
  if (parsed.error) return usageError(c, parsed.error);
  let exit = 0;
  for (const operand of parsed.operands) {
    if (parsed.opts.f || parsed.opts.e || parsed.opts.m) {
      const found = c.rc.fs.lookup(operand, { cwd: c.rc.cwd });
      if (found.error) { exit = 1; continue; }
      c.out(`${found.path}\n`);
      continue;
    }
    const found = c.rc.fs.lookup(operand, { follow: false, cwd: c.rc.cwd });
    if (found.error || found.node.type !== 'link') { exit = 1; continue; }
    c.out(`${found.node.target}\n`);
  }
  return exit;
}

function testCommand(c) {
  let args = [...c.args];
  if (c.name === '[') {
    if (args[args.length - 1] !== ']') { c.err('bash: [: missing `]\'\n'); return 2; }
    args = args.slice(0, -1);
  }
  const { fs } = c.rc;
  const fileTest = (flag, operand) => {
    const found = fs.lookup(operand, { follow: flag !== '-L' && flag !== '-h', cwd: c.rc.cwd });
    if (found.error) return false;
    const { node } = found;
    switch (flag) {
      case '-e': return true;
      case '-f': return node.type === 'file';
      case '-d': return node.type === 'dir';
      case '-L': case '-h': return node.type === 'link';
      case '-r': return fs.canRead(node);
      case '-w': return fs.canWrite(node);
      case '-x': return fs.canExec(node);
      case '-s': return sizeOf(c, node) > 0;
      default: return false;
    }
  };
  let pos = 0;
  const parsePrimary = () => {
    const tok = args[pos];
    if (tok === undefined) return false;
    if (tok === '!') { pos += 1; return !parsePrimary(); }
    if (tok === '(') {
      pos += 1;
      const value = parseOr();
      if (args[pos] === ')') pos += 1;
      return value;
    }
    if (['-e', '-f', '-d', '-L', '-h', '-r', '-w', '-x', '-s'].includes(tok) && pos + 1 < args.length) {
      pos += 2;
      return fileTest(tok, args[pos - 1]);
    }
    if (tok === '-z' && pos + 1 < args.length) { pos += 2; return args[pos - 1] === ''; }
    if (tok === '-n' && pos + 1 < args.length) { pos += 2; return args[pos - 1] !== ''; }
    const op = args[pos + 1];
    if (['=', '==', '!=', '-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(op) && pos + 2 < args.length) {
      const left = tok;
      const right = args[pos + 2];
      pos += 3;
      if (op === '=' || op === '==') return left === right;
      if (op === '!=') return left !== right;
      const a = parseInt(left, 10);
      const b = parseInt(right, 10);
      if (Number.isNaN(a) || Number.isNaN(b)) throw new Error('integer expression expected');
      return { '-eq': a === b, '-ne': a !== b, '-lt': a < b, '-le': a <= b, '-gt': a > b, '-ge': a >= b }[op];
    }
    pos += 1;
    return tok !== '';
  };
  const parseAnd = () => {
    let value = parsePrimary();
    while (args[pos] === '-a') { pos += 1; const rhs = parsePrimary(); value = value && rhs; }
    return value;
  };
  function parseOr() {
    let value = parseAnd();
    while (args[pos] === '-o') { pos += 1; const rhs = parseAnd(); value = value || rhs; }
    return value;
  }
  try {
    return parseOr() ? 0 : 1;
  } catch (error) {
    c.err(`bash: ${c.name}: ${error.message}\n`);
    return 2;
  }
}

export const commands = {
  ls, cd, pwd, cat, tac, head: headTail(true), tail: headTail(false), less: cat, more: cat, nl, wc, file, stat, tree, du,
  touch, mkdir, rm, rmdir, cp: copyOrMove(false), mv: copyOrMove(true), ln, chmod, chown, tee, basename, dirname,
  realpath, readlink, test: testCommand, '[': testCommand,
};

