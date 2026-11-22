import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE, LEVEL_TEXT, applyOp, applyOps, checkText, checksLeftText, clampPos, describeBoardError, levelPercent, levelText, describeLink, emptyBoard, isDrag, keyMove, linkKey, meterPercent, meterText,
  nextPinPosition, pointerToBoard, suggestRelation, toPayload, whyNot,
} from '../src/osint/board.js';
import {
  MAX_ROUNDS, NOT_SAVED_MESSAGE, RETRY_DELAY_MS, UNREACHABLE_MESSAGE, classifySaveError, leavingPayload, runFlush,
} from '../src/osint/flush.js';

const pin = (id, kind = 'feed', x = 10, y = 10) => ({ id, kind, label: `label ${id}`, x, y });
const base = (extra = {}) => ({
  ...emptyBoard(), readOnly: false, limits: { pins: 3, links: 2, size: BOARD_SIZE },
  relations: [{ id: 'posted', label: 'posted / wrote' }, { id: 'linked', label: 'linked to' }], ...extra,
});

test('positions are whole numbers inside the board', () => {
  assert.equal(clampPos(-5), 0);
  assert.equal(clampPos(1500), BOARD_SIZE);
  assert.equal(clampPos(12.6), 13);
  assert.equal(clampPos('x'), 0);
});

test('a link is the same whichever way it is drawn, but a different relation is a different link', () => {
  assert.equal(linkKey({ a: 'x', b: 'y', rel: 'linked' }), linkKey({ a: 'y', b: 'x', rel: 'linked' }));
  assert.notEqual(linkKey({ a: 'x', b: 'y', rel: 'linked' }), linkKey({ a: 'x', b: 'y', rel: 'posted' }));
});

test('new pins never land on top of each other', () => {
  const pins = [];
  for (let i = 0; i < 12; i += 1) { pins.push({ id: `p${i}`, ...nextPinPosition(pins) }); }
  assert.equal(new Set(pins.map((p) => `${p.x}:${p.y}`)).size, 12);
  assert.ok(pins.every((p) => p.x >= 0 && p.x <= BOARD_SIZE && p.y >= 0 && p.y <= BOARD_SIZE));
});

test('operations pin, move, link, unlink and unpin, and ignore what the limits forbid', () => {
  let board = base();
  board = applyOp(board, { type: 'pin', pin: pin('feed:p1') });
  board = applyOp(board, { type: 'pin', pin: pin('feed:p1') });
  assert.equal(board.pins.length, 1);
  board = applyOps(board, [{ type: 'pin', pin: pin('cast:c1', 'cast') }, { type: 'pin', pin: pin('map:lm1', 'map') }, { type: 'pin', pin: pin('docs:d1', 'docs') }]);
  assert.equal(board.pins.length, 3, 'the pin cap holds');
  board = applyOp(board, { type: 'move', id: 'cast:c1', x: 2000, y: -4 });
  assert.deepEqual(board.pins.find((p) => p.id === 'cast:c1'), { ...pin('cast:c1', 'cast'), x: 1000, y: 0 });
  const link = { a: 'cast:c1', b: 'feed:p1', rel: 'posted' };
  board = applyOp(board, { type: 'link', link });
  board = applyOp(board, { type: 'link', link: { a: 'feed:p1', b: 'cast:c1', rel: 'posted' } });
  board = applyOp(board, { type: 'link', link: { a: 'feed:p1', b: 'feed:p1', rel: 'linked' } });
  board = applyOp(board, { type: 'link', link: { a: 'feed:p1', b: 'nope', rel: 'linked' } });
  assert.equal(board.links.length, 1);
  board = applyOp(board, { type: 'link', link: { a: 'feed:p1', b: 'map:lm1', rel: 'linked' } });
  board = applyOp(board, { type: 'link', link: { a: 'feed:p1', b: 'docs:d1', rel: 'linked' } });
  assert.equal(board.links.length, 2, 'the link cap holds');
  board = applyOp(board, { type: 'unlink', link: { a: 'feed:p1', b: 'cast:c1', rel: 'posted' } });
  assert.equal(board.links.length, 1);
  board = applyOp(board, { type: 'unpin', id: 'feed:p1' });
  assert.equal(board.pins.length, 2);
  assert.equal(board.links.length, 0, 'removing a pin removes its links');
  assert.equal(applyOp(board, { type: 'wat' }), board);
});

