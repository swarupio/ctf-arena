# Frontend performance

Measured on 2026-11-22 with `vite build` (Vite 6.4.5), sizes in bytes (raw / gzip level 6, via node `zlib`). Client only; no API change.

## What changed
| Change | Where | Effect |
|---|---|---|
| `vite build` no longer ships React's development build. The repo-root `.env` (shared with the backend) has `NODE_ENV=development` and `envDir` points at it, so Vite built in development mode on any machine with that file | `frontend/vite.config.js` (empty `VITE_USER_NODE_ENV` on `build`) | total JS 1.87 MB -> 1.18 MB raw, 493 KB -> 401 KB gzip; entry 54.7 KB -> 36.2 KB raw |
| Router in its own vendor chunk (`router`), separate from `react` | `vite.config.js` `manualChunks` | long-cacheable files; a router bump no longer evicts react-dom |
| Every route is `React.lazy` with its own `Suspense` inside the layout (header stays mounted); the fallback stays empty for 250 ms, so a fast chunk never flashes "Loading..." and a slow one shows an accessible `role="status"` | `src/App.jsx`, new `src/components/PageFallback.jsx` | no layout flash; admin children also lazy-wrapped |
| Debrief text (~90 KB, 31 KB gzip) is a separate chunk fetched only when a debrief can show (captured, admin, or event ended). Level lookups moved to `debrief/levels.js` (re-exported by `entries.js`, tests unchanged); `Debrief.jsx` is now a thin shell over `DebriefView.jsx` | `src/debrief/*`, `keyById` import line in CipherLabPlay, CrackmeLevel, WebLabPlay | play screens and Challenge detail: -31 KB gzip transferred until a capture |
| Event clock stops ticking (and re-rendering) while the tab is hidden and catches up on return | `src/event/useEventClock.js` | no hidden-tab renders |

## Numbers
Build output (real `.env`, production build after the fix). "Before" is the tree as found.

| | Before | After |
|---|---|---|
| Entry chunk `index` | 54,743 / 14,598 gz | 36,223 / 13,251 gz |
| First load JS (entry + react + router + amplify) | 667,551 / 197,703 gz | 441,204 / 136,417 gz |
| Total JS (all chunks, 73 / 76 files) | 1,867,147 / 493,473 gz | 1,177,436 / 401,287 gz |
| Total CSS | 208,527 / 50,164 gz | 210,595 / 50,726 gz |
| `react` (react-dom, scheduler) | 470,713 / 143,529 gz | 223,223 / 69,242 gz |
| `router` | in `react` | 39,663 / 14,348 gz |
| `amplify` (aws-amplify core + auth) | 142,095 / 39,576 gz | 142,095 / 39,576 gz |
| `qrcode` | 16,678 / 6,278 gz | 16,678 / 6,277 gz |

