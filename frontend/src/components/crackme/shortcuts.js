import { scopedKey } from '../../storage/userScope.js';

// WCAG 2.1.4: single-key shortcuts must be switchable. The choice is remembered per user in this browser only.
export const SHORTCUTS_PREFIX = 'arena.crackme.shortcuts:';
export const shortcutsKey = (email) => scopedKey(SHORTCUTS_PREFIX, email);

/** On unless the user turned it off. Signed out, blocked or corrupt storage all give the default (on). */
export function readShortcuts(storage, email) {
  const key = shortcutsKey(email);
  if (!key) { return true; }
  try { return storage?.getItem(key) !== 'off'; } catch { return true; }
}

export function writeShortcuts(storage, email, enabled) {
  const key = shortcutsKey(email);
  if (!key) { return false; }
  try { storage?.setItem(key, enabled ? 'on' : 'off'); return true; } catch { return false; }
}

/** The aria-keyshortcuts value: only present while the shortcut is active. */
export const keyshortcutsAttr = (enabled, key) => (enabled ? key : undefined);

/** The status line of the toggle. */
export const shortcutsLabel = (enabled) => `Keyboard shortcuts: ${enabled ? 'on' : 'off'}`;
