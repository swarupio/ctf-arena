// Pure hint-cost rules (services/hintCost.js). docs/HINTS.md "Hint costs".
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HINT_COSTS, allPriced, capPoints, chargeOf, costOf, firstN, hintPoints, marginalPercent, netPoints, normalizeCosts, percentOf, pricingClosed, pricingFor, spentFor, spentView, tierOf,
} from '../../src/services/hintCost.js';

const D = DEFAULT_HINT_COSTS;

describe('tierOf', () => {
  it('is nudge, approach, then walkthrough for the third hint and later', () => {
    expect([0, 1, 2, 3, 9].map(tierOf)).toEqual(['nudge', 'approach', 'walkthrough', 'walkthrough', 'walkthrough']);
  });
  it('treats junk positions as the first tier', () => {
    expect([-1, 1.5, NaN, undefined, '2'].map(tierOf)).toEqual(['nudge', 'nudge', 'nudge', 'nudge', 'nudge']);
  });
});

describe('normalizeCosts', () => {
  it('returns the defaults for nothing, junk or a non-object', () => {
    for (const input of [undefined, null, 5, 'x', [], {}]) { expect(normalizeCosts(input)).toEqual(D); }
  });
  it('clamps, rounds and keeps valid values', () => {
    expect(normalizeCosts({ enabled: false, nudge: -4, approach: 250, walkthrough: 33.6, maxPercent: 0 }))
      .toEqual({ enabled: false, nudge: 0, approach: 100, walkthrough: 34, maxPercent: 0 });
  });
  it('rejects non-numbers (default instead) and non-booleans', () => {
    expect(normalizeCosts({ enabled: 'no', nudge: '7', approach: NaN, walkthrough: Infinity, maxPercent: null })).toEqual(D);
  });
  it('ignores unknown keys', () => {
    expect(normalizeCosts({ nudge: 1, extra: 9 })).toEqual({ ...D, nudge: 1 });
  });
});

describe('hintPoints', () => {
  it('rounds the percentage of the base', () => {
    expect(hintPoints(100, 10)).toBe(10);
    expect(hintPoints(50, 5)).toBe(3); // 2.5 rounds up
    expect(hintPoints(1000, 25)).toBe(250);
  });
  it('is at least 1 for a positive percent when the level is worth 10 or more', () => {
    expect(hintPoints(10, 5)).toBe(1); // 0.5 -> 1
    expect(hintPoints(10, 1)).toBe(1);
  });
  it('can round to 0 on tiny levels (base under 10)', () => {
    expect(hintPoints(1, 25)).toBe(0);
    expect(hintPoints(9, 5)).toBe(0);
  });
  it('is 0 for percent 0 or an empty base', () => {
    expect(hintPoints(100, 0)).toBe(0);
    expect(hintPoints(0, 50)).toBe(0);
    expect(hintPoints(-5, 50)).toBe(0);
  });
});

