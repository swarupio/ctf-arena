// Pure hint-cost rules (docs/HINTS.md "Hint costs"). No I/O: the ledger and the platform settings feed these functions.
//
// A hint belongs to a TIER by its position among the level's hints. Opening it costs a PERCENTAGE of the level's base
// points; the total deduction of one level is capped at `maxPercent` of the base, and a solve always awards >= 1 point.
export const TIERS = Object.freeze(['nudge', 'approach', 'walkthrough']);

export const DEFAULT_HINT_COSTS = Object.freeze({
  enabled: true, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40,
});

const PERCENT_FIELDS = ['nudge', 'approach', 'walkthrough', 'maxPercent'];

// Tier of the hint at a 0-based position: first = nudge, second = approach, third and later = walkthrough.
export function tierOf(index) {
  if (!Number.isInteger(index) || index < 0) { return 'nudge'; }
  return TIERS[Math.min(index, TIERS.length - 1)];
}

// Clamped, defaulted costs. Anything that is not a finite number (or not a boolean for `enabled`) falls back to the default.
export function normalizeCosts(input) {
  const source = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const costs = { enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_HINT_COSTS.enabled };
  for (const field of PERCENT_FIELDS) {
    const value = source[field];
    costs[field] = typeof value === 'number' && Number.isFinite(value)
      ? Math.min(100, Math.max(0, Math.round(value)))
      : DEFAULT_HINT_COSTS[field];
  }
  return costs;
}

// Points of one hint: round(base * percent / 100), at least 1 when the percent is > 0 and the level is worth >= 10.
export function hintPoints(base, percent) {
  if (!(base > 0) || !(percent > 0)) { return 0; }
  const points = Math.round((base * percent) / 100);
  return points < 1 && base >= 10 ? 1 : points;
}

// Percentage charged for the hint at `index` (0 when costs are switched off).
export function percentOf(index, costs) {
  const normal = normalizeCosts(costs);
  return normal.enabled ? normal[tierOf(index)] : 0;
}

export const capPoints = (base, costs) => {
  const normal = normalizeCosts(costs);
  return normal.enabled && base > 0 ? Math.round((base * normal.maxPercent) / 100) : 0;
};

// What opening the hint at `index` costs on its own: { percent, points, tier }.
export function costOf(base, index, costs) {
  const percent = percentOf(index, costs);
  return { percent, points: hintPoints(base, percent), tier: tierOf(index) };
}

// Opened indexes of a level whose hints open strictly in order: 0..count-1.
export const firstN = (count) => Array.from({ length: Math.max(0, count) }, (_, index) => index);

// What one ledger row carries: the 0-based index plus the price FIXED when the hint was opened (docs/HINTS.md "Hint costs"):
// `percent` charged by that open and `capPercent` (the maxPercent in force then). Both are null on rows without a stored
// price (older rows), which are charged at the current rates. A bare number is an unpriced row.
const asEntry = (item) => {
  if (Number.isInteger(item)) { return { index: item, percent: null, capPercent: null }; }
  const percent = Number.isFinite(item?.percent) ? item.percent : null;
  return { index: item?.index, percent, capPercent: percent !== null && Number.isFinite(item?.capPercent) ? item.capPercent : null };
};

