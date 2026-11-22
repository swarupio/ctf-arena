# Lighthouse and axe audit

Measured on 2026-11-22 with Lighthouse 13.6.0, axe-core 4.14.1 and Chrome 158 (headless), against a production build of the real frontend (real `index.html`, entry, chunking, the `vercel.json` cache and security headers, gzip) with the harness auth stub and API stubs (`docs/harness`). Numbers come from a laptop and stub data, not from Vercel: use them to compare before and after, not as an SLA. Lighthouse mobile = Slow 4G + 4x CPU (simulated), desktop = the Lighthouse desktop preset (simulated). "Before" is the tree as found at the start of this pass, "after" is this tree. One run per cell (a re-run moves LCP by about 50 ms and Performance by 1 point; CLS and the category scores are stable).

## Results (before -> after)

### mobile

| Page | Perf | A11y | Best practices | SEO | LCP ms | TBT ms | CLS | FCP ms | TTI ms | KB |
|---|---|---|---|---|---|---|---|---|---|---|
| / | 84 -> 98 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 2354 -> 2386 | 31 -> 58 | 0.282 -> 0 | 912 -> 914 | 2354 -> 2386 | 170 -> 171 |
| /login | 98 -> 99 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 2215 -> 2226 | 33 -> 35 | 0.061 -> 0 | 906 -> 909 | 2215 -> 2226 | 173 -> 166 |
| /range | 81 -> 82 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 2569 -> 2580 | 3 -> 46 | 0.319 -> 0.289 | 906 -> 910 | 2569 -> 2580 | 188 -> 190 |
| /challenges | 86 -> 98 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 906 -> 2350 | 49 -> 30 | 0.282 -> 0 | 906 -> 910 | 2055 -> 2350 | 171 -> 173 |
| /skills | 84 -> 98 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 2416 -> 2429 | 57 -> 49 | 0.282 -> 0 | 908 -> 915 | 2416 -> 2429 | 174 -> 176 |
| /leaderboard | 84 -> 98 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 2403 -> 2366 | 52 -> 30 | 0.282 -> 0 | 904 -> 906 | 2403 -> 2366 | 169 -> 170 |
| /demo | 83 -> 98 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 2511 -> 2482 | 32 -> 19 | 0.282 -> 0 | 906 -> 908 | 2513 -> 2482 | 186 -> 187 |
| /terminal/easy | 91 -> 93 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 913 -> 3199 | 92 -> 66 | 0.189 -> 0.001 | 913 -> 917 | 2612 -> 3199 | 226 -> 227 |
| /weblab/weblab-sqli-login | 84 -> 97 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 2434 -> 2593 | 42 -> 18 | 0.282 -> 0 | 954 -> 914 | 2434 -> 2593 | 187 -> 188 |
| /admin | 95 -> 95 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 2825 -> 2861 | 87 -> 68 | 0.024 -> 0.004 | 908 -> 909 | 2825 -> 2861 | 184 -> 185 |

### desktop

| Page | Perf | A11y | Best practices | SEO | LCP ms | TBT ms | CLS | FCP ms | TTI ms | KB |
|---|---|---|---|---|---|---|---|---|---|---|
| / | 97 -> 100 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 560 -> 553 | 0 -> 0 | 0.113 -> 0 | 249 -> 250 | 560 -> 553 | 170 -> 171 |
| /login | 100 -> 100 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 522 -> 516 | 0 -> 0 | 0 -> 0 | 248 -> 248 | 522 -> 516 | 173 -> 166 |
| /range | 93 -> 86 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 622 -> 620 | 0 -> 0 | 0.158 -> 0.273 | 373 -> 247 | 622 -> 620 | 188 -> 190 |
| /challenges | 100 -> 100 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 552 -> 524 | 0 -> 0 | 0.039 -> 0 | 246 -> 263 | 552 -> 524 | 171 -> 173 |
| /skills | 96 -> 100 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 563 -> 566 | 0 -> 0 | 0.127 -> 0 | 250 -> 252 | 563 -> 566 | 174 -> 176 |
| /leaderboard | 99 -> 100 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 558 -> 567 | 0 -> 0 | 0.064 -> 0 | 368 -> 369 | 558 -> 567 | 169 -> 170 |
| /demo | 96 -> 100 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 558 -> 554 | 0 -> 0 | 0.118 -> 0 | 245 -> 251 | 559 -> 554 | 186 -> 187 |
| /terminal/easy | 99 -> 100 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 746 -> 739 | 0 -> 0 | 0.073 -> 0 | 249 -> 376 | 746 -> 739 | 226 -> 227 |
| /weblab/weblab-sqli-login | 99 -> 100 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 622 -> 607 | 0 -> 0 | 0.078 -> 0 | 378 -> 253 | 622 -> 607 | 187 -> 188 |
| /admin | 76 -> 96 | 100 -> 100 | 100 -> 100 | 82 -> 100 | 574 -> 598 | 0 -> 0 | 0.889 -> 0.113 | 382 -> 248 | 574 -> 598 | 184 -> 185 |

