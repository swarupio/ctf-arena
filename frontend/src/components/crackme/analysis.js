// Static reading aids for the Crackme Arcade listing: cross-references, basic blocks, a block-graph layout, strings and
// search. Everything here is computed from the program listing the player already has (plus the machine they are
// looking at), so it adds convenience but no information. It deliberately never says which exit is the right one.
import { OPCODES } from './vm.js';

const BRANCH_OPS = new Set(['JMP', 'JZ', 'JNZ']);
const EXIT_OPS = new Set(['ACCEPT', 'REJECT', 'HALT']);

export const addr3 = (value) => String(value).padStart(3, '0');
export const isBranch = (op) => BRANCH_OPS.has(op);
export const isExit = (op) => EXIT_OPS.has(op);
const letter = (index) => (index < 26 ? String.fromCharCode(65 + index) : String(index + 1));

// `program` is a list of [mnemonic, operand?] pairs (the original or the machine's current program).
export function analyzeProgram(program) {
  const count = program.length;
  const inside = (target) => Number.isInteger(target) && target >= 0 && target < count;
  const jumps = [];
  const unresolved = [];
  const leaders = new Set(count > 0 ? [0] : []);
  program.forEach(([op, arg], from) => {
    if (isBranch(op)) {
      if (inside(arg)) {
        jumps.push({ from, to: arg, op, kind: op === 'JMP' ? 'jump' : 'taken' });
        leaders.add(arg);
      } else {
        unresolved.push({ from, target: arg, op });
      }
    }
    if ((isBranch(op) || isExit(op)) && from + 1 < count) { leaders.add(from + 1); }
  });

  const starts = [...leaders].sort((a, b) => a - b);
  const blockOf = new Array(count).fill(-1);
  const blocks = starts.map((start, id) => {
    const end = (id + 1 < starts.length ? starts[id + 1] : count) - 1;
    for (let at = start; at <= end; at += 1) { blockOf[at] = id; }
    const lastOp = program[end][0];
    return {
      id, start, end, label: '', lastOp, exit: isExit(lastOp) ? lastOp : null, succs: [], preds: [], reachable: false,
    };
  });

  // Edges: a branch's target, and the fall-through of everything that is not a jump or an exit.
  for (const block of blocks) {
    const [op, arg] = program[block.end];
    if (isBranch(op)) {
      if (inside(arg)) { block.succs.push({ to: blockOf[arg], kind: op === 'JMP' ? 'jump' : 'taken', from: block.end }); }
      else { block.succs.push({ to: null, kind: 'unresolved', from: block.end, target: arg }); }
    }
    if (op !== 'JMP' && !isExit(op) && block.end + 1 < count) { block.succs.push({ to: blockOf[block.end + 1], kind: 'fall', from: block.end }); }
  }
  for (const block of blocks) {
    for (const edge of block.succs) { if (edge.to !== null) { blocks[edge.to].preds.push({ from: block.id, kind: edge.kind }); } }
  }

  // Reachability from address 0 over the static edges (code that only a rewritten jump can reach stays unreachable).
  const todo = blocks.length ? [0] : [];
  while (todo.length) {
    const block = blocks[todo.pop()];
    if (block.reachable) { continue; }
    block.reachable = true;
    for (const edge of block.succs) { if (edge.to !== null) { todo.push(edge.to); } }
  }

  // Neutral labels. Exits are lettered in address order; nothing says which one is "good".
  let exitCount = 0;
  for (const block of blocks) {
    if (block.exit) { block.label = `exit ${letter(exitCount)}`; exitCount += 1; }
    else if (block.start === 0) { block.label = 'entry'; }
    else { block.label = `loc_${addr3(block.start)}`; }
  }
  if (blocks.length && blocks[0].exit) { blocks[0].label = `entry, exit ${blocks[0].label.slice(5)}`; }

  const xrefs = new Map();
  for (const jump of jumps) {
    const list = xrefs.get(jump.to) ?? [];
    list.push({ from: jump.from, op: jump.op, back: jump.from >= jump.to });
    xrefs.set(jump.to, list);
  }
  const labelAt = new Map(blocks.map((block) => [block.start, block.label]));
  return {
    count, blocks, blockOf, jumps, unresolved, xrefs, labelAt, exits: blocks.filter((block) => block.exit),
    labelOf: (address) => labelAt.get(address) ?? '',
    blockAt: (address) => (inside(address) ? blocks[blockOf[address]] : null),
  };
}

// Text for assistive technology and the outline list: where a block can go next.
export function describeSuccessors(analysis, block) {
  if (block.exit) { return `${block.exit}, program stops`; }
  const parts = block.succs.map((edge) => {
    if (edge.to === null) { return `address ${edge.target} (outside the listing)`; }
    const name = analysis.blocks[edge.to].label;
    if (edge.kind === 'fall') { return `${name} (falls through)`; }
    return `${name} (${edge.kind === 'jump' ? 'jump' : 'branch taken'})`;
  });
  return parts.length ? parts.join(', ') : 'nothing';
}