First-load JS per route (gzip, entry closure + the route's static chunks):

| Route | Before | After |
|---|---|---|
| Home | 208,111 | 145,945 |
| Challenge detail | 237,998 | 140,490 |
| Leaderboard | 203,870 | 141,827 |
| Skills | 210,795 | 148,924 |
| Terminal play | 254,860 | 161,129 |
| Cipher Lab play | 257,562 | 162,448 |
| Web Lab play | 249,914 | 155,524 |
| Forensics case | 269,689 | 168,502 |
| Crackme level | 259,848 | 164,521 |
| OSINT case | 260,437 | 159,007 |
| Demo | 222,510 | 159,085 |
| Admin overview | 213,412 | 150,360 |

Largest route chunks after: Forensics case 25.0 KB gzip, Demo 22.7 KB, Crackme level 16.0 KB, OSINT case 15.1 KB, Cipher Lab play 14.1 KB, `DebriefView` 31.4 KB (loaded on demand).

Browser run (Chrome headless, cache off, CPU 4x, network 1.6 Mbit/s down, 150 ms RTT (Lighthouse "Fast 3G"), stubbed auth and API, gzip server, median of 3). Both columns are production builds, so this isolates the code changes from the NODE_ENV fix. Page content is stub data: Leaderboard, OSINT, Forensics and Crackme render empty with the stub, so their numbers are bytes and script cost only.

| Page | KB transferred before -> after | Script ms before -> after | DCL ms before -> after | LCP ms before -> after |
|---|---|---|---|---|
| `/` | 205 -> 206 | 438 -> 405 | 3502 (cold outlier) -> 1506 | 4600 -> 2184 |
| `/range` | 208 -> 209 | 394 -> 433 | 1935 -> 1522 | 2680 -> 2108 |
| `/skills` | 209 -> 210 | 406 -> 486 | 1649 -> 1532 | 2596 -> 2316 |
| `/terminal/easy` | 255 -> 225 | 520 -> 521 | 1679 -> 1566 | 3128 -> 2468 |
| `/forensics/x` | 268 -> 233 | 654 -> 660 | 1755 -> 1598 | n/a (empty) |
| `/reversing/x` | 259 -> 229 | 603 -> 662 | 1725 -> 1623 | n/a (empty) |
| `/osint/x` | 257 -> 222 | 428 -> 471 | 1668 -> 1556 | n/a (empty) |
| `/admin` | 213 -> 214 | 946 -> 735 | 1747 -> 1573 | 3660 -> 3708 |

Script time varies by +-100 ms between runs on this machine; treat differences under that as noise. The solid wins are bytes: 30-35 KB less on every play screen, and (real builds) 226 KB less first-load JS and no development React.

## Already in place (checked, not changed)
- Pollers (`startPolling`: leaderboard 10 s, event 30 s, announcement banner, activity ticker, freeze note, admin hooks) wait for the previous request, back off on failure and pause while the tab is hidden. The OSINT board poll (20 s) skips while hidden.
- Per-second timers (event banner, case timer, terminal HUD, challenge countdown) each live in a small component and clear on unmount.
- Fonts: both woff2 files are preloaded in `index.html` and use `font-display: swap`; no images are shipped (SVG favicon only).
- API GET cache with revalidation (`src/api/cache.js`) untouched.

## Not changed, and why
- `aws-amplify` (40 KB gzip) stays in the first load: the session is restored on every start and `AuthContext`/`token.js` are Foundation-owned. Loading it only when a stored session exists would save ~40 KB for signed-out visitors; needs an auth-owner decision.
- Play-screen tab splits (OSINT map/web/registry tabs, Forensics disk/pixel/timeline viewers, Crackme time-travel/patch bay, Cipher Lab tools): 10-25 KB raw each, in files other work was editing; revisit with `React.lazy` per tab.
- `ChallengeDetail` re-renders once a second for its countdown (small page); isolate the countdown if the page grows.
- `Demo` (22.7 KB gzip) is already lazy and only opened on purpose.

## Budget (gzip)
| Item | Now | Budget |
|---|---|---|
| Entry chunk | 13.3 KB | 20 KB |
| First-load JS (entry + vendors) | 136.4 KB | 150 KB |
| Any single route chunk | 25.0 KB | 30 KB |
| Total JS | 401 KB | 420 KB |
| Total CSS | 50.7 KB | 55 KB |

## How to re-measure
```bash
cd frontend && npx vite build --outDir <scratch dir> --emptyOutDir     # never overwrite dist while testing
node -e "const fs=require('fs'),z=require('zlib'),p=require('path');const d=process.argv[1];let t=0,g=0;(function w(x){for(const f of fs.readdirSync(x,{withFileTypes:true})){const q=p.join(x,f.name);if(f.isDirectory())w(q);else if(q.endsWith('.js')){const b=fs.readFileSync(q);t+=b.length;g+=z.gzipSync(b).length;console.log(f.name,b.length,z.gzipSync(b).length)}}})(d);console.log('TOTAL',t,g)" <scratch dir>/assets
```
Check the build is a production build: `react-<hash>.js` should be about 220 KB raw (about 430 KB means the development build is back). For per-chunk module contents, add a throwaway Rollup plugin whose `generateBundle` prints `chunk.modules[id].renderedLength`. For load numbers use puppeteer-core with `Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate` and `Performance.getMetrics`.
