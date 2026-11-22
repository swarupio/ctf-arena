// Pure helpers for the Hints control of the Arena Terminal. The control only ever runs the same `hint` / `hint N` command a
// player can type; everything below reads that command's output (`[hint 2/3 for code 4] ...`, see backend builtin.js).
import { costLine } from '../hints/config.js';
import { tierLabel, usedLabel } from '../hints/helpers.js';

const HINT_LINE = /\[hint (\d{1,2})\/(\d{1,2}) for code (\d{1,4})\]/;
const NO_HINTS_LINE = /^No hints are available for code/m;
const MAX_TIERS = 20;
const NO_HINT_MODES = new Set(['insane']);

export const INITIAL_HINTS = Object.freeze({ used: Object.freeze([]), code: null, tier: 0, total: 0, none: false });

// Modes with no in-shell hints (none today besides a future "insane") hide the control.
export const hintsEnabled = (mode) => typeof mode === 'string' && mode !== '' && !NO_HINT_MODES.has(mode);

export const isHintLine = (line) => typeof line === 'string' && /^\s*hint(\s+\d+)?\s*$/.test(line);

// Command text for a tier. Anything that is not a whole number from 2 to MAX_TIERS means the plain `hint`.
export function hintCommand(tier) {
  return Number.isInteger(tier) && tier >= 2 && tier <= MAX_TIERS ? `hint ${tier}` : 'hint';
}

// { tier, total, code } from a hint reply, { none: true } for "no hints for this code", otherwise null (cannot tell).
export function parseHintOutput(output) {
  if (typeof output !== 'string') { return null; }
  const match = HINT_LINE.exec(output);
  if (match) {
    const tier = Number(match[1]);
    const total = Number(match[2]);
    if (tier >= 1 && total >= tier && total <= MAX_TIERS) { return { tier, total, code: Number(match[3]) }; }
    return null;
  }
  return NO_HINTS_LINE.test(output) ? { none: true } : null;
}

// Actions: { type: 'output', text } after a hint command, { type: 'solved' } after a new code was captured.
// `used` counts distinct code+tier pairs opened this session (re-running a tier does not count twice).
export function hintReducer(state, action) {
  if (action?.type === 'solved') { return { ...state, code: null, tier: 0, total: 0, none: false }; }
  if (action?.type !== 'output') { return state; }
  const parsed = parseHintOutput(action.text);
  if (!parsed) { return state; }
  if (parsed.none) { return { ...state, code: null, tier: 0, total: 0, none: true }; }
  const key = `${parsed.code}:${parsed.tier}`;
  const used = state.used.includes(key) ? state.used : [...state.used, key];
  return { used, code: parsed.code, tier: parsed.tier, total: parsed.total, none: false };
}

// Everything the control draws.
export function hintBarView(state, { mode = '', isAdmin = false } = {}) {
  if (!hintsEnabled(mode)) { return { visible: false }; }
  const next = state.tier >= 1 && state.tier < state.total ? state.tier + 1 : null;
  const label = state.tier >= 1 ? `Hint ${state.tier} of ${state.total}, ${tierLabel(state.tier, state.total)}` : '';
  return {
    visible: true,
    firstCommand: 'hint',
    nextTier: next,
    nextCommand: next === null ? null : hintCommand(next),
    tierText: label,
    usedText: isAdmin ? null : usedLabel(state.used.length),
    costText: costLine('terminal'),
  };
}
