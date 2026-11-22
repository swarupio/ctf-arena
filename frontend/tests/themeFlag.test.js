import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DARK_THEME_ENABLED, THEME_COLORS, THEME_STORAGE_KEY } from '../src/theme/config.js';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const init = read('../public/theme-init.js');

test('theme-init.js carries the same flag as config.js', () => {
  const match = init.match(/var ENABLED = (true|false);\s*\/\/ keep in sync with DARK_THEME_ENABLED/);
  assert.ok(match, 'ENABLED line with the keep-in-sync comment is missing');
  assert.equal(match[1] === 'true', DARK_THEME_ENABLED);
});

test('theme-init.js uses the same storage key and theme-color values as config.js', () => {
  assert.ok(init.includes(`var KEY = '${THEME_STORAGE_KEY}';`));
  assert.ok(init.includes(`light: '${THEME_COLORS.light}'`));
  assert.ok(init.includes(`dark: '${THEME_COLORS.dark}'`));
});

test('index.html loads theme-init.js as a blocking script in <head>, not inline (CSP script-src self)', () => {
  const html = read('../index.html');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.match(head, /<script src="\/theme-init\.js"><\/script>/);
  assert.doesNotMatch(head, /<script(?![^>]*src=)[^>]*>/);
  assert.doesNotMatch(head, /<script[^>]*(defer|async|type="module")/);
});

test('the CSP forbids inline scripts (why theme-init is a file)', () => {
  assert.match(read('../../vercel.json'), /script-src 'self';/);
});

// Phase C verified both themes (docs/THEMING.md section 9), so the dark theme and its toggle ship on.
test('the flag ships on', () => {
  assert.equal(DARK_THEME_ENABLED, true);
});

// Both variants are derived from the shipped file whatever its current flag value, so these keep testing the
// code path they name if the flag is ever switched.
const FLAG_LINE = /var ENABLED = (true|false);/;
const withFlag = (value) => init.replace(FLAG_LINE, `var ENABLED = ${value};`);

function runInit(source, stored, systemDark) {
  const attrs = new Map();
  const meta = { 'theme-color': '#ffffff', 'color-scheme': 'light' };
  const metaEl = (name) => ({ setAttribute: (key, value) => { assert.equal(key, 'content'); meta[name] = value; } });
  const root = { setAttribute: (key, value) => attrs.set(key, value), removeAttribute: (key) => attrs.delete(key) };
  const win = { localStorage: { getItem: () => stored }, matchMedia: () => ({ matches: systemDark }) };
  const doc = { documentElement: root, querySelector: (query) => metaEl(query.includes('theme-color') ? 'theme-color' : 'color-scheme') };
  new Function('window', 'document', source)(win, doc);
  return { attrs: Object.fromEntries(attrs), meta };
}

test('theme-init.js with the flag off changes nothing', () => {
  const off = withFlag(false);
  assert.match(off, /var ENABLED = false;/);
  assert.deepEqual(runInit(off, 'dark', true), { attrs: {}, meta: { 'theme-color': '#ffffff', 'color-scheme': 'light' } });
});

test('theme-init.js with the flag on applies the stored theme before paint', () => {
  const on = withFlag(true);
  assert.match(on, /var ENABLED = true;/);
  assert.deepEqual(runInit(on, 'dark', false).attrs, { 'data-theme-enabled': '', 'data-theme': 'dark' });
  assert.equal(runInit(on, 'dark', false).meta['theme-color'], THEME_COLORS.dark);
  assert.deepEqual(runInit(on, '"light"', true).attrs, { 'data-theme-enabled': '', 'data-theme': 'light' });
  assert.equal(runInit(on, '"light"', true).meta['theme-color'], THEME_COLORS.light);
  assert.deepEqual(runInit(on, null, true).attrs, { 'data-theme-enabled': '' });
  assert.equal(runInit(on, null, true).meta['theme-color'], THEME_COLORS.dark);
  assert.equal(runInit(on, null, true).meta['color-scheme'], 'light dark');
  assert.deepEqual(runInit(on, 'bogus', false).attrs, { 'data-theme-enabled': '' });
});
