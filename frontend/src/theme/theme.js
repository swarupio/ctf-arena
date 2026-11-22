// Theme helper: preference ('light' | 'dark' | 'system'), storage, effective theme, <html> attributes, <meta> tags.
// Everything takes its environment (window, document, storage, flag) as an argument so it is testable without a browser.
import { DARK_THEME_ENABLED, DEFAULT_PREFERENCE, THEME_COLORS, THEME_PREFERENCES, THEME_STORAGE_KEY } from './config.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export const THEME_OPTIONS = Object.freeze([
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]);

// The button cycles System -> Light -> Dark -> System.
export const CYCLE = Object.freeze(['system', 'light', 'dark']);
export const nextPreference = (preference) => CYCLE[(Math.max(CYCLE.indexOf(preference), 0) + 1) % CYCLE.length];
export const themeLabel = (preference) => THEME_OPTIONS.find((option) => option.value === preference)?.label ?? 'System';

// Accepts the plain string or its JSON form; anything else is not a preference.
export function parsePreference(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  try { value = JSON.parse(value); } catch { /* plain string */ }
  return typeof value === 'string' && THEME_PREFERENCES.includes(value) ? value : null;
}

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// Blocked or broken storage and invalid values fall back to following the system.
export function readPreference(storage = defaultStorage()) {
  try { return parsePreference(storage?.getItem(THEME_STORAGE_KEY)) ?? DEFAULT_PREFERENCE; } catch { return DEFAULT_PREFERENCE; }
}

export function writePreference(preference, storage = defaultStorage()) {
  const value = parsePreference(preference);
  if (!value) return false;
  try {
    if (value === DEFAULT_PREFERENCE) storage.removeItem(THEME_STORAGE_KEY); else storage.setItem(THEME_STORAGE_KEY, value);
    return true;
  } catch { return false; }
}

export function systemPrefersDark(win = globalThis.window) {
  try { return Boolean(win?.matchMedia?.(DARK_QUERY).matches); } catch { return false; }
}

export function resolveTheme(preference, win = globalThis.window) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemPrefersDark(win) ? 'dark' : 'light';
}

// Puts the theme on <html> and updates theme-color / color-scheme. With the flag off it touches nothing.
export function applyTheme(preference, { doc = globalThis.document, win = globalThis.window, enabled = DARK_THEME_ENABLED } = {}) {
  if (!enabled || !doc?.documentElement) return null;
  const pref = parsePreference(preference) ?? DEFAULT_PREFERENCE;
  const effective = resolveTheme(pref, win);
  const root = doc.documentElement;
  root.setAttribute('data-theme-enabled', '');
  // 'system' sets no data-theme: the prefers-color-scheme rules in styles.css decide.
  if (pref === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', pref);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[effective]);
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', pref === 'system' ? 'light dark' : pref);
  return effective;
}

// Calls onChange(isDark) when the operating system switches theme. Returns an unsubscribe function.
export function watchSystem(onChange, win = globalThis.window) {
  let query;
  try { query = win?.matchMedia?.(DARK_QUERY); } catch { query = null; }
  if (!query) return () => {};
  const handler = (event) => onChange(Boolean(event.matches));
  if (query.addEventListener) { query.addEventListener('change', handler); return () => query.removeEventListener('change', handler); }
  if (query.addListener) { query.addListener(handler); return () => query.removeListener(handler); }
  return () => {};
}

// A small store: React reads it with useSyncExternalStore. start() applies the stored theme and starts listening.
export function createThemeController({ win = globalThis.window, doc = globalThis.document, storage, enabled = DARK_THEME_ENABLED } = {}) {
  const store = storage === undefined ? defaultStorage() : storage;
  const listeners = new Set();
  let preference = readPreference(store);
  let stops = [];
  const emit = () => listeners.forEach((fn) => fn());
  const reapply = () => { applyTheme(preference, { doc, win, enabled }); };
  return {
    enabled,
    getPreference: () => preference,
    getEffective: () => resolveTheme(preference, win),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setPreference(next) {
      const value = parsePreference(next);
      if (!value) return false;
      preference = value;
      writePreference(value, store);
      reapply();
      emit();
      return true;
    },
    start() {
      if (!enabled) return () => {};
      reapply();
      stops.push(watchSystem(() => { if (preference === 'system') { reapply(); emit(); } }, win));
      // Another tab changed the preference.
      const onStorage = (event) => {
        if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
        preference = readPreference(store);
        reapply();
        emit();
      };
      win?.addEventListener?.('storage', onStorage);
      stops.push(() => win?.removeEventListener?.('storage', onStorage));
      return () => { stops.forEach((stop) => stop()); stops = []; };
    },
  };
}

let shared;
export function getThemeController() {
  shared ??= createThemeController();
  return shared;
}
