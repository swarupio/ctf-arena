import { FREE_LINE } from './config.js';
import { inOrderPricing, mergeSpent, priceFor, priceText, spentText } from './pricing.js';

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

// Free hints ask for a confirmation only on the Walkthrough-lite tier (it nearly gives the answer away). A hint that
// costs points always asks first, whatever its tier.
export const needsConfirm = (position, total, price = null) => tierLabel(position, total) === TIER_LABELS[2] || Boolean(price && price.percent > 0);

export const usedLabel = (used) => `Hints used: ${Math.max(0, Number.isInteger(used) ? used : 0)}`;

const NO_LADDER = { used: 0, total: 0, tiers: [], next: null, costLine: '', spentText: '', pending: false };

// The one status line under the header: what was spent, else the price of the next hint, else the free line.
function statusLine({ used, count, spent, base, price, closedPrices, priced, pending, unavailable }) {
  if (!priced) { return ''; }
  const spentLine = spentText(spent, base);
  if (spentLine) { return spentLine; }
  if (used >= count) { return ''; }
  if (pending) { return 'Checking the hint price...'; }
  if (closedPrices.length === 0) { return unavailable ? 'Hint price unavailable. A hint may cost points.' : ''; }
  if (closedPrices.every((item) => item.percent <= 0)) { return FREE_LINE; }
  return `Next hint: ${priceText(price)}`;
}

// Everything the ladder draws, from data the client already has. `shown` are the opened hint texts in order.
// `pricing` is the server's hintPricing, `costs` the platform prices (fallback), `base` the level's points, `spent` the
// level's hintSpent. `priced: false` (admins, previews) hides every price and confirmation the server did not send.
export function buildLadder({
  total, shown = [], allowed = true, preview = false, canOpen = true, priced = true, pricing, costs, base, spent,
  pending = false, unavailable = false, cumulative = false,
} = {}) {
  const count = Number.isInteger(total) && total > 0 ? total : 0;
  const texts = (Array.isArray(shown) ? shown : []).filter((text) => typeof text === 'string').slice(0, count);
  if (!allowed) { return { kind: 'none', message: NO_HINTS_TRACK, preview, ...NO_LADDER }; }
  if (count === 0) { return { kind: 'none', message: NO_HINTS_LEVEL, preview, ...NO_LADDER }; }
  const showPrices = priced && !preview && canOpen;
  const used = texts.length;
  // : the server prices each closed hint as what opening it first would add; this ladder opens in order.
  const ordered = cumulative ? inOrderPricing(pricing, used) : pricing;
  const priceAt = (index) => (showPrices ? priceFor({ index, pricing: ordered, costs, base }) : null);
  const tiers = Array.from({ length: count }, (_, index) => {
    const position = index + 1;
    const price = index < used ? null : priceAt(index);
    return {
      position, label: tierLabel(position, count), text: index < used ? texts[index] : null,
      state: index < used ? 'open' : index === used ? 'next' : 'locked', price, priceText: priceText(price),
    };
  });
  const position = used + 1;
  const price = position <= count ? priceAt(used) : null;
  const next = position <= count && canOpen && !preview
    ? { position, label: tierLabel(position, count), confirm: needsConfirm(position, count, price), button: `Open hint ${position} of ${count}`, price, priceText: priceText(price) }
    : null;
  const spentView = showPrices ? mergeSpent(spent, null) : null;
  const closedPrices = tiers.filter((tier) => tier.price).map((tier) => tier.price);
  return {
    kind: 'ladder', message: '', used, total: count, tiers, next, preview,
    costLine: statusLine({ used, count, spent: spentView, base, price, closedPrices, priced: showPrices, pending, unavailable }),
    spentText: showPrices ? spentText(spentView, base) : '', pending,
  };
}

// What the confirmation step says before a hint is opened. Never empty for a hint that needs one.
export function confirmText(next) {
  if (!next) { return ''; }
  const parts = [];
  if (next.label === TIER_LABELS[2]) { parts.push(`${next.label} nearly gives the answer away.`); }
  if (next.price && next.price.percent > 0) {
    parts.push(`Hint ${next.position} (${next.label}) ${next.priceText.replace(/^Costs/, 'costs')}, taken from this level's points when your team captures it.`);
  }
  parts.push('Open it?');
  return parts.join(' ');
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