test('replaying pending edits on a teammate board keeps both sets of changes', () => {
  const mine = [{ type: 'pin', pin: pin('cast:c1', 'cast') }, { type: 'move', id: 'cast:c1', x: 500, y: 500 }];
  const theirs = base({ version: 4, pins: [pin('feed:p1')] });
  const merged = applyOps(theirs, mine);
  assert.deepEqual(merged.pins.map((p) => p.id), ['feed:p1', 'cast:c1']);
  assert.equal(merged.version, 4);
});

test('the payload carries ids, positions and relations only', () => {
  const board = base({ version: 7, pins: [pin('feed:p1')], links: [{ a: 'feed:p1', b: 'feed:p1x', rel: 'linked', extra: 1 }], unlocked: true, nudge: 'hello' });
  assert.deepEqual(toPayload(board), { version: 7, pins: [{ id: 'feed:p1', x: 10, y: 10 }], links: [{ a: 'feed:p1', b: 'feed:p1x', rel: 'linked' }] });
});

test('refusals come with a reason', () => {
  const full = base({ pins: [pin('a'), pin('b'), pin('c')], links: [{ a: 'a', b: 'b', rel: 'linked' }, { a: 'b', b: 'c', rel: 'linked' }] });
  assert.match(whyNot(full, { type: 'pin', pin: pin('d') }), /at most 3 pins/);
  assert.match(whyNot(full, { type: 'link', link: { a: 'a', b: 'c', rel: 'linked' } }), /at most 2 links/);
  assert.match(whyNot(full, { type: 'link', link: { a: 'b', b: 'a', rel: 'linked' } }), /already/);
  assert.match(whyNot(full, { type: 'link', link: { a: 'a', b: 'a', rel: 'linked' } }), /different/);
  assert.match(whyNot({ ...full, readOnly: true }, { type: 'pin', pin: pin('d') }), /read-only/);
  assert.equal(whyNot(base({ pins: [pin('a'), pin('b')] }), { type: 'link', link: { a: 'a', b: 'b', rel: 'linked' } }), null);
});

test('relation suggestions use only the kinds of the two ends', () => {
  assert.equal(suggestRelation('cast', 'feed'), 'posted');
  assert.equal(suggestRelation('docs', 'cast'), 'posted');
  assert.equal(suggestRelation('feed', 'map'), 'at');
  assert.equal(suggestRelation('cast', 'registry'), 'owns');
  assert.equal(suggestRelation('pastes', 'registry'), 'mentions');
  assert.equal(suggestRelation('registry', 'registry'), 'linked');
});

test('arrow keys move a pin by 10 units, 50 with shift, inside the board', () => {
  assert.deepEqual(keyMove({ x: 100, y: 100 }, 'ArrowRight'), { x: 110, y: 100 });
  assert.deepEqual(keyMove({ x: 100, y: 100 }, 'ArrowUp', true), { x: 100, y: 50 });
  assert.deepEqual(keyMove({ x: 0, y: 1000 }, 'ArrowLeft'), { x: 0, y: 1000 });
  assert.deepEqual(keyMove({ x: 0, y: 1000 }, 'ArrowDown'), { x: 0, y: 1000 });
  assert.equal(keyMove({ x: 1, y: 1 }, 'Enter'), null);
});

test('pointer positions map into board units and a tiny movement is a click, not a drag', () => {
  const rect = { left: 100, top: 50, width: 500, height: 250 };
  assert.deepEqual(pointerToBoard(rect, 350, 175), { x: 500, y: 500 });
  assert.deepEqual(pointerToBoard(rect, 0, 9999), { x: 0, y: 1000 });
  assert.equal(pointerToBoard({ left: 0, top: 0, width: 0, height: 5 }, 1, 1), null);
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 2, y: 2 }), false);
  assert.equal(isDrag({ x: 0, y: 0 }, { x: 9, y: 0 }), true);
});

