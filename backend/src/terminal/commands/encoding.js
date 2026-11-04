// Encoding and binary tools: base64 xxd hexdump od strings gzip gunzip zcat md5sum sha1sum sha256sum factor.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { LIMITS, ResourceLimitError } from '../limits.js';
import { gzipDeterministic } from '../vfs.js';
import {
  asBuf, asText, errnoText, joinLines, openOperand, pad, parseArgs, readOperand, splitLines, usageError,
} from './util.js';

const hex2 = (n) => n.toString(16).padStart(2, '0');

// ---------------------------------------------------------------- base64

function base64(c) {
  const parsed = parseArgs(c.args, { flags: 'dDi', values: 'w', long: { decode: 'd', 'ignore-garbage': 'i', wrap: 'w' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  if (parsed.operands.length > 1) { c.err(`base64: extra operand '${parsed.operands[1]}'\nTry 'base64 --help' for more information.\n`); return 1; }
  const data = readOperand(c, 'base64', parsed.operands[0] ?? '-');
  if (data === null) return 1;
  c.rc.tick(1 + (data.length >> 10));
  if (opts.d || opts.D) {
    let clean = asText(data).replace(/[\r\n]/g, '');
    if (opts.i) clean = clean.replace(/[^A-Za-z0-9+/=]/g, '');
    const valid = /^[A-Za-z0-9+/]*={0,2}$/.test(clean) && clean.length % 4 === 0;
    c.out(Buffer.from(clean.replace(/[^A-Za-z0-9+/]/g, ''), 'base64'));
    if (!valid) { c.err('base64: invalid input\n'); return 1; }
    return 0;
  }
  const wrap = opts.w === undefined ? 76 : Number(opts.w);
  if (!Number.isInteger(wrap) || wrap < 0) { c.err(`base64: invalid wrap size: '${opts.w}'\n`); return 1; }
  const encoded = data.toString('base64');
  if (encoded === '') return 0;
  if (wrap === 0) c.out(encoded); // GNU: -w 0 prints no trailing newline
  else {
    const rows = [];
    for (let i = 0; i < encoded.length; i += wrap) rows.push(encoded.slice(i, i + wrap));
    c.out(`${rows.join('\n')}\n`);
  }
  return 0;
}

// ---------------------------------------------------------------- xxd / hexdump / od / strings

function parseNumber(text) {
  if (text === undefined) return undefined;
  const value = /^0x/i.test(text) ? parseInt(text, 16) : Number(text);
  return Number.isInteger(value) && value >= 0 ? value : NaN;
}

function xxdReverse(text, plain) {
  const bytes = [];
  if (plain) {
    const digits = text.replace(/[^0-9A-Fa-f]/g, '');
    for (let i = 0; i + 1 < digits.length; i += 2) bytes.push(parseInt(digits.slice(i, i + 2), 16));
    return Buffer.from(bytes);
  }
  for (const line of text.split('\n')) {
    const body = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
    const field = body.split('  ')[0];
    const digits = field.replace(/[^0-9A-Fa-f]/g, '');
    for (let i = 0; i + 1 < digits.length; i += 2) bytes.push(parseInt(digits.slice(i, i + 2), 16));
  }
  return Buffer.from(bytes);
}

function xxd(c) {
  const args = c.args.map((arg) => (arg === '-ps' || arg === '-postscript' ? '-p' : arg));
  const parsed = parseArgs(args, {
    flags: 'prbuiaE', values: 'lsgcn', long: { plain: 'p', reverse: 'r', uppercase: 'u', len: 'l', seek: 's', cols: 'c', groupsize: 'g' },
  });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  if (parsed.operands.length > 1) { c.err(`xxd: extra operand '${parsed.operands[1]}'\n`); return 1; }
  const data = readOperand(c, 'xxd', parsed.operands[0] ?? '-');
  if (data === null) return 1;
  c.rc.tick(1 + (data.length >> 10));
  if (opts.r) { c.out(xxdReverse(asText(data), Boolean(opts.p))); return 0; }
  const length = parseNumber(opts.l ?? opts.n);
  const seek = parseNumber(opts.s) ?? 0;
  const cols = parseNumber(opts.c) ?? (opts.p ? 30 : 16);
  const group = opts.g === undefined ? 2 : parseNumber(opts.g);
  if ([length, seek, cols, group].some((v) => Number.isNaN(v)) || cols < 1 || cols > 256) { c.err('xxd: invalid number\n'); return 1; }
  const slice = data.subarray(Math.min(seek, data.length), length === undefined ? undefined : Math.min(seek, data.length) + length);
  const fmt = (b) => (opts.u ? hex2(b).toUpperCase() : hex2(b));
  const out = [];
  if (opts.p) {
    for (let i = 0; i < slice.length; i += cols) out.push(Array.from(slice.subarray(i, i + cols), fmt).join(''));
  } else {
    const groupsPerLine = group === 0 ? 1 : Math.ceil(cols / group);
    const fieldWidth = cols * 2 + (group === 0 ? 0 : groupsPerLine - 1);
    for (let i = 0; i < slice.length; i += cols) {
      const chunk = slice.subarray(i, i + cols);
      let hexField = '';
      for (let j = 0; j < chunk.length; j += 1) {
        if (group !== 0 && j > 0 && j % group === 0) hexField += ' ';
        hexField += fmt(chunk[j]);
      }
      const ascii = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
      out.push(`${(seek + i).toString(16).padStart(8, '0')}: ${hexField.padEnd(fieldWidth)}  ${ascii}`);
    }
  }
  c.rc.tickLines(out.length);
  c.out(joinLines(out));
  return 0;
}

function hexdump(c) {
  const parsed = parseArgs(c.args, { flags: 'CvbcdoxX', values: 'ns', long: { canonical: 'C', length: 'n', skip: 's', 'no-squeezing': 'v' } });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const inputs = parsed.operands.length > 0 ? parsed.operands : ['-'];
  const chunks = [];
  for (const operand of inputs) {
    const data = readOperand(c, 'hexdump', operand);
    if (data === null) return 1;
    chunks.push(data);
  }
  let data = Buffer.concat(chunks);
  c.rc.tick(1 + (data.length >> 10));
  const skip = parseNumber(opts.s) ?? 0;
  const length = parseNumber(opts.n);
  const base = skip;
  data = data.subarray(Math.min(skip, data.length), length === undefined ? undefined : Math.min(skip, data.length) + length);
  const out = [];
  let previous = null;
  let starred = false;
  const squeeze = (chunk, render, offset) => {
    if (!opts.v && previous && chunk.equals(previous)) {
      if (!starred) out.push('*');
      starred = true;
      return;
    }
    starred = false;
    previous = chunk;
    out.push(render(offset));
  };
  if (opts.C) {
    for (let i = 0; i < data.length; i += 16) {
      const chunk = data.subarray(i, i + 16);
      squeeze(chunk, (offset) => {
        let cells = '';
        for (let j = 0; j < 16; j += 1) {
          cells += j < chunk.length ? `${hex2(chunk[j])} ` : '   ';
          if (j === 7) cells += ' ';
        }
        const ascii = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
        return `${(base + offset).toString(16).padStart(8, '0')}  ${cells} |${ascii}|`;
      }, i);
    }
    out.push((base + data.length).toString(16).padStart(8, '0'));
  } else {
    for (let i = 0; i < data.length; i += 16) {
      const chunk = data.subarray(i, i + 16);
      squeeze(chunk, (offset) => {
        const words = [];
        for (let j = 0; j < chunk.length; j += 2) {
          const lo = chunk[j];
          const hi = j + 1 < chunk.length ? chunk[j + 1] : 0;
          words.push(hex2(hi) + hex2(lo));
        }
        return `${(base + offset).toString(16).padStart(7, '0')} ${words.join(' ')}`;
      }, i);
    }
    out.push((base + data.length).toString(16).padStart(7, '0'));
  }
  c.rc.tickLines(out.length);
  c.out(joinLines(out));
  return 0;
}

function od(c) {
  const parsed = parseArgs(c.args, { flags: 'cxbdo', values: 'AtNjw', long: {} });
  if (parsed.error) return usageError(c, parsed.error);
  const { opts } = parsed;
  const data = readOperand(c, 'od', parsed.operands[0] ?? '-');
  if (data === null) return 1;
  c.rc.tick(1 + (data.length >> 10));
  const skip = parseNumber(opts.j) ?? 0;
  const limit = parseNumber(opts.N);
  const bytes = data.subarray(Math.min(skip, data.length), limit === undefined ? undefined : Math.min(skip, data.length) + limit);
  const radix = opts.A === 'x' ? 16 : opts.A === 'd' ? 10 : 8;
  const offsetOf = (n) => (opts.A === 'n' ? '' : n.toString(radix).padStart(7, '0'));
  const hexBytes = opts.t === 'x1' || opts.x;
  const names = { 0: '\\0', 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r' };
  const cell = (b) => {
    if (hexBytes) return ` ${hex2(b)}`;
    if (Object.hasOwn(names, b)) return pad(names[b], 4);
    if (b >= 0x20 && b < 0x7f) return pad(String.fromCharCode(b), 4);
    return pad(b.toString(8).padStart(3, '0'), 4);
  };
  const out = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = Array.from(bytes.subarray(i, i + 16), cell).join('');
    out.push(opts.A === 'n' ? chunk : `${offsetOf(skip + i)}${chunk}`);
  }
  if (opts.A !== 'n') out.push(offsetOf(skip + bytes.length));
  c.rc.tickLines(out.length);
  c.out(joinLines(out));
  return 0;
}

function strings(c) {
  const parsed = parseArgs(c.args, { flags: 'af', values: 'nt', numeric: 'n', long: { bytes: 'n', all: 'a', radix: 't' } });
  if (parsed.error) return usageError(c, parsed.error);
  const min = Number(parsed.opts.n ?? 4);
  if (!Number.isInteger(min) || min < 1) { c.err(`strings: invalid minimum string length ${parsed.opts.n}\n`); return 1; }
  const radix = { x: 16, d: 10, o: 8 }[parsed.opts.t];
  const inputs = parsed.operands.length > 0 ? parsed.operands : ['-'];
  let exit = 0;
  for (const operand of inputs) {
    const data = readOperand(c, 'strings', operand);
    if (data === null) { exit = 1; continue; }
    c.rc.tick(1 + (data.length >> 10));
    const lines = [];
    let start = -1;
    const flush = (end) => {
      if (start >= 0 && end - start >= min) {
        const text = data.toString('latin1', start, end);
        lines.push(radix ? `${pad(start.toString(radix), 7)} ${text}` : text);
      }
      start = -1;
    };
    for (let i = 0; i < data.length; i += 1) {
      const b = data[i];
      if ((b >= 0x20 && b < 0x7f) || b === 0x09) { if (start < 0) start = i; } else flush(i);
    }
    flush(data.length);
    c.rc.tickLines(lines.length);
    c.out(joinLines(lines));
  }
  return exit;
}

// ---------------------------------------------------------------- gzip family

function gunzip(buf) {
  try {
    return { data: gunzipSync(buf, { maxOutputLength: LIMITS.MAX_STREAM }) };
  } catch (error) {
    if (error && error.code === 'ERR_BUFFER_TOO_LARGE') throw new ResourceLimitError();
    return { error };
  }
}

function gzipCommand(forceDecompress, forceStdout) {
  return (c) => {
    const parsed = parseArgs(c.args, { flags: 'dcfkqtvnNlS123456789', values: 'S', long: { decompress: 'd', uncompress: 'd', stdout: 'c', 'to-stdout': 'c', keep: 'k', force: 'f', test: 't', quiet: 'q' } });
    if (parsed.error) return usageError(c, parsed.error);
    const { opts } = parsed;
    const decompress = forceDecompress || opts.d || opts.t;
    const toStdout = forceStdout || opts.c || opts.t;
    const inputs = parsed.operands;
    let exit = 0;
    if (inputs.length === 0) {
      const data = asBuf(c.stdin);
      if (decompress) {
        const result = gunzip(data);
        if (result.error) { c.err(`${c.name}: stdin: not in gzip format\n`); return 1; }
        if (!opts.t) c.out(result.data);
      } else c.out(gzipDeterministic(data));
      return 0;
    }
    for (const operand of inputs) {
      const found = openOperand(c, c.name, operand);
      if (!found) { exit = 1; continue; }
      if (found.node.type === 'dir') { c.err(`${c.name}: ${operand} is a directory -- ignored\n`); exit = 1; continue; }
      if (!c.rc.fs.canRead(found.node)) { c.err(`${c.name}: ${operand}: Permission denied\n`); exit = 1; continue; }
      if (decompress && !toStdout && !/\.(gz|z|Z|tgz)$/.test(operand)) { c.err(`${c.name}: ${operand}: unknown suffix -- ignored\n`); exit = 2; continue; }
      const data = c.rc.read(found.node);
      let result;
      if (decompress) {
        result = gunzip(data);
        if (result.error) { c.err(`${c.name}: ${operand}: not in gzip format\n`); exit = 1; continue; }
        if (opts.t) continue;
      } else result = { data: gzipDeterministic(data) };
      if (toStdout) { c.out(result.data); continue; }
      const suffix = /\.(gz|z|Z|tgz)$/.exec(operand);
      if (decompress && !suffix) { c.err(`${c.name}: ${operand}: unknown suffix -- ignored\n`); exit = 2; continue; }
      const outName = decompress ? operand.replace(/\.tgz$/, '.tar').replace(/\.(gz|z|Z)$/, '') : `${operand}.gz`;
      const parent = c.rc.fs.parentFor(outName, c.rc.cwd);
      if (parent.error) {
        c.err(`${c.name}: ${outName}: ${errnoText(parent.error)}\n`);
        if (parent.error === 'EROFS') c.err(`hint: this file system is read-only; use  zcat ${operand}  or  gunzip -c ${operand}  (or copy it to /tmp first)\n`);
        exit = 1;
        continue;
      }
      c.rc.fs.setNode(parent.phys, c.rc.fs.newFile(Buffer.from(result.data)));
      if (!opts.k && c.rc.fs.isTmp(found.path)) c.rc.fs.deleteNode(found.path);
    }
    return exit;
  };
}

// ---------------------------------------------------------------- checksums

function sumCommand(algorithm) {
  return (c) => {
    const parsed = parseArgs(c.args, { flags: 'bctwqs', long: { binary: 'b', check: 'c', text: 't', quiet: 'q', status: 's' } });
    if (parsed.error) return usageError(c, parsed.error);
    const { opts } = parsed;
    const hashOf = (buf) => createHash(algorithm).update(buf).digest('hex');
    const inputs = parsed.operands.length > 0 ? parsed.operands : ['-'];
    let exit = 0;
    if (opts.c) {
      let bad = 0;
      let unreadable = 0;
      for (const listName of inputs) {
        const list = readOperand(c, c.name, listName);
        if (list === null) { exit = 1; continue; }
        for (const line of splitLines(asText(list))) {
          const match = /^([0-9a-fA-F]+) [ *](.+)$/.exec(line);
          if (!match) continue;
          const found = c.rc.fs.lookup(match[2], { cwd: c.rc.cwd });
          if (found.error || found.node.type === 'dir' || !c.rc.fs.canRead(found.node)) {
            if (!opts.s) c.out(`${match[2]}: FAILED open or read\n`);
            unreadable += 1;
            continue;
          }
          const ok = hashOf(c.rc.read(found.node)) === match[1].toLowerCase();
          if (!ok) bad += 1;
          if (!opts.s && !(opts.q && ok)) c.out(`${match[2]}: ${ok ? 'OK' : 'FAILED'}\n`);
        }
      }
      if (bad > 0 && !opts.s) c.err(`${c.name}: WARNING: ${bad} computed checksum${bad === 1 ? '' : 's'} did NOT match\n`);
      if (unreadable > 0 && !opts.s) c.err(`${c.name}: WARNING: ${unreadable} listed file${unreadable === 1 ? '' : 's'} could not be read\n`);
      return bad > 0 || unreadable > 0 || exit ? 1 : 0;
    }
    for (const operand of inputs) {
      const data = readOperand(c, c.name, operand);
      if (data === null) { exit = 1; continue; }
      c.rc.tick(1 + (data.length >> 10));
      c.out(`${hashOf(data)} ${opts.b ? '*' : ' '}${operand}\n`);
    }
    return exit;
  };
}

function factor(c) {
  const numbers = c.args.length > 0 ? c.args : splitLines(asText(c.stdin)).flatMap((line) => line.trim().split(/\s+/)).filter(Boolean);
  let exit = 0;
  for (const text of numbers) {
    if (!/^\d+$/.test(text)) { c.err(`factor: '${text}' is not a valid positive integer\n`); exit = 1; continue; }
    let n = BigInt(text);
    if (n > 10n ** 15n) { c.err(`factor: '${text}' is too large for this sandbox\n`); exit = 1; continue; }
    const primes = [];
    for (let p = 2n; p * p <= n; p += p === 2n ? 1n : 2n) {
      c.rc.tick(1);
      while (n % p === 0n) { primes.push(p); n /= p; }
    }
    if (n > 1n || primes.length === 0) primes.push(n);
    c.out(`${text}: ${primes.join(' ')}\n`);
  }
  return exit;
}

export const commands = {
  base64,
  xxd,
  hexdump,
  od,
  strings,
  gzip: gzipCommand(false, false),
  gunzip: gzipCommand(true, false),
  zcat: gzipCommand(true, true),
  gzcat: gzipCommand(true, true),
  md5sum: sumCommand('md5'),
  sha1sum: sumCommand('sha1'),
  sha256sum: sumCommand('sha256'),
  sha512sum: sumCommand('sha512'),
  factor,
};

