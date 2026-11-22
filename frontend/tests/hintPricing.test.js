import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HINT_COSTS, FREE_LINE } from '../src/hints/config.js';
import { buildLadder, confirmText, needsConfirm } from '../src/hints/helpers.js';
import {
  deductionText, earnLeft, inOrderPricing, marginalPercent, mergeSpent, normalizeCosts, normalizeSpent, percentAt, percentLine, pointsFor, priceFor, priceText,
  pricingCovers, ptsText, spentText, tierAt,
} from '../src/hints/pricing.js';

const PRICING = [
  { index: 0, tier: 'nudge', percent: 5, points: 5 },
  { index: 1, tier: 'approach', percent: 10, points: 10 },
  { index: 2, tier: 'walkthrough', percent: 25, points: 25 },
];

test('the fallback defaults mirror the backend 5/10/25/40', () => {
  assert.deepEqual({ ...DEFAULT_HINT_COSTS }, { enabled: true, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40 });
  assert.ok(Object.isFrozen(DEFAULT_HINT_COSTS));
  assert.equal(FREE_LINE, 'Free: no points deducted');
});

test('normalizeCosts repairs anything invalid with the defaults', () => {
  assert.deepEqual(normalizeCosts(null), { ...DEFAULT_HINT_COSTS });
  assert.deepEqual(normalizeCosts({ enabled: false, nudge: 0, approach: 2, walkthrough: 3, maxPercent: 9 }), { enabled: false, nudge: 0, approach: 2, walkthrough: 3, maxPercent: 9 });
  assert.equal(normalizeCosts({ nudge: -1 }).nudge, 5);
  assert.equal(normalizeCosts({ nudge: 101 }).nudge, 5);
  assert.equal(normalizeCosts({ approach: 2.5 }).approach, 10);
  assert.equal(normalizeCosts({ enabled: 'yes' }).enabled, true);
  assert.equal(normalizeCosts([1, 2]).walkthrough, 25);
});

test('tiers follow the position and a disabled setting makes every hint free', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(tierAt), ['nudge', 'approach', 'walkthrough', 'walkthrough', 'walkthrough']);
  assert.equal(percentAt(1, DEFAULT_HINT_COSTS), 10);
  assert.equal(percentAt(1, { ...DEFAULT_HINT_COSTS, enabled: false }), 0);
  assert.equal(percentAt(1, null), 0);
});

test('pointsFor matches the backend rounding and minimum', () => {
  assert.equal(pointsFor(100, 5), 5);
  assert.equal(pointsFor(120, 10), 12);
  assert.equal(pointsFor(50, 25), 13);
  assert.equal(pointsFor(10, 5), 1);
  assert.equal(pointsFor(9, 5), 0);
  assert.equal(pointsFor(100, 0), 0);
  assert.equal(pointsFor(0, 50), 0);
  assert.equal(pointsFor(undefined, 50), 0);
});

test('priceFor prefers the server entry, then the platform costs, then nothing', () => {
  assert.deepEqual(priceFor({ index: 1, pricing: PRICING, costs: null }), { percent: 10, points: 10, tier: 'approach' });
  assert.deepEqual(priceFor({ index: 0, pricing: [], costs: DEFAULT_HINT_COSTS, base: 120 }), { percent: 5, points: 6, tier: 'nudge' });
  assert.deepEqual(priceFor({ index: 2, costs: DEFAULT_HINT_COSTS }), { percent: 25, points: null, tier: 'walkthrough' });
  assert.equal(priceFor({ index: 0 }), null);
  assert.deepEqual(priceFor({ index: 0, costs: { ...DEFAULT_HINT_COSTS, enabled: false }, base: 100 }), { percent: 0, points: 0, tier: 'nudge' });
  assert.equal(priceFor({ index: 0, pricing: [{ index: 0, percent: 500 }], costs: null }), null);
});