test('the meter and the messages say what the server said, without inventing detail', () => {
  assert.equal(meterText({ found: 2, total: 5 }), '2 of 5 required links found');
  assert.equal(meterPercent({ found: 2, total: 5 }), 40);
  assert.equal(meterPercent({ found: 0, total: 0 }), 0);
  assert.match(describeBoardError({ code: 'BOARD_CONFLICT' }), /teammate/);
  assert.match(describeBoardError({ code: 'BOARD_LIMIT', message: 'A board holds at most 8 links.' }), /8 links/);
  assert.match(describeBoardError({ status: 429 }), /too fast/);
  assert.match(describeBoardError({ code: 'SUBMISSIONS_FROZEN' }), /frozen/);
  assert.match(describeBoardError({ code: 'NO_TEAM' }), /team/);
  assert.match(describeBoardError(null), /Could not reach/);
});

test('a link line is described with the labels of its pins and the relation', () => {
  const board = base({ pins: [pin('feed:p1'), pin('cast:c1', 'cast')] });
  assert.equal(describeLink(board, { a: 'cast:c1', b: 'feed:p1', rel: 'posted' }), 'label cast:c1 - posted / wrote - label feed:p1');
});

test('the coarse level has its own text and bar, and an unknown level falls back to none', () => {
  assert.equal(levelText({ level: 'complete', total: 4 }), 'The chain holds');
  assert.equal(levelPercent({ level: 'close', total: 4 }), 80);
  assert.equal(levelPercent({ level: 'weird', total: 4 }), 0);
  assert.equal(levelText(undefined), 'Not there yet');
  assert.doesNotMatch(Object.values(LEVEL_TEXT).join(' '), /\d/); // a level never states a number of links
  assert.equal(emptyBoard().progress.level, 'none');
});

test('the explicit check shows N of M and the remaining checks', () => {
  assert.equal(checkText({ found: 3, total: 5 }), '3 of 5 required links found');
  assert.match(checksLeftText(2), /2 checks left/);
  assert.match(checksLeftText(1), /1 check left/);
  assert.match(checksLeftText(0), /No checks left/);
  assert.equal(checksLeftText(undefined), '');
  assert.match(describeBoardError({ status: 429, code: 'RATE_LIMITED', message: 'You can check your chain 3 times a minute and 10 times an hour. Try again later.' }), /3 times a minute/);
});

// ---- the save loop -----------------------------------------------------------------------------------------
const addPin = (id) => ({ type: 'pin', pin: pin(id) });
function harness({ save, fetchBoard, ops = [addPin('feed:p1')], server = base() }) {
  const state = { ops, server, statuses: [], scheduled: [], unlocked: 0, alive: true };
  const io = {
    getOps: () => state.ops,
    getServer: () => state.server,
    save,
    fetchBoard: fetchBoard ?? (async () => state.server),
    commit: (s, o) => { state.server = s; state.ops = o; },
    setStatus: (s) => state.statuses.push(s),
    isAlive: () => state.alive,
    onUnlocked: () => { state.unlocked += 1; },
    schedule: (ms) => state.scheduled.push(ms),
    describe: (e) => `desc:${e.code ?? e.status}`,
  };
  return { state, io };
}
const conflict = () => Object.assign(new Error('x'), { code: 'BOARD_CONFLICT', status: 409 });

test('classifies save errors: conflict, refusal for good, or retry', () => {
  assert.equal(classifySaveError({ code: 'BOARD_CONFLICT', status: 409 }), 'conflict');
  assert.equal(classifySaveError({ status: 422, code: 'BOARD_LIMIT' }), 'drop');
  assert.equal(classifySaveError({ status: 423 }), 'drop');
  assert.equal(classifySaveError({ status: 429 }), 'retry');
  assert.equal(classifySaveError({ status: 502 }), 'retry');
  assert.equal(classifySaveError(new TypeError('Failed to fetch')), 'retry');
  assert.equal(classifySaveError({ status: 502, code: 'BAD_RESPONSE' }), 'retry');
});

