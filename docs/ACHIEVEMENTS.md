# Achievements, profile, activity feed and daily spotlight

Purely cosmetic features to make the arena more fun. They never change `solves.points`, `scoringService` or the
leaderboard totals.

## Badges
Catalog and rules live in `backend/src/services/achievementService.js`. `computeEarned(facts)` is a pure function;
`evaluate({ userId, teamId })` loads the facts (lean, indexed queries) and awards what is new.

| Key | Rule |
|-----|------|
| first-solve | 1 solve |
| first-blood | any of the user's solves was a first blood |
| category-web / crypto / forensics / pwn / misc / terminal | solved a challenge of that category |
| solves-3 / solves-5 / solves-10 | that many solves by the user |
| hard-hitter | solved a hard challenge |
| terminal-easy / medium / hard | the user's team found every visible code of that terminal mode |
| night-owl | a solve between 00:00 and 04:59 UTC |
| speed-runner | 3 solves within one hour |
| streak-3 / streak-7 | solves on 3 or 7 UTC days in a row (best streak ever) |
| team-of-three | the user's team has three members |
| comeback | a solve at least 3 days after the previous one |

"Solves by the user" are `solves` rows with that `userId` (the teammate who submitted). Streaks use UTC days; the
current streak stays alive until the end of the day after the last solve.

## Awarding hook
One guarded line in each submit route, after the solve is recorded:
- `backend/src/routes/challenges.js`, `POST /:id/submit`: `const badges = await achievementService.safeEvaluate({ userId: user._id, teamId: team._id });`
  and the optional `badges` field on the response.
- `backend/src/routes/terminal.js`, `POST /:mode/submit`: the same call when `pointsAwarded > 0`.

`safeEvaluate` never throws, gives up after 1.5 s and does nothing when MongoDB is not connected, so a badge problem
cannot break or noticeably slow a solve. Awarding is an upsert on the unique `{ userId, key }` index with `$setOnInsert`,
so concurrent or repeated calls are safe on any replica and only the call that inserted the row reports the badge as new.
Badges for solves made before this feature existed are awarded on the player's next solve.

## Endpoints
See "Achievements, profile, feed and daily spotlight" in `docs/API_SPEC.md`. The profile is public-safe: display name,
team name, counts, badges and recent solves with category and difficulty only (no email, flag, invite code or title).

## Feed
`GET /api/feed` merges the newest solves, first bloods, badge awards and new teams. Each source is one bounded,
newest-first, indexed read (`solvedAt`, `awardedAt`, `_id`). Banned teams and hidden challenges are skipped. The
frontend polls with `pages/poller.js` (paused while the tab is hidden).

## Daily spotlight
`pickDaily` hashes the UTC date (`YYYY-MM-DD`) with FNV-1a and indexes the visible challenges sorted by slug. No state is
stored, every replica agrees. The "Daily bonus" label is decoration: the points shown are the normal points.

## Celebrations
After a correct submit on the challenge page, `announce(outcome)` dispatches `arena:celebrate` for first blood, a first
flag or a new badge. `components/CelebrationHost.jsx` (mounted in the layout) shows a banner and tiny CSS confetti. Confetti
is skipped under `prefers-reduced-motion`; there is no sound. The Arena Terminal page has its own confetti and does not
yet read the `badges` field (badges still appear on the profile and in the feed).

## Frontend
`/profile` (own) and `/profile/:id`, lazy loaded, with the badge grid (locked and unlocked), stats, streak and a share
card (Web Share API, falling back to copying a one-line summary).