test('price text: Free, percent with points, percent alone', () => {
  assert.equal(priceText({ percent: 10, points: 12, tier: 'approach' }), 'Costs\u00a010% (-12\u00a0pts)');
  assert.equal(priceText({ percent: 10, points: null }), 'Costs\u00a010%');
  assert.equal(priceText({ percent: 5, points: 0 }), 'Costs\u00a05%');
  assert.equal(priceText({ percent: 0, points: 0 }), 'Free');
  assert.equal(priceText(null), '');
});

test('pricingCovers says whether the server priced every closed hint', () => {
  assert.equal(pricingCovers(PRICING, 0, 3), true);
  assert.equal(pricingCovers(PRICING.slice(1), 1, 3), true);
  assert.equal(pricingCovers(PRICING.slice(1), 0, 3), false);
  assert.equal(pricingCovers(undefined, 0, 2), false);
  assert.equal(pricingCovers(undefined, 2, 2), true);
});

test('spent records: normalise, merge, what is left and the sentence', () => {
  assert.deepEqual(normalizeSpent({ points: 17, percent: 15, cap: 40 }), { points: 17, percent: 15, cap: 40 });
  assert.equal(normalizeSpent({ points: -1 }), null);
  assert.equal(normalizeSpent(undefined), null);
  assert.equal(mergeSpent({ points: 5 }, { points: 17 }).points, 17);
  assert.equal(mergeSpent({ points: 17 }, { points: 5 }).points, 17);
  assert.equal(mergeSpent(null, { points: 3 }).points, 3);
  assert.equal(mergeSpent(null, null), null);
  assert.equal(earnLeft(100, { points: 17, cap: 40 }), 83);
  assert.equal(earnLeft(100, { points: 90, cap: 40 }), 60);
  assert.equal(earnLeft(10, { points: 10, cap: 0 }), 1);
  assert.equal(earnLeft(undefined, { points: 3 }), null);
  assert.equal(spentText({ points: 17, percent: 15, cap: 40 }, 100), 'So far -17\u00a0pts. You can still earn 83.');
  assert.equal(spentText({ points: 40, percent: 40, cap: 40 }, 100), 'So far -40\u00a0pts (cap reached). You can still earn 60.');
  assert.equal(spentText({ points: 17, percent: 15, cap: 40 }), 'So far -17\u00a0pts.');
  assert.equal(spentText({ points: 0, percent: 0, cap: 40 }, 100), '');
  assert.equal(spentText(null, 100), '');
});

test('the solve message names the base, the deduction and the net points', () => {
  assert.equal(deductionText({ pointsAwarded: 83, hintCost: { spent: 17, openedCount: 2, base: 100, awarded: 83 } }), 'Captured: 100\u00a0pts, minus 17 for hints = 83');
  assert.equal(deductionText({ pointsAwarded: 83, hintCost: { spent: 17, openedCount: 2 } }), 'Captured: 100\u00a0pts, minus 17 for hints = 83');
  assert.equal(deductionText({ pointsAwarded: 100 }), '');
  assert.equal(deductionText({ pointsAwarded: 100, hintCost: { spent: 0, base: 100, awarded: 100 } }), '');
  assert.equal(deductionText({ hintCost: { spent: 5 } }), 'Hints cost 5\u00a0pts.');
  assert.equal(deductionText(null), '');
});

test('terminal percent line: free when disabled or all zero', () => {
  assert.equal(percentLine({ enabled: false }), 'Free: no points deducted');
  assert.equal(percentLine({ enabled: true, nudge: 0, approach: 0, walkthrough: 0, maxPercent: 40 }), 'Free: no points deducted');
  assert.equal(percentLine(DEFAULT_HINT_COSTS), "Costs\u00a05%, 10%, then 25% of the flag's points (up to 40%)");
  assert.equal(percentLine(null), '');
});