describe('spentFor and netPoints', () => {
  it('is 0 without opened hints, and for junk input', () => {
    expect(spentFor(100, [], D)).toBe(0);
    expect(spentFor(100, undefined, D)).toBe(0);
    expect(spentFor(100, [-1, 1.5, 'a'], D)).toBe(0);
  });
  it('charges 1, 2 and 3 hints by position', () => {
    expect(spentFor(100, [0], D)).toBe(5);
    expect(spentFor(100, [0, 1], D)).toBe(15);
    expect(spentFor(100, [0, 1, 2], D)).toBe(40); // 5 + 10 + 25 = 40, exactly the cap
    expect(spentFor(100, [1], D)).toBe(15); // tiers are cumulative: the approach hint also pays for the nudge below it
  });
  it('caps the total at maxPercent of the base', () => {
    expect(spentFor(100, [0, 1, 2, 3, 4, 5], D)).toBe(40);
    expect(spentFor(10, [0, 1, 2, 3, 4], D)).toBe(4);
    expect(spentFor(1000, [0, 1, 2, 3], { ...D, maxPercent: 10 })).toBe(100);
    expect(spentFor(100, [0, 1, 2], { ...D, maxPercent: 0 })).toBe(0);
  });
  it('counts duplicates in openedIndexes once', () => {
    expect(spentFor(100, [0, 0, 0, 1, 1], D)).toBe(15);
  });
  it('is 0 when costs are disabled or all percentages are 0 (free preset)', () => {
    expect(spentFor(100, [0, 1, 2], { ...D, enabled: false })).toBe(0);
    expect(spentFor(100, [0, 1, 2], { enabled: true, nudge: 0, approach: 0, walkthrough: 0, maxPercent: 40 })).toBe(0);
  });
  it('handles base 10, 1 and 1000', () => {
    expect(spentFor(10, [0], D)).toBe(1);
    expect(spentFor(10, [0, 1], D)).toBe(2);
    expect(spentFor(1, [0, 1, 2], D)).toBe(0);
    expect(spentFor(1000, [0, 1, 2], D)).toBe(400);
    expect(spentFor(0, [0], D)).toBe(0);
  });
  it('uses the defaults for missing costs', () => {
    expect(spentFor(100, [0], undefined)).toBe(5);
  });
  it('netPoints never goes below 1 and never raises the base', () => {
    expect(netPoints(100, 40)).toBe(60);
    expect(netPoints(100, 0)).toBe(100);
    expect(netPoints(100, 100)).toBe(1);
    expect(netPoints(10, 500)).toBe(1);
    expect(netPoints(1, 1)).toBe(1);
    expect(netPoints(100, -20)).toBe(100);
    expect(netPoints(0, 5)).toBe(0);
  });
  it('a maxPercent of 100 still leaves 1 point', () => {
    const all = { enabled: true, nudge: 100, approach: 100, walkthrough: 100, maxPercent: 100 };
    expect(netPoints(50, spentFor(50, [0, 1, 2], all))).toBe(1);
  });
});

describe('views', () => {
  it('percentOf and costOf follow the tier and the enabled switch', () => {
    expect(percentOf(0, D)).toBe(5);
    expect(percentOf(4, D)).toBe(25);
    expect(percentOf(0, { ...D, enabled: false })).toBe(0);
    expect(costOf(120, 1, D)).toEqual({ percent: 10, points: 12, tier: 'approach' });
    expect(costOf(120, 0, { ...D, enabled: false })).toEqual({ percent: 0, points: 0, tier: 'nudge' });
  });
  it('capPoints rounds the cap, 0 when disabled', () => {
    expect(capPoints(100, D)).toBe(40);
    expect(capPoints(25, D)).toBe(10);
    expect(capPoints(100, { ...D, enabled: false })).toBe(0);
  });
  it('spentView reports points, percent of the base and the cap', () => {
    expect(spentView(100, [0, 1], D)).toEqual({ points: 15, percent: 15, cap: 40 });
    expect(spentView(0, [0], D)).toEqual({ points: 0, percent: 0, cap: 0 });
  });
  it('pricingFor lists only the closed hints, with no text', () => {
    expect(pricingFor(100, 3, 1, D)).toEqual([
      { index: 1, tier: 'approach', percent: 10, points: 10 },
      { index: 2, tier: 'walkthrough', percent: 25, points: 25 },
    ]);
    expect(pricingFor(100, 3, 3, D)).toEqual([]);
    expect(pricingFor(100, 1, 0, D)).toEqual([{ index: 0, tier: 'nudge', percent: 5, points: 5 }]);
  });
  it('firstN builds 0..n-1', () => {
    expect(firstN(3)).toEqual([0, 1, 2]);
    expect(firstN(0)).toEqual([]);
    expect(firstN(-2)).toEqual([]);
  });
});

