import test from 'node:test';
import assert from 'node:assert/strict';
import { PAIRS, contrast, evaluate, parseColor, readThemeBlocks } from './helpers/themeCss.js';

const blocks = readThemeBlocks();

test('the contrast maths matches known WCAG values', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff') * 10) / 10, 21);
  assert.equal(contrast('#ffffff', '#ffffff'), 1);
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.equal(parseColor('rgba(10, 20, 30, 0.5)').a, 0.5);
  // 50% white over black is mid grey (127.5), 5.3:1 against black.
  assert.ok(Math.abs(contrast('rgba(255,255,255,0.5)', '#000000') - 5.3) < 0.1);
});

for (const theme of ['light', 'dark']) {
  test(`every text and UI pair meets its WCAG ratio in the ${theme} theme`, () => {
    const results = evaluate(theme, blocks);
    assert.equal(results.length, PAIRS.length);
    const failures = results.filter((r) => !r.pass).map((r) => `${r.fg} on ${r.bg}: ${r.ratio} < ${r.min} (${r.note})`);
    assert.deepEqual(failures, []);
  });
}

test('dark ink keeps AAA-level body contrast (7:1) on the page and on surfaces', () => {
  const dark = new Map(evaluate('dark', blocks).map((r) => [`${r.fg}|${r.bg}`, r.ratio]));
  assert.ok(dark.get('--color-ink|--color-surface') >= 7);
  assert.ok(dark.get('--color-ink|--color-bg') >= 7);
});
