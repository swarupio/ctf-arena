import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeProgram, codeStrings, current, describeSuccessors, emptyHistory, goBack, goForward, immediates, layoutGraph, memoryStrings,
  parseAddress, runsOf, searchProgram, storedStrings, visit,
} from '../src/components/crackme/analysis.js';
import {
  createMachine, currentProgram, runProgram, stepMachine,
} from '../src/components/crackme/vm.js';

const B = '../../backend/src/games/crackme/';
const { LEVELS } = await import(B + 'levels.js');
const { buildPuzzle } = await import(B + 'game.js');

const AB = [
  ['INPUT'], ['PUSH', 65], ['CMP'], ['JNZ', 9],
  ['INPUT'], ['PUSH', 66], ['CMP'], ['JNZ', 9],
  ['ACCEPT'], ['REJECT'],
];
const BRANCHES = ['JMP', 'JZ', 'JNZ'];

test('blocks, xrefs and neutral labels on a small program', () => {
  const a = analyzeProgram(AB);
  assert.deepEqual(a.blocks.map((b) => [b.start, b.end]), [[0, 3], [4, 7], [8, 8], [9, 9]]);
  assert.deepEqual(a.xrefs.get(9).map((x) => x.from), [3, 7]);
  assert.deepEqual(a.blocks.map((b) => b.label), ['entry', 'loc_004', 'exit A', 'exit B']);
  assert.equal(a.blocks[2].exit, 'ACCEPT');
  assert.equal(a.blockAt(5).id, 1);
  assert.equal(a.blockAt(99), null);
  assert.match(describeSuccessors(a, a.blocks[0]), /exit B \(branch taken\), loc_004 \(falls through\)/);
});

test('labels never say which exit is the good one', () => {
  for (const level of LEVELS) {
    const { program } = buildPuzzle(level, { secret: 's'.repeat(32), teamId: 'label-check' });
    for (const block of analyzeProgram(program).blocks) {
      assert.doesNotMatch(block.label, /accept|reject|halt|win|fail|good|bad|success|correct|wrong/i, `${level.id} ${block.label}`);
    }
  }
});

test('out-of-range jump targets are reported, not followed', () => {
  const a = analyzeProgram([['PUSH', 1], ['JNZ', 500], ['JMP', 0], ['ACCEPT']]);
  assert.deepEqual(a.unresolved.map((u) => [u.from, u.target]), [[1, 500]]);
  assert.equal(a.xrefs.get(0).length, 1);
  assert.match(describeSuccessors(a, a.blocks[0]), /outside the listing/);
  assert.equal(analyzeProgram([]).blocks.length, 0);
});

test('graph layout is deterministic and keeps every block inside the canvas', () => {
  const a = analyzeProgram(AB);
  const one = layoutGraph(a);
  assert.deepEqual(layoutGraph(a), one);
  for (const node of one.nodes) {
    assert.ok(node.x >= 0 && node.x + one.boxW <= one.width && node.y >= 0 && node.y + one.boxH <= one.height);
  }
  assert.equal(one.paths.length, 4);
});

test('strings: runs, code pushes, literal stores, memory, constants', () => {
  assert.deepEqual(runsOf([1, 72, 105, 33, 0, 65, 66], 3), [{ start: 1, length: 3, text: 'Hi!' }]);
  const program = [
    ['PUSH', 79], ['PUSH', 75], ['PUSH', 33], ['POP'],
    ['PUSH', 72], ['PUSH', 3], ['STORE'], ['PUSH', 73], ['PUSH', 4], ['STORE'], ['PUSH', 33], ['PUSH', 5], ['STORE'],
  ];
  assert.deepEqual(codeStrings(program).map((s) => [s.address, s.text]), [[0, 'OK!']]);
  assert.deepEqual(storedStrings(program).map((s) => [s.cell, s.text, s.at]), [[3, 'HI!', 4]]);
  assert.deepEqual(memoryStrings([0, 0, 0, 65, 66, 67]).map((s) => s.text), ['ABC']);
  assert.deepEqual(immediates(program).find((i) => i.value === 33).addresses, [2, 10]);
});

test('search finds mnemonics, decimal, hex, characters and labels', () => {
  const a = analyzeProgram(AB);
  assert.deepEqual(searchProgram(AB, a, 'jnz'), [3, 7]);
  assert.deepEqual(searchProgram(AB, a, 'j'), [3, 7]);
  assert.deepEqual(searchProgram(AB, a, '65'), [1]);
  assert.deepEqual(searchProgram(AB, a, '0x42'), [5]);
  assert.deepEqual(searchProgram(AB, a, "'B'"), [5]);
  assert.deepEqual(searchProgram(AB, a, 'B'), [5]);
  assert.deepEqual(searchProgram(AB, a, 'exit'), [8, 9]);
  assert.deepEqual(searchProgram(AB, a, 'loc_004'), [4]);
  assert.deepEqual(searchProgram(AB, a, ''), []);
  assert.deepEqual(searchProgram(AB, a, 'zzz'), []);
});

