# Theming: light and dark

Status: **phase A (foundation) done, dark theme switched off.** The tokens, the runtime, the toggle and the tests exist. The component CSS still holds hard-coded colours (phase B migrates them) and `DARK_THEME_ENABLED` is `false` (phase C flips it once every page passes in both themes). With the flag off the app is pixel-identical to before: the toggle is not rendered, nothing is applied, and the dark rules never match.

Files: `frontend/src/styles.css` (tokens), `frontend/src/theme/` (`config.js` flag, `theme.js` helper, `ThemeToggle.jsx`, `theme.css`), `frontend/public/theme-init.js` (no-flash script), `frontend/index.html` (loads it), one import and one element in `frontend/src/layout/Layout.jsx`, tests in `frontend/tests/theme*.test.js` plus `frontend/tests/helpers/themeCss.js`. Raw audit: `docs/harness/color-audit.json`.

## 1. How it works

- **One token set, three blocks** in `styles.css`: the light values in `:root`, the dark values in `:root[data-theme-enabled][data-theme='dark']`, and the same declarations again in `@media (prefers-color-scheme: dark) { :root[data-theme-enabled]:not([data-theme='light']) { ... } }`. `tests/themeTokens.test.js` fails if the two dark blocks differ in any name or value, or if dark misses a light `--color-*` token.
- **The feature flag gates everything.** The dark rules need `data-theme-enabled` on `<html>`. Only `public/theme-init.js` (before first paint) and `theme.js` (`applyTheme`) set it, and only when the flag is true. Flag off: no attribute, so neither dark block can match, and `prefers-color-scheme: dark` changes nothing.
- **Preference** is `light`, `dark` or `system` (default), stored in `localStorage` key `ctf.theme` (plain string or JSON string; anything else, or blocked storage, means `system`). `light` and `dark` set `data-theme` on `<html>`; `system` sets no `data-theme`, so the media query decides and follows the operating system live.
- **`color-scheme`** is `light` in `:root` and `dark` in both dark blocks, so native form controls, scrollbars and the canvas follow the theme. The `<meta name="color-scheme">` becomes `light dark` for `system`. `<meta name="theme-color">` is updated per effective theme (`#ffffff` light, `#151b23` dark: the header surface).
- **No flash.** The CSP is `script-src 'self'`, which forbids inline scripts, so the init code is a static file, `public/theme-init.js`, loaded by a blocking `<script src="/theme-init.js">` in `<head>` (Vite copies `public/` to the site root; Nginx and Vercel serve it with `Cache-Control: no-cache`). Checked with a build whose JS bundle was delayed by 3 seconds: the first paint already had the right colours in all four combinations of stored preference and operating-system scheme.
- **The toggle** (`ThemeToggle.jsx`) is a plain TWO-state light/dark switch based on the EFFECTIVE theme (what the page shows now). Convention: the icon shows the theme a click switches TO (moon while the page is light, sun while it is dark; one SVG set, 24x24 box, 2px round strokes, 20px) and the accessible name states the action ("Switch to dark theme" / "Switch to light theme", also the tooltip and, in the mobile menu, the visible text). A click always changes the page and stores an explicit `light` or `dark` (never `system`): see the table below. No `aria-pressed` (the name already states the action and a changing name plus a pressed state would be read twice). A visually hidden `role="status"` announces "Theme set to dark". It is 44px square on the desktop header (icon only, header width unchanged) and a full-width icon-plus-text row in the mobile Menu panel. It renders nothing while the flag is off. Pure logic in `theme.js`: `effectiveTheme(preference, systemDark)` and `nextTheme(preference, systemDark)`.
- **System lives in the selector** (`ThemeSelect`, a radio group labelled "Theme": System, Light, Dark, filled segment = current preference, hint "Auto (follows your device): now light." or "Dark is set. System is Auto (follows your device)."). It is in the footer (always) and inside the mobile Menu panel (only at 1100px and below). The storage key (`ctf.theme`), the stored values and the default (System, stored as no value) are unchanged, so existing choices survive. Radios are native (arrow keys move and select; Tab leaves the group); each segment is 44px high on coarse pointers.
- **No flicker.** Icon, label, `data-theme`, `theme-color` and `color-scheme` are all derived from the same controller store (`useSyncExternalStore`) and update in the same frame as the click. The toggle button has no colour transition, and `setPreference` / a live OS change adds the class `theme-switching` to `<html>` for two animation frames, which turns every CSS transition off so nothing shows a mix of old and new colours (reduced motion already disables them). The first paint (`theme-init.js`) is untouched.

| Stored preference | Device (OS) | Page shows now | Icon / name | Click result (stored) |
| --- | --- | --- | --- | --- |
| none or `system` | light | light | moon, "Switch to dark theme" | dark (`dark`) |
| none or `system` | dark | dark | sun, "Switch to light theme" | light (`light`) |
| `light` | any | light | moon | dark (`dark`) |
| `dark` | any | dark | sun | light (`light`) |
| invalid value | like none | by device | by device | like none |
- **Fonts, spacing and the pixel look do not change.** Dark keeps the hard borders; the hard offset shadow becomes a dim lime block (`--color-shadow`), the dotted page pattern becomes a faint light dot, and lime stays the accent. The terminal and code panels stay dark in both themes (`--term-*`).

### The feature flag

| Place | What to change |
|---|---|
| `frontend/src/theme/config.js` | `export const DARK_THEME_ENABLED = false;` |
| `frontend/public/theme-init.js` | `var ENABLED = false; // keep in sync with ...` |

Change both. `tests/themeFlag.test.js` fails when they differ, and also runs `theme-init.js` against a fake `window` and `document` (flag off: nothing changes; flag on: the stored theme is applied, `system` sets no `data-theme`). To try the dark theme locally without editing the repo, serve with a dev-server plugin that rewrites those two constants (the harness in section 8 does this).

## 2. Token reference

Every `--color-*` token has a light and a dark value. `--term-*` and `--paper-*` never change with the theme (the test enforces that they are absent from the dark blocks). The 12 original tokens keep their original light values (also tested). The dark values were tuned until every pair in section 6 passed.

**Surfaces**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#f4f4f1` | `#0d1117` | Page background |
| `--color-surface` | `#ffffff` | `#151b23` | Cards, panels, header, form fields |
| `--color-surface-2` | `#e9e9e4` | `#1e2631` | Raised or striped areas, table heads, disabled fields |
| `--color-sunken` | `#f0f0ec` | `#090d12` | Recessed wells (inset areas inside a surface) |
| `--color-overlay` | `rgba(10, 10, 10, 0.55)` | `rgba(1, 4, 9, 0.75)` | Modal and drawer backdrop |
| `--color-scrim` | `rgba(10, 10, 10, 0.35)` | `rgba(1, 4, 9, 0.55)` | Wash over images or text |

**Text**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-ink` | `#0a0a0a` | `#e6edf3` | Body text; also the fill of inverse controls (primary button, hard tags) |
| `--color-ink-contrast` | `#ffffff` | `#0d1117` | Text on an ink fill, and on solid status fills (danger) |
| `--color-muted` | `#55554f` | `#a2adbb` | Secondary text |
| `--color-subtle` | `#6a6a64` | `#8793a3` | Placeholders, tertiary text |
| `--color-on-accent` | `#0a0a0a` | `#0a0a0a` | Text on a lime (accent) fill. Same in both themes |
| `--color-on-accent-muted` | `#55554f` | `#55554f` | Muted text on a lime (accent) fill (diagram sub-labels). Same in both themes |
| `--color-on-ink-accent` | `#b5f23d` | `#35520a` | Lime-style text on an ink fill (the "badge" look) |
| `--color-accent-text` | `#3d5c00` | `#b5f23d` | Lime used AS TEXT (dark green on light, lime on dark) |
| `--color-link` | `#0a0a0a` | `#c9f26b` | Link colour (links currently inherit; use this for explicit link text) |

**Lines, accent, focus**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-line` | `#0a0a0a` | `#66758a` | Strong border (every card, field, button) |
| `--color-line-soft` | `#c9c9c2` | `#2a3441` | Dim divider |
| `--color-accent` | `#b5f23d` | `#b5f23d` | Lime brand fill (never text on light) |
| `--color-accent-tint` | `#eefbcc` | `#1d2a0e` | Soft accent background (notices, hovered cards) |
| `--color-accent-hover` | `#a3e02b` | `#c9ff5e` | Accent hover fill |
| `--color-focus` | `#0a0a0a` | `#b5f23d` | Focus ring (3:1 against bg and surfaces) |
| `--color-selection-bg` | `#b5f23d` | `#b5f23d` | Text selection background |
| `--color-selection-fg` | `#0a0a0a` | `#0a0a0a` | Text selection text |

**Status (fg = text, tint = background, border = border and icon)**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-danger` | `#a8001a` | `#ff8a93` | Danger text / solid fill |
| `--color-danger-tint` | `#fdeceb` | `#3a1218` | Danger background |
| `--color-danger-border` | `#a8001a` | `#c4505b` | Danger border and icon |
| `--color-warn` | `#6b4a00` | `#ffd166` | Warning text |
| `--color-warn-tint` | `#fff4d6` | `#33290b` | Warning background |
| `--color-warn-border` | `#d98e00` | `#a37a1a` | Warning border and icon |
| `--color-ok` | `#1a6b2a` | `#6fdc8c` | Success text |
| `--color-ok-tint` | `#e0f6e4` | `#0f2a18` | Success background |
| `--color-ok-border` | `#1a7f37` | `#2f8f4e` | Success border and icon |
| `--color-info` | `#1a56a8` | `#8ab8ff` | Info text |
| `--color-info-tint` | `#e8f1ff` | `#11233f` | Info background |
| `--color-info-border` | `#2457c5` | `#3b6fc4` | Info border and icon |

**Difficulty**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-diff-easy` | `#b5f23d` | `#b5f23d` | Difficulty easy: bar / chip fill |
| `--color-diff-easy-tint` | `#eefbcc` | `#1f2d0c` | Difficulty easy: background tint |
| `--color-diff-easy-text` | `#2d5a00` | `#c5f56a` | Difficulty easy: label text (4.5:1 on its tint) |
| `--color-diff-medium` | `#ffd95a` | `#ffd95a` | Difficulty medium: bar / chip fill |
| `--color-diff-medium-tint` | `#fff4d6` | `#33290b` | Difficulty medium: background tint |
| `--color-diff-medium-text` | `#6b4a00` | `#ffd166` | Difficulty medium: label text (4.5:1 on its tint) |
| `--color-diff-hard` | `#ff9e57` | `#ff9e57` | Difficulty hard: bar / chip fill |
| `--color-diff-hard-tint` | `#ffe9d2` | `#3a200c` | Difficulty hard: background tint |
| `--color-diff-hard-text` | `#8a3a00` | `#ffae75` | Difficulty hard: label text (4.5:1 on its tint) |
| `--color-diff-insane` | `#ff6b6b` | `#ff6b6b` | Difficulty insane: bar / chip fill |
| `--color-diff-insane-tint` | `#ffe3e6` | `#3a1018` | Difficulty insane: background tint |
| `--color-diff-insane-text` | `#8a0016` | `#ff8a99` | Difficulty insane: label text (4.5:1 on its tint) |

