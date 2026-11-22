# Device and display-size compatibility

Verified with headless Chrome device emulation (puppeteer `KnownDevices` plus custom profiles) against a production build with stubbed auth and API data. 41 page states per device: home (signed out and in), 6 auth pages, Range hub, 6 overview pages, 6 play screens, challenges, 2 challenge details, leaderboard, profile, team, fair play, demo, 11 admin states (incl. drawers).

Devices: iPhone SE (320x568), iPhone 390x844, iPhone 14 Pro Max (430x739), Pixel 7 (412x915, custom profile), Galaxy S9+ (320x658), iPad Mini (768x1024), iPad Pro 11 (834x1194), each portrait and landscape; desktop 1366x768, 1920x1080, 2560x1440, 3840x2160. Extra passes: 200% zoom (half-width viewport, DPR x2) and root font-size 20px.

## Matrix (after this pass)

`pass` = no horizontal overflow, nothing off-screen, all targets >= 44px, inputs >= 16px. `fixed` = failed the touch checks before, passes now. `limit` = passes except for the known limits below (none at the moment).

| Page family | phone portrait | phone landscape | tablet portrait | tablet landscape | desktop (1366-3840) |
|---|---|---|---|---|---|
| Home (signed out and in) | fixed | fixed | fixed | fixed | pass |
| Auth (login, signup, confirm, forgot, MFA) | fixed | fixed | fixed | fixed | pass |
| Range hub | fixed | fixed | fixed | fixed | pass |
| Six overview pages | fixed | fixed | fixed | fixed | pass |
| Play screens (one per category) | fixed | fixed | fixed | fixed | pass |
| Challenges list | fixed | fixed | fixed | fixed | pass |
| Challenge detail | fixed | fixed | fixed | fixed | pass |
| Leaderboard | fixed | fixed | fixed | fixed | pass |
| Profile | fixed | fixed | fixed | fixed | pass |
| Team | fixed | fixed | fixed | fixed | pass |
| Fair play | fixed | fixed | fixed | fixed | pass |
| Demo | fixed | fixed | fixed | fixed | pass |
| Admin sections | fixed | fixed | fixed | fixed | pass |

Horizontal overflow and off-screen elements were already 0 on every device before this pass (earlier layout work) and stay 0.

## Counts, before -> after (touch devices, 574 page loads)

| Metric | Before | After |
|---|---|---|
| Page loads with a target under 44px | 573 of 574 | 0 (follow-up pass; was 21) |
| Targets under 44px (total) | 6458 | 0 (follow-up pass; was 462: 448 Crackme memory-cell widths, 14 terminal input) |
| Page loads with a text field under 16px (iOS focus-zoom) | 314 | 0 |
| Sticky/fixed UI taller than 35% of a landscape phone (excluding modal drawers) | 14 admin pages | 0 |
| Overflow, off-screen, JS errors | 0 / 0 / 0 | 0 / 0 / 0 |
| Root font 20px (164 loads on SE, 14 Pro Max, iPad Mini, 1366) | n/a | 0 overflow, 0 off-screen |
| 200% zoom on desktop 1366/1920 and iPad Mini | n/a | 0 overflow |
| 200% zoom on a 430px phone (215 CSS px) | 4 pages overflow by 5-25px | 0 overflow (41 pages) |
| Terminal log height on iPhone SE landscape (320px high) | about 140px (44%) | 227px (71%) |
| Narrow zoom floor, pages (of 41) scrolling sideways at 320 / 240 / 200 / 180 / 160 CSS px (touch, DPR 2; DPR 3 gives the same) | 0 / 0 / 3 / 7 / 14 | 0 / 0 / 0 / 0 / 0 |
| Same with a mouse pointer (no touch rules) at 240 / 200 / 160 CSS px | 0 / 0 / 2 (Forensics and OSINT "Check answer" button) | 0 / 0 / 0 |

Worst offenders before: secondary/small buttons (36px, e.g. Menu toggle), Crackme memory cells (25x28) and instruction rows (28), admin sort buttons (19), forensics packet rows (22), brand link (38), standalone links such as "Open" and "Back to ..." (26), selects (36), terminal chips (40), tabs (40).

## Large screens

| Viewport | Root font | Content width | Side gutter | Smallest text |
|---|---|---|---|---|
| 1366 | 16px | 1160 | 103 | 11px |
| 1920 | 18px | 1305 | 308 | 12.4px |
| 2560 | 20px | 1450 | 555 | 13.8px |
| 3840 | 24px | 1740 | 1050 | 16.5px |

The whole layout is rem based (spacing tokens, content widths) and `html` font-size steps up at 1800, 2400 and 3200px, so line length, gutters and text scale together. Admin uses 97.5rem (1755px at 1920, 2340px at 3840) and the header, banner and footer follow the same width so they line up with the dashboard.

