# Event mode (scheduled Arena event)

An optional, scheduled event, like a real CTF "match": a start, an end and an optional scoreboard freeze. It lives in the
Arena side of the product (see `docs/VOCABULARY.md`). **If no event is configured the platform behaves exactly as before**;
the tests prove it (`backend/tests/event/*`, plus the unchanged freeze, leaderboard and route-matrix tests).

## Design

- **Stored state is only timestamps.** The settings document (`appsettings`, key `platform`) gets an optional `event`
  object: `name`, `startsAt`, `endsAt`, `freezeAt`. Nothing about the *current* phase is stored.
- **The phase is derived on every request** from those timestamps and the clock (`backend/src/services/eventPhase.js`, a pure
  function). There are no timers, so every backend replica and every serverless invocation agrees, and a restart changes nothing.
- An event needs **both** a start and an end. A document with only one of them (or an end not after the start) is treated as
  "no event". A `freezeAt` outside the window is ignored. The admin API refuses such input in the first place.
- Reuses the existing mechanisms: the settings document and its admin routes, the audit log, the submit guard
  `assertSubmissionsOpen()` that every scoring route already calls, and the leaderboard service and its 5 s memo.

## Phases

| Phase | When | Submissions | Public scoreboard (players) | Admins |
|-------|------|-------------|-----------------------------|--------|
| `none` | no event configured | as before (only the manual `submissionsFrozen` switch applies) | live | live |
| `upcoming` | now < `startsAt` | refused: 423 `EVENT_NOT_STARTED` | live | live |
| `live` | `startsAt` <= now < `freezeAt` (or `endsAt` when there is no freeze) | accepted | live | live |
| `frozen` | `freezeAt` <= now < `endsAt` | accepted | **frozen**: standings from solves with `solvedAt <= freezeAt` | live |
| `ended` | now >= `endsAt` | refused: 423 `EVENT_ENDED` | live (the final standings) | live |

What stays open in every phase: browsing, challenge lists, hints, instances, the terminal `exec`, the Web Exploit Lab
simulator, profile, team pages and read-only API routes.

Important consequence: the submit guard is shared by **all** scoring routes, including the practice ones on The Range
(Cipher Lab, Crackme Arcade, Web Exploit Lab, Forensics Desk, OSINT Trail, Arena Terminal codes). While an event is
configured, no flag or answer can be submitted before the start or after the end, anywhere. To reopen practice after an
event, clear the event in Settings (the Clear button). `submissionsFrozen` (the manual switch) is checked first and keeps its
own code `SUBMISSIONS_FROZEN`.

Admins are not affected for previews: every submit route is player-only (`requireRole('player')`), so admins never reach the
guard. They see live standings at all times.

## API

### `GET /api/event` (public, read-only, no token)

Like `GET /api/announcement`, no auth, no user data. Cached for 3 seconds (`Cache-Control: public, max-age=3`).

```json
{ "name": "Winter Cup", "phase": "frozen", "startsAt": "2030-12-05T18:00:00.000Z", "endsAt": "2030-12-05T22:00:00.000Z",
  "freezeAt": "2030-12-05T21:00:00.000Z", "serverTime": "2030-12-05T21:30:12.345Z" }
```

With no event: `{ "name": "", "phase": "none", "startsAt": null, "endsAt": null, "freezeAt": null, "serverTime": "..." }`.
`serverTime` lets the browser compute a countdown from the server clock (offset = serverTime - Date.now() when the response
arrives) instead of trusting the device clock.

### Submit refusals

`POST` on any scoring route answers `423` with the standard error body:
`{ "error": { "code": "EVENT_NOT_STARTED" | "EVENT_ENDED", "message": "..." } }`. The check runs right after body validation
(like `SUBMISSIONS_FROZEN`), so nothing is recorded and no attempt is consumed. The settings read has a 2 s timeout and fails
**closed**: if it errors or cannot be read in time, the submission is refused with a retryable `503 SETTINGS_UNAVAILABLE`
(it must never mean "allowed"; admins never reach this guard).

Routes: `POST /challenges/:id/submit`, `POST /terminal/:mode/submit`, `POST /cipherlab/levels/:id/answer`,
`POST /crackme/levels/:id/answer`, `POST /crackme/levels/:id/patch`, `POST /weblab/labs/:slug/submit`,
`POST /forensics/tracks/:track/stages/:n/answer`, `POST /osint/cases/:track/questions/:n/answer`, and
`PUT /osint/cases/:track/board` (the shared case board, read-only outside the window like the other writes).

### Leaderboard while frozen

Roles come from the verified token. During `frozen`:

- `GET /leaderboard` for a **player**: standings computed from solves with `solvedAt <= freezeAt`, same row shape. The body
  stays a plain array (contract unchanged); the frozen view is flagged with response headers `X-Scoreboard-Frozen: true` and
  `X-Scoreboard-As-Of: <freezeAt ISO>`. Teams whose solves all came later show 0 points.
- `GET /leaderboard/timeline` for a player: same shape with every line cut at the freeze time, plus additive fields
  `frozen: true` and `asOf`.
- `GET /leaderboard/me` (player, admin): `{ frozen, asOf, team }`. While frozen, a player gets **its own live totals**
  `team: { teamId, teamName, points, solves }`; never other teams' live data and never a live rank (a live rank would leak how
  others are doing). Outside a freeze, for admins, team-less players and banned teams, `team` is `null`.
  Query parameters are rejected (strict).
- Admins always get live data and no freeze flag.
- After `ended` players get the final standings computed from solves with `solvedAt <= endsAt` (a request admitted just before
  the end can be stored a moment after it; that solve does not count). No frozen headers. Admins stay live.