test('a successful save commits the server board and drops only the sent edits', async () => {
  const { state, io } = harness({ save: async () => ({ ...base(), version: 1, unlocked: true }) });
  assert.equal(await runFlush(io), 'saved-all');
  assert.equal(state.server.version, 1);
  assert.equal(state.ops.length, 0);
  assert.equal(state.unlocked, 1);
  assert.equal(state.statuses.at(-1).kind, 'saved');
});

test('a failing reload after a conflict never leaves the status on Saving: it says so and retries', async () => {
  const { state, io } = harness({ save: async () => { throw conflict(); }, fetchBoard: async () => { throw new Error('offline'); } });
  assert.equal(await runFlush(io), 'retry-scheduled');
  assert.deepEqual(state.statuses.at(-1), { kind: 'error', message: UNREACHABLE_MESSAGE });
  assert.deepEqual(state.scheduled, [RETRY_DELAY_MS]);
  assert.equal(state.ops.length, 1); // the edit is kept
});

test('conflicts that keep happening end with an error status and a rescheduled flush, never a silent stop', async () => {
  let fetched = 0;
  const { state, io } = harness({ save: async () => { throw conflict(); }, fetchBoard: async () => { fetched += 1; return base({ version: fetched }); } });
  assert.equal(await runFlush(io), 'retry-scheduled');
  assert.equal(fetched, MAX_ROUNDS);
  assert.deepEqual(state.statuses.at(-1), { kind: 'error', message: NOT_SAVED_MESSAGE });
  assert.deepEqual(state.scheduled, [RETRY_DELAY_MS]);
  assert.equal(state.ops.length, 1);
});

test('a conflict that resolves on the second round saves and reports saved', async () => {
  let tries = 0;
  const { state, io } = harness({ save: async () => { tries += 1; if (tries === 1) { throw conflict(); } return { ...base(), version: 5 }; } });
  assert.equal(await runFlush(io), 'saved-all');
  assert.equal(state.server.version, 5);
  assert.equal(state.statuses.some((s) => s.kind === 'merged'), true);
  assert.deepEqual(state.scheduled, []);
});

test('a network or server error keeps the edits and schedules a retry; a refusal drops them', async () => {
  const retry = harness({ save: async () => { throw Object.assign(new Error('boom'), { status: 503 }); } });
  assert.equal(await runFlush(retry.io), 'retry-scheduled');
  assert.equal(retry.state.ops.length, 1);
  assert.deepEqual(retry.state.scheduled, [RETRY_DELAY_MS]);
  const refused = harness({ save: async () => { throw Object.assign(new Error('no'), { status: 422, code: 'BOARD_LIMIT' }); } });
  assert.equal(await runFlush(refused.io), 'dropped');
  assert.equal(refused.state.ops.length, 0);
  assert.equal(refused.state.statuses.at(-1).kind, 'error');
});

test('nothing happens without edits, and an unmounted board is left alone', async () => {
  const idle = harness({ save: async () => { throw new Error('must not be called'); }, ops: [] });
  assert.equal(await runFlush(idle.io), 'idle');
  const gone = harness({ save: async () => { gone.state.alive = false; return base(); } });
  assert.equal(await runFlush(gone.io), 'stopped');
});

test('leaving the page sends the pending edits applied to the server board, and nothing when there are none', () => {
  const server = base();
  assert.equal(leavingPayload(server, []), null);
  assert.equal(leavingPayload(null, [addPin('feed:p1')]), null);
  assert.equal(leavingPayload({ ...server, readOnly: true }, [addPin('feed:p1')]), null);
  const payload = leavingPayload(server, [addPin('feed:p1')]);
  assert.equal(payload.version, 0);
  assert.deepEqual(payload.pins.map((p) => p.id), ['feed:p1']);
});