## What changed (summary)

- `index.html`: `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content` (zoom is not disabled); `theme-color` matches the white header; `color-scheme: light`.
- Safe-area insets (`--safe-*` tokens) on main, header, footer, banner, admin overlay, drawer, toasts and the celebration toast.
- `dvh` with `vh` fallback on every viewport-height cap.
- Touch (`pointer: coarse`): 44px minimum for buttons, links that stand alone, tabs, summaries, fields; checkbox rows; 16px text fields; `touch-action: manipulation` on controls, `pan-y` on range sliders and admin charts; scroll-margin on fields; pressed state for `hover: none`.
- Every `:hover` rule wrapped in `@media (hover: hover)` (no sticky hover after a tap).
- Forensics virtual rows are 44px on touch; pixel grid reads on pointer down (touch) as well as hover.
- Landscape phones (`max-height: 520px`): sticky side panels become static, terminal window fits the screen, hero shrinks.
- Cheap performance: dropped animated `box-shadow` transitions on cards; auto-fill grids use `min(Npx, 100%)`.

## Interaction checks run

- OSINT pinboard: a touch drag (touchStart/Move/End on iPhone 14 Pro Max profile) moved a pin; `touch-action: none` confirmed.
- On-screen keyboard simulated by shrinking the viewport to 55% height (iPhone SE and 14 Pro Max): terminal input, Crackme answer, OSINT search and Forensics answer fields stay inside the viewport; terminal window follows `dvh`.
- Menu toggle opens and every nav link is visible and inside the viewport at 320, 568 landscape, root font 20px, 200% zoom and at the 1100px breakpoint.
- Admin dialogs and drawers scroll (`overscroll-behavior: contain`, `max-height` in `dvh`).

## Fixed in the follow-up pass

1. Crackme memory grid: on touch the grid is a sideways-scrolling region (snap, soft edge shadow, visible "Swipe sideways" hint, focusable region) with 44x44 cells; desktop keeps the compact grid. Buttons and keyboard access are unchanged.
2. Terminal: the prompt row is 44px tall on touch (log tap still focuses the input). In short landscape (max-height 520px) the title bar shrinks, the quick-command chips scroll sideways in one row and the window fills the screen: log 227px of 320px on iPhone SE landscape. The HUD stays collapsed under the terminal.
3. Hover-only `title=` tooltips: truncated values now wrap on touch (header e-mail, Web Lab address bar, terminal status, Demo phase names and hop titles), locked Cipher Lab and Web Lab tools list their unlock reason as visible text, badge descriptions and the admin signal-kind help use the new tap-to-open `components/Info.jsx` (aria-expanded, Escape closes, no focus trap). `title=` stays only as a bonus. Left as is because the same information is on screen: Crackme cell titles (decimal value shown, hex only in the title), `Stamp` times (zone offset shown), Demo shortcut hints (visible button labels).
4. Wording: "Hover the picture to read a pixel" is now "Tap or hover the picture to read a pixel. A tap keeps it selected" and the chosen pixel is outlined on the canvas; "Click" became "Tap or click" in the Crackme debugger, log viewer, OSINT board and map; the scrubber text says "Move the slider".
5. Forensics timeline: reordering by HTML5 drag is mouse-only; the Up/Down buttons are 44px on touch and a visible tip says to use them. The OSINT pinboard uses pointer events and drags by touch (checked with touchStart/Move/End).
6. 200% zoom on a 430px phone (215 CSS px): the four overflowing pages (MFA setup, MFA, Crackme, Demo) now have 0 overflow. Headings wrap anywhere, the Demo terminal strip wraps, the Crackme instruction table scrolls inside its own box and the scrubber stacks below 320px.

## Fixed in the narrow-zoom pass

Goal: the document never scrolls sideways at 160 CSS px and up (a 360px phone at 200% zoom is 180px, a Galaxy S9+ at 200% is 160px; 150% is 240px). The 14 failing pages at 160px were Home (both), MFA setup, Range hub, Cipher Lab, Reversing and Web Lab overviews, Crackme, Forensics and OSINT play screens, leaderboard, team, Demo and admin settings (found with the harness at 320, 240, 200, 180 and 160px, DPR 2 and 3).

- `styles.css` (block at the end): below 260px, `body { overflow-wrap: anywhere }`, every element may shrink (`body :where(*) { min-width: 0 }`, zero specificity so component rules still win) and `.tag` wraps. This alone cleared 9 of the 14 pages (a long word such as "Self-Modifying Cabin", an e-mail address or an invite code can no longer set the minimum width of a grid or flex column).
- Leaderboard: the standings table sits in `div.lb-scroll` (`role="region"`, `aria-label="Team standings table"`, `tabindex="0"`, `overflow-x: auto`) and keeps a 16rem minimum below 260px, so it scrolls inside its own box. This is the only JSX change made for layout.
- `forensics.css`: the suspect label (`dt`) may shrink. `panels.css`: the Demo scoreboard row and score column fit 160px. `Leaderboard.css`: the scroll box, `.lb-you` wraps.
- `.fx-answer button` and `.os-answer button` had `min-width: 140px`, which only the touch rule (`min-width: 44px !important`) hid; with a mouse a narrow window overflowed. Now `min(140px, 100%)`.
- Wide content that stays wide (Crackme instruction table, hex and packet tables, graphs) scrolls inside its own box, as before.

