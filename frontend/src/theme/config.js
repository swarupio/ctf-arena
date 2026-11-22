// Dark theme feature flag. While false: the toggle is not rendered, public/theme-init.js does nothing and the dark
// token blocks in styles.css never apply (they need the data-theme-enabled attribute on <html>).
// Keep in sync with ENABLED in frontend/public/theme-init.js (tests/themeFlag.test.js checks it).
export const DARK_THEME_ENABLED = true;

export const THEME_STORAGE_KEY = 'ctf.theme';
export const THEME_PREFERENCES = Object.freeze(['light', 'dark', 'system']);
export const DEFAULT_PREFERENCE = 'system';

// <meta name="theme-color"> per effective theme: the header surface colour (--color-surface).
export const THEME_COLORS = Object.freeze({ light: '#ffffff', dark: '#151b23' });