### mobile, real (devtools) throttling, five slowest pages

| Page | Perf | LCP ms | TBT ms | CLS | FCP ms | KB |
|---|---|---|---|---|---|---|
| /range | 71 -> 72 | 3621 -> 3581 | 27 -> 15 | 0.316 -> 0.29 | 2454 -> 2331 | 188 -> 190 |
| /challenges | 81 -> 86 | 2381 -> 3683 | 0 -> 44 | 0.282 -> 0 | 2381 -> 2482 | 171 -> 173 |
| /terminal/easy | 84 -> 78 | 2393 -> 4811 | 39 -> 62 | 0.189 -> 0.001 | 2393 -> 2395 | 226 -> 227 |
| /weblab/weblab-sqli-login | 65 -> 79 | 4851 -> 4821 | 24 -> 16 | 0.282 -> 0 | 2351 -> 2404 | 187 -> 188 |
| /admin | 59 -> 68 | 5563 -> 5612 | 46 -> 41 | 0.351 -> 0.178 | 2297 -> 2362 | 184 -> 185 |


Reading the tables
- **CLS was the main finding.** On every page the footer sat at the bottom of the screen under an almost empty page while the lazy page chunk and its data loaded, then jumped out of view (0.28 on most mobile pages, 0.89 on desktop `/admin`). Fixed by keeping the footer invisible (it keeps its space) while a page chunk loads and for the first 2.5 s after start. Mobile CLS is now under 0.01 on 9 of 10 pages (`/range` 0.29, see below); mobile Performance went from 83-86 to 97-98 on the six pages that only had the footer shift.
- **LCP on `/challenges` (906 -> 2350 ms) and `/terminal/easy` (913 -> 3199 ms) is a measurement change, not a slowdown.** Before, the footer text was painted early (about 0.9 s) and was the largest candidate on pages whose real content is small text (the challenge list's loading line, the terminal prompt). Hiding the footer removes that false early candidate, so LCP now reports when the page content really appears. All other pages are within +-50 ms. FCP is unchanged (906-917 ms mobile). Under real (devtools) throttling `/terminal/easy` therefore shows Performance 84 -> 78 although nothing got slower.
- **SEO 82 -> 100** everywhere: `meta name="description"` and a real `robots.txt` were missing (the SPA fallback answered `/robots.txt` with `index.html`).
- Accessibility and Best practices were already 100 on every page and stay 100.
- Transfer: +1 to +2 KB per page (the new meta tags); `/login` -7 KB because its chunk no longer imports `aws-amplify/auth` statically (in this harness build only that part of amplify existed; in the real build the whole 40 KB gzip chunk leaves the first load, see below).
- `/range` still has CLS 0.29 (mobile) and 0.27 (desktop). That is the stub: the demo player has captured every first flag, and the "Capture your first flag" checklist renders expanded while its progress loads, then collapses to one line (1343 px -> 159 px). A player who has not cleared the Range does not see that collapse. The fix belongs in `onboarding/FirstFlagChecklist.jsx` (render the collapsed row until `progress.loaded`, or remember the cleared state); not changed here (the owner decides how it looks while loading).
- `/admin` CLS 0.113 desktop and 0.178 under devtools throttling: the stat cards (`.adm-stats`) change height when their data arrives (374 px skeleton, 262 px loaded at 412 px width). Reserve the height in `admin.css` if it matters; not changed (shared admin CSS, other agents editing).
- Remaining Lighthouse opportunities are small: `unused-javascript` (react-dom is 223 KB and about 35% of it runs on any page; unavoidable with React 19), `render-blocking-insight` (the 8 KB gzip stylesheet and the 1.5 KB `theme-init.js`, which must run before first paint to avoid a theme flash) and `network-dependency-tree-insight` (informational). `forced-reflow-insight` on the terminal pages comes from the typing animation measuring layout (it shifts nothing: CLS 0.001).

First-load JS for a signed-out visitor (entry + react + router, real build, gzip level 6): 136.4 KB -> **99.5 KB** (the 39.6 KB `amplify` chunk is no longer referenced from `index.html`).

Per-route JS coverage (puppeteer coverage API, mobile viewport, after): `/` 37% of 327 KB executed (react 77 KB of 223 KB, router 15 of 40, entry 21 of 40), `/login` 36%, `/range` 40%, `/challenges` 38%, `/leaderboard` 40%, `/admin` 40%, `/terminal/easy` 53% of 454 KB. The unexecuted part is dominated by react-dom and the router (framework paths a page never takes), not by app code, so further route splitting would not pay off; the biggest route chunk (TerminalPlay, 33 KB raw) is 42% unexecuted until commands are typed and stays as is (splitting it would add a request before the terminal is usable).

## axe-core (WCAG 2.1 A and AA plus best practices), every page state of `docs/harness/pages.cjs`, light and dark (41 states x 2)
| Rule (impact) | Before | After | Note |
|---|---|---|---|
| label-content-name-mismatch (serious) | 102 | 98 (all allowlisted) | `aria-label` is a full spoken sentence on purpose (Crackme listing rows and graph nodes, Web Lab cards, terminal mail chip); the two cheap ones are fixed (terminal Hints button, Crackme Prev button) |
| color-contrast (serious) | 33 | 3 (allowlisted) | the Web Lab locked-card chips were fixed by the parallel theme work during this pass; left: Crackme listing address text (3.9:1) and xref text (2.6:1 in light) on the dark code panel |
| empty-table-header (minor) | 84 | 84 | stub artifact: the screen-reader chart tables get an empty day label because the stub series has no `day` field; the real API sends one |
| landmark-unique (moderate) | 10 | 6 | admin overview Panels: three `section[aria-labelledby]` the rule reports as not distinguishable; not changed (Panel is shared) |
| aria-allowed-role (minor) | 4 | 0 | the admin Drawer was `<aside role="dialog">`; now `<div role="dialog">` |
| landmark-no-duplicate-banner (moderate) | 4 | 0 | the Drawer's `<header>` counted as a second banner; now a `<div>` |
| heading-order (moderate) | 2 | 2 | the admin challenge drawer jumps from h2 to h4 (`.adm-h4`); changing the tag needs a CSS check, not changed |

"After" is the raw count before the allowlist. With the allowlist at the top of `axe.cjs` (each entry has its reason), `node docs/harness/axe.cjs` reports no serious or critical violation and exits 0. The "before" colour-contrast count includes fixes by other agents made while this pass ran, so it is not all this pass's work. Distinct titles: the 41 states give 36 distinct document titles (levels and drawers share their route's title); before, every state was "CTF Arena".