test('ladder: closed hints show their price before opening, from hintPricing', () => {
  const ladder = buildLadder({ total: 3, shown: [], pricing: PRICING, base: 100 });
  assert.deepEqual(ladder.tiers.map((t) => t.priceText), ['Costs\u00a05% (-5\u00a0pts)', 'Costs\u00a010% (-10\u00a0pts)', 'Costs\u00a025% (-25\u00a0pts)']);
  assert.equal(ladder.next.priceText, 'Costs\u00a05% (-5\u00a0pts)');
  assert.equal(ladder.next.confirm, true);
  assert.equal(ladder.costLine, 'Next hint: Costs\u00a05% (-5\u00a0pts)');
  const mid = buildLadder({ total: 3, shown: ['a'], pricing: PRICING.slice(1), base: 100, spent: { points: 5, percent: 5, cap: 40 } });
  assert.deepEqual(mid.tiers.map((t) => t.priceText), ['', 'Costs\u00a010% (-10\u00a0pts)', 'Costs\u00a025% (-25\u00a0pts)']);
  assert.equal(mid.costLine, 'So far -5\u00a0pts. You can still earn 95.');
  assert.equal(mid.next.priceText, 'Costs\u00a010% (-10\u00a0pts)');
});

test('ladder: without hintPricing the platform costs and the level points fill in', () => {
  const ladder = buildLadder({ total: 2, shown: [], costs: DEFAULT_HINT_COSTS, base: 120 });
  assert.deepEqual(ladder.tiers.map((t) => t.priceText), ['Costs\u00a05% (-6\u00a0pts)', 'Costs\u00a010% (-12\u00a0pts)']);
  const noBase = buildLadder({ total: 2, shown: [], costs: DEFAULT_HINT_COSTS });
  assert.equal(noBase.next.priceText, 'Costs\u00a05%');
});

test('ladder: waiting for the platform costs and a failed read say so, and invent nothing', () => {
  const waiting = buildLadder({ total: 2, shown: [], pending: true });
  assert.equal(waiting.costLine, 'Checking the hint price...');
  assert.equal(waiting.next.priceText, '');
  assert.equal(waiting.next.confirm, false);
  const failed = buildLadder({ total: 2, shown: [], unavailable: true });
  assert.equal(failed.costLine, 'Hint price unavailable. A hint may cost points.');
});

test('ladder: free states read Free, disabled or percent 0', () => {
  const off = buildLadder({ total: 2, shown: [], costs: { ...DEFAULT_HINT_COSTS, enabled: false }, base: 100 });
  assert.equal(off.costLine, FREE_LINE);
  assert.deepEqual(off.tiers.map((t) => t.priceText), ['Free', 'Free']);
  assert.equal(off.next.confirm, false);
  const zero = buildLadder({ total: 3, shown: [], pricing: PRICING.map((p) => ({ ...p, percent: 0, points: 0 })) });
  assert.equal(zero.costLine, FREE_LINE);
  assert.equal(zero.next.priceText, 'Free');
  assert.equal(zero.next.confirm, false);
  assert.equal(buildLadder({ total: 3, shown: ['a', 'b'], pricing: [{ index: 2, tier: 'walkthrough', percent: 0, points: 0 }] }).next.confirm, true);
});

test('ladder: admin preview, no-open and unpriced screens show no prices or confirmations', () => {
  for (const options of [{ preview: true }, { canOpen: false }, { priced: false }]) {
    const ladder = buildLadder({ total: 3, shown: [], pricing: PRICING, costs: DEFAULT_HINT_COSTS, base: 100, spent: { points: 9, percent: 9, cap: 40 }, ...options });
    assert.equal(ladder.costLine, '', JSON.stringify(options));
    assert.ok(ladder.tiers.every((t) => t.priceText === ''));
    if (ladder.next) { assert.equal(ladder.next.priceText, ''); assert.equal(ladder.next.confirm, false); }
  }
});

test('ladder: server fields missing and no fallback reads as plain, free of any price text', () => {
  const ladder = buildLadder({ total: 3, shown: [] });
  assert.equal(ladder.costLine, '');
  assert.equal(ladder.next.confirm, false);
  assert.equal(buildLadder({ total: 3, shown: ['a', 'b'] }).next.confirm, true);
});

