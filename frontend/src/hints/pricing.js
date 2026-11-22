import { DEFAULT_HINT_COSTS } from './config.js';

// Pure price rules for the hint ladder. They mirror backend/src/services/hintCost.js so a price shown before a hint is
// opened matches what the server deducts at solve time. The server's own numbers (`hintPricing`, `cost`, `spent`,
// `hintCost`) always win; these functions only fill gaps and format text.
const TIERS = Object.freeze(['nudge', 'approach', 'walkthrough']);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isPercent = (value) => isCount(value) && value <= 100;

// Tier by 0-based position: first hint nudge, second approach, third and later walkthrough.
export const tierAt = (index) => TIERS[Math.min(Math.max(Number.isInteger(index) ? index : 0, 0), TIERS.length - 1)];

// GET /api/hint-costs (or the platform setting) -> a complete, valid object. Any bad field falls back to the default.
export function normalizeCosts(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const pick = (key) => (isPercent(source[key]) ? source[key] : DEFAULT_HINT_COSTS[key]);
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_HINT_COSTS.enabled,
    nudge: pick('nudge'), approach: pick('approach'), walkthrough: pick('walkthrough'), maxPercent: pick('maxPercent'),
  };
}

export const percentAt = (index, costs) => (costs && costs.enabled ? costs[tierAt(index)] : 0);

// Tiers are cumulative on the server (backend/src/services/hintCost.js marginalPercent): opening hint N also pays for the
// cheaper tiers below it that nothing opened yet (the highest opened index covers everything under it). `opened` is a list
// of 0-based opened indexes.
export function marginalPercent(index, opened, costs) {
  if (!costs || !costs.enabled) { return 0; }
  const highest = (Array.isArray(opened) ? opened : []).reduce((top, value) => (Number.isInteger(value) ? Math.max(top, value) : top), -1);
  let percent = 0;
  for (let step = highest + 1; step <= index; step += 1) { percent += costs[tierAt(step)]; }
  return Math.min(100, percent);
}

// round(base * percent / 100), at least 1 when the percent is above 0 and the level is worth 10 or more.
export function pointsFor(base, percent) {
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(percent) || percent <= 0) { return 0; }
  const points = Math.round((base * percent) / 100);
  return points === 0 && base >= 10 ? 1 : points;
}

const validEntry = (entry) => entry && isCount(entry.index) && isPercent(entry.percent);

// The price of the hint at 0-based `index`: { percent, points|null, tier }, or null when nothing is known yet.
// Order: the server's `hintPricing` entry, then the platform costs (with the level's base points when known). The fallback is
// the hint's own tier (hints opened in order); pass `opened` (indexes) where any hint can open first: the price is then what
// opening it would add.
export function priceFor({ index, pricing, costs, base, opened } = {}) {
  const entry = (Array.isArray(pricing) ? pricing : []).find((item) => validEntry(item) && item.index === index);
  if (entry) {
    return { percent: entry.percent, points: isCount(entry.points) ? entry.points : null, tier: typeof entry.tier === 'string' ? entry.tier : tierAt(index) };
  }
  if (!costs) { return null; }
  const percent = Array.isArray(opened) ? marginalPercent(index, opened, costs) : percentAt(index, costs);
  return { percent, points: Number.isFinite(base) && base > 0 ? pointsFor(base, percent) : null, tier: tierAt(index) };
}

// The server prices a closed hint as what opening it WOULD ADD (cumulative tiers). A ladder that opens hints strictly in
// order wants the price each later hint will have once the ones before it are open: the step between neighbours. Entries
// from `used` upward keep their order; the first keeps its price, a later one is its price minus the previous entry's.
export function inOrderPricing(pricing, used) {
  const list = (Array.isArray(pricing) ? pricing : []).filter(validEntry);
  const byIndex = new Map(list.map((item) => [item.index, item]));
  return list.map((item) => {
    const before = byIndex.get(item.index - 1);
    if (item.index <= used || !before) { return item; }
    return {
      ...item,
      percent: Math.max(0, item.percent - before.percent),
      points: isCount(item.points) && isCount(before.points) ? Math.max(0, item.points - before.points) : item.points,
    };
  });
}

// True when the server already priced every hint that is still closed (no need to ask GET /api/hint-costs).
export function pricingCovers(pricing, used, total) {
  for (let index = used; index < total; index += 1) {
    if (!(Array.isArray(pricing) ? pricing : []).some((item) => validEntry(item) && item.index === index)) { return false; }
  }
  return true;
}

export const FREE_WORD = 'Free';

export function priceText(price) {
  if (!price) { return ''; }
  if (price.percent <= 0) { return FREE_WORD; }
  return price.points !== null && price.points > 0 ? `Costs ${price.percent}% (-${price.points} pts)` : `Costs ${price.percent}%`;
}

// { points, percent, cap } from `spent` / `hintSpent`, or null when absent or malformed (admins never get it).
export function normalizeSpent(raw) {
  if (!raw || typeof raw !== 'object' || !isCount(raw.points)) { return null; }
  return { points: raw.points, percent: isCount(raw.percent) ? raw.percent : 0, cap: isCount(raw.cap) ? raw.cap : 0 };
}

// The larger of two spent records (the level view can be older than a hint-open response, never newer by less).
export function mergeSpent(a, b) {
  const left = normalizeSpent(a);
  const right = normalizeSpent(b);
  if (!left) { return right; }
  if (!right) { return left; }
  return right.points > left.points ? right : left;
}

// Points a team can still earn on this level given what hints already cost (always at least 1 for a level worth points).
export function earnLeft(base, spent) {
  const current = normalizeSpent(spent);
  if (!Number.isFinite(base) || base <= 0 || !current) { return null; }
  const charged = current.cap > 0 ? Math.min(current.points, current.cap) : current.points;
  return Math.max(1, base - charged);
}

// 'So far -17 pts. You can still earn 83.' Empty while nothing was spent.
export function spentText(spent, base) {
  const current = normalizeSpent(spent);
  if (!current || current.points <= 0) { return ''; }
  const left = earnLeft(base, current);
  const capped = current.cap > 0 && current.points >= current.cap ? ' (cap reached)' : '';
  return left === null ? `So far -${current.points} pts${capped}.` : `So far -${current.points} pts${capped}. You can still earn ${left}.`;
}

// The solve result line: 'Captured: 100 pts, minus 17 for hints = 83'. Empty when no hint cost anything.
export function deductionText(result) {
  const cost = result?.hintCost;
  if (!cost || !Number.isFinite(cost.spent) || cost.spent <= 0) { return ''; }
  const awarded = Number.isFinite(cost.awarded) ? cost.awarded : result.pointsAwarded;
  const base = Number.isFinite(cost.base) ? cost.base : Number.isFinite(awarded) ? awarded + cost.spent : null;
  if (base === null || !Number.isFinite(awarded)) { return `Hints cost ${cost.spent} pts.`; }
  return `Captured: ${base} pts, minus ${cost.spent} for hints = ${awarded}`;
}

// One line for the Arena Terminal, where the base points of the next code are not known up front.
export function percentLine(costs) {
  if (!costs) { return ''; }
  const c = normalizeCosts(costs);
  if (!c.enabled || (c.nudge === 0 && c.approach === 0 && c.walkthrough === 0)) { return 'Free: no points deducted'; }
  return `Costs ${c.nudge}%, ${c.approach}%, then ${c.walkthrough}% of the code's points (up to ${c.maxPercent}%)`;
}
