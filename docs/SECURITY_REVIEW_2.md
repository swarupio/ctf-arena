# Security review 2: findings, fixes and tests

Second read-only backend review. Every item below was fixed with tests that fail on the old code and pass on the new.
Nothing was committed. Code owners: leaderboard, social, challenges, OSINT, terminal and settings services.

| # | Severity | Finding | Fix | Tests |
|---|---|---|---|---|
| 1 | Medium-high | While the scoreboard was frozen, `GET /feed` and `GET /players/:id/profile` showed every team's live solves, first bloods, badges and times | New `services/viewCutoff.js` (`resolveView`): players are cut at `freezeAt` while frozen and at `endsAt` once ended, admins live, the event read fails closed (500). Applied to `solvedAt`, `awardedAt` and team `createdAt` in the feed and in the profile (counters, streak, `recentSolves`); `Vary: Authorization`; profile reads at most 1000 solves. Other endpoints reviewed (below) | `tests/event/frozenViews.test.js` (feed, profile, `/me/achievements`) |
| 2 | Medium | `GET /challenges` and `/challenges/:id` exposed the live `solveCount` while frozen | `solveCount` is `null` for players while frozen, admins live; `no-store`; frontend shows a dash (`solveCountLabel`) | `tests/event/frozenViews.test.js` (challenges), `frontend/tests/challenge.test.js` |
| 3 | Medium | OSINT board `progress.found` after every save was an exact-count oracle (group testing recovers the chain) | Board responses carry only `progress.level` (`none`, `started`, `close`, `complete`) and `unlocked`; `POST .../board/check` returns the exact count of the saved board (3 a minute, 10 an hour); saves limited to 30 a minute and 200 an hour; one generic nudge | `tests/osint/board.api.test.js` ("checking the saved board", "no count oracle"), `tests/osint/board.test.js`, `frontend/tests/osintBoard.test.js` |
| 4 | Low-medium | Terminal burst: a correct flag escaped the over-limit 429 | `consumeAttempt` (atomic, MongoDB) before evaluating; already captured codes stay idempotent and unlimited | `tests/terminal/api.test.js` (burst, correct flag, new window, idempotent resubmit) |
| 5 | Low | `assertSubmissionsOpen` failed open on a settings read error or timeout | Fails closed: retryable `503 SETTINGS_UNAVAILABLE` on every submit path | `tests/event/submitGuardTimeout.test.js`, `tests/event/eventApi.test.js`, `tests/serverlessAdmin.test.js` |
| 6 | Low | A solve stored after `endsAt` still counted | Ended view for players uses `solvedAt <= endsAt` in the leaderboard and timeline (admins live) | `tests/event/frozenViews.test.js` (ended view) |
| 7 | Low | Board of a banned team returned `readOnly: false` | `readOnly: true` for banned teams (saves were already refused) | `tests/osint/board.api.test.js` |
| 8 | Info | Forensics interviews can reveal the culprit after one solved stage | Not changed (owner decision pending, documented in `docs/FORENSICS_DESK.md`) | none |

## Tests that encoded the old behaviour (updated, not weakened)

- `tests/terminal/api.test.js`: the 429 test and the "correct flag that lost the recount race gets 200" test used `Submission.countDocuments`; they now use the atomic limiter, and the second one is replaced by the burst tests. `tests/terminal/seedApi.test.js` mocks the limiter (it only checks the seed).
- `tests/osint/board.api.test.js`: `progress: { found }` expectations became `progress: { level }`; the 60-a-minute budget test is now 30.
- `tests/serverlessAdmin.test.js`: "fails open immediately" is now "fails closed immediately".

## Other player views reviewed for live data while frozen

`GET /me/achievements` (own badges; kept live), `GET /teams/me` score (own team), `GET /daily` (no solve data),
`GET /leaderboard/me` (own totals by design), game list and progress endpoints (own team only), submit responses
(`firstBlood` and badges of the caller's own solve). No other endpoint returns another team's solves or counters.

## OSINT group-testing attacker (item 3)

Script: `scratchpad/attacker.mjs` (simulation with the real `progressLevel` and `linkCap`; not committed). Model: the hidden chain
(M links) sits inside a pool of P links the attacker considers plausible (600 for easy, scaled with the square of the evidence
count), a save holds at most 2 x M links, rate limits applied.

| Case | Before: exact count after each save (60 a minute, 400 an hour) | After, count only through `/check` (10 an hour) | After, best level-only attack through saves (200 an hour) |
|---|---|---|---|
| easy (P 600) | about 75 saves, about 1 minute | about 75 checks, about 7 hours | 700 to 1250 saves, about 3 to 6 hours (high variance) |
| medium (P 1350) | about 136 saves, 2 minutes | about 136 checks, 13 hours | not found within 30000 saves (more than 149 hours) |
| hard (P 2050) | about 179 saves, 2 minutes | about 179 checks, 17 hours | not found within 30000 saves (more than 149 hours) |
| insane (P 3900) | about 294 saves, 4 minutes | about 294 checks, 29 hours | not found within 30000 saves (more than 149 hours) |

The group-testing numbers are for a strong attacker (adaptive halving over a pool they chose); the review's own estimates for the
old API were higher for the larger cases. The level attack needs `ceil(M/2)` chain links inside one 2 x M link save by luck, so it is
a random search; an attacker with a smaller plausible pool (for example 100 candidates) is still faster, which is why the level
buckets start at half and the exact count is rationed.

## Residual risk

- A coarse level is still a threshold oracle. It makes extraction slow (hours instead of a minute) but not impossible for an attacker with a small, well chosen candidate pool; the sticky final unlock only opens the final question, which keeps its own 8-per-minute answer limit and its own points.
- Fixed-window limiter: a window boundary allows up to twice the limit across two adjacent windows.
- Terminal: re-submitting an already captured code is never limited (the team already holds that flag; it reveals nothing new).
- Frozen views are cut by time, so a player still sees their own team's live data where documented (`/leaderboard/me`, `/me/achievements`, own game progress).
- The one-hour (not per-minute) check budget is per team: a large team shares it.