test('the last tier always confirms; a paid hint confirms whatever its tier', () => {
  assert.equal(needsConfirm(3, 3), true);
  assert.equal(needsConfirm(1, 3), false);
  assert.equal(needsConfirm(1, 3, { percent: 5 }), true);
  assert.equal(needsConfirm(1, 3, { percent: 0 }), false);
});

test('confirmation text includes the price and where it is deducted', () => {
  const paid = buildLadder({ total: 3, shown: [], pricing: PRICING });
  assert.equal(confirmText(paid.next), "Hint 1 (Nudge) costs\u00a05% (-5\u00a0pts), taken from this level's points when your team captures it. Open it?");
  const last = buildLadder({ total: 3, shown: ['a', 'b'], pricing: [PRICING[2]] });
  assert.match(confirmText(last.next), /^Walkthrough-lite nearly gives the answer away\. Hint 3 \(Walkthrough-lite\) costs\u00a025% \(-25\u00a0pts\)/);
  const freeLast = buildLadder({ total: 3, shown: ['a', 'b'] });
  assert.equal(confirmText(freeLast.next), 'Walkthrough-lite nearly gives the answer away. Open it?');
  assert.equal(confirmText(null), '');
});

// Cumulative tiers (mirror of backend/src/services/hintCost.js marginalPercent / pricingClosed).
test('marginalPercent adds the cheaper tiers below that nothing opened yet', () => {
  const costs = DEFAULT_HINT_COSTS;
  assert.equal(marginalPercent(0, [], costs), 5);
  assert.equal(marginalPercent(2, [], costs), 40);
  assert.equal(marginalPercent(2, [0], costs), 35);
  assert.equal(marginalPercent(2, [0, 1], costs), 25);
  assert.equal(marginalPercent(0, [2], costs), 0);
  assert.equal(marginalPercent(2, [], { ...costs, enabled: false }), 0);
  assert.equal(marginalPercent(2, [], null), 0);
  assert.equal(marginalPercent(3, [], { ...costs, nudge: 100, approach: 100, walkthrough: 100 }), 100);
});

test('priceFor with opened indexes prices what opening the hint would add; without them it stays the own tier', () => {
  const costs = DEFAULT_HINT_COSTS;
  assert.deepEqual(priceFor({ index: 2, costs, base: 100, opened: [] }), { percent: 40, points: 40, tier: 'walkthrough' });
  assert.deepEqual(priceFor({ index: 2, costs, base: 100, opened: [0, 1] }), { percent: 25, points: 25, tier: 'walkthrough' });
  assert.deepEqual(priceFor({ index: 2, costs, base: 100 }), { percent: 25, points: 25, tier: 'walkthrough' });
});

test('inOrderPricing turns the server prices (what each would add) into the step each later hint costs', () => {
  const server = [
    { index: 0, tier: 'nudge', percent: 5, points: 2 },
    { index: 1, tier: 'approach', percent: 15, points: 5 },
    { index: 2, tier: 'walkthrough', percent: 40, points: 12 },
  ];
  assert.deepEqual(inOrderPricing(server, 0).map((p) => [p.index, p.percent, p.points]), [[0, 5, 2], [1, 10, 3], [2, 25, 7]]);
  // Nudge already open: the approach is the next hint at its own price (the server already priced it that way).
  const afterNudge = [
    { index: 1, tier: 'approach', percent: 10, points: 3 },
    { index: 2, tier: 'walkthrough', percent: 35, points: 10 },
  ];
  assert.deepEqual(inOrderPricing(afterNudge, 1).map((p) => [p.index, p.percent, p.points]), [[1, 10, 3], [2, 25, 7]]);
  assert.deepEqual(inOrderPricing(null, 0), []);
});