// Distinct valid entries by index, sorted ascending; a priced row wins over an unpriced one of the same index.
function entriesOf(opened) {
  const byIndex = new Map();
  for (const item of opened ?? []) {
    const entry = asEntry(item);
    if (!Number.isInteger(entry.index) || entry.index < 0) { continue; }
    const known = byIndex.get(entry.index);
    if (!known || (known.percent === null && entry.percent !== null)) { byIndex.set(entry.index, entry); }
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

// Tiers are CUMULATIVE: opening hint N also pays for the cheaper tiers below it that are not yet covered (the highest
// opened index covers everything under it). Percent that opening `index` adds, given the already opened rows.
export function marginalPercent(index, opened, costs) {
  const normal = normalizeCosts(costs);
  if (!normal.enabled) { return 0; }
  const highest = entriesOf(opened).reduce((top, entry) => Math.max(top, entry.index), -1);
  let percent = 0;
  for (let step = highest + 1; step <= index; step += 1) { percent += normal[tierOf(step)]; }
  return Math.min(100, percent);
}

// The cap, in percent of the base, that applies to these rows: the lowest stored `capPercent`; the current maxPercent for
// rows without a stored price (or priced rows without a cap) while costs are on; 0 when nothing applies.
function capPercentFor(entries, normal) {
  const caps = entries.filter((entry) => entry.percent !== null && entry.capPercent !== null).map((entry) => entry.capPercent);
  if (normal.enabled && entries.some((entry) => entry.percent === null || entry.capPercent === null)) { caps.push(normal.maxPercent); }
  return caps.length === 0 ? 0 : Math.min(...caps);
}

// Total points spent on a level, capped. Rows with a stored price are charged exactly that (no settings needed); rows
// without one are charged at the CURRENT rates, cumulatively over the tiers below them that nothing else covers. The cap is
// the lowest stored `capPercent` (what was agreed), or the current maxPercent once an unpriced row is involved.
export function spentFor(base, openedIndexes, costs) {
  if (!(base > 0)) { return 0; }
  const normal = normalizeCosts(costs);
  const entries = entriesOf(openedIndexes);
  let total = 0;
  let covered = -1;
  for (const entry of entries) {
    if (entry.percent !== null) {
      total += hintPoints(base, entry.percent);
    } else if (normal.enabled) {
      for (let step = covered + 1; step <= entry.index; step += 1) { total += hintPoints(base, normal[tierOf(step)]); }
    }
    covered = Math.max(covered, entry.index);
  }
  return Math.min(total, Math.round((base * capPercentFor(entries, normal)) / 100));
}

// True when every opened row carries its own price: the spend is then computable without reading the settings.
export const allPriced = (opened) => entriesOf(opened).every((entry) => entry.percent !== null);

// What a stored percent costs on a level: { percent, points, tier }.
export const chargeOf = (base, percent, index) => ({ percent, points: hintPoints(base, percent), tier: tierOf(index) });

// Points awarded for a solve: base minus the spend, never below 1 (a level worth nothing stays worth nothing).
export function netPoints(base, spent) {
  if (!(base > 0)) { return Math.max(0, base || 0); }
  return Math.max(1, base - Math.max(0, spent || 0));
}

// { points, percent, cap } of a level so far; `cap` is in points. percent is the spend as a share of the base.
export function spentView(base, openedIndexes, costs) {
  const points = spentFor(base, openedIndexes, costs);
  const entries = entriesOf(openedIndexes);
  const cap = base > 0 ? Math.round((base * capPercentFor(entries, normalizeCosts(costs))) / 100) : 0;
  // Nothing opened yet: the cap the current settings would apply (as before).
  return { points, percent: base > 0 ? Math.round((points * 100) / base) : 0, cap: entries.length === 0 ? capPoints(base, costs) : cap };
}

// Prices of the hints that are still closed, WITHOUT their text: [{ index, tier, percent, points }].
export function pricingFor(base, total, openedCount, costs) {
  const list = [];
  for (let index = Math.max(0, openedCount); index < total; index += 1) {
    list.push({ index, ...costOf(base, index, costs) });
  }
  return list;
}

// Same as pricingFor for hints that may be opened in any order: every index below `total` not opened, priced as what opening
// it WOULD ADD now (cumulative tiers: tiers already covered are free; the cap applies): [{ index, tier, percent, points }].
export function pricingClosed(base, total, openedIndexes, costs) {
  const normal = normalizeCosts(costs);
  const opened = entriesOf(openedIndexes);
  const open = new Set(opened.map((entry) => entry.index));
  const before = spentFor(base, opened, normal);
  const list = [];
  for (let index = 0; index < total; index += 1) {
    if (open.has(index)) { continue; }
    const percent = marginalPercent(index, opened, normal);
    const after = spentFor(base, [...opened, { index, percent, capPercent: normal.maxPercent }], normal);
    list.push({ index, tier: tierOf(index), percent, points: normal.enabled ? Math.max(0, after - before) : 0 });
  }
  return list;
}
