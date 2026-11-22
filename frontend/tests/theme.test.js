import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_COLORS, THEME_STORAGE_KEY } from '../src/theme/config.js';
import {
  THEME_OPTIONS, SWITCHING_CLASS, applyTheme, effectiveTheme, nextTheme, suspendTransitions, themeLabel, createThemeController, parsePreference, readPreference, resolveTheme, systemPrefersDark, watchSystem, writePreference,
} from '../src/theme/theme.js';

const memory = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); } };
};
const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };

function fakeEnv({ dark = false } = {}) {
  const attrs = new Map();
  const meta = { 'theme-color': '#ffffff', 'color-scheme': 'light' };
  const metaEl = (name) => ({ setAttribute: (key, value) => { if (key === 'content') meta[name] = value; } });
  const doc = {
    documentElement: { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k), getAttribute: (k) => attrs.get(k) ?? null },
    querySelector: (query) => metaEl(query.includes('theme-color') ? 'theme-color' : 'color-scheme'),
  };
  const query = { matches: dark, handlers: new Set(), addEventListener(type, fn) { this.handlers.add(fn); }, removeEventListener(type, fn) { this.handlers.delete(fn); } };
  const listeners = new Map();
  const win = {
    matchMedia: (q) => { assert.equal(q, '(prefers-color-scheme: dark)'); return query; },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const flip = (value) => { query.matches = value; query.handlers.forEach((fn) => fn({ matches: value })); };
  return { doc, win, attrs, meta, query, flip, listeners };
}

test('parsePreference accepts plain and JSON strings and rejects everything else', () => {
  for (const value of ['light', 'dark', 'system']) {
    assert.equal(parsePreference(value), value);
    assert.equal(parsePreference(JSON.stringify(value)), value);
  }
  for (const bad of [null, undefined, '', 'Dark', 'blue', '{"a":1}', '42', 'null', 7, {}, ['dark']]) assert.equal(parsePreference(bad), null);
});

test('readPreference defaults to system for missing, invalid or blocked storage', () => {
  assert.equal(readPreference(memory()), 'system');
  assert.equal(readPreference(memory({ [THEME_STORAGE_KEY]: 'dark' })), 'dark');
  assert.equal(readPreference(memory({ [THEME_STORAGE_KEY]: '"light"' })), 'light');
  assert.equal(readPreference(memory({ [THEME_STORAGE_KEY]: 'neon' })), 'system');
  assert.equal(readPreference(blocked), 'system');
  assert.equal(readPreference(null), 'system');
});

test('writePreference stores light and dark, clears system, ignores invalid and survives blocked storage', () => {
  const store = memory();
  assert.equal(writePreference('dark', store), true);
  assert.equal(store.data.get(THEME_STORAGE_KEY), 'dark');
  assert.equal(writePreference('system', store), true);
  assert.equal(store.data.has(THEME_STORAGE_KEY), false);
  assert.equal(writePreference('neon', store), false);
  assert.equal(writePreference('dark', blocked), false);
});

test('resolveTheme follows the system only for system', () => {
  const env = fakeEnv({ dark: true });
  assert.equal(resolveTheme('system', env.win), 'dark');
  assert.equal(resolveTheme('light', env.win), 'light');
  assert.equal(resolveTheme('dark', fakeEnv({ dark: false }).win), 'dark');
  assert.equal(resolveTheme('system', fakeEnv({ dark: false }).win), 'light');
  assert.equal(systemPrefersDark({}), false);
  assert.equal(systemPrefersDark({ matchMedia() { throw new Error('no'); } }), false);
  assert.equal(resolveTheme('system', undefined), 'light');
});

test('applyTheme sets data-theme for light and dark, none for system, and updates the meta tags', () => {
  const env = fakeEnv({ dark: true });
  assert.equal(applyTheme('light', { ...env, enabled: true }), 'light');
  assert.equal(env.attrs.get('data-theme'), 'light');
  assert.equal(env.attrs.has('data-theme-enabled'), true);
  assert.equal(env.meta['theme-color'], THEME_COLORS.light);
  assert.equal(env.meta['color-scheme'], 'light');
  assert.equal(applyTheme('dark', { ...env, enabled: true }), 'dark');
  assert.equal(env.attrs.get('data-theme'), 'dark');
  assert.equal(env.meta['theme-color'], THEME_COLORS.dark);
  assert.equal(applyTheme('system', { ...env, enabled: true }), 'dark');
  assert.equal(env.attrs.has('data-theme'), false);
  assert.equal(env.meta['color-scheme'], 'light dark');
  assert.equal(applyTheme('garbage', { ...env, enabled: true }), 'dark');
});

