/* Applies the stored colour theme before first paint (no flash). Loaded as a blocking <script src> in index.html because
   the CSP (script-src 'self') forbids inline scripts. Plain ES5 on purpose: it is not bundled. Does nothing while the
   dark theme flag is off. Mirrors src/theme/theme.js (applyTheme); the tests keep the constants in step. */
(function () {
  var ENABLED = true; // keep in sync with DARK_THEME_ENABLED in src/theme/config.js
  if (!ENABLED) return;
  var KEY = 'ctf.theme';
  var COLORS = { light: '#ffffff', dark: '#151b23' };
  var pref = 'system';
  try {
    var raw = window.localStorage.getItem(KEY);
    if (raw) {
      try { raw = JSON.parse(raw); } catch (e) { /* plain string */ }
      if (raw === 'light' || raw === 'dark') pref = raw;
    }
  } catch (e) { /* storage blocked: follow the system */ }
  var dark = pref === 'dark';
  if (pref === 'system') {
    try { dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { dark = false; }
  }
  var root = document.documentElement;
  root.setAttribute('data-theme-enabled', '');
  if (pref === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', pref);
  var color = document.querySelector('meta[name="theme-color"]');
  if (color) color.setAttribute('content', dark ? COLORS.dark : COLORS.light);
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', pref === 'system' ? 'light dark' : pref);
})();
