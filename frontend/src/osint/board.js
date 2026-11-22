// Pure helpers of the OSINT case board (docs/OSINT_TRAIL.md "Case board"): pin placement, keyboard moves, the operation
// log that is replayed after a conflict, relation suggestions and messages. No network, no DOM.
import { eventMessage } from '../event/messages.js';
export const BOARD_SIZE = 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clampPos = (n) => clamp(Math.round(Number.isFinite(Number(n)) ? Number(n) : 0), 0, BOARD_SIZE);

export const KIND_LABEL = {
  feed: 'Post', cast: 'Profile', pages: 'Web page', docs: 'Document', registry: 'Domain', photos: 'Photo', pastes: 'Paste', map: 'Place',
};
export const KINDS = Object.keys(KIND_LABEL);

// A link is an unordered pair plus a relation: the same key whichever way it was drawn.
export const linkKey = ({ a, b, rel }) => `${rel}|${[a, b].sort().join('|')}`;

export const emptyBoard = () => ({
  version: 0, pins: [], links: [], unlocked: false, readOnly: true, progress: { level: 'none', total: 0 }, nudge: '',
  limits: { pins: 40, links: 8, size: BOARD_SIZE }, relations: [],
});

// New pins fill a loose grid so they never land on top of each other.
export function nextPinPosition(pins, size = BOARD_SIZE) {
  const columns = 3;
  const stepX = Math.floor((size - 200) / (columns - 1));
  const stepY = 170;
  const taken = new Set(pins.map((p) => `${Math.round(p.x / stepX)}:${Math.round(p.y / stepY)}`));
  for (let i = 0; i < 200; i += 1) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    if (!taken.has(`${col}:${row}`)) { return { x: clampPos(40 + col * stepX), y: clampPos(40 + row * stepY) }; }
  }
  return { x: 40, y: 40 };
}

// ---- operations --------------------------------------------------------------------------------------------
// The browser edits through small operations so a conflict (409) can be resolved by replaying them on the fresh board.
export function applyOp(board, op) {
  const links = board.links;
  switch (op.type) {
    case 'pin': {
      if (board.pins.some((p) => p.id === op.pin.id) || board.pins.length >= board.limits.pins) { return board; }
      return { ...board, pins: [...board.pins, { ...op.pin, x: clampPos(op.pin.x), y: clampPos(op.pin.y) }] };
    }
    case 'move': {
      if (!board.pins.some((p) => p.id === op.id)) { return board; }
      return { ...board, pins: board.pins.map((p) => (p.id === op.id ? { ...p, x: clampPos(op.x), y: clampPos(op.y) } : p)) };
    }
    case 'unpin': {
      return { ...board, pins: board.pins.filter((p) => p.id !== op.id), links: links.filter((l) => l.a !== op.id && l.b !== op.id) };
    }
    case 'link': {
      const ids = new Set(board.pins.map((p) => p.id));
      const link = { a: op.link.a, b: op.link.b, rel: op.link.rel };
      if (link.a === link.b || !ids.has(link.a) || !ids.has(link.b)) { return board; }
      if (links.length >= board.limits.links || links.some((l) => linkKey(l) === linkKey(link))) { return board; }
      return { ...board, links: [...links, link] };
    }
    case 'unlink': return { ...board, links: links.filter((l) => linkKey(l) !== linkKey(op.link)) };
    default: return board;
  }
}
export const applyOps = (board, ops) => ops.reduce(applyOp, board);

// What the server accepts: no labels, no flags, only ids, positions, relations and the version the edit started from.
export const toPayload = (board) => ({
  version: board.version,
  pins: board.pins.map((p) => ({ id: p.id, x: clampPos(p.x), y: clampPos(p.y) })),
  links: board.links.map((l) => ({ a: l.a, b: l.b, rel: l.rel })),
});

// Why an op would be refused, for the controls to explain instead of silently doing nothing.
export function whyNot(board, op) {
  if (board.readOnly) { return 'This board is read-only here.'; }
  if (op.type === 'pin' && board.pins.length >= board.limits.pins) { return `The board holds at most ${board.limits.pins} pins.`; }
  if (op.type === 'link') {
    if (op.link.a === op.link.b) { return 'Pick two different pieces of evidence.'; }
    if (board.links.some((l) => linkKey(l) === linkKey(op.link))) { return 'That link is already on the board.'; }
    if (board.links.length >= board.limits.links) { return `The board holds at most ${board.limits.links} links. Remove one you doubt first.`; }
  }
  return null;
}