test('with the flag off nothing is applied', () => {
  const env = fakeEnv({ dark: true });
  assert.equal(applyTheme('dark', { ...env, enabled: false }), null);
  assert.equal(env.attrs.size, 0);
  assert.deepEqual(env.meta, { 'theme-color': '#ffffff', 'color-scheme': 'light' });
  const controller = createThemeController({ ...env, storage: memory({ [THEME_STORAGE_KEY]: 'dark' }), enabled: false });
  controller.start()();
  controller.setPreference('light');
  assert.equal(env.attrs.size, 0);
  assert.equal(env.query.handlers.size, 0);
  assert.equal(env.listeners.size, 0);
});

test('watchSystem reports changes, unsubscribes and tolerates a missing matchMedia', () => {
  const env = fakeEnv();
  const seen = [];
  const stop = watchSystem((isDark) => seen.push(isDark), env.win);
  env.flip(true);
  env.flip(false);
  stop();
  env.flip(true);
  assert.deepEqual(seen, [true, false]);
  assert.equal(typeof watchSystem(() => {}, {}), 'function');
  const legacy = { handlers: new Set(), addListener(fn) { this.handlers.add(fn); }, removeListener(fn) { this.handlers.delete(fn); } };
  const stopLegacy = watchSystem(() => {}, { matchMedia: () => legacy });
  assert.equal(legacy.handlers.size, 1);
  stopLegacy();
  assert.equal(legacy.handlers.size, 0);
});

test('the controller applies the stored theme, persists changes and tracks system changes only for system', () => {
  const env = fakeEnv({ dark: false });
  const store = memory({ [THEME_STORAGE_KEY]: 'dark' });
  const controller = createThemeController({ ...env, storage: store, enabled: true });
  assert.equal(controller.getPreference(), 'dark');
  let notified = 0;
  controller.subscribe(() => { notified += 1; });
  const stop = controller.start();
  assert.equal(env.attrs.get('data-theme'), 'dark');

  assert.equal(controller.setPreference('system'), true);
  assert.equal(store.data.has(THEME_STORAGE_KEY), false);
  assert.equal(env.attrs.has('data-theme'), false);
  assert.equal(env.meta['theme-color'], THEME_COLORS.light);
  env.flip(true);
  assert.equal(env.meta['theme-color'], THEME_COLORS.dark);
  assert.equal(controller.getEffective(), 'dark');

  controller.setPreference('light');
  const before = notified;
  env.flip(false);
  env.flip(true);
  assert.equal(notified, before, 'an explicit choice ignores system changes');
  assert.equal(env.attrs.get('data-theme'), 'light');
  assert.equal(controller.setPreference('nope'), false);

  // another tab writes the key
  store.data.set(THEME_STORAGE_KEY, 'dark');
  env.listeners.get('storage')({ key: THEME_STORAGE_KEY });
  assert.equal(controller.getPreference(), 'dark');
  assert.equal(env.attrs.get('data-theme'), 'dark');

  stop();
  assert.equal(env.query.handlers.size, 0);
  assert.equal(env.listeners.size, 0);
});

test('the controller keeps working when storage is blocked', () => {
  const env = fakeEnv();
  const controller = createThemeController({ ...env, storage: blocked, enabled: true });
  assert.equal(controller.getPreference(), 'system');
  assert.equal(controller.setPreference('dark'), true);
  assert.equal(controller.getPreference(), 'dark');
  assert.equal(env.attrs.get('data-theme'), 'dark');
});

test('the selector lists System, Light, Dark and labels each preference', () => {
  assert.deepEqual(THEME_OPTIONS.map((option) => option.label), ['System', 'Light', 'Dark']);
  assert.deepEqual(THEME_OPTIONS.map((option) => option.value), ['system', 'light', 'dark']);
  assert.equal(themeLabel('dark'), 'Dark');
  assert.equal(themeLabel('bogus'), 'System');
});