**Content and decoration**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-code-bg` | `#f0f0ec` | `#0a0e14` | Inline code and pre background (themed) |
| `--color-code-text` | `#0a0a0a` | `#d6dee8` | Inline code and pre text |
| `--color-stripe` | `#f7f7f4` | `#1a212b` | Zebra row background |
| `--color-shadow` | `#0a0a0a` | `#3f5514` | Hard offset shadow colour (box-shadow: Npx Npx 0 var(--color-shadow)) |
| `--color-dot` | `rgba(10, 10, 10, 0.1)` | `rgba(230, 237, 243, 0.07)` | Dotted page pattern |
| `--color-hatch` | `rgba(10, 10, 10, 0.25)` | `rgba(230, 237, 243, 0.25)` | Pixel-art hatch lines |
| `--color-tap` | `rgba(181, 242, 61, 0.35)` | `rgba(181, 242, 61, 0.35)` | Mobile tap highlight |

**Chart series**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-series-1` | `#2a78d6` | `#5aa0ff` | Chart series 1 |
| `--color-series-2` | `#d95926` | `#ff8a57` | Chart series 2 |
| `--color-series-3` | `#13946a` | `#3ccf9f` | Chart series 3 |
| `--color-series-4` | `#b07400` | `#e0a030` | Chart series 4 |
| `--color-series-5` | `#d0457a` | `#ff7aa8` | Chart series 5 |
| `--color-series-6` | `#008300` | `#7fd35f` | Chart series 6 |
| `--color-series-7` | `#6250d6` | `#a596ff` | Chart series 7 |
| `--color-series-8` | `#d93a3a` | `#ff6b6b` | Chart series 8 |
| `--color-series-other` | `#6b6b66` | `#9aa3ad` | Chart: "other" bucket |