- The event read for these routes **does not fail open**: if it fails, the request is a 500, never live data.
- Cache: the 5 s ranking memo is keyed by view (`live` or `asOf:<freezeAt>`), so live data can never be served to a request
  for the frozen view. Responses are `private` and `Vary: Authorization`.

### Other player views while frozen

The same view (frozen: `solvedAt`/`awardedAt`/`createdAt <= freezeAt`; ended: `<= endsAt`; admins live; the event read does not fail open)
applies to every player view that would show live activity of other teams:

- `GET /feed` and `GET /players/:id/profile`: solves, first bloods, badges and new teams after the cutoff are dropped; profile
  counters, streak and `recentSolves` are derived from the remaining rows. `Vary: Authorization`, profiles `no-store`.
- `GET /challenges` and `GET /challenges/:id`: `solveCount` is `null` for players while frozen (clients show a dash).
- Reviewed and unchanged: `GET /me/achievements` (own badges), `GET /teams/me` `score` (own team), `GET /daily` (no solve data),
  game progress endpoints (own team only), the submit responses (`firstBlood` of the caller's own solve).

### Admin settings

`GET /admin/settings` returns `event: null` or `event: { name, startsAt, endsAt, freezeAt, phase }` (`phase` is the phase right
now). `PUT /admin/settings` accepts `event` (replaced as a whole, like `announcement`):

```json
{ "event": { "name": "Winter Cup", "startsAt": "2030-12-05T18:00:00.000Z", "endsAt": "2030-12-05T22:00:00.000Z",
             "freezeAt": "2030-12-05T21:00:00.000Z" } }
```

- `name` optional, 0-80 characters. `startsAt` and `endsAt` required, ISO 8601 **with** a zone (`Z` or an offset), years
  2000-2100. `freezeAt` optional or `null`, strictly between start and end. `endsAt` must be after `startsAt`.
- `{ "event": null }` clears the event (back to "disabled").
- Body is `.strict()`: unknown keys (including top-level `eventName`, `eventStartsAt`, ...) are 400 `VALIDATION_ERROR`.
- Admin only (401/403 otherwise). Every change writes a `settings.update` audit entry with before/after summaries.

## Operator runbook

1. **Announce it.** In Admin > Settings > Announcement banner, write something like "Winter Cup, 5 Dec 18:00 UTC" (optional).
2. **Schedule it.** Admin > Settings > Scheduled event. Fill the name, start, end and (optional) freeze time. Times are entered
   in your browser's time zone and stored as UTC; the page shows the time zone. Save, confirm. The Overview shows an Event
   panel with the current phase.
3. **Before the start**, players see "Winter Cup - starts in 02:13:05" in the bar under the top of every page. Browsing and
   practice reading work, submissions answer 423 "The event has not started yet".
4. **At the start** the bar switches to "live - ends in ..." by itself. Nothing to do.
5. **At the freeze time** the public scoreboard stops moving ("Scoreboard frozen at 21:00" on the Leaderboard page). Flags are
   still accepted. Each team still sees its own live score, privately. You (admin) see live standings.
6. **At the end** submissions close and the scoreboard shows the final standings.
7. **Afterwards** clear the event (Settings > Clear, then Save) to reopen practice submissions and remove the bar. Leaving it
   in place keeps the "ended" bar and keeps submissions closed.
8. **Changing the schedule** mid-event is allowed (for example, extending the end); it takes effect on the next request on
   every replica. Moving `freezeAt` later immediately un-freezes the board; moving it earlier freezes it at the new time.
9. **Emergency:** the manual "Freeze flag submissions" switch still works on top of an event and wins.

Admin score adjustments are Solve rows with their own `solvedAt`; one added after the freeze is hidden from the frozen player
view until the event ends, like any other late solve.

## What players see

- `EventBanner` (`frontend/src/components/EventBanner.jsx`) under the announcement banner: "Event name - starts in 02:13:05",
  "live - ends in ...", "scoreboard frozen - ends in ...", "ended". Hidden when no event is configured. The countdown is
  computed from the server clock offset and polled every 30 s (paused while the tab is hidden).
- Accessibility: the ticking text is hidden from assistive technology; a separate `role="status"` line carries a spoken text
  ("2 hours 13 minutes") that only changes on a phase change or when the minute changes.
- Leaderboard page: "Scoreboard frozen at HH:MM" (viewer's time zone) with the team's own live score; "The event has ended.
  These are the final standings." afterwards.
- Submit forms show the two refusal messages through their existing error helpers (`frontend/src/event/messages.js`).

## Files

- Backend: `services/eventPhase.js` (pure), `services/adminSettings.js` (schema, guard, `getEventConfig`),
  `services/leaderboardService.js` (views, cache), `routes/event.js`, `routes/leaderboard.js`, `models/AppSetting.js`.
- Frontend: `src/event/{logic,messages,useEventClock}`, `src/api/event.js`, `src/components/{EventBanner,ScoreboardFreezeNote}`,
  `src/admin/eventForm.js`, `src/components/admin/{EventPanel,EventSummary}`.
- Tests: `backend/tests/event/{eventPhase,eventApi,eventLeaderboard}.test.js`, `frontend/tests/event.test.js`.

## Limits

- The countdown is only as accurate as one clock offset sample per poll (response latency); it is a display aid, the server
  decides every refusal.
- A replica that serves a `GET /api/event` from a browser cache may be up to 3 s stale.
- No per-division or per-group schedules, no automatic results page (the final standings are the normal leaderboard).