Below 160px (300% zoom on a 360px phone is 120px) was not a target and was not tested.

## Terminal on short landscape phones

The 568x320 overflow one agent reported was re-checked with `terminal.cjs` (touch profile, DPR 2): Arena Terminal in easy, medium and hard at 568x320, 667x375, 740x360, 844x390, 896x414, 932x430 and 320x568 portrait, after 6 commands, with the HUD open, after `Hints` and `Next hint`, and with the keyboard simulated (viewport height x 0.55). Result: 105 of 105 stages have no sideways scroll and nothing off-screen, and the input row stays in view every time. The report was not reproduced as a horizontal overflow. The page does scroll vertically (page height 996-2388px against 320-568px) because the HUD sits below the terminal window by design; the window itself ends inside the screen (bottom at 312-316px for 568x320, 371 for 667x375, 356 for 740x360, 386 for 844x390, 410 for 896x414, 426 for 932x430, 504 for 320x568). With the keyboard open the window keeps a floor of 13rem (208px), so on a 568x320 phone (176px left) its bottom is at 212px, about 36px below the visible area: the page scrolls and the prompt stays visible. No fix needed.

## Known limits

1. Below 160 CSS px (300% zoom on a 360px phone) was not tested or targeted.
2. Small decorative labels (tags, table headings, chart axes) stay at 10-11px on phones; they are not interactive.
3. `title=` on packet fields ("Adds: ...") is a hover bonus only; the same action is the visible "Filter on this value" button.
4. Large lists without virtualisation: leaderboard (all teams), challenge list, admin tables (paged 25 at a time), OSINT evidence lists (paged). Fine up to a few hundred rows; the Forensics log, hex and packet viewers are virtualised.
5. Not testable here: real iOS Safari (safe-area insets, 100dvh with the toolbar, focus zoom), real touch feel, real keyboards, Android Chrome resize behaviour. WebKit and Firefox were run (see "Cross-engine results"), but WebKit on Windows is the engine, not Safari on iOS.

## Cross-engine results

Playwright (WebKit and Firefox, installed outside the repo, not a dependency) against the same stubbed-auth pages: `docs/harness/engines.cjs`. 24 page states per device: home (both), login, signup, MFA, Range hub, six overviews, six play screens, leaderboard, profile, team, skills, admin overview and settings.

| Engine / device | Overflow | Off-screen | JS errors | Targets under 44px | Inputs under 16px |
|---|---|---|---|---|---|
| WebKit iPhone 13 (390x664) | 0 | 0 | 0 | 0 | 0 |
| WebKit iPhone SE (320x568) | 0 | 0 | 0 | 0 | 0 |
| WebKit iPad Mini (768x1024) | 0 | 0 | 0 | 0 | 0 |
| WebKit iPhone 13 landscape (750x342) | 0 | 0 | 0 | 0 | 0 |
| Firefox 320x568, 412x915, 1366x768 | 0 | 0 | 0 | n/a (no coarse pointer) | n/a |
| WebKit and Firefox at 160px wide | 2 pages before the `min(140px, 100%)` fix, 0 after | 0 | 0 | n/a | n/a |

Feature support, both engines: `:has()`, `color-mix()`, `subgrid`, `min()`, `dvh` and `env(safe-area-inset-*)` are supported; `100dvh` equals the inner height; `@media (hover: hover)` is false on the WebKit touch devices and true on Firefox, as expected; `touch-action: manipulation` is applied to buttons. Findings:

- WebKit logs "Viewport argument key interactive-widget not recognized and ignored". It is harmless (Safari resizes the visual viewport instead); the fields were already checked with a shrunk viewport.
- The only console error in any engine is a React dev warning on the admin overview ("Each child in a list should have a unique key", `SvgLineChart`), probably caused by repeated stub chart labels; it was not changed here.
- The one layout bug found was not engine specific: the fixed `min-width: 140px` answer buttons (above), visible with any non-touch pointer at 160px.

Limits: Playwright WebKit on Windows is the WebKit engine, not Safari on iOS. It has no real toolbar (so no 100dvh change while scrolling), no on-screen keyboard, no safe-area insets (`env()` resolves to 0) and no real touch. Firefox for Android and Samsung Internet were not available.

## Reduced motion, data, colour scheme