// ---- relation suggestions (from the kinds of the two ends only: no answer knowledge) --------------------------
export function suggestRelation(kindA, kindB) {
  const kinds = [kindA, kindB];
  const has = (k) => kinds.includes(k);
  if (has('cast') && (has('feed') || has('docs') || (has('pastes')))) { return 'posted'; }
  if (has('map') && (has('feed') || has('photos') || has('cast'))) { return 'at'; }
  if (has('cast') && has('registry')) { return 'owns'; }
  if ((has('pastes') || has('docs') || has('pages')) && !has('cast')) { return 'mentions'; }
  return 'linked';
}

// ---- keyboard and pointer -----------------------------------------------------------------------------------
const STEP = 10;
export function keyMove(pin, key, shift = false) {
  const d = shift ? STEP * 5 : STEP;
  const delta = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[key];
  return delta ? { x: clampPos(pin.x + delta[0]), y: clampPos(pin.y + delta[1]) } : null;
}

// A pointer position inside the board's bounding box, in board units.
export function pointerToBoard(rect, clientX, clientY) {
  if (!rect || rect.width <= 0 || rect.height <= 0) { return null; }
  return {
    x: clampPos(((clientX - rect.left) / rect.width) * BOARD_SIZE),
    y: clampPos(((clientY - rect.top) / rect.height) * BOARD_SIZE),
  };
}

// Distance in pixels before a press counts as a drag (below it, it is a click that selects the pin).
export const DRAG_THRESHOLD = 4;
export const isDrag = (from, to) => Math.hypot(to.x - from.x, to.y - from.y) > DRAG_THRESHOLD;

// ---- text ------------------------------------------------------------------------------------------------
// After a save the server only tells a coarse level (never how many links hold): none | started | close | complete.
export const LEVEL_TEXT = {
  none: 'Not there yet',
  started: 'Getting somewhere',
  close: 'Close: nearly every required link holds',
  complete: 'The chain holds',
};
export const LEVEL_PERCENT = { none: 0, started: 40, close: 80, complete: 100 };
export const levelOf = (progress) => (progress && progress.level in LEVEL_TEXT ? progress.level : 'none');
export const levelText = (progress) => LEVEL_TEXT[levelOf(progress)];
export const levelPercent = (progress) => LEVEL_PERCENT[levelOf(progress)];

// The exact count comes only from the explicit check of the saved board: "N of M" and how many checks are left.
export const checkText = ({ found, total }) => meterText({ found, total });
export function checksLeftText(checksLeft) {
  if (!Number.isInteger(checksLeft)) { return ''; }
  if (checksLeft <= 0) { return 'No checks left for now (3 a minute, 10 an hour).'; }
  return `${checksLeft} ${checksLeft === 1 ? 'check' : 'checks'} left for now.`;
}

export const meterText = ({ found, total }) => (total > 0 ? `${found} of ${total} required links found` : 'No chain defined');
export const meterPercent = ({ found, total }) => (total > 0 ? Math.min(100, Math.round((found / total) * 100)) : 0);

export function describeBoardError(error) {
  const code = error?.code;
  const event = eventMessage(error);
  if (event) { return event; }
  if (code === 'BOARD_CONFLICT') { return 'A teammate changed the board at the same moment. It was reloaded and your change applied again.'; }
  if (code === 'BOARD_LIMIT') { return error.message || 'The board is over its limits.'; }
  if (code === 'BAD_EVIDENCE' || code === 'BAD_BOARD') { return error.message || 'The board contains something this case does not know.'; }
  if (code === 'RATE_LIMITED' || error?.status === 429) { return error?.message || 'You are saving too fast. Wait a moment, your changes are kept.'; }
  if (code === 'SUBMISSIONS_FROZEN') { return 'The arena is frozen: the board is read-only for now.'; }
  if (code === 'NO_TEAM') { return 'Join or create a team first: the board is shared by your team.'; }
  if (error?.status === 403) { return error.message || 'That action is not allowed here.'; }
  return error?.message || 'Could not reach the board. Your changes are kept; trying again.';
}

// Text for a link in the list view (also the accessible description of a link line).
export function describeLink(board, link) {
  const byId = new Map(board.pins.map((p) => [p.id, p]));
  const rel = board.relations.find((r) => r.id === link.rel)?.label ?? link.rel;
  return `${byId.get(link.a)?.label ?? link.a} - ${rel} - ${byId.get(link.b)?.label ?? link.b}`;
}