**Exact-literal variants (themed): one per distinct light colour the pages use, so migrating never shifts light**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-line-faint` | `#ecece6` | `#232c38` | Row separators (#ecece6 in light) |
| `--color-surface-warm` | `#fffbe8` | `#18202b` | Cream card in app chrome (#fffbe8) |
| `--color-surface-soft` | `#fbfbf8` | `#121821` | List background (#fbfbf8) |
| `--color-sev-medium` | `#6b5600` | `#ffd166` | Severity medium text |
| `--color-sev-medium-tint` | `#fff6cc` | `#33290b` | Severity medium background |
| `--color-sev-low` | `#1d5a2a` | `#6fdc8c` | Severity low text (background: --color-ok-tint) |
| `--color-ok-alt` | `#145c26` | `#6fdc8c` | Success notice text |
| `--color-ok-tint-alt` | `#e6f9ea` | `#0f2a18` | Success notice background |
| `--color-diff-add` | `#d7f7dd` | `#0f2a18` | Diff: added line background |
| `--color-diff-del` | `#fddde0` | `#3a1218` | Diff: removed line background |
| `--color-chart-green` | `#2d6a00` | `#7fd35f` | Admin chart green |
| `--color-info-tint-alt` | `#dbe8fa` | `#11233f` | Info badge background |
| `--color-info-wash` | `#eef4ff` | `#101c33` | Packets: client segment background |
| `--color-accent-wash` | `#f2fbdc` | `#1a2710` | Packets: server segment background |
| `--color-danger-deep` | `#6f0011` | `#ffb0b8` | Solid danger button hover |
| `--color-shadow-soft` | `rgba(10, 10, 10, 0.2)` | `rgba(0, 0, 0, 0.5)` | Soft drawer shadow |

**Always-dark panels (terminal window, code and debugger panels): identical in both themes**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--term-bg` | `#1c1c1a` | same | Terminal window / code panel background (always dark) |
| `--term-bg-deep` | `#141413` | same | Deeper panel background (listings, graphs, hex panes) |
| `--term-bg-raised` | `#2a2a27` | same | Raised row or card inside a dark panel |
| `--term-fg` | `#e8e8e3` | same | Text in dark panels |
| `--term-fg-muted` | `#b0b0a8` | same | Secondary text in dark panels |
| `--term-fg-subtle` | `#9b9b95` | same | Tertiary text (addresses, timestamps) |
| `--term-line` | `#34342f` | same | Divider inside dark panels |
| `--term-line-strong` | `#8a8a83` | same | Border or dot inside dark panels |
| `--term-scrollbar` | `#6b6b64` | same | Scrollbar thumb in dark panels |
| `--term-hover` | `rgba(255, 255, 255, 0.08)` | same | Hover wash (translucent white) |
| `--term-accent` | `#b5f23d` | same | Lime in dark panels |
| `--term-accent-tint` | `#26310d` | same | Highlighted line / current node background |
| `--term-warn-alt` | `#ffd84a` | same | Crackme patched bytes, hot edge |
| `--term-warn-pale` | `#ffe08a` | same | Pale warning |
| `--term-addr` | `#8a8a82` | same | Addresses, graph strokes |
| `--term-danger-soft` | `#ff9b9b` | same | Demo log errors |
| `--term-danger-hot` | `#ff5a6e` | same | Breakpoint dot |
| `--term-danger-pale` | `#ffb4a8` | same | Pale error note |
| `--term-info-alt` | `#9ad0ff` | same | Crackme analysis labels |
| `--term-hex` | `#e7ffd0` | same | Hex dump text |
| `--term-synth` | `#9fc79a` | same | Synthesised packet field |
| `--term-violet-alt` | `#d68cff` | same | Violet variant |
| `--term-violet-pale` | `#e6b8ff` | same | Violet variant (pale) |
| `--term-cyan-alt` | `#5fd7e6` | same | Cyan variant |
| `--term-cyan-pale` | `#8be9f5` | same | Cyan variant (pale) |
| `--term-fg-listing` | `#d9d9d2` | same | Crackme listing text |
| `--term-fg-dim` | `#b9b9b0` | same | Graph arrow heads |
| `--term-edge` | `#b9c4a0` | same | Graph edges |
| `--term-desk-fg` | `#f4f1e6` | same | OSINT desk text |
| `--term-bg-row` | `#1d1d1a` | same | Hovered row, graph node fill |
| `--term-bg-black` | `#0a0a0a` | same | Near-black panel (#0a0a0a): crackme listing and graph, cipherlab ciphertext |
| `--term-white` | `#ffffff` | same | White text or hover fill in dark panels |
| `--term-dot` | `#55554f` | same | Terminal title-bar dots |
| `--term-fg-soft` | `#c9c9c2` | same | Light grey text in the terminal |
| `--term-bg-flat` | `#222222` | same | OSINT scene background |
| `--term-bg-pre` | `#14171c` | same | OSINT pre background |
| `--term-bg-goto` | `#14212b` | same | Crackme goto line |
| `--term-desk-top` | `#1b2229` | same | OSINT desk gradient start |
| `--term-desk-bottom` | `#101419` | same | OSINT desk gradient end |
| `--term-accent-tint-2` | `#3c4d12` | same | Current graph node fill |
| `--term-on-accent` | `#0a0a0a` | same | Text on lime inside dark panels |
| `--term-ok` | `#6fdc6f` | same | Syntax / log: success |
| `--term-warn` | `#fcd34d` | same | Syntax / log: warning |
| `--term-danger` | `#ff6b6b` | same | Syntax / log: error |
| `--term-info` | `#9ec5ff` | same | Syntax / log: info, requests |
| `--term-violet` | `#c4b5fd` | same | Syntax / log: database, keywords |
| `--term-cyan` | `#7dd3fc` | same | Syntax / log: docker, types |
| `--term-orange` | `#ff9e57` | same | Syntax / log: hard |

**Always-light paper art (OSINT cards, map): identical in both themes**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper-bg` | `#fffdf2` | same | Cream card (OSINT case file), always light |
| `--paper-bg-2` | `#f3efe0` | same | Second paper tone, always light |
| `--paper-ink` | `#222222` | same | Ink on paper, always dark |
| `--paper-muted` | `#55554f` | same | Muted ink on paper |
| `--paper-line` | `#c8a77a` | same | Cork board / paper edge |
| `--paper-card` | `#fffbe8` | same | OSINT card (#fffbe8) |
| `--paper-bg-3` | `#e9e3cf` | same | OSINT panel (#e9e3cf) |
| `--paper-ink-2` | `#3b3b36` | same | OSINT handle ink on paper |

Notes on the dark design: near-black blue-grey surfaces (not pure black), off-white ink, strong lines mid-grey (`#66758a`, 3:1 or better on every surface), soft lines dim. Lime is both the fill (`--color-accent`) and, in dark only, a text colour (`--color-accent-text`); in light, lime is never used as text, `--color-accent-text` is a dark green there.

## 3. How to add a colour

1. Decide the role first (surface, text, line, status, difficulty, chart, decoration). If an existing token has that role, use it.
2. If not, add the token in `styles.css`: the light value in `:root`, and the **same name** with a dark value in **both** dark blocks (the explicit block and the media block, identical text). Always-dark or always-light colours go in `:root` only, named `--term-*` or `--paper-*`.
3. If it is used as text or as a border/icon, add its pair to `PAIRS` in `frontend/tests/helpers/themeCss.js` (4.5 for text, 3 for borders, icons and focus rings).
4. `cd frontend && npm test` runs the parity and contrast tests. Update the tables in this file (the contrast table is generated from `PAIRS`).

## 4. Migration rules for agents (phase B)

1. **No raw colours in component CSS or JSX.** Use `var(--color-...)`. No hex, `rgb()`, `hsl()` or named colour, except the "keep" list in section 5. Drop `var(--token, #fallback)` fallbacks while you are there; `styles.css` always defines the token.
2. **Exact tokens keep light pixel-identical.** Every distinct light colour found in the audit has a token with exactly that light value (the `Exact-literal variants` group and the extra `--term-*` and `--paper-*` tokens). Use the token the map names for that literal; do not substitute a "nearby" token (a different light value shifts the light theme). A few tokens differ from their literal on purpose and the map says so (`--color-accent-text` replaces lime text on light, which must not exist).
3. **Context decides the token.** Pick by what the colour does (text, fill, border, shadow), not by what it looks like. The map in section 5 lists the recommended token per literal and the ambiguous ones (`#fff`, `#0a0a0a`, `#b5f23d`) with their options.
4. **`--color-ink` flips.** It is near-black in light and off-white in dark. That is right for text and for inverse controls (`background: var(--color-ink); color: var(--color-ink-contrast)`), and wrong for anything that must stay dark. A terminal, code listing, hex pane or graph panel uses `--term-bg`, `--term-bg-deep`, `--term-fg` and the other `--term-*` tokens, never `var(--color-ink)` as a background (the Arena Terminal log turns white on dark otherwise; section 5 lists the 32 places).
5. **Text on lime is `--color-on-accent`**, never `--color-ink` and never inherited. In dark, ink is light, so an accent fill with inherited text is unreadable. 79 rules need this (section 5).
6. **Text on a solid danger or ink fill is `--color-ink-contrast`.** The solid danger fill is light pink in dark.
7. **Hard shadows use `--color-shadow`**, not `--color-ink` (a white block shadow in dark). `box-shadow: 5px 5px 0 var(--color-shadow)`; `--shadow-hard` and `--shadow-accent` already do. Translucent overlay shadows: `--color-scrim`.
8. **Status colours come in triples** (`--color-ok`, `--color-ok-tint`, `--color-ok-border`, same for `danger`, `warn`, `info`): text, background, border. Difficulty uses `--color-diff-<level>` for the bar or chip fill, `-tint` for the background and `-text` for the label (4.5:1 on the tint). Never rely on colour alone for difficulty: keep the text label.
9. **Local palettes** (`--os-accent`, `--fx-accent`, `--ov-accent`, `--adm-c1..4`, `--lb-series-N`, `--demo-kind`) stay as local variables but must be assigned tokens: `--lb-series-1: var(--color-series-1);`, `--ov-accent: var(--color-diff-easy);`.
10. **Always-dark and art exceptions stay literal** (section 5, "Keep"): Web Lab lab skins, OSINT paper art and map, SVG art, confetti, matrix rain, medals, print rules. Do not wrap them in tokens.
11. **Hover and active rules** that put a lime background behind text must set `color: var(--color-on-accent)` (the global ones in `styles.css` already do).
12. **Never use `data-theme='light'` or `'dark'` on any element other than `<html>`.** The Web Lab already uses `[data-theme='pizza']` and similar on inner elements: those values are fine.
13. **Images and canvases**: the QR code on the MFA page keeps black on white (its own white quiet zone), which must not be themed. Canvas colours (confetti, matrix rain, pixel grid) are brand pixels: keep.
14. After migrating a file, re-run the audit (see section 5) and the tests; light must stay pixel-identical except where the map says a token differs slightly (noted per literal).
15. **Anchors that override the hover background must set `color`.** `styles.css` has a global `a:hover { background: var(--color-accent); color: var(--color-on-accent) }`. A link, card or button-link that replaces only the hover background (surface, tint, transparent) silently keeps that dark on-accent text, which is unreadable on a dark surface (navbar links and challenge cards went black on dark). Set `color: var(--color-ink)` (or `inherit`, or `--color-on-accent` when the new background is lime) in the same hover rule, and do the same for child text that has its own colour (status text, muted meta) when the card turns lime (`--color-on-accent-muted`). In light these equal what rendered before, so light stays identical. `frontend/tests/hoverColor.test.js` fails on any anchor `:hover` rule that sets a background without a colour; `docs/harness` hover audit (see FIXLOG "Dark hover contrast") checks the rendered result.
## 5. Colour audit and migration map

### Audit (phase A baseline)

| File | Literals | Distinct |
|---|---|---|
| `terminal/terminal.css` | 68 | 26 |
| `components/weblab/weblab.css` | 48 | 42 |
| `components/osint/osint.css` | 39 | 30 |
| `demo/ArchitectureDiagram.css` | 32 | 8 |
| `demo/StepTerminal.css` | 31 | 15 |
| `demo/HopTrail.css` | 26 | 6 |
| `components/crackme/crackme.css` | 22 | 12 |
| `components/crackme/analysis.css` | 21 | 12 |
| `components/osint/MapTab.jsx` | 15 | 9 |
| `components/admin/admin.css` | 13 | 11 |
| `components/forensics/forensics.css` | 12 | 10 |
| `demo/panels.css` | 12 | 10 |
| `pages/Leaderboard.css` | 9 | 9 |
| `pages/socialHelpers.js` | 6 | 6 |
| `terminal/Confetti.jsx` | 6 | 6 |
| `components/forensics/packets.css` | 5 | 5 |
| `components/cipherlab/cipherlab.css` | 4 | 4 |
| `overview.css` | 4 | 4 |
| `components/EventBanner.css` | 3 | 3 |
| `osint/helpers.js` | 3 | 3 |
| `skills/skills.css` | 3 | 2 |
| `terminal/MatrixRain.jsx` | 3 | 3 |
| `components/AnnouncementBanner.css` | 2 | 2 |
| `components/forensics/PixelGrid.jsx` | 2 | 2 |
| `components/ScoreboardFreezeNote.css` | 2 | 2 |
| `components/osint/Common.jsx` | 1 | 1 |

**Total 392 literals in 26 files, 155 distinct values.**

The device-compatibility notes estimated about 354 hex colours; the full count (hex, rgba, named) is above. 58 of the hits are `var(--token, #fallback)` fallbacks in HopTrail and ArchitectureDiagram that only need the fallback deleted, and at least 67 more are Web Lab skins, OSINT paper art, confetti and other art that stays literal, so about 265 need a real token.

Raw data (per file: literal, kind, count, the CSS property it is used in, two lines of context; per literal: total and files; plus the `varRisks` below) is in `docs/harness/color-audit.json`. The scan is a scratch script (not committed): it walks `frontend/src` for `.css`, `.jsx` and `.js`, skips comments and `styles.css`, and matches hex (3, 4, 6, 8 digits), `rgb()/rgba()/hsl()/hsla()` and named colours used as values. A quick equivalent: `grep -rEn '#[0-9a-fA-F]{3,8}\b|rgba?\(' frontend/src --include=*.css --include=*.jsx --include=*.js`.

### Existing `var(--color-*)` usages that change meaning in dark

These already use tokens, so no literal shows up, but their meaning flips in dark mode and each needs a look. Counts per pattern and per file; line-level detail is in the JSON (`varRiskDetail`).

| Pattern | Count | Why it matters | Files (count) |
|---|---|---|---|
| `ink-fill` | 32 | background uses var(--color-ink): it becomes LIGHT in dark. Primary/inverse control with ink-contrast text is fine; an always-dark panel must use --term-bg*. | bench:1, cipherlab:3, forensics:3, packets:1, osint:1, panels:6, Demo:4, Leaderboard:3, Profile:1, skills:1, terminal-hints:1, terminal:7 |
| `ink-contrast-text` | 11 | text uses var(--color-ink-contrast): it becomes DARK in dark. Fine on an ink fill; wrong inside an always-dark panel (use --term-fg). | bench:1, panels:3, Demo:2, Leaderboard:2, Profile:1, Team:1, terminal-hints:1 |
| `ink-contrast-fill` | 0 | background uses var(--color-ink-contrast): it becomes DARK in dark. Check it is a surface; for a deliberately white card use --color-surface. |  |
| `accent-fill-text` | 79 | accent fill with no color or color: var(--color-ink): ink is light in dark, so lime + light text. Set color: var(--color-on-accent). | admin:2, cipherlab:5, crackme:5, forensics:7, packets:3, Info:1, osint:6, Social:4, weblab:2, panels:8, onboarding:3, overview:2, Challenge:1, Demo:8, FairPlay:1, Games:1, Leaderboard:2, Profile:3, Team:2, skills:2, terminal:11 |
| `shadow-ink` | 11 | box-shadow uses var(--color-ink): a white block shadow in dark. Use var(--color-shadow). | osint:1, panels:1, overview:2, Challenge:1, Demo:3, FairPlay:1, Leaderboard:1, Profile:1 |
| `ink-on-dark-js` | 1 | inline style in JSX/JS uses a flipping token. | PixelArt.jsx:1 |

Fix recipes: `ink-fill` in a window, listing or pane: `background: var(--term-bg)` (or `--term-bg-deep`) and `--term-fg` text. `ink-fill` on a button or tag with `--color-ink-contrast` text: leave. `accent-fill-text`: add `color: var(--color-on-accent)`. `shadow-ink`: `var(--color-shadow)`.

### Colour migration map

One row per distinct literal found. "Token (by role)" lists the options by context; **keep** means do not tokenise (art, skins, canvas, print). Counts are totals over all files; the per-file split is in the last column.

| Literal | Uses | Token (by role) | Notes |
|---|---|---|---|
| `#0a0a0a` | 42 | `--color-ink` text; `--color-line` border, stroke, outline; `--color-shadow` hard shadow; `--term-bg-black` near-black panel fill (crackme listing and graph, cipherlab ciphertext) | Context decides; every option equals #0a0a0a in light. `--adm-c1` chart colour: `--color-ink`. HopTrail and ArchitectureDiagram hits are mostly `var(--color-ink, #0a0a0a)` fallbacks: drop the fallback. Files: HopTrail:15, ArchitectureDiagram:12, StepTerminal:4, crackme:2, MapTab:2, terminal:1, analysis:1, admin:1, socialHelpers:1, Confetti:1, cipherlab:1, PixelGrid:1 |
| `#b5f23d` | 30 | `--color-accent` fill; `--color-accent-text` as text on a page surface; `--term-accent` inside dark panels; `--color-diff-easy` for `--*-accent` easy | Never lime text on light surfaces. Confetti, MatrixRain and MapTab pin: keep (brand pixels). Files: StepTerminal:9, ArchitectureDiagram:7, HopTrail:4, forensics:2, terminal:1, osint:1, MapTab:1, panels:1, socialHelpers:1, Confetti:1, overview:1, MatrixRain:1 |
| `#ffffff` | 26 | `--color-surface` card or field fill; `--color-ink-contrast` text on an ink or danger fill; `--color-on-accent` is NOT white (use only on lime); `--term-white` text or hover fill in dark panels | Ambiguous: background (surface) vs text on a fill (ink-contrast) vs white in a dark panel (term-white). All white in light. Weblab `--t-on-accent`, confetti, PixelGrid strokes, skills print: keep. Files: terminal:15, analysis:3, weblab:2, crackme:2, socialHelpers:1, Confetti:1, helpers:1, PixelGrid:1 |
| `#e8e8e3` | 15 | `--term-fg` | Text in terminal / demo log (always dark). Files: terminal:8, StepTerminal:5, panels:2 |
| `#fff` | 15 | `--color-surface` fill; `--color-ink-contrast` text on solid fill | Same rule as `#ffffff`. admin.css (3, text on solid danger/ink badge): `--color-ink-contrast`. HopTrail/ArchitectureDiagram: `var(--color-surface, #fff)` fallbacks, drop. MapTab road stroke and skills.css print rules: keep. Files: HopTrail:4, ArchitectureDiagram:3, admin:3, MapTab:2, skills:2, weblab:1 |
| `#55554f` | 12 | `--color-muted` text and diagram fill; `--paper-muted` on paper cards (osint); `--term-dot` terminal title-bar dots | osint `.os-muted` sits on cream cards: `--paper-muted`. Files: osint:5, ArchitectureDiagram:3, terminal:2, StepTerminal:1, HopTrail:1 |
| `#9b9b95` | 10 | `--term-fg-subtle` | Timestamps, sub-titles in dark panels. Files: terminal:6, StepTerminal:2, panels:2 |
| `#ff6b6b` | 7 | `--term-danger` in dark panels; `--color-diff-insane` for `--os-accent` / `--fx-accent` / `--ov-accent` insane | Confetti: keep. Files: terminal:2, osint:1, forensics:1, socialHelpers:1, Confetti:1, overview:1 |
| `#ffd84a` | 7 | `--term-warn-alt` | crackme patched bytes, hot edge. Exact value, no light shift. Files: crackme:4, analysis:2, cipherlab:1 |
| `#8a8a82` | 6 | `--term-addr` | crackme addresses and graph strokes. Exact value, no light shift. Files: crackme:3, analysis:3 |
| `#8a8a83` | 5 | `--term-line-strong` | Terminal borders. Files: terminal:4, StepTerminal:1 |
| `#34342f` | 5 | `--term-line` | Terminal row dividers. Files: terminal:4, StepTerminal:1 |
| `#fcd34d` | 5 | `--term-warn` | Terminal / demo log warnings. Files: terminal:3, StepTerminal:1, panels:1 |
| `#a8001a` | 5 | `--color-danger` text; `--color-danger` solid fill with `--color-ink-contrast` text; `--color-danger-border` | `--adm-c4` chart colour: `--color-danger`. MapTab pick ring: keep (paper art). Files: weblab:2, MapTab:2, admin:1 |
| `#1c1c1a` | 4 | `--term-bg` | Files: terminal:3, StepTerminal:1 |
| `#c9c9c2` | 4 | `--color-line-soft` (diagram stroke, token definition); `--term-fg-soft` (terminal text) | Exact either way. Files: terminal:3, ArchitectureDiagram:1 |
| `#ff9b9b` | 4 | `--term-danger-soft` | demo log errors. Exact value, no light shift. Files: terminal:2, StepTerminal:1, panels:1 |
| `#9ec5ff` | 4 | `--term-info` | Files: terminal:2, StepTerminal:1, panels:1 |
| `#ffd95a` | 4 | `--color-diff-medium` for every `--ov-accent` / `--fx-accent` / `--os-accent` medium tone | Same value in light, so no shift. Files: forensics:2, osint:1, overview:1 |
| `#9ad0ff` | 4 | `--term-info-alt` | crackme analysis labels and graph. Exact value, no light shift. Files: analysis:4 |
| `#6b6b64` | 3 | `--term-scrollbar` | scrollbar-color in dark panels. Files: terminal:1, StepTerminal:1, panels:1 |
| `#6ea8ff` | 3 | **keep** (not a token) | Confetti piece. Files: terminal:1, socialHelpers:1, Confetti:1 |
| `#fffbe8` | 3 | `--paper-card` (osint card); `--color-surface-warm` (forensics `.fx-card`, app chrome) | Exact value both ways, no light shift. Files: osint:2, forensics:1 |
| `#ff9e57` | 3 | `--color-diff-hard` for the accent variables; `--term-orange` in dark panels | Files: osint:1, forensics:1, overview:1 |
| `#e7ffd0` | 3 | `--term-hex` | hex dump text on dark panes. Exact value, no light shift. Files: osint:1, forensics:1, packets:1 |
| `#222` | 3 | `--term-bg-flat` (`.os-scene` background); keep for MapTab text fill | Exact value, no light shift. Files: MapTab:2, osint:1 |
| `#f3efe0` | 3 | `--paper-bg-2` | osint `.os-map`; MapTab `<rect>` fill: keep. Files: MapTab:2, osint:1 |
| `#e9e9e4` | 3 | `--color-surface-2` | Fallback inside `var(--color-surface-2, #e9e9e4)`: drop the fallback. Files: ArchitectureDiagram:2, HopTrail:1 |
| `#eefbcc` | 3 | `--color-accent-tint` | Fallbacks in HopTrail/ArchitectureDiagram: drop. Files: ArchitectureDiagram:2, HopTrail:1 |
| `#26310d` | 3 | `--term-accent-tint` | Current-line highlight in crackme listing. Files: crackme:2, analysis:1 |
| `#d62828` | 2 | **keep** (not a token) | Weblab pizza skin accent. Files: weblab:2 |
| `#ffd166` | 2 | **keep** (not a token) | Weblab pizza skin header. Files: weblab:2 |
| `#0a0a12` | 2 | **keep** (not a token) | Weblab vault skin. Files: weblab:2 |
| `#076472` | 2 | **keep** (not a token) | Weblab hospital skin kicker. Files: weblab:2 |
| `#f4f1e6` | 2 | `--term-desk-fg` | osint desk text. Exact value, no light shift. Files: osint:2 |
| `#e9e3cf` | 2 | `--paper-bg-3` | osint panel. Exact value, no light shift. Files: osint:2 |
| `#fffdf2` | 2 | `--paper-bg` | osint paper. Files: osint:2 |
| `#c8a77a` | 2 | `--paper-line` | Cork board. Files: osint:2 |
| `#f4f4f1` | 2 | `--color-bg` | Fallbacks: drop. Files: ArchitectureDiagram:2 |
| `rgba(255,255,255,0.08)` | 2 | `--term-hover` | Active log line. Files: StepTerminal:1, panels:1 |
| `#c4b5fd` | 2 | `--term-violet` | Files: StepTerminal:1, panels:1 |
| `#7dd3fc` | 2 | `--term-cyan` | Files: StepTerminal:1, panels:1 |
| `#d9d9d2` | 2 | `--term-fg-listing` | crackme listing text. Exact value, no light shift. Files: crackme:2 |
| `rgba(0,0,0,0.28)` | 2 | **keep** (not a token) | Scroll-shadow gradient on a dark panel. Files: crackme:2 |
| `#1d1d1a` | 2 | `--term-bg-row` | hovered row / graph node fill. Exact value, no light shift. Files: crackme:1, analysis:1 |
| `#b9b9b0` | 2 | `--term-fg-dim` | graph arrow heads. Exact value, no light shift. Files: analysis:2 |
| `#6b6a63` | 2 | **keep** (not a token) | MapTab road (art). Files: MapTab:2 |
| `#fff4d6` | 2 | `--color-warn-tint` | admin `--adm-warn-tint`, announcement banner. Files: admin:1, AnnouncementBanner:1 |
| `#d98e00` | 2 | `--color-warn-border` | left stripe; dark value is lighter. Exact value, no light shift. Files: admin:1, AnnouncementBanner:1 |
| `#ecece6` | 2 | `--color-line-faint` | row separators. Exact value, no light shift. Files: forensics:1, packets:1 |
| `#ffd23f` | 2 | **keep** (not a token) | Confetti. Files: socialHelpers:1, Confetti:1 |
| `#e8f1ff` | 2 | `--color-info-tint` | EventBanner frozen, ScoreboardFreezeNote. Files: EventBanner:1, ScoreboardFreezeNote:1 |
| `#2457c5` | 2 | `--color-info-border` | Files: EventBanner:1, ScoreboardFreezeNote:1 |
| `#6fdc6f` | 1 | `--term-ok` | Files: terminal:1 |
| `#d68cff` | 1 | `--term-violet-alt` | Exact value, no light shift. Files: terminal:1 |
| `#5fd7e6` | 1 | `--term-cyan-alt` | Exact value, no light shift. Files: terminal:1 |
| `#ffe08a` | 1 | `--term-warn-pale` | Exact value, no light shift. Files: terminal:1 |
| `#e6b8ff` | 1 | `--term-violet-pale` | Exact value, no light shift. Files: terminal:1 |
| `#8be9f5` | 1 | `--term-cyan-pale` | Exact value, no light shift. Files: terminal:1 |
| `rgba(181,242,61,0.09)` | 1 | **keep** (not a token) | Terminal tone wash (`--tm-wash`), alpha over a dark panel. Files: terminal:1 |
| `rgba(255,107,107,0.09)` | 1 | **keep** (not a token) | Same. Files: terminal:1 |
| `rgba(158,197,255,0.09)` | 1 | **keep** (not a token) | Same. Files: terminal:1 |
| `#141413` | 1 | `--term-bg-deep` | Files: terminal:1 |
| `#07140b` | 1 | **keep** (not a token) | Weblab retro-bank skin. Files: weblab:1 |
| `#8dffa8` | 1 | **keep** (not a token) | Weblab retro-bank skin. Files: weblab:1 |
| `#39ff6a` | 1 | **keep** (not a token) | Weblab retro-bank skin. Files: weblab:1 |
| `#0d2a16` | 1 | **keep** (not a token) | Weblab retro-bank skin. Files: weblab:1 |
| `#2f8f4e` | 1 | **keep** (not a token) | Weblab retro-bank skin. Files: weblab:1 |
| `#04110a` | 1 | **keep** (not a token) | Weblab retro-bank skin. Files: weblab:1 |
| `#fff6e0` | 1 | **keep** (not a token) | Weblab pizza skin. Files: weblab:1 |
| `#3b1a0a` | 1 | **keep** (not a token) | Weblab pizza skin. Files: weblab:1 |
| `#8c2f1b` | 1 | **keep** (not a token) | Weblab pizza skin. Files: weblab:1 |
| `#f2fbfb` | 1 | **keep** (not a token) | Weblab hospital skin. Files: weblab:1 |
| `#0b3b44` | 1 | **keep** (not a token) | Weblab hospital skin. Files: weblab:1 |
| `#087a89` | 1 | **keep** (not a token) | Weblab hospital skin. Files: weblab:1 |
| `#d7f1f3` | 1 | **keep** (not a token) | Weblab hospital skin. Files: weblab:1 |
| `#3b919d` | 1 | **keep** (not a token) | Weblab hospital skin. Files: weblab:1 |
| `#e6e6ff` | 1 | **keep** (not a token) | Weblab vault skin. Files: weblab:1 |
| `#b388ff` | 1 | **keep** (not a token) | Weblab vault skin. Files: weblab:1 |
| `#17172b` | 1 | **keep** (not a token) | Weblab vault skin. Files: weblab:1 |
| `#6d5bc0` | 1 | **keep** (not a token) | Weblab vault skin. Files: weblab:1 |
| `#a31515` | 1 | **keep** (not a token) | Weblab pizza skin kicker. Files: weblab:1 |
| `#8a0016` | 1 | `--color-diff-insane-text` | weblab critical badge text. Exact value, no light shift. Files: weblab:1 |
| `#ffe3e6` | 1 | `--color-diff-insane-tint` | weblab critical badge background. Exact value, no light shift. Files: weblab:1 |
| `#8a3a00` | 1 | `--color-diff-hard-text` | weblab high badge. Files: weblab:1 |
| `#ffe9d2` | 1 | `--color-diff-hard-tint` | Files: weblab:1 |
| `#6b5600` | 1 | `--color-sev-medium` | weblab medium badge text. Exact value, no light shift. Files: weblab:1 |
| `#fff6cc` | 1 | `--color-sev-medium-tint` | weblab medium badge background. Exact value, no light shift. Files: weblab:1 |
| `#1d5a2a` | 1 | `--color-sev-low` | weblab low badge text (background is `--color-ok-tint`). Exact value, no light shift. Files: weblab:1 |
| `#e0f6e4` | 1 | `--color-ok-tint` | Files: weblab:1 |
| `#fff0b8` | 1 | **keep** (not a token) | Weblab pizza skin header stripe. Files: weblab:1 |
| `#145c26` | 1 | `--color-ok-alt` | weblab success notice text. Exact value, no light shift. Files: weblab:1 |
| `#e6f9ea` | 1 | `--color-ok-tint-alt` | weblab success notice background. Exact value, no light shift. Files: weblab:1 |
| `#ff7a8a` | 1 | **keep** (not a token) | Weblab skin error text (dark lab skins). Files: weblab:1 |
| `#1a6b2a` | 1 | **keep** (not a token) | Weblab pizza skin success text. Files: weblab:1 |
| `rgba(0,0,0,0.08)` | 1 | **keep** (not a token) | Weblab `.wl-code` wash inside the lab frame. Files: weblab:1 |
| `#d7f7dd` | 1 | `--color-diff-add` | weblab diff added line. Exact value, no light shift. Files: weblab:1 |
| `#fddde0` | 1 | `--color-diff-del` | weblab diff removed line. Exact value, no light shift. Files: weblab:1 |
| `#1b2229` | 1 | `--term-desk-top` | osint desk gradient start. Exact value, no light shift. Files: osint:1 |
| `#101419` | 1 | `--term-desk-bottom` | osint desk gradient end. Exact value, no light shift. Files: osint:1 |
| `rgba(255,224,140,0.18)` | 1 | **keep** (not a token) | OSINT desk glow on a dark background. Files: osint:1 |
| `rgba(10,10,10,0.25)` | 1 | `--color-hatch` (pixel hatch, done); osint paper shadow: keep | Files: osint:1 |
| `#3b3b36` | 1 | `--paper-ink-2` | osint handle on paper. Exact value, no light shift. Files: osint:1 |
| `#14171c` | 1 | `--term-bg-pre` | osint `.os-pre`. Exact value, no light shift. Files: osint:1 |
| `#e9f4ff` | 1 | **keep** (not a token) | OSINT pin tint (paper art; dark ink text on top). Files: osint:1 |
| `rgba(255,255,255,0.25)` | 1 | **keep** (not a token) | OSINT cork highlight. Files: osint:1 |
| `#b3202a` | 1 | **keep** (not a token) | OSINT red string (art). Files: osint:1 |
| `#3a0a0e` | 1 | **keep** (not a token) | OSINT string label (art). Files: osint:1 |
| `#f6ead3` | 1 | **keep** (not a token) | OSINT string label halo (art). Files: osint:1 |
| `rgba(10,10,10,0.35)` | 1 | **keep** (not a token) | OSINT pin shadow (paper art). Files: osint:1 |
| `#ffe9c9` | 1 | **keep** (not a token) | OSINT pin tint. Files: osint:1 |
| `#dcf3dc` | 1 | **keep** (not a token) | OSINT pin tint. Files: osint:1 |
| `#dce8ff` | 1 | **keep** (not a token) | OSINT pin tint. Files: osint:1 |
| `#f0dcff` | 1 | **keep** (not a token) | OSINT pin tint. Files: osint:1 |
| `rgba(10,10,10,0.4)` | 1 | **keep** (not a token) | OSINT pin shadow while dragging. Files: osint:1 |
| `#ff5a6e` | 1 | `--term-danger-hot` | breakpoint dot. Exact value, no light shift. Files: crackme:1 |
| `#b0b0a8` | 1 | `--term-fg-muted` | Files: crackme:1 |
| `#f2c53d` | 1 | **keep** (not a token) | Crackme game piece colour (art). Files: crackme:1 |
| `#f2823d` | 1 | **keep** (not a token) | Crackme game piece colour (art). Files: crackme:1 |
| `#ffb4a8` | 1 | `--term-danger-pale` | crackme notes. Exact value, no light shift. Files: analysis:1 |
| `#14212b` | 1 | `--term-bg-goto` | crackme goto line. Exact value, no light shift. Files: analysis:1 |
| `#b9c4a0` | 1 | `--term-edge` | graph edges. Exact value, no light shift. Files: analysis:1 |
| `#3c4d12` | 1 | `--term-accent-tint-2` | current graph node. Exact value, no light shift. Files: analysis:1 |
| `#b9b39c` | 1 | **keep** (not a token) | MapTab grid (art). Files: MapTab:1 |
| `#8a8470` | 1 | **keep** (not a token) | MapTab labels (art). Files: MapTab:1 |
| `#1a56a8` | 1 | `--color-info` | admin `--adm-c2` chart colour. Files: admin:1 |
| `#2d6a00` | 1 | `--color-chart-green` | admin `--adm-c3` chart colour. Exact value, no light shift. Files: admin:1 |
| `#dbe8fa` | 1 | `--color-info-tint-alt` | admin info badge. Exact value, no light shift. Files: admin:1 |
| `#6f0011` | 1 | `--color-danger-deep` | admin danger button hover. Exact value, no light shift. Files: admin:1 |
| `rgba(10,10,10,0.55)` | 1 | `--color-overlay` | admin modal backdrop. Files: admin:1 |
| `rgba(10,10,10,0.2)` | 1 | `--color-shadow-soft` | admin drawer shadow. Exact value, no light shift. Files: admin:1 |
| `#fbfbf8` | 1 | `--color-surface-soft` | forensics list background. Exact value, no light shift. Files: forensics:1 |
| `#7fb2ff` | 1 | **keep** (not a token) | Forensics DNS stripe (readable on both themes). Files: forensics:1 |
| `#cba6ff` | 1 | **keep** (not a token) | Forensics TLS stripe. Files: forensics:1 |
| `#2a78d6` | 1 | `--color-series-1` | Leaderboard: set `--lb-series-N: var(--color-series-N)`. Files: Leaderboard:1 |
| `#d95926` | 1 | `--color-series-2` | Files: Leaderboard:1 |
| `#13946a` | 1 | `--color-series-3` | Files: Leaderboard:1 |
| `#b07400` | 1 | `--color-series-4` | Files: Leaderboard:1 |
| `#d0457a` | 1 | `--color-series-5` | Files: Leaderboard:1 |
| `#008300` | 1 | `--color-series-6` | Files: Leaderboard:1 |
| `#6250d6` | 1 | `--color-series-7` | Files: Leaderboard:1 |
| `#d93a3a` | 1 | `--color-series-8` | Files: Leaderboard:1 |
| `#6b6b66` | 1 | `--color-series-other` | Files: Leaderboard:1 |
| `#9fc79a` | 1 | `--term-synth` | packets synthesised-field text on dark pane. Exact value, no light shift. Files: packets:1 |
| `#eef4ff` | 1 | `--color-info-wash` | packets client segment. Exact value, no light shift. Files: packets:1 |
| `#f2fbdc` | 1 | `--color-accent-wash` | packets server segment. Exact value, no light shift. Files: packets:1 |
| `#dfe3e6` | 1 | **keep** (not a token) | cipherlab silver medal. Files: cipherlab:1 |
| `#e3a56b` | 1 | **keep** (not a token) | cipherlab bronze medal. Files: cipherlab:1 |
| `#1a7f37` | 1 | `--color-ok-border` | EventBanner live. Files: EventBanner:1 |
| `#888888` | 1 | **keep** (not a token) | `safeColour` fallback for plot shapes (art). Files: helpers:1 |
| `#222222` | 1 | **keep** (not a token) | Plot shape default (art). Files: helpers:1 |
| `#000` | 1 | **keep** (not a token) | skills.css print rule (print is always light). Files: skills:1 |
| `rgba(10,10,10,0.14)` | 1 | **keep** (not a token) | MatrixRain canvas fade. Files: MatrixRain:1 |
| `#f2ffd6` | 1 | **keep** (not a token) | MatrixRain. Files: MatrixRain:1 |
| `#555` | 1 | **keep** (not a token) | Plot polygon fallback (art). Files: Common:1 |

## 6. Contrast table (WCAG 2.1)

Computed from the real token values by `tests/helpers/themeCss.js` (`PAIRS`), asserted in both themes by `tests/themeContrast.test.js`. Text pairs need 4.5:1; borders, icons, chart marks and focus rings need 3:1. Translucent colours are not used in any pair.

| Foreground on background | Need | Light | Dark | Use |
|---|---|---|---|---|
| `color-ink` on `color-bg` | 4.5 | 17.97 | 16.02 | body text |
| `color-ink` on `color-surface` | 4.5 | 19.8 | 14.65 | body text |
| `color-ink` on `color-surface-2` | 4.5 | 16.25 | 12.91 | body text |
| `color-ink` on `color-sunken` | 4.5 | 17.33 | 16.49 | body text |
| `color-ink` on `color-accent-tint` | 4.5 | 18.2 | 12.79 | body text |
| `color-ink` on `color-code-bg` | 4.5 | 17.33 | 16.37 | body text |
| `color-ink` on `color-stripe` | 4.5 | 18.45 | 13.71 | body text |
| `color-muted` on `color-bg` | 4.5 | 6.81 | 8.32 | secondary text |
| `color-muted` on `color-surface` | 4.5 | 7.5 | 7.61 | secondary text |
| `color-muted` on `color-surface-2` | 4.5 | 6.16 | 6.7 | secondary text |
| `color-muted` on `color-sunken` | 4.5 | 6.57 | 8.56 | secondary text |
| `color-muted` on `color-accent-tint` | 4.5 | 6.9 | 6.64 | secondary text |
| `color-muted` on `color-stripe` | 4.5 | 6.99 | 7.12 | secondary text |
| `color-subtle` on `color-bg` | 4.5 | 4.94 | 6.07 | placeholder / tertiary text |
| `color-subtle` on `color-surface` | 4.5 | 5.44 | 5.55 | placeholder / tertiary text |
| `color-subtle` on `color-sunken` | 4.5 | 4.76 | 6.25 | placeholder / tertiary text |
| `color-link` on `color-bg` | 4.5 | 17.97 | 14.78 | link |
| `color-link` on `color-surface` | 4.5 | 19.8 | 13.52 | link |
| `color-accent-text` on `color-bg` | 4.5 | 6.98 | 14.18 | lime used as text |
| `color-accent-text` on `color-surface` | 4.5 | 7.69 | 12.97 | lime used as text |
| `color-on-accent` on `color-accent` | 4.5 | 14.83 | 14.83 | text on accent fill |
| `color-on-accent` on `color-accent-hover` | 4.5 | 12.5 | 16.92 | text on accent hover |
| `color-on-accent-muted` on `color-accent` | 4.5 | 5.62 | 5.62 | muted text on accent fill |
| `color-on-accent-muted` on `color-accent-hover` | 4.5 | 4.74 | 6.41 | muted text on accent hover |
| `color-ink-contrast` on `color-ink` | 4.5 | 19.8 | 16.02 | text on ink fill |
| `color-on-ink-accent` on `color-ink` | 4.5 | 14.83 | 7.52 | lime-style text on ink fill (badge) |
| `color-selection-fg` on `color-selection-bg` | 4.5 | 14.83 | 14.83 | text selection |
| `color-code-text` on `color-code-bg` | 4.5 | 17.33 | 14.25 | code |
| `color-danger` on `color-danger-tint` | 4.5 | 6.86 | 7.27 | danger text on its tint |
| `color-danger` on `color-surface` | 4.5 | 7.84 | 7.67 | danger text on surface |
| `color-danger` on `color-bg` | 4.5 | 7.11 | 8.39 | danger text on page |
| `color-danger-border` on `color-surface` | 3 | 7.84 | 3.83 | danger border / icon |
| `color-warn` on `color-warn-tint` | 4.5 | 7.36 | 9.96 | warn text on its tint |
| `color-warn` on `color-surface` | 4.5 | 8.06 | 12.01 | warn text on surface |
| `color-warn` on `color-bg` | 4.5 | 7.32 | 13.12 | warn text on page |
| `color-warn-border` on `color-surface` | 3 (light 2.6) | 2.69 | 4.42 | warn border / icon |
| `color-ok` on `color-ok-tint` | 4.5 | 5.81 | 9.01 | ok text on its tint |
| `color-ok` on `color-surface` | 4.5 | 6.6 | 10.13 | ok text on surface |
| `color-ok` on `color-bg` | 4.5 | 5.99 | 11.08 | ok text on page |
| `color-ok-border` on `color-surface` | 3 | 5.08 | 4.25 | ok border / icon |
| `color-info` on `color-info-tint` | 4.5 | 6.28 | 7.77 | info text on its tint |
| `color-info` on `color-surface` | 4.5 | 7.14 | 8.56 | info text on surface |
| `color-info` on `color-bg` | 4.5 | 6.48 | 9.35 | info text on page |
| `color-info-border` on `color-surface` | 3 | 6.47 | 3.51 | info border / icon |
| `color-diff-easy-text` on `color-diff-easy-tint` | 4.5 | 7.5 | 11.57 | easy label on tint |
| `color-diff-easy-text` on `color-surface` | 4.5 | 8.16 | 13.72 | easy label on surface |
| `color-diff-easy` on `color-surface` | 3 (light 1) | 1.33 | 12.97 | easy bar fill on surface |
| `color-diff-medium-text` on `color-diff-medium-tint` | 4.5 | 7.36 | 9.96 | medium label on tint |
| `color-diff-medium-text` on `color-surface` | 4.5 | 8.06 | 12.01 | medium label on surface |
| `color-diff-medium` on `color-surface` | 3 (light 1) | 1.37 | 12.63 | medium bar fill on surface |
| `color-diff-hard-text` on `color-diff-hard-tint` | 4.5 | 6.64 | 8.31 | hard label on tint |
| `color-diff-hard-text` on `color-surface` | 4.5 | 7.82 | 9.53 | hard label on surface |
| `color-diff-hard` on `color-surface` | 3 (light 1) | 2.04 | 8.48 | hard bar fill on surface |
| `color-diff-insane-text` on `color-diff-insane-tint` | 4.5 | 8.31 | 7.38 | insane label on tint |
| `color-diff-insane-text` on `color-surface` | 4.5 | 10.04 | 7.71 | insane label on surface |
| `color-diff-insane` on `color-surface` | 3 (light 1) | 2.78 | 6.24 | insane bar fill on surface |
| `color-accent` on `color-surface` | 3 (light 1) | 1.33 | 12.97 | accent fill on surface |
| `color-accent` on `color-bg` | 3 (light 1) | 1.21 | 14.18 | accent fill on page |
| `color-focus` on `color-bg` | 3 | 17.97 | 14.18 | focus ring on page |
| `color-focus` on `color-surface` | 3 | 19.8 | 12.97 | focus ring on surface |
| `color-focus` on `color-surface-2` | 3 | 16.25 | 11.43 | focus ring on surface-2 |
| `color-line` on `color-bg` | 3 | 17.97 | 4.03 | strong border on page |
| `color-line` on `color-surface` | 3 | 19.8 | 3.69 | strong border on surface |
| `color-line` on `color-surface-2` | 3 | 16.25 | 3.25 | strong border on surface-2 |
| `color-series-1` on `color-surface` | 3 | 4.42 | 6.52 | chart series 1 |
| `color-series-2` on `color-surface` | 3 | 3.88 | 7.44 | chart series 2 |
| `color-series-3` on `color-surface` | 3 | 3.84 | 8.75 | chart series 3 |
| `color-series-4` on `color-surface` | 3 | 3.93 | 7.62 | chart series 4 |
| `color-series-5` on `color-surface` | 3 | 4.36 | 7.09 | chart series 5 |
| `color-series-6` on `color-surface` | 3 | 4.95 | 9.39 | chart series 6 |
| `color-series-7` on `color-surface` | 3 | 5.77 | 6.93 | chart series 7 |
| `color-series-8` on `color-surface` | 3 | 4.55 | 6.24 | chart series 8 |
| `color-series-other` on `color-surface` | 3 | 5.36 | 6.77 | chart series other |
| `color-sev-medium` on `color-sev-medium-tint` | 4.5 | 6.53 | 9.96 | severity medium |
| `color-sev-low` on `color-ok-tint` | 4.5 | 7.25 | 9.01 | severity low |
| `color-ok-alt` on `color-ok-tint-alt` | 4.5 | 7.38 | 9.01 | success notice |
| `color-ink` on `color-diff-add` | 4.5 | 17.19 | 13.02 | diff added |
| `color-ink` on `color-diff-del` | 4.5 | 15.65 | 13.89 | diff removed |
| `color-chart-green` on `color-surface` | 3 | 6.62 | 9.39 | admin chart green |
| `color-ink` on `color-info-tint-alt` | 4.5 | 15.97 | 13.3 | info badge |
| `color-ink` on `color-info-wash` | 4.5 | 17.93 | 14.38 | packets client |
| `color-ink` on `color-accent-wash` | 4.5 | 18.49 | 13.25 | packets server |
| `color-ink` on `color-surface-warm` | 4.5 | 19.06 | 13.88 | body text |
| `color-muted` on `color-surface-warm` | 4.5 | 7.22 | 7.21 | secondary text |
| `color-ink` on `color-surface-soft` | 4.5 | 19.1 | 15.08 | body text |
| `color-muted` on `color-surface-soft` | 4.5 | 7.24 | 7.83 | secondary text |
| `color-line` on `color-surface-warm` | 3 | 19.06 | 3.5 | border |
| `color-line-faint` on `color-surface-soft` | 1 | 1.14 | 1.26 | decorative row separator |
| `color-ink-contrast` on `color-danger-deep` | 4.5 | 12.47 | 10.95 | text on danger hover |
| `term-fg` on `term-bg` | 4.5 | 13.88 | 13.88 | terminal text on term-bg |
| `term-fg-muted` on `term-bg` | 4.5 | 7.82 | 7.82 | terminal text on term-bg |
| `term-fg-subtle` on `term-bg` | 4.5 | 6.11 | 6.11 | terminal text on term-bg |
| `term-ok` on `term-bg` | 4.5 | 9.87 | 9.87 | terminal text on term-bg |
| `term-warn` on `term-bg` | 4.5 | 11.84 | 11.84 | terminal text on term-bg |
| `term-danger` on `term-bg` | 4.5 | 6.15 | 6.15 | terminal text on term-bg |
| `term-info` on `term-bg` | 4.5 | 9.66 | 9.66 | terminal text on term-bg |
| `term-violet` on `term-bg` | 4.5 | 9.25 | 9.25 | terminal text on term-bg |
| `term-cyan` on `term-bg` | 4.5 | 10.24 | 10.24 | terminal text on term-bg |
| `term-orange` on `term-bg` | 4.5 | 8.36 | 8.36 | terminal text on term-bg |
| `term-accent` on `term-bg` | 4.5 | 12.79 | 12.79 | terminal text on term-bg |
| `term-fg` on `term-bg-deep` | 4.5 | 15 | 15 | terminal text on term-bg-deep |
| `term-fg-muted` on `term-bg-deep` | 4.5 | 8.45 | 8.45 | terminal text on term-bg-deep |
| `term-fg-subtle` on `term-bg-deep` | 4.5 | 6.6 | 6.6 | terminal text on term-bg-deep |
| `term-ok` on `term-bg-deep` | 4.5 | 10.66 | 10.66 | terminal text on term-bg-deep |
| `term-warn` on `term-bg-deep` | 4.5 | 12.78 | 12.78 | terminal text on term-bg-deep |
| `term-danger` on `term-bg-deep` | 4.5 | 6.64 | 6.64 | terminal text on term-bg-deep |
| `term-info` on `term-bg-deep` | 4.5 | 10.43 | 10.43 | terminal text on term-bg-deep |
| `term-violet` on `term-bg-deep` | 4.5 | 9.99 | 9.99 | terminal text on term-bg-deep |
| `term-cyan` on `term-bg-deep` | 4.5 | 11.06 | 11.06 | terminal text on term-bg-deep |
| `term-orange` on `term-bg-deep` | 4.5 | 9.02 | 9.02 | terminal text on term-bg-deep |
| `term-accent` on `term-bg-deep` | 4.5 | 13.81 | 13.81 | terminal text on term-bg-deep |
| `term-fg` on `term-bg-raised` | 4.5 | 11.71 | 11.71 | terminal text on term-bg-raised |
| `term-fg-muted` on `term-bg-raised` | 4.5 | 6.59 | 6.59 | terminal text on term-bg-raised |
| `term-fg-subtle` on `term-bg-raised` | 4.5 | 5.15 | 5.15 | terminal text on term-bg-raised |
| `term-ok` on `term-bg-raised` | 4.5 | 8.32 | 8.32 | terminal text on term-bg-raised |
| `term-warn` on `term-bg-raised` | 4.5 | 9.98 | 9.98 | terminal text on term-bg-raised |
| `term-danger` on `term-bg-raised` | 4.5 | 5.19 | 5.19 | terminal text on term-bg-raised |
| `term-info` on `term-bg-raised` | 4.5 | 8.15 | 8.15 | terminal text on term-bg-raised |
| `term-violet` on `term-bg-raised` | 4.5 | 7.8 | 7.8 | terminal text on term-bg-raised |
| `term-cyan` on `term-bg-raised` | 4.5 | 8.63 | 8.63 | terminal text on term-bg-raised |
| `term-orange` on `term-bg-raised` | 4.5 | 7.05 | 7.05 | terminal text on term-bg-raised |
| `term-accent` on `term-bg-raised` | 4.5 | 10.78 | 10.78 | terminal text on term-bg-raised |
| `term-warn-alt` on `term-bg` | 4.5 | 12.33 | 12.33 | terminal text on term-bg |
| `term-warn-alt` on `term-bg-deep` | 4.5 | 13.32 | 13.32 | terminal text on term-bg-deep |
| `term-warn-pale` on `term-bg` | 4.5 | 13.23 | 13.23 | terminal text on term-bg |
| `term-warn-pale` on `term-bg-deep` | 4.5 | 14.29 | 14.29 | terminal text on term-bg-deep |
| `term-addr` on `term-bg` | 4.5 | 4.91 | 4.91 | terminal text on term-bg |
| `term-addr` on `term-bg-deep` | 4.5 | 5.3 | 5.3 | terminal text on term-bg-deep |
| `term-danger-soft` on `term-bg` | 4.5 | 8.46 | 8.46 | terminal text on term-bg |
| `term-danger-soft` on `term-bg-deep` | 4.5 | 9.14 | 9.14 | terminal text on term-bg-deep |
| `term-danger-hot` on `term-bg` | 4.5 | 5.64 | 5.64 | terminal text on term-bg |
| `term-danger-hot` on `term-bg-deep` | 4.5 | 6.09 | 6.09 | terminal text on term-bg-deep |
| `term-danger-pale` on `term-bg` | 4.5 | 10.03 | 10.03 | terminal text on term-bg |
| `term-danger-pale` on `term-bg-deep` | 4.5 | 10.84 | 10.84 | terminal text on term-bg-deep |
| `term-info-alt` on `term-bg` | 4.5 | 10.44 | 10.44 | terminal text on term-bg |
| `term-info-alt` on `term-bg-deep` | 4.5 | 11.27 | 11.27 | terminal text on term-bg-deep |
| `term-hex` on `term-bg` | 4.5 | 15.94 | 15.94 | terminal text on term-bg |
| `term-hex` on `term-bg-deep` | 4.5 | 17.22 | 17.22 | terminal text on term-bg-deep |
| `term-synth` on `term-bg` | 4.5 | 9.03 | 9.03 | terminal text on term-bg |
| `term-synth` on `term-bg-deep` | 4.5 | 9.75 | 9.75 | terminal text on term-bg-deep |
| `term-violet-alt` on `term-bg` | 4.5 | 7.36 | 7.36 | terminal text on term-bg |
| `term-violet-alt` on `term-bg-deep` | 4.5 | 7.95 | 7.95 | terminal text on term-bg-deep |
| `term-violet-pale` on `term-bg` | 4.5 | 10.29 | 10.29 | terminal text on term-bg |
| `term-violet-pale` on `term-bg-deep` | 4.5 | 11.12 | 11.12 | terminal text on term-bg-deep |
| `term-cyan-alt` on `term-bg` | 4.5 | 10.04 | 10.04 | terminal text on term-bg |
| `term-cyan-alt` on `term-bg-deep` | 4.5 | 10.84 | 10.84 | terminal text on term-bg-deep |
| `term-cyan-pale` on `term-bg` | 4.5 | 12.25 | 12.25 | terminal text on term-bg |
| `term-cyan-pale` on `term-bg-deep` | 4.5 | 13.23 | 13.23 | terminal text on term-bg-deep |
| `term-fg-listing` on `term-bg` | 4.5 | 12.03 | 12.03 | terminal text on term-bg |
| `term-fg-listing` on `term-bg-deep` | 4.5 | 13 | 13 | terminal text on term-bg-deep |
| `term-fg-dim` on `term-bg` | 4.5 | 8.64 | 8.64 | terminal text on term-bg |
| `term-fg-dim` on `term-bg-deep` | 4.5 | 9.33 | 9.33 | terminal text on term-bg-deep |
| `term-edge` on `term-bg` | 4.5 | 9.32 | 9.32 | terminal text on term-bg |
| `term-edge` on `term-bg-deep` | 4.5 | 10.07 | 10.07 | terminal text on term-bg-deep |
| `term-desk-fg` on `term-bg` | 4.5 | 15.09 | 15.09 | terminal text on term-bg |
| `term-desk-fg` on `term-bg-deep` | 4.5 | 16.3 | 16.3 | terminal text on term-bg-deep |
| `term-white` on `term-bg-black` | 4.5 | 19.8 | 19.8 | text on near-black panel |
| `term-fg-soft` on `term-bg-black` | 4.5 | 11.9 | 11.9 | text on near-black panel |
| `term-fg-listing` on `term-bg-black` | 4.5 | 13.96 | 13.96 | text on near-black panel |
| `term-hex` on `term-bg-black` | 4.5 | 18.49 | 18.49 | text on near-black panel |
| `term-fg` on `term-bg-black` | 4.5 | 16.11 | 16.11 | text on near-black panel |
| `term-fg-muted` on `term-bg-black` | 4.5 | 9.07 | 9.07 | text on near-black panel |
| `term-white` on `term-bg` | 4.5 | 17.07 | 17.07 | terminal input text |
| `term-white` on `term-bg-deep` | 4.5 | 18.43 | 18.43 | terminal text |
| `term-fg-soft` on `term-bg` | 4.5 | 10.25 | 10.25 | terminal text |
| `term-fg` on `term-accent-tint-2` | 4.5 | 7.55 | 7.55 | text on highlighted node |
| `term-fg` on `term-bg-goto` | 4.5 | 13.32 | 13.32 | text on goto line |
| `term-fg` on `term-bg-row` | 4.5 | 13.74 | 13.74 | text on hovered row |
| `term-fg` on `term-bg-flat` | 4.5 | 12.94 | 12.94 | text on scene |
| `term-hex` on `term-bg-pre` | 4.5 | 16.78 | 16.78 | hex text on pre |
| `term-desk-fg` on `term-desk-bottom` | 4.5 | 16.35 | 16.35 | desk text |
| `term-on-accent` on `term-accent` | 4.5 | 14.83 | 14.83 | text on terminal accent |
| `term-line-strong` on `term-bg` | 3 | 4.91 | 4.91 | terminal border |
| `paper-ink` on `paper-bg` | 4.5 | 15.6 | 15.6 | text on paper |
| `paper-ink` on `paper-bg-2` | 4.5 | 13.81 | 13.81 | text on paper |
| `paper-ink` on `paper-card` | 4.5 | 15.32 | 15.32 | text on paper card |
| `paper-ink-2` on `paper-bg-3` | 4.5 | 8.77 | 8.77 | text on paper panel |
| `paper-ink` on `paper-bg-3` | 4.5 | 12.39 | 12.39 | text on paper panel |
| `paper-muted` on `paper-card` | 4.5 | 7.22 | 7.22 | muted text on paper card |
| `paper-muted` on `paper-bg` | 4.5 | 7.36 | 7.36 | muted text on paper |
| `paper-muted` on `paper-bg-2` | 4.5 | 6.52 | 6.52 | muted text on paper |
| `term-fg` on `term-accent-tint` | 4.5 | 11.18 | 11.18 | terminal text on highlighted line |

182 pairs per theme; 0 failures.

Pairs that could not reach their bar in light, by design (the table lists them as "light 1"): lime and yellow **fills** on white (`--color-accent`, `--color-diff-*` bars: 1.2 to 1.9:1). Lime and yellow cannot be 3:1 against white and still be lime; they are always drawn with the strong border (`--color-line`, 3:1 or better) and a text label. In dark every one of them passes 3:1. The light warning stripe (`--color-warn-border`, exact #d98e00, a decorative left stripe) is 2.7:1, so its light bar is 2.6. No text pair fails in either theme.


## 7. Where to look first (per-file notes)

| File group | Treatment |
|---|---|
| `terminal/terminal.css`, `demo/StepTerminal.css`, `demo/panels.css` | Always-dark window. Convert every literal and every `var(--color-ink)` background to `--term-*`. The ANSI palette maps to `--term-ok/warn/danger/info/violet/cyan/orange/accent`. The three `--tm-wash` alpha tints stay. |
| `components/crackme/*.css` | Listing, graph and debugger panels are always dark: `--term-*`. Game piece colours (`#f2c53d`, `#f2823d`) are art: keep. |
| `components/osint/osint.css`, `MapTab.jsx`, `Common.jsx`, `osint/helpers.js` | Cream paper, cork board, pins, map and strings are art that stays light in both themes: `--paper-*` for the structural paper colours, keep the rest. Dark desk gradient and `.os-pre`: `--term-*`. `.os-muted` on paper: `--paper-muted`. |
| `components/weblab/weblab.css` | The lab skins (pizza, retro-bank, hospital and vault: `[data-theme=...]` blocks that set `--t-*`) are fake target sites: keep. The severity badges, notices, diff lines and status chips are app UI: status tokens (map). Check each `.wl-frame` rule: inside the frame it is skin (keep), outside it is app chrome (tokens). |
| `demo/HopTrail.css`, `demo/ArchitectureDiagram.css` | Already use `var(--color-*, fallback)`: delete the fallbacks, the rest is done. They follow the theme (SVG diagrams on the page surface). |
| `pages/Leaderboard.css` | `--lb-series-N: var(--color-series-N)`; text and lines already tokens. |
| `components/admin/admin.css` | Chart colours `--adm-c1..4` to `--color-ink`, `--color-info`, `--color-ok`, `--color-danger`; overlay `--color-overlay`; warn and info tints to status tokens. |
| `overview.css`, `forensics.css`, `osint.css` | `--ov-accent`, `--fx-accent`, `--os-accent` per difficulty to `--color-diff-*`. |
| `EventBanner.css`, `AnnouncementBanner.css`, `ScoreboardFreezeNote.css` | Status tokens (info, ok, warn). |
| `terminal/Confetti.jsx`, `pages/socialHelpers.js`, `terminal/MatrixRain.jsx`, `forensics/PixelGrid.jsx` | Canvas brand pixels: keep. |
| `skills/skills.css` | `#fff` and `#000` are inside the print rules: keep. |

### Do not turn into tokens (and what to use instead)

- **Always-dark panels** (terminal window, code listings, hex panes, graph panels, the demo log): never `--color-*`; use `--term-*` (listed in section 2).
- **Always-light paper art** (OSINT cards, cork board, map): `--paper-*` or keep the literal.
- **Web Lab lab skins** (`--t-bg`, `--t-ink`, `--t-accent`, `--t-head`, `--t-line`, `--t-on-accent` for pizza, retro-bank, hospital, vault): each lab imitates a different website; they are content, not theme. Keep.
- **SVG and canvas art, confetti, matrix rain, medals, brand pixels (`PixelArt.jsx` already uses tokens), print rules, the QR code**: keep.
- **Crackme game pieces, OSINT pin tints and string colours**: keep.

## 8. How to test both themes

- **Unit:** `cd frontend && npm test` (theme helper including the pure `effectiveTheme` / `nextTheme` for System on a light and a dark device and invalid stored values, the transition suspension, token parity, contrast, flag sync, init script), `npx eslint src tests`, `npx vite build`.
- **In a browser** (no flag edits in the repo): copy the layout harness (`docs/harness`: stubbed auth and API, Vite on a free port), add a tiny Vite plugin that rewrites `DARK_THEME_ENABLED = false` in `src/theme/config.js` and `var ENABLED = false` in the served `/theme-init.js` to `true`, and drive it with `puppeteer-core`:
  - system theme: `page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])` before `goto`;
  - explicit theme: `page.evaluateOnNewDocument(() => localStorage.setItem('ctf.theme', 'dark'))`;
  - check `document.documentElement.getAttribute('data-theme')`, `getComputedStyle(document.body).backgroundColor` (`rgb(13, 17, 23)` dark, `rgb(244, 244, 241)` light) and the `theme-color` meta.
- **Toggle flicker check:** in the harness, start a `requestAnimationFrame` logger that records `data-theme`, the computed `background-color` of body, header and `.theme-btn`, the icon and the aria-label every frame, click the button (and press Enter or Space), and require ONE state change from the old to the new theme (a hover fill from the mouse may follow; screenshots taken while hovering can blink the hover colour, so log without them too). Do this for light to dark, dark to light and System with `prefers-color-scheme` light and dark.
- **Per page checklist (both themes, 1440 and 390 px):** no light panel or white text-on-white anywhere, lime fills carry dark text, hard shadows are the dim lime block, terminal and code panels still look like windows (border visible against the page), focus ring visible, forms and scrollbars dark (native controls follow `color-scheme`), status colours readable, no raw colour left (`grep -rEn '#[0-9a-fA-F]{3,8}\b|rgba?\(' frontend/src --include=*.css --include=*.jsx`, minus the keep list).
- **Contrast in the browser** (phase C): run an axe or computed-style pass per page; the token pairs here are the design-time guarantee, not a substitute.
- **Phase C flip:** change the two flag constants (section 1), run the full tests, and take screenshots of every route in light, dark and system.

## 9. Phase C results: shell, pages and admin (agent C2)

Scope: header, nav, menu, footer, theme toggle, Home, auth pages, The Range hub and the six overviews, Challenges list and detail, Leaderboard, Profile, Team, Fair play, Skills, Demo, 404, the error and empty and loading states, onboarding, hint ladder, debrief, event banner and freeze note, announcement banner and every admin section (drawers, settings forms, event panel, charts, tables). The play screens belong to the C1 audit. The flag is still `false` (a later step flips it).

Method: the stubbed-auth harness with a Vite plugin that forces both flag constants to `true` in the harness copy only (repo untouched), driven with puppeteer-core, theme `dark` stored in `ctf.theme`, reduced motion and a fixed `Date`. For every scene at 1440, 768 and 390 px: a full-page screenshot plus an in-browser audit that walks every visible text node (HTML and SVG), builds the real background from `elementsFromPoint` (ancestors composited with alpha, gradient stops taken worst case, an unknown `url()` image flagged), and flags text under 4.5:1 (3:1 for large text). It also checks placeholder colour, control borders and fills (3:1), a sample of up to 30 focusable elements per page for a visible focus ring (3:1), and light-coloured islands.

| Result | Value |
|---|---|
| Scenes (player, admin, anonymous; loading, empty and error states; banner and announcement variants; drawers) | 66 |
| Scene runs (scene x width) | 198 |
| Text nodes audited | 10,713 |
| Focusable elements checked for a focus ring | 3,656 |
| Failing text, first pass (1440 px only, 69 scenes) | 40 |
| Failing text after the fixes, all widths | 27, every one exempt (below); 0 non-exempt under 4.5:1 |
| Focus rings under 3:1 after the fixes | 0 |

First pass offenders and what they were: the Challenges group counters (`.ov-count`, ink on lime, 1.13:1, real, fixed); the Web Lab overview card focus ring (lime on the cream and teal skin panels, 1.24:1, real, fixed); the hero title (ratio 1, false positive: the corner brackets are a background gradient under the text, the title itself is 14:1); the leaderboard "your team" row (false positive: `elementsFromPoint` skips the `tr` that carries the lime fill, the row is lime with dark text, 14.8:1, verified in the screenshot and fixed in the audit); visually hidden `.ob-sr` spans (false positive); the event summary at 390 px (false positive: the text wraps beside the lime badge and the sample point lands on it).

The 27 remaining occurrences are 6 distinct controls that are exempt from WCAG 1.4.3 because they are inactive: the disabled Submit and Save buttons (challenge flag form, cipher answer, admin settings, event panel), the locked Cipher Lab tabs, and the "Clear the previous lab first." note inside a locked Web Lab card (the lab skin ink at 0.6 opacity; light has the identical ratio because the skin is fixed). Native `select` focus after programmatic `focus()` is reported as not focus-visible by the browser (a probe artifact, not a defect).

Fixes made:

| File | Selector | Change |
|---|---|---|
| `styles.css` | `:root`, both dark blocks | new token `--color-on-accent-muted` (`#55554f` in all three; contrast pairs added to `tests/helpers/themeCss.js`) |
| `demo/ArchitectureDiagram.css` | active node `.demo-arch__sub` | `--paper-muted` replaced by `--color-on-accent-muted` (muted text on the always-lime node; same grey, now a role token) |
| `overview.css` | `.ov-page .ov-count` | `color: var(--color-on-accent)` (ink was light on lime in dark) |
| `theme/theme.css` | `:is(.wl-track, .wl-frame) :focus-visible` | dark only: `outline-color: var(--t-ink)` so the focus ring uses the skin's own ink on the cream and teal Web Lab skins (the lime dark focus colour was 1.24:1 there) |
| `styles.css` | `.hero-title` corner brackets, `.site-header nav a.active` border | `--color-ink` to `--color-line` |
| `components/admin/admin.css` | `.adm-nav-link.active` border, `.adm-badge` border, `.adm-chart-cross`, `.adm-bar-accent` stroke, `.adm-timeline` rule, `.adm-preview` dashed border | `--color-ink` to `--color-line` |
| `pages/Leaderboard.css` | `.lb-axis line`, `.lb-crosshair` | `--color-ink` to `--color-line` |
| `demo/panels.css`, `pages/Demo.css`, `pages/FairPlay.css`, `components/EventBanner.css` | `.demo-ip-chip` border, `.demo-watch li::before` bullet, `.fp-help` dashed border, `.event-ended` stripe | `--color-ink` to `--color-line` |

Border-only uses of `--color-ink` (known gap 1): converted where the colour is structural (axes, crosshairs, brackets, badge and chip borders, dashed boxes, stripes, bullets, the border of a lime-filled active link) because a near-white hairline on dark reads brighter than the text it frames, and a light grey line on a lime fill nearly disappears. `--color-line` and `--color-ink` are both `#0a0a0a` in light, so light is byte-identical. Left as `--color-ink` on purpose: focus rings (a bright ring is the goal, 14:1 in dark), the hard border of inverse (ink-filled) controls, and the Range card top bars that fall back to ink.

Light identity: the affected pages (home, challenges, leaderboard, demo, fair play, hub, profile, team, Web Lab and Cipher Lab overviews, all admin sections, event banner states) were screenshotted in light at 1440 and 390 px from the current tree and from a copy of the tree with every edit above reverted, and compared pixel by pixel: 0 differing pixels except the account area of the header at 1440 px, which only differs because the harness forces the flag on (the toggle is rendered and the email is shortened, as designed). Identical at 390 px everywhere. A comparison against `HEAD` is not possible because other uncommitted work (device-compatibility layout changes) also differs from it.

Other checks: the header at 1101, 1130, 1160, 1161, 1200, 1280, 1366, 1440 and 1500 px, player and admin, light and dark, is one nav row and 78 px high everywhere with no horizontal scroll. The toggle cycles System, Light, Dark and the accessible name and the live status read "Theme: dark. Switch to system" and "Theme set to dark"; `ctf.theme` is stored (and removed for System); a reload keeps the stored theme; in System the page follows a live `prefers-color-scheme` change both ways; Enter and Space operate the button with a 3px lime focus ring (in dark); `<meta name="theme-color">` switches between `#ffffff` and `#151b23` and `<meta name="color-scheme">` between `light`, `dark` and `light dark`; at 390 px the toggle is a 44px-high full-width row inside the Menu panel and works there.

Known remaining limits: disabled and locked controls stay below 4.5:1 by design (WCAG exempts inactive controls; the disabled look is the same muted treatment in light); the primary and inverse controls are light fills with dark text in dark mode (`--color-ink` fill), which is the intended look and measures 14:1; the Range card top bars (`--ov-accent` falls back to ink) are bright in dark.

## 10. Known limits and open decisions

- **Header width.** The toggle is one 44px icon button inside `.account`, next to Logout (icon plus text, "Theme: System", only inside the mobile Menu panel). To keep the desktop nav on one row, `theme.css` shortens the email (ellipsised, with a `title`) from 150px to 96px while the toggle is present (`.account:has(.theme-toggle)`), and to just the status square between 1101 and 1160 px. Verified with the stub harness at 1101, 1130, 1160, 1161, 1280, 1440 and 1500 px, signed-in player (with a team name) and admin (widest nav): one nav row and an unchanged 78px header everywhere. A much longer team name, or a browser without `:has()` (before 2022-2023), can still wrap the nav; nothing breaks.
- **Light fills below 3:1.** Lime and yellow fills (`--color-accent`, the difficulty bar fills) cannot reach 3:1 against white. They are always drawn with the strong border and, for difficulty, a text label, so they are not colour-only. In dark they pass 3:1.
- **Selection colour** (`::selection`: lime with dark text) applies only when the flag is on, in both themes.
- **`color-mix` and `light-dark()`** are not used (older Safari and Firefox on phones); the duplicated blocks are the compatibility choice.
- Not tested on real devices (iOS Safari `theme-color` behaviour, Android automatic dark mode / force-dark).

### Update: account box and the footer line

The header now has an account box (initials) next to Logout and the theme switch, all at the same height. The three-option footer selector was replaced by `ThemeAuto`: nothing is shown while the device setting is in use; after a choice it shows "<Theme> is set. Use device setting". The stored values (`ctf.theme`: light, dark, or absent for the device setting) are unchanged.