- `prefers-reduced-motion`: one global rule in `styles.css` turns off every CSS animation and transition; JS animations also honour it (matrix rain, terminal spinner, demo terminal, confetti hidden).
- No `prefers-reduced-data` handling; fonts are two preloaded woff2 files and there are no images to defer.
- Dark theme: the foundation (tokens, toggle, no-flash script, flag, tests) now exists behind a flag; see `docs/THEMING.md`. Original estimate of what it would take: (1) define a dark token set under `@media (prefers-color-scheme: dark)` and switch `color-scheme` and the `theme-color` meta (with `media`); (2) replace about 354 hard-coded hex colours in 20 CSS files (largest: terminal 65, weblab 47, osint 34, demo diagram 32, demo terminal 30, HopTrail 26) plus 7 files with `rgba()` and about 15 colour literals in JSX with tokens; (3) invert the hard black `--shadow-hard`/dotted background (lime shadows on dark); (4) pixel art SVGs and the QR code (needs a light quiet zone) and chart palettes; (5) re-check contrast for lime text and tags, and the already-dark terminal/crackme panels so they stay distinct from the page. Roughly 1-2 days.

## Re-running the checks

The harness is in `docs/harness/` (not run by `npm test`, because `puppeteer-core` is not a dependency and was not added). It is the real frontend served by Vite with stubbed auth and API answers, plus Puppeteer scripts: `run.cjs` (overflow, off-screen, touch-target and font counts for 41 page states on any device profile), `touch.cjs` (touch drag, on-screen keyboard), `menu.cjs` (Menu toggle). Nothing talks to a database or Cognito.

```bash
# 1. a throwaway puppeteer-core outside the repo, plus any Chrome
mkdir /tmp/pptr && cd /tmp/pptr && npm init -y && npm i puppeteer-core
# 2. the stubbed dev server (pick a free port)
cd docs/harness && PORT=5480 node ../../frontend/node_modules/vite/bin/vite.js --config vite.config.js
# 3. in another shell, from docs/harness
export PUPPETEER_CORE=/tmp/pptr/node_modules/puppeteer-core CHROME=/path/to/chrome PORT=5480
TAG=run CFG="iPhone SE,iPhone SE landscape,iPad Mini" node run.cjs      # all 41 pages per device
MODE=zoom CFG="iPhone 14 Pro Max" node run.cjs                         # 200% zoom (half-width viewport, DPR x2)
MODE=font20 CFG="iPhone SE" node run.cjs                               # root font 20px
ONLY=play-reversing,terminal node run.cjs                              # page filter
```

Results go to `docs/harness/out/<TAG>/results-*.json` (git-ignored) with one entry per page and device: `sw` against `cw` (overflow), `off` (off-screen elements), `small` (targets under 44px), `inputsUnder16`. Pass means `sw <= cw` and empty `off`, `small` and `inputsUnder16` on touch profiles. `CFG` names are the keys in `run.cjs` (iPhone SE, iPhone 14 Pro Max, Galaxy S9+, Pixel 7, iPhone 390, iPad Mini, iPad Pro 11, each with ` landscape`, and `desktop 1366|1920|2560|3840`). Desktop profiles have a fine pointer, so the touch-only 44px rules do not apply there. `playhandler.cjs` imports the backend generators read-only to fake play-screen data; if a backend module is renamed, fix its imports there.

Regression guards (run before a release; each should report 0 overflow). A page passes when `sw <= cw` and `off` is empty; `pages.cjs` holds the 41 page states shared by `run.cjs` and `engines.cjs`.

```bash
# narrow zoom: 41 pages at 320, 240, 200, 180 and 160 CSS px wide (DPR 2 and 3, touch) and 240/200/160 with a mouse pointer
TAG=narrow CFG="narrow 320 x2,narrow 240 x2,narrow 200 x2,narrow 180 x2,narrow 160 x2,narrow 160 x3" node run.cjs
TAG=narrow-fine CFG="narrow 240 fine,narrow 200 fine,narrow 160 fine" node run.cjs
# Arena Terminal: 3 modes x 7 sizes (568x320 ... 932x430 landscape, 320x568) x 5 stages (loaded, 6 commands, HUD, hints, keyboard); exits 1 on any overflow
node terminal.cjs
# WebKit and Firefox (Playwright outside the repo: npm i playwright; PLAYWRIGHT_BROWSERS_PATH=/tmp/pw/browsers npx playwright install webkit firefox)
PLAYWRIGHT=/tmp/pw/node_modules/playwright PLAYWRIGHT_BROWSERS_PATH=/tmp/pw/browsers ENGINES=webkit,firefox node engines.cjs
NARROW=160,200 PLAYWRIGHT=/tmp/pw/node_modules/playwright PLAYWRIGHT_BROWSERS_PATH=/tmp/pw/browsers node engines.cjs   # same pages at narrow widths
```