## What changed (and why)
| File | Change | Reason |
|---|---|---|
| `frontend/index.html` | `meta description`, `robots`, Open Graph title and description, `apple-touch-icon` | SEO 82 -> 100; iOS home-screen icon |
| `frontend/public/robots.txt` (new) | allow all, disallow `/api/` | the SPA fallback served `index.html` as `robots.txt` (an invalid robots file) |
| `frontend/public/apple-touch-icon.png` (new, 613 bytes) | 180x180 render of `favicon.svg` | iOS ignores SVG icons |
| `frontend/src/components/DocumentTitle.jsx` (new), `src/App.jsx` | `lazyPage(element, title)` sets `document.title` to "<page> · CTF Arena" for every route and the 404 page | every route had the same title (WCAG 2.4.2; screen readers read the title on navigation) |
| `frontend/src/components/PageFallback.jsx`, `pageFallback.css` (new) | footer hidden (visibility, its space is kept) while a page chunk loads and for the first 2.5 s | CLS 0.28 -> 0; under `prefers-reduced-motion` the delay is off |
| `frontend/src/auth/session.js`, `amplifyAuth.js`, `config.js` (new); `AuthContext.jsx`, `token.js`, `amplify.js`, `pages/AuthPages.jsx` | `aws-amplify` (39.6 KB gzip) is no longer in the first load: a visitor with no `CognitoIdentityServiceProvider.*` key in localStorage is signed out without loading it. It loads when a stored session must be restored (at once, as before), when a sign-in form opens (`preload`) and on the first auth call | -37 KB gzip first-load JS for signed-out visitors. Behaviour kept: one memoised `loadAuth()` serves sign up, confirm, sign in, MFA, reset password, sign out, Hub events and `getToken()`; signed-out API calls send no `Authorization` header exactly as before (`getToken()` returned null). `AuthProvider` now starts with `loading` false when nothing is stored (no "Loading..." flash in the header). Checked in a browser against the real build: signed-out `/` requests no amplify file; `/login`, a protected route (redirects to `/login`) and any stored Cognito key do load it |
| `frontend/src/components/admin/Drawer.jsx` | `aside` -> `div`, `header` -> `div` (role="dialog" stays) | axe: aria-allowed-role, duplicate banner |
| `frontend/src/terminal/HintBar.jsx`, `components/crackme/AnalysisView.jsx` | accessible names now start with the visible text ("Hints: ...", "Prev: ...") | WCAG 2.5.3 label in name (voice control: "click Hints") |
| `deploy/bundle-size.mjs` | fails when `index.html` references an `amplify-` chunk | guards the auth deferral |
| `docs/harness/perfserver.cjs`, `vite.perf.config.js`, `lighthouse.cjs`, `axe.cjs` (new) | the audit tooling | see "How to run" |