test('effectiveTheme resolves the preference against the device (pure)', () => {
  assert.equal(effectiveTheme('light', true), 'light');
  assert.equal(effectiveTheme('dark', false), 'dark');
  assert.equal(effectiveTheme('system', false), 'light');
  assert.equal(effectiveTheme('system', true), 'dark');
  for (const bad of [null, undefined, '', 'Dark', 'neon', 7]) {
    assert.equal(effectiveTheme(bad, false), 'light');
    assert.equal(effectiveTheme(bad, true), 'dark');
  }
});

test('the header switch has two states: one click always changes what the page shows', () => {
  assert.equal(nextTheme('light', false), 'dark');
  assert.equal(nextTheme('light', true), 'dark');
  assert.equal(nextTheme('dark', false), 'light');
  assert.equal(nextTheme('dark', true), 'light');
  assert.equal(nextTheme('system', false), 'dark', 'System on a light device goes straight to dark');
  assert.equal(nextTheme('system', true), 'light', 'System on a dark device goes to light');
  for (const bad of [null, undefined, 'neon', '']) {
    assert.equal(nextTheme(bad, false), 'dark');
    assert.equal(nextTheme(bad, true), 'light');
  }
  for (const pref of ['light', 'dark', 'system']) for (const osDark of [false, true]) {
    assert.notEqual(effectiveTheme(nextTheme(pref, osDark), osDark), effectiveTheme(pref, osDark));
    assert.ok(['light', 'dark'].includes(nextTheme(pref, osDark)), 'never stores system');
  }
});

test('a click from System stores an explicit preference and keeps the key', () => {
  const env = fakeEnv({ dark: false });
  const store = memory();
  const controller = createThemeController({ ...env, storage: store, enabled: true });
  assert.equal(controller.getPreference(), 'system');
  controller.setPreference(nextTheme(controller.getPreference(), controller.getEffective() === 'dark'));
  assert.equal(store.data.get(THEME_STORAGE_KEY), 'dark');
  assert.equal(controller.getEffective(), 'dark');
});

test('transitions are suspended for two frames while the theme flips, and only while it flips', () => {
  const classes = new Set();
  const frames = [];
  const doc = { documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } } };
  const win = { requestAnimationFrame: (fn) => frames.push(fn) };
  suspendTransitions({ doc, win });
  assert.equal(classes.has(SWITCHING_CLASS), true);
  frames.shift()();
  assert.equal(classes.has(SWITCHING_CLASS), true, 'still off after one frame');
  frames.shift()();
  assert.equal(classes.has(SWITCHING_CLASS), false);
  assert.doesNotThrow(() => suspendTransitions({ doc: { documentElement: {} }, win }));
  const env = fakeEnv();
  const controller = createThemeController({ ...env, doc: { ...env.doc, documentElement: { ...env.doc.documentElement, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } } }, win: { ...env.win, requestAnimationFrame: (fn) => frames.push(fn) }, storage: memory(), enabled: true });
  controller.start();
  assert.equal(classes.has(SWITCHING_CLASS), false, 'the first paint is not animated or suspended');
  controller.setPreference('dark');
  assert.equal(classes.has(SWITCHING_CLASS), true);
});

test('the toggle CSS has no colour fade, one global transition-off class, a 44px target on touch, and the "use device setting" line is in the footer and the menu', () => {
  const css = readFileSync(new URL('../src/theme/theme.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.theme-toggle .theme-btn { transition: none; }'));
  assert.ok(css.includes(`:root.${SWITCHING_CLASS} *`));
  assert.ok(css.includes('transition: none !important;'));
  assert.ok(css.includes('@media (pointer: coarse) { .theme-auto-btn { min-height: 44px; padding: 0 var(--space-2); } }'));
  const layout = readFileSync(new URL('../src/layout/Layout.jsx', import.meta.url), 'utf8');
  assert.ok(layout.includes('<ThemeAuto className="theme-auto-menu" />'));
  assert.ok(layout.includes('<ThemeAuto className="theme-auto-footer" />'));
  const toggle = readFileSync(new URL('../src/theme/ThemeToggle.jsx', import.meta.url), 'utf8');
  assert.ok(toggle.includes('Switch to ${target} theme'));
  assert.ok(toggle.includes('Theme set to ${target}'));
});