describe('cumulative tiers and stored prices', () => {
  const priced = (index, percent, capPercent = 40) => ({ index, percent, capPercent });

  it('marginalPercent adds the tiers below the hint that nothing covers yet', () => {
    expect(marginalPercent(0, [], D)).toBe(5);
    expect(marginalPercent(2, [], D)).toBe(40);
    expect(marginalPercent(2, [0], D)).toBe(35);
    expect(marginalPercent(2, [0, 1], D)).toBe(25);
    expect(marginalPercent(0, [2], D)).toBe(0);
    expect(marginalPercent(2, [], { ...D, enabled: false })).toBe(0);
    expect(marginalPercent(3, [], { ...D, nudge: 100, approach: 100, walkthrough: 100 })).toBe(100);
  });

  it('keeps the in-order categories numerically unchanged', () => {
    for (const base of [10, 15, 40, 100, 250]) {
      for (const count of [1, 2, 3, 4, 5]) {
        const legacy = Math.min(
          firstN(count).reduce((sum, index) => sum + hintPoints(base, percentOf(index, D)), 0), capPoints(base, D),
        );
        expect(spentFor(base, firstN(count), D)).toBe(legacy);
      }
    }
  });

  it('charges stored percents without looking at the current costs', () => {
    const rows = [priced(0, 5), priced(1, 10)];
    expect(spentFor(100, rows, { ...D, nudge: 90, approach: 90, maxPercent: 100 })).toBe(15);
    expect(spentFor(100, rows, null)).toBe(15);
    expect(spentFor(100, rows, { ...D, enabled: false })).toBe(15);
    expect(allPriced(rows)).toBe(true);
    expect(allPriced([...rows, 2])).toBe(false);
  });

  it('caps at the lowest stored cap, and at the current maxPercent for rows without a price', () => {
    expect(spentFor(100, [priced(0, 40, 20), priced(1, 40, 90)], D)).toBe(20);
    expect(spentFor(100, [0, 1, 2], { ...D, maxPercent: 30 })).toBe(30);
    expect(spentFor(100, [priced(0, 5), 1], D)).toBe(15);
  });

  it('charges an unpriced hint cumulatively at the current rates', () => {
    expect(spentFor(100, [2], D)).toBe(40);
    expect(spentFor(100, [2], { ...D, maxPercent: 30 })).toBe(30);
    expect(spentFor(100, [1], { ...D, enabled: false })).toBe(0);
  });

  it('pricingClosed shows what opening each closed hint would add (marginal, cap aware)', () => {
    expect(pricingClosed(100, 3, [], D)).toEqual([
      { index: 0, tier: 'nudge', percent: 5, points: 5 },
      { index: 1, tier: 'approach', percent: 15, points: 15 },
      { index: 2, tier: 'walkthrough', percent: 40, points: 40 },
    ]);
    expect(pricingClosed(100, 3, [priced(1, 15)], D)).toEqual([
      { index: 0, tier: 'nudge', percent: 0, points: 0 },
      { index: 2, tier: 'walkthrough', percent: 25, points: 25 },
    ]);
    // Cap 40 of 100, 35 already spent: the walkthrough can add only 5 more points.
    expect(pricingClosed(100, 3, [priced(0, 5), priced(1, 30)], D).map((p) => p.points)).toEqual([5]);
    expect(pricingClosed(100, 3, [], { ...D, enabled: false }).every((p) => p.percent === 0 && p.points === 0)).toBe(true);
  });

  it('a displayed price is exactly what opening the hint adds to the spend', () => {
    for (const opened of [[], [0], [1], [0, 1]]) {
      const rows = opened.map((index) => priced(index, marginalPercent(index, opened.filter((i) => i < index), D)));
      for (const price of pricingClosed(60, 3, rows, D)) {
        const added = marginalPercent(price.index, rows, D);
        const after = spentFor(60, [...rows, priced(price.index, added)], D);
        expect(after - spentFor(60, rows, D)).toBe(price.points);
      }
    }
  });

  it('chargeOf and spentView report the stored price', () => {
    expect(chargeOf(40, 35, 2)).toEqual({ percent: 35, points: 14, tier: 'walkthrough' });
    expect(spentView(100, [priced(0, 5, 20)], D)).toEqual({ points: 5, percent: 5, cap: 20 });
  });
});
