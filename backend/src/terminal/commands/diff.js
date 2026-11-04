// `diff FILE1 FILE2`: normal format (default), -u unified, -q, -i. Myers O(ND) with a work cap.
import { ResourceLimitError } from '../limits.js';
import { asText, parseArgs, readOperand, splitLines, usageError } from './util.js';

const MAX_D = 1500;

// Returns ops: { t: '=' | '-' | '+', a: indexInA, b: indexInB }.
function myers(a, b, c) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d += 1) {
    if (d > MAX_D) throw new ResourceLimitError();
    c.rc.tick(1 + (d >> 3));
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  const ops = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const prev = trace[d];
    const base = d + 1; // trace[d] was sliced from offset - d - 1
    const k = x - y;
    const get = (kk) => prev[base + kk];
    let prevK;
    if (k === -d || (k !== d && get(k - 1) < get(k + 1))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x -= 1; y -= 1; ops.push({ t: '=', a: x, b: y }); }
    if (x === prevX) { y -= 1; ops.push({ t: '+', a: x, b: y }); } else { x -= 1; ops.push({ t: '-', a: x, b: y }); }
  }
  while (x > 0 && y > 0) { x -= 1; y -= 1; ops.push({ t: '=', a: x, b: y }); }
  return ops.reverse();
}

const range = (start, count) => (count === 1 ? String(start) : `${start},${start + count - 1}`);

function normalFormat(ops, a, b) {
  const out = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t === '=') { i += 1; continue; }
    let j = i;
    const dels = [];
    const adds = [];
    while (j < ops.length && ops[j].t !== '=') { (ops[j].t === '-' ? dels : adds).push(ops[j]); j += 1; }
    const aStart = dels.length > 0 ? dels[0].a + 1 : (adds[0].a);
    const bStart = adds.length > 0 ? adds[0].b + 1 : (dels[0].b);
    if (dels.length > 0 && adds.length > 0) {
      out.push(`${range(aStart, dels.length)}c${range(bStart, adds.length)}`);
      for (const d of dels) out.push(`< ${a[d.a]}`);
      out.push('---');
      for (const d of adds) out.push(`> ${b[d.b]}`);
    } else if (dels.length > 0) {
      out.push(`${range(aStart, dels.length)}d${bStart}`);
      for (const d of dels) out.push(`< ${a[d.a]}`);
    } else {
      out.push(`${aStart}a${range(bStart, adds.length)}`);
      for (const d of adds) out.push(`> ${b[d.b]}`);
    }
    i = j;
  }
  return out;
}

const STAMP = '2024-03-14 09:26:53.000000000 +0000';

function unifiedFormat(ops, a, b, nameA, nameB, context = 3) {
  const changes = [];
  ops.forEach((op, index) => { if (op.t !== '=') changes.push(index); });
  if (changes.length === 0) return [];
  const hunks = [];
  let start = changes[0];
  let end = changes[0];
  for (const index of changes.slice(1)) {
    // Gap of equal ops between two changes: merge when it fits inside the context.
    if (index - end - 1 <= context * 2) end = index;
    else { hunks.push([start, end]); start = index; end = index; }
  }
  hunks.push([start, end]);
  const out = [`--- ${nameA}\t${STAMP}`, `+++ ${nameB}\t${STAMP}`];
  for (const [first, last] of hunks) {
    const from = Math.max(0, first - context);
    const to = Math.min(ops.length - 1, last + context);
    const slice = ops.slice(from, to + 1);
    let aStart = null;
    let bStart = null;
    let aLen = 0;
    let bLen = 0;
    const body = [];
    for (const op of slice) {
      if (op.t === '=') { body.push(` ${a[op.a]}`); aLen += 1; bLen += 1; if (aStart === null) { aStart = op.a + 1; bStart = op.b + 1; } }
      else if (op.t === '-') { body.push(`-${a[op.a]}`); aLen += 1; if (aStart === null) { aStart = op.a + 1; bStart = op.b + 1; } }
      else { body.push(`+${b[op.b]}`); bLen += 1; if (aStart === null) { aStart = op.a + 1; bStart = op.b + 1; } }
    }
    const fmt = (s, len) => (len === 1 ? String(s) : `${len === 0 ? s - 1 : s},${len}`);
    out.push(`@@ -${fmt(aStart, aLen)} +${fmt(bStart, bLen)} @@`, ...body);
  }
  return out;
}

function diff(c) {
  const parsed = parseArgs(c.args, { flags: 'uqiwbB', values: 'U', long: { unified: 'u', brief: 'q', 'ignore-case': 'i' } });
  if (parsed.error) return usageError(c, `${parsed.error}`);
  const { opts, operands } = parsed;
  if (operands.length !== 2) {
    c.err(`diff: ${operands.length < 2 ? `missing operand after '${operands[operands.length - 1] ?? 'diff'}'` : `extra operand '${operands[2]}'`}\ndiff: Try 'diff --help' for more information.\n`);
    return 2;
  }
  const reads = operands.map((operand) => {
    const data = readOperand(c, 'diff', operand);
    return data === null ? null : splitLines(asText(data));
  });
  if (reads.includes(null)) return 2;
  const [a, b] = reads;
  const norm = (line) => {
    let text = opts.i ? line.toLowerCase() : line;
    if (opts.w) text = text.replace(/[ \t]+/g, '');
    else if (opts.b) text = text.replace(/[ \t]+/g, ' ').replace(/ $/, '');
    return text;
  };
  let startIdx = 0;
  while (startIdx < a.length && startIdx < b.length && norm(a[startIdx]) === norm(b[startIdx])) startIdx += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > startIdx && endB > startIdx && norm(a[endA - 1]) === norm(b[endB - 1])) { endA -= 1; endB -= 1; }
  c.rc.tickLines(a.length + b.length);
  if (startIdx === endA && startIdx === endB) return 0;
  if (opts.q) { c.out(`Files ${operands[0]} and ${operands[1]} differ\n`); return 1; }
  const midA = a.slice(startIdx, endA).map(norm);
  const midB = b.slice(startIdx, endB).map(norm);
  const core = myers(midA, midB, c);
  const ops = [];
  for (let i = 0; i < startIdx; i += 1) ops.push({ t: '=', a: i, b: i });
  for (const op of core) ops.push({ t: op.t, a: op.a + startIdx, b: op.b + startIdx });
  for (let i = 0; i < a.length - endA; i += 1) ops.push({ t: '=', a: endA + i, b: endB + i });
  const lines = opts.u ? unifiedFormat(ops, a, b, operands[0], operands[1]) : normalFormat(ops, a, b);
  c.out(`${lines.join('\n')}\n`);
  return 1;
}

export const commands = { diff };