test('the ladder shows the in-order step prices when the server prices are cumulative', () => {
  const server = [
    { index: 0, tier: 'nudge', percent: 5, points: 2 },
    { index: 1, tier: 'approach', percent: 15, points: 5 },
    { index: 2, tier: 'walkthrough', percent: 40, points: 12 },
  ];
  const ladder = buildLadder({ total: 3, shown: [], pricing: server, base: 30, cumulative: true });
  assert.deepEqual(ladder.tiers.map((tier) => tier.price.percent), [5, 10, 25]);
  assert.equal(ladder.next.price.percent, 5);
  const plain = buildLadder({ total: 3, shown: [], pricing: server, base: 30 });
  assert.deepEqual(plain.tiers.map((tier) => tier.price.percent), [5, 15, 40]);
});

test('one point reads "1 pt" in every message built from the prices; the unit never splits from its number', () => {
  assert.equal(ptsText(1), '1\u00a0pt');
  assert.equal(ptsText(0), '0\u00a0pts');
  assert.equal(ptsText(2), '2\u00a0pts');
  assert.equal(priceText({ percent: 5, points: 1, tier: 'nudge' }), 'Costs\u00a05% (-1\u00a0pt)');
  assert.equal(spentText({ points: 1, percent: 1, cap: 40 }, 100), 'So far -1\u00a0pt. You can still earn 99.');
  assert.equal(deductionText({ hintCost: { spent: 1 } }), 'Hints cost 1\u00a0pt.');
  assert.equal(deductionText({ pointsAwarded: 9, hintCost: { spent: 1, base: 10, awarded: 9 } }), 'Captured: 10\u00a0pts, minus 1 for hints = 9');
  assert.equal(deductionText({ pointsAwarded: 1, hintCost: { spent: 1, base: 2, awarded: 1 } }), 'Captured: 2\u00a0pts, minus 1 for hints = 1');
  const confirm = confirmText(buildLadder({ total: 3, shown: [], pricing: [{ index: 0, tier: 'nudge', percent: 5, points: 1 }] }).next);
  assert.match(confirm, /costs\u00a05% \(-1\u00a0pt\),/);
  // No ordinary space may sit between "Costs" and its percent, or between a number and "pt(s)".
  const text = priceText({ percent: 25, points: 12, tier: 'walkthrough' });
  assert.doesNotMatch(text, /Costs \d|\d pts?/);
  // Screen readers get the same words once the non-breaking spaces are read as spaces.
  assert.equal(text.replace(/\u00a0/g, ' '), 'Costs 25% (-12 pts)');
});

// Expected numbers: backend/src/services/hintCost.js `pricingClosed(base, 3, opened, { enabled: true, nudge: 5, approach: 10,
// walkthrough: 25, maxPercent: 40 })` for the default costs, copied from running it. [index, percent, points] of the closed hints.
const BACKEND_CLOSED = {
  8: { none: [[0, 5, 0], [1, 15, 1], [2, 40, 3]], first: [[1, 10, 1], [2, 35, 3]], firstTwo: [[2, 25, 2]], thirdFirst: [[0, 0, 0], [1, 0, 0]] },
  30: { none: [[0, 5, 2], [1, 15, 5], [2, 40, 12]], first: [[1, 10, 3], [2, 35, 10]], firstTwo: [[2, 25, 7]], thirdFirst: [[0, 0, 0], [1, 0, 0]] },
  40: { none: [[0, 5, 2], [1, 15, 6], [2, 40, 16]], first: [[1, 10, 4], [2, 35, 14]], firstTwo: [[2, 25, 10]], thirdFirst: [[0, 0, 0], [1, 0, 0]] },
  100: { none: [[0, 5, 5], [1, 15, 15], [2, 40, 40]], first: [[1, 10, 10], [2, 35, 35]], firstTwo: [[2, 25, 25]], thirdFirst: [[0, 0, 0], [1, 0, 0]] },
  150: { none: [[0, 5, 8], [1, 15, 23], [2, 40, 60]], first: [[1, 10, 15], [2, 35, 52]], firstTwo: [[2, 25, 37]], thirdFirst: [[0, 0, 0], [1, 0, 0]] },
};
const OPENED = { none: [], first: [0], firstTwo: [0, 1], thirdFirst: [2] };
const asServer = (rows) => rows.map(([index, percent, points]) => ({ index, tier: tierAt(index), percent, points }));

