import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLES_PATH, readThemeBlocks } from './helpers/themeCss.js';

const blocks = readThemeBlocks();
const SRC = fileURLToPath(new URL('../src', import.meta.url));
const themed = (map) => [...map.keys()].filter((name) => name.startsWith('--color-'));

test('both dark blocks are found with the gated selectors', () => {
  assert.deepEqual(blocks.selectors.explicit, [":root[data-theme-enabled][data-theme='dark']"]);
  assert.deepEqual(blocks.selectors.media, [":root[data-theme-enabled]:not([data-theme='light'])"]);
});

test('the explicit dark block and the prefers-color-scheme block hold identical declarations', () => {
  assert.deepEqual([...blocks.darkMedia.keys()].sort(), [...blocks.darkExplicit.keys()].sort());
  for (const [name, value] of blocks.darkExplicit) assert.equal(blocks.darkMedia.get(name), value, `${name} differs between the dark blocks`);
});

test('dark defines exactly the --color-* tokens that light defines (and color-scheme)', () => {
  const light = themed(blocks.light).sort();
  const dark = themed(blocks.darkExplicit).sort();
  assert.deepEqual(dark.filter((name) => !light.includes(name)), [], 'dark-only tokens');
  assert.deepEqual(light.filter((name) => !dark.includes(name)), [], 'tokens missing a dark value');
  assert.ok(light.length >= 60, 'token set looks truncated');
});

test('dark only overrides colour tokens and color-scheme; nothing else drifts between themes', () => {
  for (const name of blocks.darkExplicit.keys()) assert.ok(name === 'color-scheme' || name.startsWith('--color-'), `unexpected dark declaration ${name}`);
  assert.equal(blocks.light.get('color-scheme'), 'light');
  assert.equal(blocks.darkExplicit.get('color-scheme'), 'dark');
});

test('always-dark (--term-*) and always-light (--paper-*) tokens are not redefined for dark', () => {
  const always = [...blocks.light.keys()].filter((name) => /^--(term|paper)-/.test(name));
  assert.ok(always.length >= 20);
  for (const name of always) assert.equal(blocks.darkExplicit.has(name), false, `${name} must not change with the theme`);
});

test('the original token names keep their original light values', () => {
  const original = {
    '--color-bg': '#f4f4f1', '--color-surface': '#ffffff', '--color-surface-2': '#e9e9e4', '--color-ink': '#0a0a0a',
    '--color-ink-contrast': '#ffffff', '--color-muted': '#55554f', '--color-line': '#0a0a0a', '--color-line-soft': '#c9c9c2',
    '--color-accent': '#b5f23d', '--color-accent-tint': '#eefbcc', '--color-danger': '#a8001a', '--color-danger-tint': '#fdeceb',
  };
  for (const [name, value] of Object.entries(original)) assert.equal(blocks.light.get(name), value, name);
});

test('every theme rule in styles.css is gated by data-theme-enabled', () => {
  const css = readFileSync(STYLES_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const hits = css.split('\n').filter((line) => line.includes('data-theme') && line.includes('{'));
  assert.ok(hits.length >= 2);
  assert.ok(hits.every((line) => line.includes('data-theme-enabled')), 'every theme rule must be gated by data-theme-enabled');
});

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test('every var(--color-*), var(--term-*) and var(--paper-*) used under src is defined', () => {
  const defined = new Set(blocks.light.keys());
  const missing = [];
  for (const file of walk(SRC).filter((f) => /\.(css|jsx?)$/.test(f))) {
    const text = readFileSync(file, 'utf8');
    // Local palettes (--os-accent, --adm-c1 ...) are not checked, only the shared families. A file may define its own.
    for (const match of text.matchAll(/var\((--(?:color|term|paper)-[a-z0-9-]+)/g)) {
      if (!defined.has(match[1]) && !new RegExp(`${match[1]}\\s*:`).test(text)) missing.push(`${file.slice(SRC.length + 1)}: ${match[1]}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('styles.css has no raw colour literal outside the token blocks', () => {
  let rest = readFileSync(STYLES_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // Drop every block that only declares tokens: the two dark blocks (one inside @media) and :root.
  rest = rest.replace(/:root\[data-theme-enabled\]\[data-theme='dark'\]\s*\{[^}]*\}/, '');
  rest = rest.replace(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root[^{]*\{[^}]*\}\s*\}/, '');
  rest = rest.replace(/:root\s*\{[^}]*\}/, '');
  const literals = rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? [];
  assert.deepEqual(literals, []);
});
