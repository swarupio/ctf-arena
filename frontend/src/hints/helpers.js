import { hintCost } from './config.js';

export const TIER_LABELS = Object.freeze(['Nudge', 'Approach', 'Walkthrough-lite']);
export const NO_HINTS_TRACK = 'No hints on this track. You are on your own.';
export const NO_HINTS_LEVEL = 'No hints here. You are on your own.';

const MAX_SCOPES = 400;
const STORAGE_PREFIX = 'ctf.hints.v1:';

// Tier name by position (1-based). One hint is a Nudge, two are Nudge + Approach, three or more end with Walkthrough-lite.
export function tierLabel(position, total) {
  if (!Number.isInteger(position) || !Number.isInteger(total) || position < 1 || position > total || total < 1) { return ''; }
  if (position === 1) { return TIER_LABELS[0]; }
  if (total >= 3 && position === total) { return TIER_LABELS[2]; }
  return TIER_LABELS[1];
}

// Only the Walkthrough-lite tier asks for a confirmation: it nearly gives the answer away.
export const needsConfirm = (position, total) => tierLabel(position, total) === TIER_LABELS[2];

export const usedLabel = (used) => `Hints used: ${Math.max(0, Number.isInteger(used) ? used : 0)}`;

// Everything the ladder draws, from data the client already has. `shown` are the opened hint texts in order.
export function buildLadder({ total, shown = [], allowed = true, preview = false, canOpen = true, category = '', costs } = {}) {
  const count = Number.isInteger(total) && total > 0 ? total : 0;
  const texts = (Array.isArray(shown) ? shown : []).filter((text) => typeof text === 'string').slice(0, count);
  if (!allowed) { return { kind: 'none', message: NO_HINTS_TRACK, used: 0, total: 0, tiers: [], next: null, preview, cost: 0 }; }
  if (count === 0) { return { kind: 'none', message: NO_HINTS_LEVEL, used: 0, total: 0, tiers: [], next: null, preview, cost: 0 }; }
  const tiers = Array.from({ length: count }, (_, index) => {
    const position = index + 1;
    return {
      position, label: tierLabel(position, count), text: index < texts.length ? texts[index] : null,
      state: index < texts.length ? 'open' : index === texts.length ? 'next' : 'locked',
    };
  });
  const position = texts.length + 1;
  const next = position <= count && canOpen && !preview
    ? { position, label: tierLabel(position, count), confirm: needsConfirm(position, count), button: `Open hint ${position} of ${count}` }
    : null;
  return { kind: 'ladder', message: '', used: texts.length, total: count, tiers, next, preview, cost: hintCost(category, costs) };
}

export const announcement = (ladder, position) => {
  const tier = ladder.tiers[position - 1];
  return tier?.text ? `Hint ${position} of ${ladder.total} opened, ${tier.label}. ${tier.text} ${usedLabel(ladder.used)}.` : '';
};

// ---- opened-state storage (hints the server does not track: Web Exploit Lab and Forensics) ----
// One JSON object per user: { "<scope>": openedCount }. Anything corrupt reads as "nothing opened".
export const userKey = (user) => {
  const raw = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  return raw === '' ? 'anonymous' : raw.slice(0, 200);
};
export const storageKey = (user) => `${STORAGE_PREFIX}${userKey(user)}`;

function readAll(storage, user) {
  try {
    const parsed = JSON.parse(storage?.getItem(storageKey(user)) ?? 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return {}; }
    const clean = {};
    for (const [scope, value] of Object.entries(parsed)) {
      if (scope !== '__proto__' && Number.isInteger(value) && value > 0 && value <= 50) { clean[scope] = value; }
    }
    return clean;
  } catch { return {}; }
}

export function readOpened(storage, user, scope, total) {
  const value = readAll(storage, user)[scope];
  const max = Number.isInteger(total) && total > 0 ? total : 0;
  return Number.isInteger(value) ? Math.min(Math.max(value, 0), max) : 0;
}

export function writeOpened(storage, user, scope, count) {
  try {
    const all = readAll(storage, user);
    if (Number.isInteger(count) && count > 0) { all[scope] = Math.min(count, 50); } else { delete all[scope]; }
    const keys = Object.keys(all);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SCOPES))) { delete all[key]; }
    storage?.setItem(storageKey(user), JSON.stringify(all));
    return true;
  } catch { return false; }
}