test('priceFor with opened hints gives the percent the backend pricingClosed gives, and the points within one rounding step', () => {
  for (const [base, states] of Object.entries(BACKEND_CLOSED)) {
    for (const [state, rows] of Object.entries(states)) {
      for (const [index, percent, points] of rows) {
        const price = priceFor({ index, costs: DEFAULT_HINT_COSTS, base: Number(base), opened: OPENED[state] });
        assert.equal(price.percent, percent, `base ${base} ${state} hint ${index + 1} percent`);
        // The backend also applies the cap and sums rounded tiers; the client estimate (only used when the server sent no price) may differ by one.
        assert.ok(Math.abs(price.points - points) <= 1, `base ${base} ${state} hint ${index + 1} points ${price.points} vs ${points}`);
      }
    }
  }
});

test('marginalPercent matches the backend for none, first, first two and third first', () => {
  for (const states of Object.values(BACKEND_CLOSED)) {
    for (const [state, rows] of Object.entries(states)) {
      for (const [index, percent] of rows) { assert.equal(marginalPercent(index, OPENED[state], DEFAULT_HINT_COSTS), percent); }
    }
  }
});

test('inOrderPricing turns the backend closed prices into exactly what the backend charges when the hints open in order', () => {
  for (const [base, states] of Object.entries(BACKEND_CLOSED)) {
    const fresh = inOrderPricing(asServer(states.none), 0).map((p) => [p.index, p.percent, p.points]);
    // What the backend charges as each hint opens in turn: the first from "none", the second from "first", the third from "first two".
    const sequential = [states.none[0], states.first[0], states.firstTwo[0]];
    assert.deepEqual(fresh, sequential, `base ${base} from none`);
    const afterFirst = inOrderPricing(asServer(states.first), 1).map((p) => [p.index, p.percent, p.points]);
    assert.deepEqual(afterFirst, [states.first[0], states.firstTwo[0]], `base ${base} after the first hint`);
    const afterTwo = inOrderPricing(asServer(states.firstTwo), 2).map((p) => [p.index, p.percent, p.points]);
    assert.deepEqual(afterTwo, states.firstTwo, `base ${base} after two hints`);
  }
});

test('the cumulative ladder shows the same prices the backend will charge, from none and after the first hint', () => {
  const none = buildLadder({ total: 3, shown: [], pricing: asServer(BACKEND_CLOSED[100].none), base: 100, cumulative: true });
  assert.deepEqual(none.tiers.map((t) => [t.price.percent, t.price.points]), [[5, 5], [10, 10], [25, 25]]);
  const after = buildLadder({ total: 3, shown: ['a'], pricing: asServer(BACKEND_CLOSED[100].first), base: 100, cumulative: true });
  assert.deepEqual(after.tiers.filter((t) => t.price).map((t) => [t.price.percent, t.price.points]), [[10, 10], [25, 25]]);
});

test('inOrderPricing gives the same steps from a list older than the last open (it still holds the opened hints)', () => {
  const stale = asServer(BACKEND_CLOSED[30].none);
  assert.deepEqual(inOrderPricing(stale, 1).filter((p) => p.index >= 1).map((p) => [p.index, p.percent, p.points]), [[1, 10, 3], [2, 25, 7]]);
  assert.deepEqual(inOrderPricing(stale, 2).filter((p) => p.index >= 2).map((p) => [p.index, p.percent, p.points]), [[2, 25, 7]]);
  const ladder = buildLadder({ total: 3, shown: ['a'], pricing: stale, base: 30, cumulative: true });
  assert.deepEqual(ladder.tiers.filter((t) => t.price).map((t) => t.price.percent), [10, 25]);
});