Tried and reverted: `<link rel="manifest">` plus 192/512 px icons. Chrome fetches the manifest at load, and under Lighthouse's simulation it cost about 140 ms of LCP on every page, for a feature the app does not use (no service worker, no install flow). Add it back together with a service worker if an installable app is wanted.

Checked, nothing to fix: fonts (both woff2 preloaded, `font-display: swap`, 13 KB + 31 KB, latin subset); `vercel.json` caching (`/assets/*` and `/fonts/*` immutable for a year, everything else `no-cache`, hashed file names verified in the build output; a missing asset is a 404, not `index.html`); CSP (the harness server sends the real CSP and the console stays clean; no inline scripts or styles added); no cross-origin API (same-origin `/api`), so no preconnect; no `will-change`, no scroll, touch or wheel listeners; the only `requestAnimationFrame` loop (Matrix rain) stops after 4 s and browsers pause rAF in hidden tabs; timers are cleaned on unmount (see `docs/PERFORMANCE.md`); no images besides the icons; `content-visibility` on the list pages was not added (the lists are tens of rows; scroll-jump and find-in-page risk outweighs the gain).

## Not fixed, and why
- **Announcement banner and event bar** render above the header once `/api/announcement` and `/api/event` answer, so a live announcement pushes the page down by one bar height. The stub returns none, so Lighthouse does not see it. Reserving height would leave a blank bar on every page without an announcement; an overlay would cover the header. If it matters: remember in `sessionStorage` whether the last visit had a banner and reserve that height until the first answer.
- `/range` and `/admin` CLS, label-in-name on the designed long labels, Crackme listing contrast, `empty-table-header` (stub), admin `landmark-unique` and `heading-order`: see the tables.
- The shipped `index.html` still carries the comment `TODO(dev): remove before release. internal debug endpoints still enabled on staging: /api/internal/debug/flags (no auth), /api/internal/config`. Vite keeps HTML comments, so every visitor can read it. Remove it (and the endpoints if they are still reachable) before release; not touched here (not a performance item).
- The harness build has no amplify chunk (auth is stubbed), so the tables are for a signed-out visitor after the deferral. A signed-in visitor still downloads amplify (about 40 KB gzip) in parallel with the first page; the real build shows it as `amplify-*.js`, reached through `amplifyAuth-*.js`.

## How to run (regression guard)
The tools are not project dependencies: install them in a scratch folder, never in `frontend/` or `backend/`.
```bash
# once: tools (outside the repo)
mkdir -p <tools> && cd <tools> && npm init -y && npm i lighthouse axe-core puppeteer-core
# 1. production build of the real frontend with stubbed auth (never into frontend/dist)
cd docs/harness && node ../../frontend/node_modules/vite/bin/vite.js build --config vite.perf.config.js --outDir <scratch>/dist-harness --emptyOutDir
# 2. accessibility: every page state, light and dark; exit 1 on a serious or critical violation that is not in the ALLOWLIST at the top of axe.cjs
DIST=<scratch>/dist-harness PERF_TOOLS=<tools> node axe.cjs              # SUMMARY=1 counts only, THEMES=light, ONLY=home,login
# 3. Lighthouse: 10 pages, mobile and desktop, prints the table
DIST=<scratch>/dist-harness PERF_TOOLS=<tools> node lighthouse.cjs       # PRESETS=mobile ONLY=/,/login THROTTLING=devtools OUT=result.json
```
`PERF_TOOLS` is the folder whose `node_modules` has `lighthouse`, `axe-core` and `puppeteer-core`. `CHROME` overrides the Chrome path and `PORT` the port (the scripts start their own static server, `perfserver.cjs`, which also answers `/api` from `data.cjs`, `ovdata.cjs` and `playhandler.cjs`). In Git Bash on Windows prefix the command with `MSYS_NO_PATHCONV=1` when an `ONLY` value starts with `/`. An allowlist entry in `axe.cjs` needs its reason on the same line; keep the list short.
Targets for a green run: Accessibility, Best practices and SEO 100, CLS under 0.1 on every page except the two noted above, no serious axe violation. Run it after a CSS or layout change; axe takes about 3 minutes, Lighthouse about 8.