// ---- graph layout (deterministic: layers by longest path from the entry, columns by address) -------------------------
export const GRAPH = {
  boxW: 116, boxH: 44, gapX: 24, gapY: 18, pad: 14, lane: 9,
};

export function layoutGraph(analysis) {
  const { blocks } = analysis;
  const n = blocks.length;
  // Depth-first search marks back edges (loops) so they do not create cycles in the layering.
  const state = new Array(n).fill(0);
  const back = new Set();
  const order = [];
  const visit = (root) => {
    const stack = [[root, 0]];
    state[root] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [id, index] = top;
      const edges = blocks[id].succs.filter((edge) => edge.to !== null);
      if (index >= edges.length) { state[id] = 2; order.push(id); stack.pop(); continue; }
      top[1] += 1;
      const target = edges[index].to;
      if (state[target] === 1) { back.add(`${id}>${target}`); }
      else if (state[target] === 0) { state[target] = 1; stack.push([target, 0]); }
    }
  };
  if (n) { visit(0); }
  for (let id = 0; id < n; id += 1) { if (state[id] === 0) { visit(id); } }
  const topo = order.slice().reverse();
  const layer = new Array(n).fill(0);
  for (const id of topo) {
    for (const edge of blocks[id].succs) {
      if (edge.to !== null && !back.has(`${id}>${edge.to}`)) { layer[edge.to] = Math.max(layer[edge.to], layer[id] + 1); }
    }
  }
  const column = new Array(n).fill(0);
  const perLayer = new Map();
  for (let id = 0; id < n; id += 1) {
    column[id] = perLayer.get(layer[id]) ?? 0;
    perLayer.set(layer[id], column[id] + 1);
  }
  const columns = Math.max(1, ...perLayer.values());
  const layers = n ? Math.max(...layer) + 1 : 0;
  const { boxW, boxH, gapX, gapY, pad, lane } = GRAPH;
  const nodes = blocks.map((block) => ({
    id: block.id, x: pad + column[block.id] * (boxW + gapX), y: pad + layer[block.id] * (boxH + gapY), layer: layer[block.id],
  }));
  // Every edge that skips a layer or goes upward runs down a lane on the right, one lane per target (a shared bus).
  const laneOf = new Map();
  const edges = [];
  for (const block of blocks) {
    for (const edge of block.succs) {
      if (edge.to === null) { continue; }
      const long = back.has(`${block.id}>${edge.to}`) || layer[edge.to] - layer[block.id] !== 1;
      if (long && !laneOf.has(edge.to)) { laneOf.set(edge.to, laneOf.size); }
      edges.push({ from: block.id, to: edge.to, kind: edge.kind, long, back: back.has(`${block.id}>${edge.to}`) });
    }
  }
  const rightEdge = pad + columns * (boxW + gapX) - gapX;
  const width = rightEdge + pad + (laneOf.size ? laneOf.size * lane + 6 : 0);
  const height = pad * 2 + Math.max(0, layers) * (boxH + gapY) - (layers ? gapY : 0);
  const paths = edges.map((edge) => {
    const a = nodes[edge.from];
    const b = nodes[edge.to];
    let d;
    if (edge.long) {
      const laneX = rightEdge + 8 + laneOf.get(edge.to) * lane;
      d = `M${a.x + boxW},${a.y + boxH / 2} H${laneX} V${b.y + boxH / 2} H${b.x + boxW}`;
    } else {
      const x1 = a.x + boxW / 2;
      const y1 = a.y + boxH;
      const x2 = b.x + boxW / 2;
      const mid = (y1 + b.y) / 2;
      d = `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${b.y}`;
    }
    return { ...edge, d };
  });
  return { nodes, paths, width, height, boxW, boxH };
}

// ---- constants and strings --------------------------------------------------------------------------------------------
export const isPrintable = (value) => Number.isInteger(value) && value >= 32 && value <= 126;
export const MIN_STRING = 3;

// Distinct PUSH operands, in order of first use, with every address that pushes them.
export function immediates(program) {
  const seen = new Map();
  program.forEach(([op, arg], address) => {
    if (op !== 'PUSH') { return; }
    const entry = seen.get(arg) ?? { value: arg, addresses: [] };
    entry.addresses.push(address);
    seen.set(arg, entry);
  });
  return [...seen.values()];
}

// Printable runs in a list of cells (cells that are not printable end a run). Returns [{ start, length, text }].
export function runsOf(cells, min = MIN_STRING) {
  const runs = [];
  let start = -1;
  const close = (end) => {
    if (start >= 0 && end - start >= min) { runs.push({ start, length: end - start, text: cells.slice(start, end).map((v) => String.fromCharCode(v)).join('') }); }
    start = -1;
  };
  cells.forEach((value, index) => {
    if (isPrintable(value)) { if (start < 0) { start = index; } } else { close(index); }
  });
  close(cells.length);
  return runs;
}