test('go to address and navigation history', () => {
  const a = analyzeProgram(AB);
  assert.equal(parseAddress('8', a), 8);
  assert.equal(parseAddress('0x9', a), 9);
  assert.equal(parseAddress('Exit A', a), 8);
  assert.equal(parseAddress('10', a), null);
  assert.equal(parseAddress('-1', a), null);
  assert.equal(parseAddress('', a), null);
  let h = visit(visit(visit(emptyHistory(), 0), 4), 9);
  assert.equal(current(h), 9);
  h = goBack(goBack(h));
  assert.equal(current(h), 0);
  assert.equal(current(goBack(h)), 0);
  h = goForward(h);
  assert.equal(current(h), 4);
  h = visit(h, 8);
  assert.equal(current(goForward(h)), 8, 'a new move drops the forward stack');
  assert.equal(h.stack.length, 3);
});

// Invariants over every cabinet's real program, for several team seeds.
const SEEDS = ['t0', 't1', 'team-three', 'zz', 'admin-preview'];
function checkInvariants(id, program, where) {
  const a = analyzeProgram(program);
  const tag = `${id} ${where}`;
  // Blocks partition the code: contiguous, no gaps, no overlaps, each address in exactly one block.
  let next = 0;
  for (const block of a.blocks) { assert.equal(block.start, next, `${tag}: gap before block ${block.id}`); next = block.end + 1; }
  assert.equal(next, program.length, tag);
  program.forEach((_, at) => { const b = a.blocks[a.blockOf[at]]; assert.ok(b.start <= at && at <= b.end, tag); });
  // Control only enters a block at its first instruction and only leaves at its last.
  for (const jump of a.jumps) { assert.equal(a.blocks[a.blockOf[jump.to]].start, jump.to, `${tag}: jump into a block middle`); }
  for (const block of a.blocks) {
    program.slice(block.start, block.end).forEach(([op]) => assert.ok(![...BRANCHES, 'ACCEPT', 'REJECT', 'HALT'].includes(op), `${tag}: branch mid-block`));
  }
  // xrefs are symmetric with branches: every in-range branch is an xref, every xref is a real branch to that address.
  let branches = 0;
  program.forEach(([op, arg], from) => {
    if (!BRANCHES.includes(op)) { return; }
    if (arg >= 0 && arg < program.length) {
      branches += 1;
      assert.ok(a.xrefs.get(arg).some((x) => x.from === from && x.op === op), `${tag}: missing xref ${from}->${arg}`);
    } else {
      assert.ok(a.unresolved.some((u) => u.from === from), tag);
    }
  });
  let counted = 0;
  for (const [target, list] of a.xrefs) {
    for (const x of list) { counted += 1; assert.ok(BRANCHES.includes(program[x.from][0]) && program[x.from][1] === target, tag); }
    assert.ok(a.labelAt.has(target), `${tag}: referenced address ${target} has no label`);
  }
  assert.equal(counted, branches, tag);
  assert.equal(a.jumps.length + a.unresolved.length, program.filter(([op]) => BRANCHES.includes(op)).length, tag);
  for (const block of a.blocks) {
    for (const edge of block.succs) { if (edge.to !== null) { assert.ok(a.blocks[edge.to].preds.some((p) => p.from === block.id), tag); } }
  }
  const layout = layoutGraph(a);
  assert.equal(layout.nodes.length, a.blocks.length, tag);
  for (const node of layout.nodes) { assert.ok(node.x + layout.boxW <= layout.width && node.y + layout.boxH <= layout.height, tag); }
  const labels = a.exits.map((b) => b.label);
  assert.equal(new Set(labels).size, labels.length, tag);
  return a;
}

test('every cabinet, several seeds: blocks partition the code and xrefs match the branches', () => {
  let packed = 0;
  for (const level of LEVELS) {
    for (const seed of SEEDS) {
      const { program, answer } = buildPuzzle(level, { secret: 's'.repeat(32), teamId: seed });
      const a = checkInvariants(level.id, program, `${seed} original`);
      assert.ok(a.blocks[0].label.startsWith('entry'), level.id);
      assert.ok(a.exits.length >= 1, level.id);
      if (a.unresolved.length) {
        packed += 1;
        assert.equal(level.track, 'insane', `${level.id} has a bad jump target outside the insane track`);
      }
      // After the program has run (self-decrypting code is rewritten) the analysis still holds on what is there now.
      const machine = createMachine(program, answer, { debugger: false });
      while (machine.status === 'running') { stepMachine(machine); }
      assert.equal(machine.status, 'accept', `${level.id} ${seed}`);
      checkInvariants(level.id, currentProgram(machine), `${seed} after run`);
      assert.equal(runProgram(program, answer, { debugger: false }).accepted, true);
    }
  }
  assert.ok(packed > 0, 'packed cabinets show unresolved targets before they decrypt');
});
