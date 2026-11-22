# Hints

One shared hint panel, `HintLadder` (`frontend/src/hints/`), is used on the play screens of Cipher Lab, Crackme, OSINT, Web Exploit Lab and Forensics. Terminal has its own compact Hints control (see below).

## What the player sees
- Hints open one at a time, in order: **Nudge**, **Approach**, **Walkthrough-lite**, labelled by position (1 hint = Nudge; 2 = Nudge, Approach; 3 or more = first Nudge, last Walkthrough-lite). Hint texts are the existing ones, untouched.
- Button: `Open hint 2 of 3 (Approach)`. The last tier (Walkthrough-lite) asks for an inline confirmation first (no modal).
- Opened hints stay visible. Header shows `Hints used: N`; the same line appears in the solved result of Cipher Lab, Crackme, OSINT, Forensics and Web Exploit Lab (from the opened hints the client already has).
- Cost line: each closed hint shows its price (for example `Costs 10% (-12 pts)`); `Free: no points deducted` appears only when hints are disabled or every closed hint costs 0% (see "Hint costs" and "Frontend" below).
- A polite live region announces each opened hint; buttons are 44 px; everything is keyboard operable; focus moves to the newly opened hint.
- Tracks that disallow hints (OSINT/Crackme/Cipher Lab insane, Forensics hard and insane) show "No hints on this track". A Web lab with no hints shows "No hints here".
- Admins preview only: Cipher Lab shows every hint with no button; OSINT and Crackme show locked tiers and no button. Nothing is logged for admins.

## Behaviour and storage per category
| Category | Endpoint | Where opens are stored |
|---|---|---|
| Cipher Lab | `POST /cipherlab/levels/:id/hints` | server, `cipherhints` (logged for admins) |
| Crackme | `POST /crackme/levels/:id/hints` | server, `crackmehints` |
| OSINT | `POST /osint/cases/:track/questions/:n/hints` | server, `osinthints` |
| Web Exploit Lab | `POST /weblab/labs/:slug/hints/:level` | server, `hintopens` (scope `weblab`); the browser localStorage count stays as a display cache |
| Forensics | `POST /forensics/tracks/:track/stages/:n/hint` (the case view withholds `stage.hint` until opened) | server, `hintopens` (scope `forensics`) |
| Terminal | in-shell `hint [n]` command | server, `hintopens` (scope `terminal`), recorded by the command itself; `Hints` / `Next hint` buttons under the log (`frontend/src/terminal/HintBar.jsx`) type the same command |

Browser storage: key `ctf.hints.v1:<email>` holds `{ "<scope>": count }` (scopes `weblab:<slug>`, `forensics:<track>:<n>`). Corrupt JSON, wrong types, `__proto__` keys and out-of-range counts read as "nothing opened"; at most 400 scopes are kept. Web lab hints are re-fetched in order on load. No new collections or endpoints were added.