// Text stored in the program itself: runs of consecutive PUSH instructions that push printable characters.
export function codeStrings(program, min = MIN_STRING) {
  const cells = program.map(([op, arg]) => (op === 'PUSH' ? arg : -1));
  return runsOf(cells, min).map((run) => ({ address: run.start, length: run.length, text: run.text }));
}

// Text that the program writes into data memory with literal stores (PUSH value, PUSH cell, STORE), as a static image.
export function literalStores(program) {
  const image = new Map();
  for (let at = 0; at + 2 < program.length; at += 1) {
    const [a, b, c] = [program[at], program[at + 1], program[at + 2]];
    if (a[0] === 'PUSH' && b[0] === 'PUSH' && c[0] === 'STORE' && b[1] < 64) { image.set(b[1], { value: a[1], at }); }
  }
  return image;
}

export function storedStrings(program, min = MIN_STRING) {
  const image = literalStores(program);
  const cells = Array.from({ length: 64 }, (_, cell) => (image.has(cell) ? image.get(cell).value : -1));
  return runsOf(cells, min).map((run) => ({ cell: run.start, length: run.length, text: run.text, at: image.get(run.start).at }));
}

// Strings in the memory of the machine being viewed (what the program has written so far).
export const memoryStrings = (mem, min = MIN_STRING) => runsOf(mem, min).map((run) => ({ cell: run.start, length: run.length, text: run.text }));

// ---- search -------------------------------------------------------------------------------------------------------------
// Query forms: a mnemonic (or its start, "j" finds JMP JZ JNZ), a number (decimal or 0x hex) matched against operands,
// a character in quotes ('A') or a single character, or part of a label (loc_035, exit, entry).
export function parseQuery(raw) {
  const text = String(raw ?? '').trim();
  if (!text) { return { empty: true }; }
  const out = { empty: false, text, lower: text.toLowerCase(), values: [] };
  let m = /^0x([0-9a-f]+)$/i.exec(text);
  if (m) { out.values.push(parseInt(m[1], 16)); }
  if (/^\d+$/.test(text)) { out.values.push(Number(text)); }
  m = /^(['"])(.)\1$/.exec(text);
  if (m) { out.values.push(m[2].charCodeAt(0)); }
  else if (text.length === 1) { out.values.push(text.charCodeAt(0)); }
  return out;
}

// Returns the sorted addresses of matching instructions.
export function searchProgram(program, analysis, raw) {
  const query = parseQuery(raw);
  if (query.empty) { return []; }
  const upper = query.text.toUpperCase();
  const mnemonicQuery = /^[A-Za-z]+$/.test(query.text);
  const hits = [];
  program.forEach(([op, arg], address) => {
    let hit = false;
    if (mnemonicQuery && op.startsWith(upper)) { hit = true; }
    if (!hit && OPCODES[op]?.operand && query.values.includes(arg)) { hit = true; }
    if (!hit && query.lower.length >= 2) {
      const label = analysis.labelAt.get(address);
      if (label && label.toLowerCase().includes(query.lower)) { hit = true; }
    }
    if (hit) { hits.push(address); }
  });
  return hits;
}

// "Go to address": a decimal number, 0x hex, or a label. Returns an address or null.
export function parseAddress(raw, analysis) {
  const text = String(raw ?? '').trim();
  if (!text) { return null; }
  let value = null;
  if (/^\d+$/.test(text)) { value = Number(text); }
  else if (/^0x[0-9a-f]+$/i.test(text)) { value = parseInt(text, 16); }
  else {
    const found = analysis.blocks.find((block) => block.label.toLowerCase() === text.toLowerCase());
    if (found) { value = found.start; }
  }
  return value !== null && value >= 0 && value < analysis.count ? value : null;
}

// ---- navigation history (a browser-like stack of addresses) -----------------------------------------------------------
export const emptyHistory = () => ({ stack: [], index: -1 });
export function visit(history, address) {
  if (history.stack[history.index] === address) { return history; }
  const stack = [...history.stack.slice(0, history.index + 1), address].slice(-50);
  return { stack, index: stack.length - 1 };
}
export const goBack = (history) => (history.index > 0 ? { ...history, index: history.index - 1 } : history);
export const goForward = (history) => (history.index < history.stack.length - 1 ? { ...history, index: history.index + 1 } : history);
export const current = (history) => (history.index >= 0 ? history.stack[history.index] : null);

// Roving-tabindex keys for the analysis tabs: arrows wrap, Home and End jump. Returns the new index or null (key not handled).
export function nextTabIndex(key, index, count) {
  if (!(count > 0)) { return null; }
  if (key === 'ArrowRight' || key === 'ArrowDown') { return (index + 1) % count; }
  if (key === 'ArrowLeft' || key === 'ArrowUp') { return (index - 1 + count) % count; }
  if (key === 'Home') { return 0; }
  if (key === 'End') { return count - 1; }
  return null;
}