## Where the cost lives
The prices are a platform setting (`appsettings.hintCosts`, percent of the level's base points; defaults 5/10/25 percent, cap 40), read through `GET /api/hint-costs` and priced on the server (`backend/src/services/hintCost.js`). `frontend/src/hints/config.js` no longer has a per-category `HINT_COSTS`; it holds only `DEFAULT_HINT_COSTS` (a fallback copy of the backend defaults) and `FREE_LINE`. See "Hint costs" below.

## Adding a cost later without breaking point totals
Superseded by "Hint costs" below (the cost is a percentage deducted from `Solve.points` at solve time; the rest of this list is the reasoning behind it).
1. Do not change `points`, `maxPoints` or any documented total. Charge hints as a separate negative ledger entry (the existing adjustment mechanism with a reason like `hint`), not by lowering level points, so totals stay stable and the cost can be switched off.
2. Charge on the server inside the open-hint endpoints of Cipher Lab, Crackme and OSINT, with the same cost table on the backend (the client constant only controls the text). Use an atomic, idempotent write (unique index on team + hint) so repeated opens never charge twice and replicas stay stateless.
3. For Web Exploit Lab and Forensics the server first had to record opens (done: `hintopens`, see "Hint costs").
4. Then set the number in `config.js` and the backend table in the same change, update `docs/API_SPEC.md`, and keep scores from going below zero.

## Hint costs

Status: **backend implemented for all six categories (phases 1 and 2)**. Cipher Lab, Crackme, OSINT, Web Exploit Lab, Forensics and Terminal charge at solve time; the play screens show the prices and ask for confirmation (frontend section below; the "still print Free" wording from phase 1 is obsolete). The owner decided hints cost points. This section replaces "Adding a cost later" above; the rules below are the contract.

### Rules
- **Tier by position.** Each hint belongs to a tier by its 0-based position among the level's hints: `nudge` (first), `approach` (second), `walkthrough` (third and later). A level with a single hint charges its tier by position only (a nudge).
- **Price is fixed when a hint is opened.** The open records the percent it charged (and the cap, `maxPercent`, in force) on its ledger row, as `percent` and `capPercent`. An admin changing the costs later never reprices a hint that is already open: the solve charges the stored percent. A repeated open answers with the stored price and writes nothing (the upsert is `$setOnInsert`, it never overwrites a row). Only rows without a stored percent (written before this rule) fall back to the current rates; if every opened hint has its percent, the solve reads no settings at all, so a failed or disabled settings read at solve time cannot change what was agreed. The cap of the level is the lowest stored `capPercent` of its rows. Cipher Lab, Crackme and OSINT write `percent` and `capPercent` on their own collections too (additive fields); their `spent` in hint-open and level views is still computed at the current rates (the solve charges the stored ones).
- **Tiers are cumulative.** Opening hint N also pays for the cheaper tiers below it that nothing opened yet covers: opening Terminal tier 3 or Web Lab level 3 first costs nudge + approach + walkthrough (5 + 10 + 25 = 40% by default), capped as always. Opening tier 1 and 2 afterwards is free (the highest opened index covers everything under it). The open stores the percent it added (the marginal cost), so rows add up to what the team pays. Categories that open strictly in order (Cipher Lab, Crackme, OSINT) are numerically unchanged: each tier is charged once. The price shown for a closed hint (`hintPricing`, Terminal `pricing`) is what opening it would add right now, cap included, so a closed tier below an opened one shows 0.
- **Cost in percent.** Platform setting `hintCosts = { enabled, nudge, approach, walkthrough, maxPercent }` (integers 0..100). Defaults `{ enabled: true, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40 }`.
- **Points of one hint** = `round(base * percent / 100)`, at least 1 when its percent is above 0 and `base >= 10`. `base` is the level's base points from the definition (never the database row).
- **Cap.** The total deduction of a level is capped at `round(base * maxPercent / 100)`. A solve always awards at least 1 point (`netPoints`). A level worth 0 stays 0.
- `enabled: false`, or percentages of 0, make hints free. Tracks that give no hints (Insane, Forensics hard/insane) are unchanged because no hint can be opened.
- **When it is charged.** At solve time: `scoringService.recordSolve({ challenge, teamId, userId, hint: { scope, key } })` reads the hints the team opened for that level and stores `Solve.points = netPoints(base, spent)`. The leaderboard, achievements and exports read `Solve.points` as before. Level points, `maxPoints` and every documented total stay the same (the maximum is what a team earns with no hints). A solve that is already captured is never charged again, and a hint opened after the solve costs nothing. First-blood rules do not change (hints exist only in categories without a first-blood bonus).
- **Admins** never pay and nothing is recorded for them: admin previews return no cost fields and write no rows.

### Examples (defaults, cap 40%)
| Level base | 1 hint | 2 hints | 3 hints | 6 hints (cap) | Free preset |
|---|---|---|---|---|---|
| 10 | 9 (-1) | 8 (-2) | 6 (-4, cap) | 6 | 10 |
| 50 | 47 (-3) | 42 (-8) | 30 (-20, cap) | 30 | 50 |
| 100 | 95 (-5) | 85 (-15) | 60 (-40, cap) | 60 | 100 |
| 300 | 285 (-15) | 255 (-45) | 180 (-120, cap) | 180 | 300 |

Every number is the points awarded; the deduction is in brackets. Opening only the second hint costs the nudge and approach prices (5% + 10% = 15%): tiers follow the hint's position and are cumulative, whatever the order of opening. Opening the same hint twice costs once.

### Where costs live and what is recorded where
| What | Where |
|---|---|
| Rules (pure functions) | `backend/src/services/hintCost.js`: `tierOf`, `hintPoints`, `spentFor`, `netPoints`, `normalizeCosts`, plus `costOf`, `capPoints`, `spentView`, `pricingFor`, `firstN` |
| Settings | `appsettings.hintCosts` (admin: `GET/PUT /api/admin/settings`, audited as `settings.update`; `{ "hintCosts": null }` resets to the defaults); public read `GET /api/hint-costs` |
| Opens of Cipher Lab, Crackme, OSINT | their own collections `cipherhints`, `crackmehints`, `osinthints` (unchanged, still the admin audit log) |
| Opens of every other category | new ledger `hintopens` `{ teamId, userId, scope, key, index, percent, capPercent, createdAt }`, unique on `{ teamId, scope, key, index }`, TTL 400 days |
| Reading and writing the ledger | `backend/src/services/hintLedger.js`: `recordHintOpen` (prices the open), `openedEntries`, `openedIndexes`, `spentForLevel`, `registerHintScope` |
| What was charged | `solves.points` (net). The solve response also carries `hintCost` (below); the base is not stored separately |

`spentForLevel({ teamId, scope, key, base })` returns `{ spent, openedCount, costs }` by unioning `hintopens` and the legacy collection of the scope (every index counted once). `costs` is `null` when nothing was opened or every opened row carries its stored price (no settings read). Nothing is cached in a process: every replica reads MongoDB, `recordHintOpen` is one idempotent upsert (a concurrent duplicate-key error counts as the same open).

Scopes and keys used for the solve-time lookup: `cipherlab` / level id (`e1`), `crackme` / level id (`h2`), `osint` / `<track>:<question>` (`easy:2`), `weblab` / lab slug (`weblab-sqli-login`; hint index 0-based = level - 1), `forensics` / `<track>:<stage>` (`easy:1`; one hint, index 0), `terminal` / `<mode>:<code>` (`easy:1`; index = tier - 1). Base points: the level, stage or code points (Terminal: the challenge row, which the seed keeps equal to the definition).

### Responses (additive)
- Settings view and `GET /api/hint-costs`: `{ enabled, nudge, approach, walkthrough, maxPercent }`.
- Hint-open responses of Cipher Lab, Crackme and OSINT gain `cost: { percent, points, tier }` (this hint) and `spent: { points, percent, cap }` (the level so far; `cap` in points). Admin responses have neither.
- Level views gain, for players only, `hintPricing: [{ index, tier, percent, points }]` for the hints still closed (never their text) and `hintSpent: { points, percent, cap }`. Cipher Lab and Crackme: on `GET /levels/:id`. OSINT: on every question of `GET /cases/:track`.
- Correct-answer responses gain `hintCost: { spent, openedCount, base, awarded }` only when something was deducted. `pointsAwarded` is already the net value.

### Web Exploit Lab, Forensics and Terminal (phase 2)
- **Web Exploit Lab.** `POST /weblab/labs/:slug/hints/:level` (strict empty body; the old `GET` route is removed and answers 404) records the open for a player and answers `{ level, count, text, cost, spent }`. Hints may be opened in any order; the price is cumulative (see Rules) and a repeat answers with the price stored the first time. `GET /weblab/labs/:slug` adds `hintsOpened` (1-based levels), `hintPricing` (closed hints, 0-based `index`) and `hintSpent`. The submit response adds `hintCost`. A player needs a team that may play (`NO_TEAM`, `TEAM_BANNED`); admins read the hint for free and nothing is recorded.
- **Forensics.** One hint per stage (nudge price), only on the easy and medium tracks (not hard, insane or the whodunit). The case view no longer carries the text: `stage.hint` is `null` until the team opened it (admins see it), `stage.hasHint` tells that one exists, and players with a team get `hintOpened`, `hintPricing` and `hintSpent` per stage. `POST /forensics/tracks/:track/stages/:n/hint` opens it: `{ index: 0, hint, used: 1, total: 1, cost, spent }`. The answer adds `hintCost`.
- **Terminal.** The `hint [n]` command records tier `n` of the lowest unsolved code (`index = n - 1`) through `ctx.recordHint` before it prints, so a failing write shows no text. Output is unchanged; typed and clicked opens are the same call. `GET /terminal/:mode/progress` adds `hint: { code, total, base, opened, pricing, spent }` for players with a team (`opened` are 1-based tiers, `pricing` the closed tiers with 0-based `index`). The submit response adds `hintCost`. Admin previews record nothing.
- Opening a hint is not blocked by a frozen event or frozen submissions (as for the older hint endpoints); the solve that charges it still is. A hint opened after the solve costs nothing.
- **Freeze and ban checks on opens (deliberate).** Hint opens in Forensics and Terminal are intentionally not blocked by freeze or ban checks: only the solve is. Web Lab hint opens do block banned teams (`TEAM_BANNED`) because they go through the team context. A banned team cannot solve, so an open it makes is never charged.
- **Solve-time race.** `recordSolve` reads the spend, inserts the Solve, then reads the spend once more; if it grew (a hint opened on another replica in between) the stored `Solve.points` is lowered atomically (`updateOne` on the solve id, only when higher, never below 1) and the corrected `hintCost` is returned. It costs one extra ledger read per hinted solve.
- **Rate limit.** `GET /api/hint-costs` has no rate limit of its own in the app (nginx limits `/api`); it is public, cached for 10 s and reads one settings document.

### Admin view
Admin > Settings > Hint costs: the switch, the three percentages and the cap with validation, a live preview for 10, 50, 100 and 300 point levels (cost per tier, cap, points awarded with all hints), the "Free hints" and "Defaults" presets, and a confirm step before saving. The change is audited (`settings.update`, before and after). Teams solved earlier keep the points they were awarded.

### Wiring a new category (phase 2)
1. In the solve path, call `recordSolve({ ..., hint: { scope, key } })` and add `hintCost` to the response when `solve.hintCost` exists (see `games/cipherlab/service.js`).
2. In the open-hint path (player only, never admin): `const { percent, costs } = await recordHintOpen({ teamId, userId, scope, key, index })` (it reads the costs, prices the open and stores the price), then reply with `cost: chargeOf(base, percent, index)` and `spent: spentView(base, await openedEntries({ teamId, scope, key }), costs)`.
3. In the level view: `hintPricing: pricingClosed(base, hintsTotal, openedEntries, costs)` (any order) or `pricingFor(base, hintsTotal, openedCount, costs)` (strictly in order) and `hintSpent: spentView(base, opened, costs)`.
4. A scope that already stores opens elsewhere calls `registerHintScope(scope, { legacy: async ({ teamId, key }) => [openedIndexes] })`; otherwise nothing to register (unknown scopes use `hintopens`).
5. Frontend: read `GET /api/hint-costs` for the text before a hint is opened, (done; `hints/config.js` now holds only `DEFAULT_HINT_COSTS` and `FREE_LINE`).

## Not done
Terminal keeps its in-shell `hint [n]` command and adds buttons that type and run that same command through the normal exec path, so pacing, logging and fair-play signals are unchanged. The tier count is read from the reply (`[hint 2/3 for code 4] ...`); `Hints used: N` counts distinct code+tier pairs opened in this browser session (typed or clicked), is not stored, and is hidden for admins. The cost line comes from `hints/config.js`. If the reply cannot be parsed only the plain `Hints` button is offered. Answer forms were left as they are.

## Frontend: prices, confirmation and deductions (phase 2)

Supersedes the "Free: no points deducted" line and the "`HINT_COSTS` stays the free fallback" note above. Code: `frontend/src/hints/` (`pricing.js` pure rules, `helpers.js` ladder state, `HintLadder.jsx`, `hooks.js` `useHintCosts`), `frontend/src/api/hintCosts.js`, `frontend/src/terminal/{hintBar.js,HintBar.jsx}`.

- **Where a price comes from.** Order: the server's `hintPricing` entry of that hint (level view), else `GET /api/hint-costs` with the level's base points (read once per screen, only when some closed hint has no `hintPricing`), else nothing. A failed read shows "Hint price unavailable. A hint may cost points." and never invents a number. `hints/config.js` now only holds `DEFAULT_HINT_COSTS` (5/10/25/40, enabled) and `FREE_LINE`; no screen uses it for a price (it is the fallback `normalizeCosts` repairs bad fields with).
- **Before opening.** Every closed hint shows its price: `Ready to open · Costs 10% (-12 pts)` / `Locked · Costs 25% (-30 pts)`, the open button reads `Open hint 2 of 3 (Approach): Costs 10% (-12 pts)`, and the status line says `Next hint: Costs 10% (-12 pts)`. Free (setting disabled or percent 0) reads `Free` per hint and `Free: no points deducted` as the line.
- **Confirmation.** A hint that costs points always asks first, with an inline pair (no browser dialog): `Hint 2 (Approach) costs 10% (-12 pts), taken from this level's points when your team captures it. Open it?` then `Yes, open hint 2 of 3` / `Not yet`. Focus moves to the confirm button, Escape or `Not yet` closes it and returns focus to the open button. A free hint opens directly, except the last tier (Walkthrough-lite) which still asks.
- **After opening.** The status line becomes `So far -17 pts. You can still earn 83.` (plus ` (cap reached)` at the cap). It uses `hintSpent` of the level view and, without a reload (OSINT, Web Exploit Lab, Forensics, Terminal), the `spent` of the hint-open answer (the larger of the two wins). `Hints used: N` is unchanged.
- **After the solve.** When the answer carries `hintCost` the result adds `Captured: 100 pts, minus 17 for hints = 83` (`deductionText`, built from `hintCost.base`, `spent`, `awarded`) next to the existing points line: Cipher Lab, Crackme, OSINT, Forensics, Web Exploit Lab (bounty banner) and the Arena Terminal result block. "Captured" follows `docs/VOCABULARY.md` (not "Solved"). Nothing is added when no hint cost anything. The leaderboard and profile read `Solve.points` and did not change.
- **Admins and previews.** `priced={false}` (admin), `preview` and `canOpen: false` hide every price, the spent line and every confirmation, whatever the server sends; a server that omits the fields gives a plain ladder (no price text, only the Walkthrough-lite confirm).
- **Forensics** now opens its hint with `POST /forensics/tracks/:track/stages/:n/hint` (the text is null in the case view until opened; `hasHint` says one exists). The browser-stored count is no longer used there. **Web Exploit Lab** restores opened hints after a reload from the lab view's `hintsOpened` (it POSTs levels 1..highest again, in order; the server open is idempotent and free the second time), so a hint opened in another browser comes back too. Admins get no `hintsOpened`, so their previews still use the browser-stored count. The ladder opens in order, so it shows each later hint at the step it will cost once the ones before it are open (`inOrderPricing`), while the Terminal bar shows the server's what-opening-it-adds price.
- **Arena Terminal.** `GET /terminal/:mode/progress` `hint` (`code, total, base, opened, pricing, spent`) is read through `normalizeProgress` and reloaded after every `hint` command. The `Hints` / `Next hint` buttons confirm inline when the next tier costs points and the info line shows `Next hint: Costs 5% (-2 pts). So far -2 pts. You can still earn 38.`; typing `hint` in the shell does not ask (the server charges at solve time anyway). Without `hint` info (before the first load, hints disabled) the bar uses `GET /api/hint-costs` and prints `Costs 5%, 10%, then 25% of the code's points (up to 40%)`.
- **Tests.** `frontend/tests/hintPricing.test.js` (pricing rules, ladder state, confirmation text, deduction message), `frontend/tests/hints.test.js` and `terminalHints.test.js` (storage, tiers, terminal bar). Harness fixtures: `docs/harness/hintfix.cjs` (hintPricing, hint-open answers, `FREE=1` for the free preset).
