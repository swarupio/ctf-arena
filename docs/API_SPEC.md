# API Specification (the contract)

Base path: `/api`. JSON in, JSON out.
Implementation status: every endpoint in this file is implemented and mounted: Health, identity and Teams
(Phase 1), Challenges, Instances and `/admin/challenges` (Phase 2), Leaderboard and `/admin/stats`,
`/admin/instances`, `/admin/teams` (Phase 3), and the Arena Terminal under `/terminal` (see
`docs/ARENA_TERMINAL.md`) and the fair-play review endpoints under `/admin/integrity` (see `docs/FAIR_PLAY.md`).
Paths that are not listed here return 404 `NOT_FOUND`, with one deliberate exception: a few public decoy paths answer
200 with invented data (and a tainted flag) so that scrapers and automated agents give themselves away. They are not
part of the contract, no client may call them, and they are not listed here on purpose (see `docs/FAIR_PLAY.md`).
Auth: `Authorization: Bearer <Cognito ID token>` on everything except `/api/health`, `/api/announcement`, `/api/event` and `/api/hint-costs` (all public).
This applies to implemented protected endpoints; unknown paths return 404 without authentication.
Authentication middleware is attached per protected route. P1-07 attaches
`req.user = { cognitoSub, email, role }` from verified ID-token claims;
`cognitoSub` is the Cognito `sub`, not a database user ID. Exact membership
in the `admin` Cognito group grants `admin`; other users (including those
without groups) are `player`. Missing or malformed Bearer credentials and
invalid/expired tokens return 401 `UNAUTHENTICATED`. Role mismatches return
403 `FORBIDDEN`. P1-08 persists the current user through `/me`.
Team create/join also upsert the user and refresh token email/role. Team read/leave
require an existing persisted membership. Roles are exact: `admin` does not
implicitly satisfy a `player` guard, so admins receive 403 on current team routes.
Every response includes the header `X-Served-By: <replica hostname>` (added by `middleware/servedBy.js`).

**Error format (all errors)**
```json
{ "error": { "code": "TEAM_FULL", "message": "This team already has 3 members." } }
```
Common codes: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400,
`CONFLICT` 409, `RATE_LIMITED` 429, `SERVER_ERROR` 500. Also used: `NO_TEAM` 404, `TEAM_BANNED` 403, `USER_BANNED` 403,
`TERMINAL_NOT_SEEDED` 503, `SLOW_DOWN` 429 (terminal `exec` pacing, see below), `FORENSICS_NOT_SEEDED` 503 and
`STAGE_LOCKED` 403 (Forensics Desk and OSINT Trail, see below), `OSINT_NOT_SEEDED` 503 and `NO_HINTS` 403 / `NO_MORE_HINTS` 409 (OSINT Trail).
Also used on answer and board routes: `SUBMISSIONS_FROZEN` 423, `EVENT_NOT_STARTED` 423 and `EVENT_ENDED` 423 (scheduled event, see Platform settings), `LEVEL_LOCKED` 403 (Cipher Lab and Crackme Arcade).

Legend for the owner column: **S** = Swarup (Phase 1), **G** = Gururaj (Phase 2), **H** = Shubham (Phase 3).

---

## Health and identity

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| GET | `/health` | none | S | `{ "status":"ok", "db":"up", "replica":"backend-2", "indexes":"ok" }`. `indexes` is additive: `ok` or `missing` (the critical unique indexes of solves, teams, users, attempt counters, decoy flags, signals and instance ports; names are only in the server log, never in the response). The field is absent when the database is down or the check fails or times out; the route never fails because of it. Cached for 5 minutes. Fix `missing` with `npm run db:indexes`. |
| GET | `/me` | any | S | Current user: `{ id, email, displayName, role, team: { id, name } or null }`, plus `teamBanned` (additive boolean, always present: `true` only when the user's team is banned, `false` for a normal team and for no team; read with the team lookup `/me` already does, no extra query) and `banned: true` (additive, only present for a banned account so the UI can show the ban message; `/me` itself keeps working) |
| PATCH | `/me` | any | S | Body `{ displayName }` (3-30 chars). 403 `USER_BANNED` for a banned account |

GET `/me` upserts by the verified Cognito `sub`, refreshing email and role from
the token on every call. On creation, displayName defaults to the email part
before `@`; later GET calls preserve it. PATCH `/me` accepts only displayName,
trims it before checking the 3-30 character limit, and returns the same profile
shape. PATCH also upserts the user and refreshes token fields. Invalid bodies
return 400 `VALIDATION_ERROR`. Both responses use the MongoDB user ID as `id`
and return `team: { id, name }` when the user has a team, otherwise `team: null`.

Health returns HTTP 200 with `{ "status": "ok", "db": "up|down", "replica": "<hostname>" }`.
`db` is `up` only when `mongoose.connection.readyState` is 1 (connected),
and `down` for all other states. It is checked on each request, so a lost
connection is reflected without restarting. Startup connects to MongoDB before
opening the HTTP listener; an initial connection failure exits with code 1.
JSON request bodies are limited to 100 KB. Invalid JSON returns 400
`VALIDATION_ERROR`; oversized bodies return 413 `VALIDATION_ERROR`.
Unknown routes return 404 `NOT_FOUND`; unexpected failures return 500
`SERVER_ERROR` with a generic message and no internal details (the server logs only `[error] METHOD path ErrorName code`, never the
message, stack or query string). Other client errors from the body parser (unsupported charset or encoding, aborted upload) are 4xx
`VALIDATION_ERROR` with a fixed message (415 for an unsupported charset). Every `/api` response carries `Cache-Control: no-store`; there
are no CORS headers (the API is same-origin behind Nginx). The security review and its test matrix are in `docs/SECURITY_AUDIT.md`.

## Teams

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| POST | `/teams` | player | S | Body `{ name }` (3-24 chars, unique). Creates team, user becomes captain. Returns team with `inviteCode`. 409 if user already has a team. 403 `USER_BANNED` for a banned account. |
| POST | `/teams/join` | player | S | Body `{ inviteCode }`. 404 bad code, 409 already in a team, `TEAM_FULL` 409 if 3 members, 429 `RATE_LIMITED` after 10 attempts per 15 minutes per account. 403 `USER_BANNED` for a banned account. |
| GET | `/teams/me` | player | S | `{ id, name, inviteCode, members:[{id,displayName}], score, banned? }` (`banned: true` only for a banned team) |
| POST | `/teams/me/leave` | player | S | Leaves team (204). If last member, team is deleted and its instances are stopped; otherwise the next member becomes captain if the captain leaves. 403 `TEAM_BANNED` for a banned team (a ban cannot be escaped by leaving). 403 `USER_BANNED` for a banned account. |

Create returns 201; join and GET return 200, all with the GET `/teams/me` shape
above. `score` is the sum of the team's `solves.points` (0 without solves). Banned teams remain readable and include
`banned: true`; this field is omitted for unbanned teams. `/me` returns only
the team's `id` and `name`, never its invite code or member list.

Names are trimmed before enforcing the 3-24 character limit and are unique
case-insensitively. Invite codes have six uppercase letters/digits from
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0, or 1); collisions are retried.
Join accepts a trimmed code in that alphabet. Create and join accept only the
documented body fields; leave accepts no body or an empty object. Invalid bodies
return 400 `VALIDATION_ERROR`. Duplicate names and existing memberships return
409 `CONFLICT`; unknown codes return 404 `NOT_FOUND`; full teams return
409 `TEAM_FULL`. GET `/teams/me` and leave return 404 `NO_TEAM` without a team.

Membership changes commit the User and Team documents together using MongoDB
transactions (Atlas or a replica set is required). Joins conditionally claim an
available seat and an unassigned user; failed claims roll back both documents.

## Challenges (players)

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| GET | `/challenges` | player, admin | G | List visible challenges. Item: `{ id, slug, title, category, difficulty, points, type, solveCount, solvedByMyTeam }`. `solveCount` is `null` for **players** (admins keep the live number) while a scheduled event's scoreboard is `frozen`, in this list and in `GET /challenges/:id`, so the live counter cannot be used to watch other teams; clients show a neutral dash. The response is `Cache-Control: private, no-store`, `Vary: Authorization`. Docker challenges (`type: 'docker'`) also carry `dockerAvailable` (boolean, additive): `false` when the server runs with `DOCKER_ENABLED=false` (Vercel), so clients can disable the Start button |
| GET | `/challenges/:id` | player, admin | G | Adds `description`, `attachments:[{name,url}]`, `hasInstance`, `myInstance` (see below) |
| POST | `/challenges/:id/submit` | player | G | Body `{ flag }`. Response `{ correct:boolean, pointsAwarded:number, firstBlood:boolean, message }`. 429 after 5 tries per minute per team per challenge. 409 if already solved. |

Phase 2 implementation notes (Challenges):
- Admins may browse (the two GET routes) but get 403 on submit and instance routes (roles are exact). Hidden challenges and malformed ids return 404 `NOT_FOUND`.
- Players without a team can list and read challenges (`solvedByMyTeam` is false). Submit and instance routes need a team: 404 `NO_TEAM`; banned teams get 403 `TEAM_BANNED`.
- Submit body is strict `{ flag }` (1-200 chars). A wrong flag returns 200 with `correct: false`. A correct flag returns 200 with `pointsAwarded` (base points, plus 10% on first blood, rounded down) and `firstBlood`. The rate limit (5 per minute per team per challenge) is counted in MongoDB, so it holds across replicas. A team that already solved it gets 409 `CONFLICT`, including the losing side of a double click.
- Correct submissions stop the team's instance of that challenge.

## Instances (Docker containers)

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| POST | `/challenges/:id/instance` | player | G | Start container for my team. Returns `{ id, status, url, expiresAt }`. Errors: `NO_TEAM`, `INSTANCE_LIMIT`, `ALREADY_RUNNING`, `NOT_DOCKER_CHALLENGE`, `NO_FREE_PORT`, and 503 `DOCKER_DISABLED` ("Docker challenges are only available when the platform is run locally.") when `DOCKER_ENABLED=false`. |
| GET | `/instances` | player | G | My team's active instances |
| POST | `/instances/:id/extend` | player | G | Adds 15 minutes, allowed once per instance |
| DELETE | `/instances/:id` | player | G | Stops and removes the container |

`myInstance` object: `{ id, challengeId, status: "starting|running|stopping", url, expiresAt, extended }`
(`POST .../instance` returns 201 with the same object; `GET /instances` returns an array of them).
Phase 2 notes: `INSTANCE_LIMIT`, `ALREADY_RUNNING` and a second extension are 409; `NO_FREE_PORT` is 503;
`NOT_DOCKER_CHALLENGE` is 400. `DELETE` returns 204. Instances are only visible to the owning team (others get 404).
Leaving a team as its last member stops that team's instances.

## Leaderboard

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| GET | `/leaderboard` | player, admin | H | `[{ rank, teamId, teamName, points, solves, lastSolveAt }]`, banned teams hidden. `points` includes admin score adjustments; `solves` counts real solves only |
| GET | `/leaderboard/timeline` | player, admin | H | `{ teams:[{ teamId, teamName, points:[{ t, score }] }] }` (top 10 teams) |
| GET | `/leaderboard/me` | player, admin | H | `{ frozen, asOf, team }`: only while a scheduled event's scoreboard is frozen does `team` hold the caller's OWN live `{ teamId, teamName, points, solves }`; otherwise `team: null` (see `docs/EVENT_MODE.md`) |

Other player views follow the same event view (frozen: up to `freezeAt`, ended: up to `endsAt`, admins live): `GET /feed` and `GET /players/:id/profile` only contain solves, badges and new teams up to that instant (profile counters, streak and `recentSolves` come from those rows only; a profile reads at most 1000 solves), with `Vary: Authorization`. `GET /me/achievements` and the own totals of `GET /teams/me` stay the caller's own live data.

Phase 3 implementation notes (`services/leaderboardService.js`, `routes/leaderboard.js`):
- Both endpoints accept `player` and `admin` (no token 401) and need no team, so team-less and banned-team players can read them. Banned and deleted teams are hidden.
- `rank` is the 1-based position. Order: points desc, then earliest `lastSolveAt`, then team name (case-insensitive), then team id, so ties are deterministic on every replica. Teams with no solves are appended with `points: 0`, `solves: 0`, `lastSolveAt: null`. `lastSolveAt` is an ISO string.
- Optional query `?limit=1..500` truncates the list after ranking (default: all teams). Anything else in the query string is ignored; an invalid `limit` is 400 `VALIDATION_ERROR`.
- Timeline: teams are in rank order (top 10 including zero-solve teams). Each `points` array starts with `{ t, score: 0 }` at the time of the earliest solve shown (the current time if there are no solves yet), then one entry per solve in `solvedAt` order with the running total (`solves.points`, bonus included). A chart should hold a score flat until the next entry.
- Responses contain only the fields above: no invite codes, member lists, emails, user ids or flag material. Nothing is cached in the process, so any replica returns the same data.
- **Scheduled event (optional, `docs/EVENT_MODE.md`).** While the event phase is `frozen`, `GET /leaderboard` and `/leaderboard/timeline` return, to **players**, the standings computed from solves with `solvedAt <= freezeAt` (same shapes; the list stays an array and is flagged with the headers `X-Scoreboard-Frozen: true` and `X-Scoreboard-As-Of`; the timeline gets the additive fields `frozen: true`, `asOf`). **Admins** always get live data. After `ended` players get the final standings, computed from solves with `solvedAt <= endsAt` (a request admitted just before the end that was stored a moment after it never counts; no frozen headers); admins stay live. With no event configured nothing changes.

## Terminal (Arena Terminal)

A Unix-terminal CTF mode (design and engine contract: `docs/ARENA_TERMINAL.md`). Players type commands into a
**virtual** shell and find hidden codes (flags) in three modes: `easy`, `medium`, `hard`. All routes are mounted at
`/api/terminal` and need `Authorization: Bearer <ID token>`.

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| GET | `/terminal/modes` | player, admin | API | `[{ mode, title, tagline, difficulty, codes, solved, points, pointsEarned, lore }]` |
| GET | `/terminal/:mode/progress` | player, admin | API | `{ mode, total, solved:[{ n, title, points, firstBlood }], remaining, hint? }`. Players with a team also get `hint: { code, total, base, opened:[tier numbers, 1-based], pricing:[{ index, tier, percent, points }], spent:{ points, percent, cap } }` for the code the in-shell `hint` command targets (the lowest unsolved code that has hints; no hint text); absent for admins and when nothing is left (see Hint costs) |
| POST | `/terminal/:mode/exec` | player, admin | API | Body `{ command, cwd, mailSeen? }` (`mailSeen`: optional integer 0..4095, a cosmetic bit mask of mails the browser has read, used only to print unread letters in `mail`). Response `{ output, cwd, exit, effect? }`. The in-shell `hint [n]` command records the opened tier server-side for players (scope `terminal`, key `<mode>:<code>`; the reply text is unchanged); admins record nothing. Unknown fields or an out-of-range `mailSeen` are 400 |
| POST | `/terminal/:mode/complete` | player, admin | API | Body `{ partial, cwd }`. Response `{ matches: string[] }` (at most 50) |
| POST | `/terminal/:mode/submit` | player | API | Body `{ flag }`. Response `{ correct, code?, title?, alreadySolved?, pointsAwarded, hintCost?, firstBlood, message, solved, total }` (`pointsAwarded` is net of the hint cost; `hintCost` only when something was deducted) |

Notes:
- **Roles.** `modes`, `progress`, `exec` and `complete` accept `player` and `admin`; `submit` is `player` only (an admin
  gets 403 `FORBIDDEN`). No token is 401 `UNAUTHENTICATED`.
- **Mode.** `:mode` must be `easy`, `medium` or `hard`; anything else is 404 `NOT_FOUND` (before the body is validated).
- **Teams.** Flags are per team, so `exec`, `complete` and `submit` need a team for players: 404 `NO_TEAM` without one,
  403 `TEAM_BANNED` for a banned team. Admins need no team: they explore with a preview flag set that no team can submit.
  `modes` and `progress` are read-only and also work for players without a team or with a banned team (`solved` is 0 and
  `solved: []` without a team), like `GET /challenges`.
- **Not seeded.** The Arena Terminal uses the `challenges` documents created by `npm run seed:terminal`. When a mode has none
  (or an admin hid all of them), `exec`, `submit` and `progress` return 503 `TERMINAL_NOT_SEEDED` with the message
  `Run npm run seed:terminal.`; `modes` still lists the mode from its definition.
- **Validation.** Every body is `.strict()` (unknown keys are 400 `VALIDATION_ERROR`). `command` is a string of at most
  300 characters (it may be empty), `partial` and `cwd` at most 200, `flag` 1-200 after trimming. `cwd` is optional: a
  missing, relative or malformed `cwd` (or one that does not exist in the virtual filesystem) falls back to the mode's
  home directory. The `cwd` in the response is normalized; send it back on the next call. The server keeps no session.
- **`exec`** runs the command line in the JavaScript shell engine (`backend/src/terminal/shell.js`) over an in-memory
  filesystem: nothing real is executed. Output is deterministic, so every replica prints the same bytes. `effect` is
  one of `clear`, `matrix`, `reboot`, `confetti` and is omitted when the command has none. The output may contain the
  calling team's own flags (that is the exercise); another team's flags never validate.
- **`exec` pacing (fair play).** For players only (admins are exempt), before the command runs: a command less than
  **300 ms** after the same user's previous executed command, or the 51st or later command within one UTC minute, is
  429 `SLOW_DOWN` with the message `Easy there, speed typist. Give each command a moment.` (nothing runs, and a command
  rejected for the 300 ms floor is not counted and does not move the clock). Clients should show the message and let the
  user retry. The counters live in MongoDB (`terminalactivities`), so every replica applies the same rule. Commands
  such as `ai-verify` get a believable reply instead of running; this is deliberate and is described in
  `docs/FAIR_PLAY.md`. Nothing here ever bans anyone.
- **`submit` and decoy flags.** A wrong flag that equals a tainted decoy flag (one handed out by a decoy path or a canary
  reply) gets the same 200 incorrect answer as any wrong flag; only an admin-visible signal is recorded. The same applies
  to `POST /challenges/:id/submit`.
- **`modes`** has one entry per mode. `codes` is the number of codes, `points` their total, `solved` and `pointsEarned`
  are my team's solved count and earned points (first-blood bonus included), `lore` is the boot text (plain lines).
- **`progress`** lists only solved codes. The `title` of a code is shown only after the team solved it (the UI shows
  `???` until then); `points` is what the team earned for it and `firstBlood` whether it was the first team.
- **`submit`** compares the flag in constant time against the team's expected flags of every code of the mode. A
  wrong flag is 200 `{ correct:false, pointsAwarded:0, firstBlood:false, message, solved, total }` (no `code`/`title`).
  A correct flag records a solve exactly like `POST /challenges/:id/submit` (points, +10% first blood, leaderboard) and
  returns `code`, `title`, `pointsAwarded`, `firstBlood`. A code the team already solved (including the losing side of a
  double click) is 200 `{ correct:true, alreadySolved:true, code, title, pointsAwarded:0, firstBlood:false, ... }`,
  not an error. At most **10 attempts per minute per team per mode** (all codes of the mode together), counted in
  MongoDB over `submissions`; the 11th is 429 `RATE_LIMITED`. Wrong attempts are stored against the mode's first code.
- **No leaks.** No response contains a flag, flag hash, expected flag or the submitted flag, except the team's own
  flags inside `exec` output when the terminal prints them. `solved` titles come from the mode definition.
- A terminal challenge an admin hid (`visible: false`) is switched off for the Arena Terminal: it is not counted in `codes` or
  `total`, `submit` does not accept it, and its `{{flag:N}}` token prints a placeholder that never validates.
- Terminal challenges also exist as normal `challenges` documents with `type: "terminal"` and `category: "terminal"`
  (they appear in `GET /challenges`; the web UI shows one promo card instead of the cards). Their flags follow the
  dynamic per-team format of docker challenges, so `POST /challenges/:id/submit` would accept them too; the Terminal
  page uses `/terminal/:mode/submit`.

## Cipher Lab (cryptography category)

Design, levels and points: `docs/CIPHER_LAB.md`. Mounted at `/api/cipherlab`; all routes need `Authorization: Bearer <ID token>`.
Level ids are `e1`-`e4`, `m1`-`m4`, `h1`-`h4`, `i1`-`i3` (anything else is 404 `NOT_FOUND`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/cipherlab/overview` | player, admin | `{ maxPoints, pointsEarned, solved, total, streak, tracks:[{ id, title, difficulty, story, hintsAllowed, total, solved, maxPoints, pointsEarned, complete, speedrun:{ ms, badge }\|null, levels:[{ id, n, title, points, boss, status: solved\|open\|locked, solvedAt, hintsTotal }] }], toolbox:[{ id, name, description, unlockedBy, unlocked }] }`. For admins every `toolbox[].unlocked` is `true` |
| GET | `/cipherlab/levels/:id` | player, admin | This team's puzzle: `{ id, track, n, title, briefing, points, boss, status, ciphertext, params, hintsAllowed, hintsTotal, hints:[opened texts], hintPricing?, hintSpent? }`. For admins `hints` holds all hint texts and the two cost fields are absent |
| POST | `/cipherlab/levels/:id/hints` | player, admin | Body `{}`. Opens the next hint: `{ index, hint, used, total, cost, spent }` (`cost: { percent, points, tier }`, `spent: { points, percent, cap }`, see Hint costs); logged for admins. For an admin (preview puzzle) it returns `{ index, hint, used, total, hints:[all texts] }` (no `cost`/`spent`) and writes no `cipherhints` row; Insane levels give 403 `NO_HINTS` to admins too |
| POST | `/cipherlab/levels/:id/answer` | player | Body `{ answer }`. Wrong: `{ correct:false, pointsAwarded:0, firstBlood:false, message, streak:0 }`. Right: `{ correct:true, alreadySolved, pointsAwarded, firstBlood:false, flag, message, streak, trackComplete, nextLevelId, badges? }` (`badges` only when a new solve earned achievements) |
| GET | `/cipherlab/admin/hints` | admin | Newest 200 hint openings: `[{ teamId, levelId, hint, at }]` |

Notes:
- Puzzles are derived per team from `HMAC(FLAG_SECRET, teamId + levelId)`; the plaintext and flag are never sent, except the
  caller's own flag in the response to a correct answer. Admins see the preview puzzle (`admin-preview`) and cannot answer; they can read hints (nothing is stored).
- Errors: 404 `NO_TEAM`, 403 `TEAM_BANNED`, 403 `LEVEL_LOCKED` (previous level of the track not solved), 403 `NO_HINTS`
  (insane track), 409 `NO_MORE_HINTS`, 429 `RATE_LIMITED` (8 attempts per team per level per minute, Mongo-backed),
  503 `CIPHERLAB_NOT_SEEDED` (`npm run seed:cipherlab`). `overview` also works without a team.
- The `pipeline` tool unlocks by clearing level `h3`.
- Points are fixed per level with no first-blood bonus (`firstBlood` is always false). Maximum 2060 in total.
## Web Exploit Lab

Simulated vulnerable sites, attacked through a request inspector (design, safety rules, labs and points:
`docs/WEB_EXPLOIT_LAB.md`). All routes are mounted at `/api/weblab`, need `Authorization: Bearer <ID token>`, and are
backed by `challenges` rows with `type: "weblab"` created by `npm run seed:weblab`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/weblab/labs` | player, admin | `{ tracks: [{ id, title, difficulty, theme, company:{ name, tagline, brief }, labs:[lab], solved, total, points, pointsEarned, cleared }], totals: { labs, solved, points, pointsEarned, bountyUsd }, inspector }` |
| GET | `/weblab/labs/:slug` | player, admin | One lab: summary fields plus `{ story, objective, company, theme, site, form, request, inspector }`. Players with a team also get `hintsOpened:[levels, 1-based]`, `hintPricing:[{ index, tier, percent, points }]` (hints still closed, index 0-based, no text) and `hintSpent:{ points, percent, cap }`; admins get none (see Hint costs) |
| POST | `/weblab/labs/:slug/hints/:level` | player, admin | Body `{}` (strict; extra fields are 400). The old `GET` of this path no longer exists (404). `{ level, count, text, cost, spent }` for players (one hint per request, 1..`hintCount`; the open is recorded for the team and priced at that moment, idempotent per lab and level: a repeat answers with the stored price; `cost: { percent, points, tier }` of this hint, cumulative over the cheaper tiers not yet open, `spent: { points, percent, cap }` of the lab so far). Players need a team that may play (404 `NO_TEAM`, 403 `TEAM_BANNED`). Admins get `{ level, count, text }` and nothing is recorded |
| POST | `/weblab/labs/:slug/request` | player, admin | Body `{ method, path, headers, cookies, body }`. Response `{ status, contentType, body, setCookies, page, exploited, hint }` |
| POST | `/weblab/labs/:slug/submit` | player | Body `{ flag }`. Response `{ correct, pointsAwarded, hintCost?, firstBlood, message, severity?, bountyUsd?, alreadySolved? }` |

Notes:
- `:slug` is `weblab-<lab id>`; unknown or malformed slugs are 404 `NOT_FOUND`. A lab summary is
  `{ id, slug, title, summary, track, boss, points, hintCount, available, solved, pointsEarned, locked, lockedReason, severity, bountyUsd }`;
  `severity` and `bountyUsd` (cosmetic bug bounty badge) are `null` until the team solved the lab.
- **Locks.** A boss lab is locked until the other labs of its track are solved, the insane lab until the hard boss is
  solved. Requests, hints and submits for a locked lab are 403 `LAB_LOCKED`; `GET /labs/:slug` returns `request: null`.
  Admin previews are never locked.
- **Teams.** `request` and `submit` need a team for players (404 `NO_TEAM`, 403 `TEAM_BANNED`); the read routes work
  without one. `submit` is player only (an admin gets 403 `FORBIDDEN`). Admins attack with a preview flag set no team can submit.
- **Not seeded.** `request`, `hints` and `submit` return 503 `WEBLAB_NOT_SEEDED` (`Run npm run seed:weblab.`) when the
  lab has no visible row; the lists still render from the built-in definitions.
- **Validation.** Bodies are `.strict()`: `method` is one of GET POST PUT PATCH DELETE HEAD OPTIONS; `path` starts with
  `/` and has at most 300 characters; `headers` at most 20 entries (name 40, value 500); `cookies` at most 10 (name 40,
  value 500); `body` at most 2000 characters; `flag` 1-200 after trimming.
- **`request`** runs a pure-function simulation (no real network, database or file access). the response `body` (the simulated site's
  output) is capped at 8000 characters; the request body is capped at 2000 (see Validation). `page` is a structured document `{ title, blocks }` (`heading`, `text`, `notice`, `code`, `table`, `kv`) or
  `null` for JSON answers; clients render it as text only. `exploited` is `true` when the simulated exploit succeeded and
  the body then contains the team's flag. A flag never appears otherwise.
- **`submit`** compares in constant time. Wrong: 200 `{ correct: false, pointsAwarded: 0, firstBlood: false, message }`.
  Correct: fixed lab points, **never a first-blood bonus** (`firstBlood` is always `false`), recorded with the normal
  unique solve index; a repeat (double click, other replica) is 200 `{ correct: true, alreadySolved: true, pointsAwarded: 0 }`.
- **Rate limits** (counted in MongoDB, same on every replica): 90 requests per team per minute (429 `RATE_LIMITED`);
  8 flag attempts per team per lab per minute (429 `RATE_LIMITED`).
- **`inspector`** is `{ level, unlocked: [id], features: [{ id, label, blurb, at, unlocked }], next }`; it grows with the
  number of solved labs and only gates browser conveniences.
- Maximum for the whole category is 1470 points (easy 120, medium 300, hard 550, insane 500).
## Forensics Desk (investigation category)

Detective category with four case files (`easy`, `medium`, `hard`, `insane`), five stages each (design, scoring and
the per-team generator: `docs/FORENSICS_DESK.md`). All routes are mounted at `/api/forensics` and need
`Authorization: Bearer <ID token>`. Unknown `:track` or `:artefact` values are 404 `NOT_FOUND`.

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| GET | `/forensics/tracks` | player, admin | API | `[{ id, title, caseTitle, difficulty, tagline, stages, solved, seeded, maxPoints, pointsEarned }]` |
| GET | `/forensics/tracks/:track` | player, admin | API | Case file: `{ id, title, caseTitle, difficulty, tagline, briefing[], artefacts[], maxPoints, stages[], evidence[], suspects[], solved, total, pointsEarned, caseClosed }`. Each stage: `{ n, title, prompt, points, format, hint, hasHint, whodunit, solved, locked, available, ... }`. `hint` is the text only after the team opened it (always `null` before; admins see it), `hasHint` says whether the stage has one. Players with a team also get per stage with a hint: `hintOpened`, `hintPricing:[{ index:0, tier, percent, points }]` (empty once opened) and `hintSpent:{ points, percent, cap }` |
| GET | `/forensics/tracks/:track/artefacts/:artefact` | player, admin | API | One chunk of generated evidence (query below) |
| GET | `/forensics/tracks/:track/interviews` | player, admin | API | Suspect interviews: `{ questions:[{ id, stage, text }], suspects:[{ id, name, role }] }`. One yes/no question per solved evidence stage (at most 3), quoting only that stage's confirmed evidence |
| POST | `/forensics/tracks/:track/interviews` | player, admin | API | Body `{ suspectId: 's1'.., questionId: 'q1'.. }` (strict). Response `{ suspectId, questionId, answer: 'yes'\|'no', statement }`. Suspects do not always tell the truth: the culprit denies every question and each decoy tells exactly one false "no"; with two or more solved stages the culprit is the unique suspect with two or more false denials (shapes unchanged, see `docs/FORENSICS_DESK.md`). 400 validation, 404 unknown track/suspect or question not yet unlocked, 429 `RATE_LIMITED` (20 per minute, 120 per hour per team and case, keyed `forensics:<team>:<track>:interview:<i>`). No score and no stored state; admins read the preview world |
| POST | `/forensics/tracks/:track/stages/:n/hint` | player, admin | API | Body `{}` (strict). Opens the stage hint: `{ index:0, hint, used:1, total:1, cost:{ percent, points, tier }, spent:{ points, percent, cap } }`, recorded once per team and stage (scope `forensics`, key `<track>:<stage>`), idempotent; charged when the stage is solved. 403 `NO_HINTS` (hard and insane tracks, the whodunit stage), 404 unknown track or stage, 404 `NO_TEAM` / 403 `TEAM_BANNED` for players. Admins get `{ index, hint, used, total }` free and nothing is recorded |
| POST | `/forensics/tracks/:track/stages/:n/answer` | player | API | Body `{ answer }` (1-200 chars). Response `{ correct, pointsAwarded, hintCost?, firstBlood:false, message, solved, total, flag?, alreadySolved?, caseClosed? }` |

- `stages[]`: `{ n, title, prompt, points, format, hint (string or null), whodunit, solved, locked, available, pointsEarned?, flag? }`.
  `flag` appears only on stages the team solved. `evidence[]` is `{ n, title, value }` for solved stages only.
  `suspects[]` is `{ id, name, role, facts:[{ label, stage, value }] }`; a fact `value` is `null` until the stage
  that proves it is solved.
- Artefacts per track: easy `log`; medium `capture`; hard `hexfile`, `exif`, `stego`, `disk`; insane `log`, `capture`,
  `stego`, `disk`. Query (all optional, anything else is 400): `offset` (0-100000), `limit` (1-500, clamped to the
  artefact's page maximum: 500 log lines, 250 packets, 1024 file bytes), `cluster` (0-255) with `count` (1-8) for the
  disk reader, `image` (1-4) for the insane `stego` pictures. Responses: `log` `{ total, offset, lines[] }`; `capture`
  `{ total, offset, packets:[{ n, t, src, sp, dst, dp, sm, dm, proto, len, info, hex }], start }`; `hexfile`
  `{ name, size, offset, hex }`; `exif` `{ name, tags:[{ tag, value }] }`; `stego`
  `{ image, images, width, height, pixels (base64 RGB), encoding }`; `disk` without `cluster`
  `{ clusterSize, clusterCount, entries:[{ inode, name, size, mtime, deleted, cluster }] }`, with `cluster`
  `{ clusters:[{ n, hex }] }`. Artefacts are generated from the team's seed on every call; admins see a fixed preview
  set that no team shares.
- `answer`: the final stage of every track (`whodunit`) is 403 `STAGE_LOCKED` until the other four are solved. A
  correct answer records the solve (fixed points, never a first-blood bonus) and returns the team's own `flag`; a
  repeat (or a parallel double click) returns `alreadySolved: true` with `pointsAwarded: 0`. A wrong answer is 200
  with `correct: false` and a playful message, and never reveals anything about the right one. Attempts are limited
  per team and per stage, counted in MongoDB: 8 per minute and 40 per hour (whodunit: 3 per minute and 8 per hour);
  beyond that 429 `RATE_LIMITED`. 503 `FORENSICS_NOT_SEEDED` until `npm run seed:forensics` has run.
- The flag is the proof of the solve; it is not submitted anywhere else (`POST /challenges/:id/submit` rejects
  forensics rows).

## Crackme Arcade (reverse-engineering category)

Design, ISA, levels and points: `docs/CRACKME_ARCADE.md`. Mounted at `/api/crackme`; all routes need
`Authorization: Bearer <ID token>`. Level ids are `e1`-`e4`, `m1`-`m4`, `h1`-`h4`, `i1`-`i4` (anything else is 404
`NOT_FOUND`). Backed by `challenges` rows with `type: "reversing"` created by `npm run seed:crackme` (503
`CRACKME_NOT_SEEDED` before that).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/crackme/overview` | player, admin | `{ maxPoints, pointsEarned, solved, total, streak, tracks:[{ id, title, difficulty, story, hintsAllowed, total, solved, maxPoints, pointsEarned, complete, levels:[{ id, n, title, points, boss, status: solved\|open\|locked, solvedAt, hintsTotal }] }] }` |
| GET | `/crackme/levels/:id` | player, admin | This team's cabinet: `{ id, track, n, title, briefing, points, boss, status, program:[[mnemonic, operand?]], inputMax, vm:{ version, codeBase, memSize, stackMax, codeMax, maxSteps }, hintsAllowed, hintsTotal, hints:[opened texts], hintPricing?, hintSpent? }`. 403 `LEVEL_LOCKED` until the previous cabinet of the track is solved |
| POST | `/crackme/levels/:id/hints` | player | Body `{}`. Opens the next hint: `{ index, hint, used, total, cost, spent }` (see Hint costs); logged for admins. 403 `NO_HINTS` on the insane track, 409 `NO_MORE_HINTS` |
| POST | `/crackme/levels/:id/answer` | player | Body `{ answer }` (1-32 printable ASCII characters, strict). The server runs the VM on it. Wrong: `{ correct:false, pointsAwarded:0, firstBlood:false, message, streak:0 }`. Right: `{ correct:true, alreadySolved, pointsAwarded, firstBlood:false, flag, message, streak, trackComplete, nextLevelId }` |
| GET | `/crackme/admin/hints` | admin | Newest 200 hint openings: `[{ teamId, levelId, hint, at }]` |
| POST | `/crackme/levels/:id/patch` | player | Patch Bay (bonus mode on h1-h4 and i1-i4). Body `{ edits: [{ index: int 0..255, op: string }] }` (1-20 edits, strict). Response `{ valid, passed, total, serialOk, badge, message }`. 400 `VALIDATION_ERROR`, `PATCH_EMPTY`, `PATCH_TOO_MANY`, `PATCH_SHAPE`, `PATCH_RANGE`, `PATCH_DUPLICATE`, `PATCH_NOT_ALLOWED`; 403 `LEVEL_LOCKED`, `TEAM_BANNED` or admin; 404 `NO_PATCH_BAY` (easy and medium) or `NOT_FOUND`; 429 `RATE_LIMITED` (8 per minute per team and cabinet; a bad-shape patch costs no attempt). Counts toward the submissions freeze. The reward is a cosmetic badge only; hidden inputs are never returned |

Patch Bay additions (additive): `GET /crackme/levels/:id` gains `patchBay` on h1-h4 and i1-i4 only: `{ maxEdits: 20, rules: { JNZ: ['JZ','POP'], JZ: ['JNZ','POP'], CMP: ['SUB','XOR'] }, tests: 6, steps: 20000, done }`.
`GET /crackme/overview` levels gain `patchBay` and `patched` booleans, and the top level gains `patchBadges` (number). Design: `docs/CRACKME_ARCADE.md`.

Notes:
- Programs are derived per team from `HMAC(FLAG_SECRET, "crackme:" + teamId + ":" + levelId)`; the accepted input and the
  flag are never sent, except the caller's own flag in the response to a correct answer. Admins see the preview
  cabinet (`admin-preview`) and cannot answer or open hints.
- Attempts: 8 per team per level per minute (429 `RATE_LIMITED`, counted in MongoDB, every attempt counts). Points are
  fixed per level and never include a first-blood bonus; the maximum for the whole category is 1905.
- The browser debugger runs the same `vm.js` with `DBG = 1`; the server verdict always uses `DBG = 0`.
## OSINT Trail (open-source investigation category)

Design, cases, points and the owner-only solution notes: `docs/OSINT_TRAIL.md`. All routes are mounted at `/api/osint`, need
`Authorization: Bearer <ID token>`, and are backed by `challenges` rows with `type: "osint"` created by `npm run seed:osint`.
The world of each team (a fully fictional cast, town, company, feed, registry, photos and pastes) is generated on every call from
`HMAC(FLAG_SECRET, 'osint:' + teamId + ':' + caseId)`; nothing is stored and nothing is fetched from the internet.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/osint/cases` | player, admin | `[{ id, title, caseTitle, difficulty, tagline, questions, solved, seeded, hints, maxPoints, pointsEarned }]` |
| GET | `/osint/cases/:track` | player, admin | Case file: `{ id, title, caseTitle, difficulty, tagline, story[], hintsAllowed, maxPoints, questions[{ n, title, prompt, points, format, kind, final, solved, locked, available, hintsTotal, hints[], hintPricing?, hintSpent?, pointsEarned?, confirmed?, flag? }], sources[{ id, label, total, max, fallback }], town, company, solved, total, pointsEarned, caseClosed }`. `confirmed` and `flag` exist only on solved questions |
| GET | `/osint/cases/:track/sources/:source` | player, admin | One page of one source (`feed`, `cast`, `pages`, `docs`, `registry`, `photos`, `pastes`, `map`): `{ source, total, offset, limit, items[] }`. Query (strict): `offset` 0..10000, `limit` 1..50, and the optional filters `author` (`cNN`) and `date` (`YYYY-MM-DD`) |
| GET | `/osint/cases/:track/search?q=&offset=&limit=` | player, admin | Search over the case corpus (`q` 2-64 chars, `offset` 0..1000, `limit` 1..20, default 10): `{ query, offset, limit, results:[{ source, id, title, snippet }], hasMore }` |
| POST | `/osint/cases/:track/questions/:n/answer` | player | Body `{ answer }` (1-200 chars). Response `{ correct, pointsAwarded, firstBlood:false, message, solved, total, flag?, alreadySolved?, caseClosed? }` |
| POST | `/osint/cases/:track/questions/:n/hints` | player | Body `{}`. Easy and medium only: opens the next hint `{ index, hint, used, total, cost, spent }` (see Hint costs), logged for admins |
| GET | `/osint/admin/hints` | admin | Newest 200 hint openings: `[{ teamId, key, hint, at }]` (`key` is `<track>:<n>`) |
| GET | `/osint/cases/:track/board` | player, admin | The team's shared evidence board: `{ version, pins:[{ id, kind, label, x, y }], links:[{ a, b, rel }], progress:{ level, total }, unlocked, nudge, limits:{ pins:40, links:2*M, size:1000 }, relations:[{ id, label, help }], readOnly }`. `readOnly` is true for admins, teamless players and banned teams (admins and teamless players get an empty preview board). `progress.level` is a coarse bucket, never an exact count: `complete` (the chain held at some save, sticky `unlocked`), `close` (all but at most one required link holds), `started` (at least half of the required links hold) or `none` (fewer than half, including zero). `total` is the number of required links |
| PUT | `/osint/cases/:track/board` | player | Body `{ version: int >= 0, pins:[{ id, x, y }], links:[{ a, b, rel }] }` (strict). `id`, `a`, `b` look like `kind:id` and must be real evidence ids in the team's world; `x`,`y` are integers 0..1000; `rel` is one of `posted`, `at`, `owns`, `mentions`, `linked`. Returns the GET shape. Errors: 400 `BAD_EVIDENCE` / `BAD_BOARD`, 403 `NO_TEAM`, 409 `BOARD_CONFLICT` (stale `version`), 422 `BOARD_LIMIT` (over 40 pins or 2*M links; nothing stored), 423 `SUBMISSIONS_FROZEN`, 429 `RATE_LIMITED` (30 per minute, 200 per hour per team and case). A save reveals only the coarse `progress.level`, `unlocked` and one generic nudge, never an exact count and never which links are missing. A complete chain sets `unlocked` for good |
| POST | `/osint/cases/:track/board/check` | player, admin | Body `{}` (strict). The explicit "Check my chain": `{ found, total, checksLeft, readOnly }` with the EXACT number of required links on the **saved** board (a draft that was not saved is not counted; once unlocked `found` equals `total`). It only reads: it never saves, unlocks or records anything. Strictly budgeted per team and case: 3 per minute and 10 per hour (key `osint-board-check:...`), 429 `RATE_LIMITED` beyond that; `checksLeft` is the smaller remaining budget. Admins, teamless players and banned teams get `{ found: 0, total, checksLeft: 0, readOnly: true }` and use no budget. 404 for an unknown case, 400 for any body field |
| GET | `/osint/cases/:track/board/evidence?source=&q=&offset=&limit=` | player, admin | Evidence picker: `{ total, offset, limit, items:[{ id, kind, label }] }` (`limit` at most 50) |

Board additions (additive): `GET /osint/cases/:track` gains `board: { required, unlocked }`, and the final question gains `lockedBy: 'questions' | 'board'` while locked. Answering or opening hints on a final question while the other questions are solved but the board has not held the chain returns 403 `BOARD_LOCKED` (403 `STAGE_LOCKED` still means unsolved questions). Design: `docs/OSINT_TRAIL.md` section 3b.

- `:track` is `easy | medium | hard | insane`; anything else is 404 `NOT_FOUND`. `:n` is the question number (the last one of a case
  is the final question).
- Source query: `offset` (0-10000), `limit` (1-50, capped per source: feed 50, cast 20, pages 20, docs 30, registry 20, photos 8,
  pastes 10, map 1); the feed also takes `author` (a cast id such as `c03`) and `date` (`YYYY-MM-DD`, the poster's own clock).
  Unknown query keys are 400. Search: `q` 2-64 characters (up to 4 whitespace-separated tokens, all must occur), `limit` 1-20
  (default 10), `offset` 0-1000. Every response is bounded (well under 100 KB); the corpus has a fixed size per case.
- Photos carry a `scene` (a short list of vector shapes: `r` rect, `c` circle, `p` polygon, `l` line, `t` text) that the browser
  draws as SVG; no markup is ever sent. Time stamps are ISO-8601 with the poster's own UTC offset.
- `answer`: the final question is 403 `STAGE_LOCKED` until every other question of the case is solved. Answers are normalised
  (names, dates, times, grid cells, domains, e-mail, IPs) and compared as SHA-256 digests with `timingSafeEqual`; map points count
  inside a 70-unit radius. A correct answer records the solve (fixed points from the case definition, never a first-blood bonus)
  and returns the team's own `flag`; a repeat (or a parallel double click) returns `alreadySolved: true` with `pointsAwarded: 0`.
  A wrong answer is 200 with `correct: false` and reveals nothing. Attempts are limited per team and per question, counted in
  MongoDB: 8 per minute and 40 per hour (final question: 3 per minute and 8 per hour); beyond that 429 `RATE_LIMITED`.
  503 `OSINT_NOT_SEEDED` until `npm run seed:osint` has run.
- `hints`: 403 `NO_HINTS` on hard and insane, 409 `NO_MORE_HINTS` when all hints of a question are open, 403 `STAGE_LOCKED` on a
  locked final question.
- Admins see a fixed preview world that no team shares and cannot answer (403 `FORBIDDEN`).

## Admin (role `admin`)

| Method | Path | Owner | Description |
|--------|------|-------|-------------|
| GET | `/admin/challenges` | G | All challenges including hidden |
| POST | `/admin/challenges` | G | Create. Body: see **Challenge body** below |
| PUT | `/admin/challenges/:id` | G | Update |
| DELETE | `/admin/challenges/:id` | G | Delete (also stops its instances) |
| GET | `/admin/stats` | H | `{ users, teams, solves, submissions, wrongRate, activeInstances, requestsByReplica:{ "backend-1": 120, ... } }`. On Vercel the per-replica request counter is off, so `requestsByReplica` is `{}` |
| GET | `/admin/instances` | H | All active instances with team and challenge names |
| POST | `/admin/instances/:id/kill` | H | Force stop |
| GET | `/admin/teams` | H | All teams with score and ban state |
| PATCH | `/admin/teams/:id/ban` | H | Body `{ banned: true|false }` |
| GET | `/admin/integrity` | fair play | Users ranked by fair-play risk with their signals. Query `limit` 1-200 (default 50) |
| DELETE | `/admin/integrity/:userId` | fair play | Dismiss (delete) that user's signals. 204 |

Admin responses never contain a flag or hash. They return the challenge fields plus `hasFlag` (static only),
`terminal` (`{ mode, code }` for Arena Terminal challenges, otherwise `null`), `visible`, `solveCount` and `createdAt`.
Attachment `url` must be a same-site path starting with a single `/` or an `http(s)://` URL without spaces or control characters (anything else, such as `javascript:`, `data:` or `//host`, is 400 `VALIDATION_ERROR`). `PUT` takes the same body as create; for static challenges omitting `flag` keeps the stored hash. `image` must start
with `ctf/`. Duplicate slugs return 409 `CONFLICT`. Deleting a challenge stops its instances; existing solves are kept.

Terminal challenges (`type: "terminal"`, `category: "terminal"`) are listed like any other, but they are created only by
`npm run seed:terminal`: `POST` with `type` or `category` `terminal` is 400 `VALIDATION_ERROR`. An admin may `PUT` one
(for example `points`, `visible`, `title`) by sending the same fields with `type: "terminal"` and `category: "terminal"`;
its `slug` cannot change (the flag derives from it), it cannot be converted to or from another type, and a `flag` is
rejected (nothing is stored). Re-running the seed resets `title`, `description`, `points` and `difficulty` to the mode
definition and keeps `visible` and `solveCount`.

Code-defined range challenges (`type` `game`, `weblab`, `forensics`, `reversing` or `osint`, for example the Cipher Lab levels and Web Exploit Lab labs) define their own points, flags and rules in code, so
an admin may `PUT` only `title`, `description` and `visible` (any subset, at least one). The body is not the full create
body: other definition fields (`slug`, `category`, `difficulty`, `points`, `type`, `image`, `internalPort`,
`attachments`) are accepted only when they equal the stored value (a form may echo the whole object back); a different
value, a `flag` or an unknown key is 400 `VALIDATION_ERROR`. These challenges also cannot be duplicated, imported over
(`mode: "update"` reports an error for them) or exported, and a `PUT` that tries to convert one to another type is 400.
Terminal challenges keep the behaviour described above.

**Fair-play review (`/admin/integrity`)** (design and thresholds: `docs/FAIR_PLAY.md`)

`GET /admin/integrity?limit=50` returns 200, highest risk first (ties: most recent signal, then user id):
```json
[{ "userId": "665f...", "displayName": "Alice", "teamName": "Rustaceans", "risk": 7,
   "signals": [
     { "kind": "tainted-flag", "detail": "from:Bob", "count": 1, "severity": 3,
       "firstAt": "2026-11-04T12:06:00.000Z", "lastAt": "2026-11-04T12:06:00.000Z" },
     { "kind": "honeypot-endpoint", "detail": "/api/v1/flags", "count": 2, "severity": 2,
       "firstAt": "2026-11-04T12:01:00.000Z", "lastAt": "2026-11-04T12:05:00.000Z" } ] },
 { "userId": null, "displayName": "anonymous scrapers", "teamName": null, "risk": 12, "signals": [ "..." ] }]
```
- `risk` is the sum over the user's signals of `severity * min(count, 5)`. `signals` are ordered by severity, then
  most recent. `kind` is one of `honeypot-endpoint`, `tainted-flag`, `terminal-canary`, `terminal-velocity`,
  `terminal-cadence`, `automation-ua`; `detail` is short context (a decoy path, `from:<display name | self | anonymous>`
  for a reused decoy flag, `<mode>:<first 60 chars>` for a canary command, a user-agent family such as `curl` or
  `missing`). `teamName` is `null` without a team.
- Signals of callers that are not signed-in users (keyed by a salted address hash) appear as ONE entry with
  `userId: null` and `displayName: "anonymous scrapers"`, merged per kind and detail, counts only. No emails, address
  hashes or flags are ever returned. `limit` outside 1-200 or not an integer is 400 `VALIDATION_ERROR`.
- `DELETE /admin/integrity/:userId` deletes every signal recorded for that user (it does not touch other users'
  signals about the same flags) and returns 204 with no body, also when there was nothing to delete. A malformed id is
  404 `NOT_FOUND`. Both routes need the exact `admin` role: no token 401 `UNAUTHENTICATED`, players 403 `FORBIDDEN`.
- Signals are evidence for a human decision. Nothing in the platform bans, hides or penalises anyone automatically.

**Phase 3 implementation notes (stats, instances, teams)**
- All five routes need the exact `admin` role: no token 401 `UNAUTHENTICATED`, players 403 `FORBIDDEN`.
  Ids in paths are validated like the challenge routes: a malformed id is 404 `NOT_FOUND`.
- Nothing here ever returns a flag, flag hash, container id, invite code or email.

`GET /admin/stats` returns 200:
```json
{ "users": 12, "teams": 5, "solves": 9, "submissions": 8, "wrongRate": 0.25,
  "activeInstances": 3, "requestsByReplica": { "backend-1": 120, "backend-2": 80 } }
```
`users` counts every user (players and admins). `submissions` is the number of stored attempts, which
expire after 30 days (see `DATABASE_SCHEMA.md`). `wrongRate` is wrong submissions / total submissions as a
fraction between 0 and 1, and `0` when there are no submissions. `activeInstances` counts instances whose
status is `starting`, `running` or `stopping`. `requestsByReplica` maps each replica hostname (the value of
`X-Served-By`) to the number of `/api/*` requests it has served, not counting `/api/health`. The counter
lives in MongoDB (`replicastats`): each replica buffers counts in memory and adds them with one atomic `$inc`
upsert about every 5 s and on SIGTERM, so the numbers lag by a few seconds and a hard crash can lose up to
that window. A replica that has served nothing for 30 days drops out of the map.

**Replica names.** The keys are the exact `X-Served-By` values, i.e. the container hostnames. In Docker Compose
that is the 12-character container id (for example `3f2a9c1b7d4e`), the same text the website footer shows as
"Served by", so a dashboard row can be matched to what a page view reported. They are not friendly names on
purpose: a fixed `hostname:` in `docker-compose.yml` would give every scaled replica the same name and defeat the
load-balancing demo, and a derived label (`backend-1`) would shift whenever a replica is replaced. To map an id to
a Compose container run `docker ps --filter name=backend --format '{{.ID}}  {{.Names}}'`. Replicas that a deploy
replaced keep their row until the 30-day expiry, so after several deploys the map also lists ids of containers that
no longer exist (their counts no longer grow).

`GET /admin/instances` returns 200 with the active instances, oldest first:
```json
[{ "id": "...", "status": "running", "port": 30001, "url": "http://<PUBLIC_HOST>:30001",
   "expiresAt": "2026-11-04T12:00:00.000Z", "extended": false,
   "team": { "id": "...", "name": "Rustaceans" },
   "challenge": { "id": "...", "slug": "cookie-monster", "title": "Cookie Monster" } }]
```
If the team or challenge was deleted, its `name` (or `slug` and `title`) is `null` and the id is kept.

`POST /admin/instances/:id/kill` stops and removes the container through the same atomic claim the player
`DELETE /instances/:id` uses and returns 204 with no body. 404 `NOT_FOUND` if the instance does not exist or is
not stoppable any more (already stopped or failed). Unlike the player route and the reaper, the kill is forced
(`instanceService.stop(id, { force: true })`): it also takes over an instance stuck in `stopping` after a crashed
replica, so such an instance can be cleaned up from the dashboard instead of returning 404. A Docker failure
returns the generic 500 `SERVER_ERROR`, puts the instance back to `running`, and the call can be repeated.

`GET /admin/teams` returns 200, highest score first (ties by name):
```json
[{ "id": "...", "name": "Rustaceans", "members": 3, "score": 210, "banned": false, "solves": 2 }]
```
`members` is the member count (0 to 3), `score` is the sum of the team's `solves.points` and `solves` is the
number of solves; both are 0 for a team without solves.

`PATCH /admin/teams/:id/ban` takes the strict body `{ "banned": true }` or `{ "banned": false }` (anything else,
including strings, numbers or extra fields, is 400 `VALIDATION_ERROR`) and returns 200 `{ "id", "name", "banned" }`;
an unknown team is 404 `NOT_FOUND`. Banning sets the flag first and then stops every running instance of the team
(`instanceService.stopTeamInstances`). It is idempotent: if stopping fails the response is 500 `SERVER_ERROR`, the
team stays banned, and repeating the call finishes the cleanup. Unbanning only clears the flag and never restarts
anything. A banned team already gets 403 `TEAM_BANNED` on the submit and instance routes.

**Challenge body (create / update)**
```json
{
  "slug": "cookie-monster",
  "title": "Cookie Monster",
  "category": "web",
  "difficulty": "easy",
  "points": 100,
  "description": "Markdown text shown to players",
  "type": "docker",
  "image": "ctf/cookie-monster",
  "internalPort": 80,
  "flag": "only for type=static (plain text, stored hashed)",
  "attachments": [{ "name": "cipher.txt", "url": "/files/cipher.txt" }],
  "visible": true
}
```
`category`: `web | crypto | forensics | misc | pwn` (plus `terminal`, update only). `difficulty`: `easy | medium | hard`.
`type`: `static | docker` (plus `terminal`, update only; see above).

---

## Achievements, profile, feed and daily spotlight (cosmetic)

None of these change points or ranking (`docs/ACHIEVEMENTS.md`). All need a token (`player` or `admin`, no team needed).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/players/:id/profile` | Public-safe profile: `{ id, displayName, team: { name } or null, solves, firstBloods, streak: { current, best }, badges: [{ key, name, description, icon, unlocked, awardedAt }], recentSolves: [{ category, difficulty, firstBlood, solvedAt }] }`. No email, flag, invite code, points or challenge titles. Malformed or unknown id is 404. A banned team's name is hidden. |
| GET | `/me/achievements` | The caller's catalog: `{ id, unlocked, total, streak, badges }` (same badge shape). |
| GET | `/feed?limit=1..50` | Newest public events (default 20): `{ type: solve or first_blood or badge or team, at, team, challenge or badge }`. Team names and challenge titles only; banned teams and hidden challenges are skipped. `Cache-Control: private, max-age=5`. Invalid `limit` is 400. |
| GET | `/daily` | `{ date, bonusLabel, resetsAt, challenge: { id, slug, title, category, difficulty, points } or null }`. Deterministic per UTC day. `Cache-Control: private, max-age=60`. |

`POST /challenges/:id/submit`, `POST /terminal/:mode/submit`, `POST /cipherlab/levels/:id/answer`, `POST /crackme/levels/:id/answer` and `POST /osint/cases/:track/questions/:n/answer`, `POST /weblab/labs/:slug/submit` and the Forensics submit answer may add an optional `badges: [{ key, name, description, icon }]`
to a correct answer when new badges were just earned. The field is absent otherwise.
## Admin API v2

Everything below is under `/api/admin` and needs the exact `admin` role (no token 401 `UNAUTHENTICATED`, players 403
`FORBIDDEN`, checked before any data is read). It extends the routes above; the routes above keep their shapes.
Owner: admin backend session (users, solves, submissions, audit, settings, exports, stats overview, challenge tools,
integrity review). Code: `backend/src/routes/admin/*`, `backend/src/services/admin*.js`.

### Conventions

- **Ids** in paths are 24-hex ObjectIds; a malformed id is 404 `NOT_FOUND`. Ids in query strings must be 24-hex or the
  call is 400 `VALIDATION_ERROR`. Query strings are strict: unknown parameters are 400.
- **Paginated lists** take `page` (default 1), `limit` (1-100, default 25), `q` (search text, 1-100 chars, matched
  case-insensitively as a literal, never as a regex), `sort` (`field` or `-field` for descending, one of the resource's
  sortable fields) plus resource filters, and answer:
  ```json
  { "items": [ ], "page": 1, "limit": 25, "total": 137 }
  ```
  Ties are broken by id, so pages are stable. Dates are ISO 8601 UTC strings. Booleans in a query string are the text
  `true` or `false`.
- **Legacy list routes** `GET /admin/teams`, `GET /admin/challenges` and `GET /admin/instances` return the bare array
  documented above when called with NO query parameter, and the paginated envelope when called with ANY query parameter
  (for example `?page=1`). New UI code should always send `page`.
- **Errors** are the standard `{ "error": { "code", "message" } }`. Codes added here: `CANNOT_BAN_ADMIN` (409),
  `NOT_A_MEMBER` (409), `TEAM_NOT_EMPTY` (409), `ACTOR_NOT_FOUND` (409: the admin has no user row yet, open
  `GET /api/me` once), `CONFLICT` (409), `USER_BANNED` (403, player routes), `SUBMISSIONS_FROZEN` (423, player routes).
- **Destructive actions** need an explicit confirmation: body `{ "confirm": true }` (POST) or `?confirm=true` (DELETE).
  Without it the answer is 400 and nothing changes.
- **Audit**: every mutating call below writes an audit entry (see `GET /admin/audit`). Entries never contain flags, flag
  hashes, invite codes, container ids or tokens. The audit write happens after the change succeeded: if it fails, the error is logged and the response is still the mutation's success (never a 500 for an action that completed).
- **Never returned**: flags, flag hashes or salts, submitted flag text or its hash, container ids, `cognitoSub`, invite
  codes (the single exception is the response of invite-code regeneration). Emails ARE returned, but only by the user
  endpoints, the team detail and the users CSV, because admins need them for support.
- **Roles** are not managed here. A user is an admin when the verified Cognito token carries the `admin` group; adding
  or removing that group is done in AWS Cognito (out of scope, no AWS call is made by this API).

### Endpoint index

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/stats` | Legacy totals (unchanged) |
| GET | `/admin/stats/overview?days=14` | Dashboard: totals, series, top teams, challenge stats, terminal, instances |
| GET | `/admin/stats/timeseries?days=14` | Daily series only |
| GET | `/admin/users` | Users list (search, filters) |
| GET | `/admin/users/:id` | User detail |
| PATCH | `/admin/users/:id/ban` | Ban / unban a user |
| POST | `/admin/users/:id/remove-from-team` | Remove the user from their team |
| POST | `/admin/users/:id/reset-terminal` | Reset the user's terminal progress (confirm) |
| GET | `/admin/teams` | Teams list (legacy array or paginated) |
| GET | `/admin/teams/:id` | Team detail with members and timeline |
| PATCH | `/admin/teams/:id/ban` | Ban / unban (unchanged) |
| PATCH | `/admin/teams/:id` | Rename |
| DELETE | `/admin/teams/:id?confirm=true` | Delete an empty team |
| DELETE | `/admin/teams/:id/members/:userId` | Remove a member |
| POST | `/admin/teams/:id/invite-code/regenerate` | New invite code |
| POST | `/admin/teams/:id/score-adjustments` | Manual +/- score with a reason |
| GET | `/admin/challenges` | List (legacy array or paginated) |
| POST / PUT / DELETE | `/admin/challenges[/:id]` | CRUD (unchanged, now audited) |
| PATCH | `/admin/challenges/:id/visibility` | Publish / hide |
| POST | `/admin/challenges/:id/duplicate` | Hidden copy |
| GET | `/admin/challenges/:id/stats` | Per-challenge submission stats |
| POST | `/admin/challenges/:id/reset-solves` | Delete every solve of a challenge (confirm) |
| GET | `/admin/challenges/export` | Definitions as JSON, no flags |
| POST | `/admin/challenges/import` | Bulk create / update from that JSON |
| GET | `/admin/solves` | Solves and score adjustments |
| DELETE | `/admin/solves/:id` | Delete a bogus solve |
| GET | `/admin/submissions` | Flag attempts (never the text) |
| GET | `/admin/integrity` | Legacy risk list (unchanged) |
| GET | `/admin/integrity/summary` | Counts per signal kind |
| GET | `/admin/integrity/users` | Filtered, paginated review list |
| POST | `/admin/integrity/:userId/resolve` | Resolve with a note |
| DELETE | `/admin/integrity/:userId` | Dismiss (unchanged, now audited) |
| GET | `/admin/instances` | Active instances (legacy array or paginated) |
| POST | `/admin/instances/:id/kill` | Force stop (unchanged, now audited, Docker-safe) |
| GET | `/admin/audit` | Audit log |
| GET / PUT | `/admin/settings` | Platform settings |
| GET | `/admin/export/{users,teams,submissions,leaderboard}.csv` | CSV downloads |
| GET | `/announcement` | PUBLIC banner and platform flags (no `/admin`, no token) |
| GET | `/event` | PUBLIC scheduled-event phase and times (no `/admin`, no token) |

### Stats

`GET /admin/stats` is unchanged (see above).

`GET /admin/stats/overview?days=14` (`days` 1-90, default 14):
```json
{
  "generatedAt": "2026-11-22T10:00:00.000Z",
  "totals": { "users": 120, "teams": 40, "solves": 310, "submissions": 1500, "wrongRate": 0.62,
              "bannedUsers": 1, "bannedTeams": 0, "activeInstances": 3 },
  "days": 14,
  "series": [ { "date": "2026-11-22", "signups": 4, "submissions": 80, "wrongSubmissions": 51, "solves": 12 } ],
  "topTeams": [ { "id": "...", "name": "Rustaceans", "banned": false, "score": 840, "solves": 9 } ],
  "challenges": {
    "hardest":  [ { "id": "...", "slug": "x", "title": "X", "category": "web", "difficulty": "hard", "points": 300, "visible": true,
                    "solves": 1, "solveRate": 0.025, "submissions": 40, "wrongSubmissions": 39, "wrongRate": 0.975 } ],
    "easiest":  [ "same item shape, highest solveRate first" ],
    "wrongRates": [ "same item shape, highest wrongRate first, only challenges with submissions, at most 20" ]
  },
  "terminal": { "modes": [ { "mode": "easy", "codes": 8, "teamsPlaying": 12, "completions": 3, "averageScore": 54.5, "maxScore": 120 } ] },
  "instances": { "dockerEnabled": true, "active": 3 }
}
```
- `series` has exactly `days` entries, oldest first, UTC days, gaps filled with 0. `solves` excludes manual adjustments.
  Submissions expire after 30 days (TTL), so submission counts for older days are 0.
- `solveRate` = solves / number of teams. `hardest` / `easiest` hold 5 visible non-terminal challenges each.
- `terminal.modes`: per mode `completions` = teams that solved every visible code, `averageScore` = mean points per
  team that solved at least one code of the mode, `maxScore` = best team. Empty when the Arena Terminal is not seeded.
- With `DOCKER_ENABLED=false` the instance count is not queried: `instances` is `{ "dockerEnabled": false, "active": 0 }`.

`GET /admin/stats/timeseries?days=14` returns `{ "days": 14, "series": [ ... ] }` (same series).

### Users

`GET /admin/users` - sort `createdAt` (default `-createdAt`), `displayName`, `email`; filters `role` (`player|admin`),
`banned`, `hasTeam`; `q` matches display name or email.
```json
{ "items": [ { "id": "...", "displayName": "Alice", "email": "alice@example.com", "role": "player", "banned": false,
               "team": { "id": "...", "name": "Rustaceans" }, "createdAt": "2026-11-01T10:00:00.000Z" } ],
  "page": 1, "limit": 25, "total": 120 }
```
`team` is `null` without a team.

`GET /admin/users/:id`:
```json
{ "id": "...", "displayName": "Alice", "email": "alice@example.com", "role": "player", "banned": false, "createdAt": "...",
  "team": { "id": "...", "name": "Rustaceans", "banned": false },
  "solveCount": 4, "recentSolves": [ { "id": "...", "solvedAt": "...", "points": 100, "firstBlood": false, "adjustment": false,
                                         "reason": null, "team": { "id": "...", "name": "..." }, "challenge": { "id": "...", "slug": "x", "title": "X" } } ],
  "submissionCount": 9, "recentSubmissions": [ { "id": "...", "createdAt": "...", "correct": false, "team": { }, "challenge": { } } ],
  "terminal": { "codesSolved": 3, "points": 40, "solvedByMode": { "easy": 3 }, "commandsLast48h": 212, "lastCommandAt": "..." },
  "integrity": { "signals": 2, "events": 7, "maxSeverity": 3, "lastAt": "..." } }
```
`recentSolves` / `recentSubmissions` are the newest 20. `terminal.commandsLast48h` comes from the pacing records that live 2
days. `integrity` counts fair-play signal rows of the user (details: `/admin/integrity/users`).

`PATCH /admin/users/:id/ban` body `{ "banned": true, "reason": "optional, max 200" }` -> 200 `{ id, displayName, banned }`.
A banned user gets 403 `USER_BANNED` on challenge submit, instance start/extend/stop, every terminal route that needs a team context
(`exec`, `complete`, `submit`), Cipher Lab hints/answers, team create/join/leave and `PATCH /me`; the user can still sign in and read
(`GET /me` returns `banned: true`, challenges, leaderboard, `GET /teams/me`). Admins cannot be banned (409 `CANNOT_BAN_ADMIN`).

`POST /admin/users/:id/remove-from-team` body `{}` -> 200 `{ teamId, teamName, userId, displayName, remaining, captainId }`.
If the user was the captain, the first remaining member becomes captain; an emptied team stays (delete it with
`DELETE /admin/teams/:id`). 409 `NOT_A_MEMBER` when the user has no team.

`POST /admin/users/:id/reset-terminal` body `{ "confirm": true }` -> 200 `{ "solvesRemoved": 3, "activityRemoved": 12 }`.
Terminal progress is stored as the team's solves of terminal challenges, so this deletes the terminal solves that THIS
user submitted (the team's score drops accordingly, challenge `solveCount` is decremented and a removed first-blood bonus
passes to the next earliest solver) and the user's pacing records. Teammates' solves stay.

### Teams

`GET /admin/teams?page=1` (any query parameter selects the paginated form) - sort `score` (default `-score`), `name`,
`createdAt`, `members`; filters `q` (name), `banned`:
```json
{ "items": [ { "id": "...", "name": "Rustaceans", "members": 3, "score": 840, "solves": 9, "banned": false,
               "captainId": "...", "createdAt": "...", "lastSolveAt": "..." } ], "page": 1, "limit": 25, "total": 40 }
```
`score` includes manual adjustments; `solves` does not.

`GET /admin/teams/:id`:
```json
{ "id": "...", "name": "Rustaceans", "banned": false, "createdAt": "...", "captainId": "...", "score": 840, "solves": 9,
  "adjustmentsTotal": -20, "activeInstances": 1,
  "members": [ { "id": "...", "displayName": "Alice", "email": "alice@example.com", "banned": false, "isCaptain": true } ],
  "timeline": [ { "id": "...", "solvedAt": "...", "points": 110, "firstBlood": true, "adjustment": false, "reason": null,
                  "user": { "id": "...", "displayName": "Alice" }, "challenge": { "id": "...", "slug": "x", "title": "X" } },
                { "id": "...", "solvedAt": "...", "points": -20, "firstBlood": false, "adjustment": true, "reason": "shared hint",
                  "user": { "id": "...", "displayName": "(the admin)" }, "challenge": null } ] }
```
`timeline` is oldest first, at most 100 entries (solves and adjustments); for adjustments `challenge` is `null` and `user`
is the admin who made it. There is no invite code here.

- `PATCH /admin/teams/:id` body `{ "name": "3-24 chars" }` -> 200 `{ id, name }`; 409 `CONFLICT` when the name exists
  (case-insensitive).
- `DELETE /admin/teams/:id?confirm=true` -> 204. Only teams with no members (409 `TEAM_NOT_EMPTY`). Stops the team's
  instances and deletes its solves through the same routine as `DELETE /admin/solves/:id`.
- `DELETE /admin/teams/:id/members/:userId` -> 200, same body as `remove-from-team`. 409 `NOT_A_MEMBER`.
- `POST /admin/teams/:id/invite-code/regenerate` body `{}` -> 200 `{ id, name, inviteCode }` (the only response that
  shows a code; the old one stops working at once).
- `POST /admin/teams/:id/score-adjustments` body `{ "points": -50, "reason": "3-200 chars" }` (`points`: non-zero integer,
  -10000..10000) -> 201 `{ id, teamId, points, reason, teamScore }`. **How it counts:** the adjustment is stored as a
  `solves` document with `adjustment: true`, a fresh random `challengeId`, the signed points and the admin as `userId`.
  Leaderboard, `GET /teams/me` score, the timeline and `teamScore` all sum `solves.points`, so they include it with no
  code change. It does not touch any challenge's `solveCount`. To undo it, `DELETE /admin/solves/:id` with its id
  (listed in the team timeline and in `GET /admin/solves?adjustments=only`). Known limit: the public leaderboard's
  `solves` counter (a plain count of solve rows) also counts adjustment rows; `GET /admin/teams` does not.
- `PATCH /admin/teams/:id/ban` is unchanged.

### Challenges

- `GET /admin/challenges?page=1` - sort `createdAt` (default), `title`, `points`, `solveCount`; filters `q` (title or slug),
  `category`, `difficulty`, `type` (any of `static`, `docker`, `terminal`, `game`, `weblab`, `forensics`, `reversing`, `osint`), `visible`. Items have the admin challenge shape (see "Challenge body" above, with
  `hasFlag`, never the flag).
- `PATCH /admin/challenges/:id/visibility` body `{ "visible": true }` -> 200 `{ id, slug, visible }`. Hidden challenges
  vanish from player lists and are rejected on submit.
- `POST /admin/challenges/:id/duplicate` body `{ "slug"?: "...", "title"?: "..." }` (defaults `<slug>-copy` and
  `<title> (copy)`) -> 201 admin challenge. The copy is hidden (`visible: false`), `solveCount` 0; a static challenge keeps
  its stored flag hash inside the database (not returned). 409 `CONFLICT` for an existing slug; terminal challenges
  cannot be duplicated (400).
- `GET /admin/challenges/:id/stats` -> `{ id, slug, title, type, solves, solveRate, submissions, wrongSubmissions,
  correctSubmissions, wrongRate, teamsAttempted, firstBlood: { teamId, teamName, at } | null }`. Attempt numbers cover the
  last 30 days (submission TTL); solves are permanent. For terminal challenges attempts are recorded against the mode's
  first code, so use the overview's `terminal` block instead.
- `POST /admin/challenges/:id/reset-solves` body `{ "confirm": true, "clearSubmissions": false }` -> 200
  `{ solvesRemoved, submissionsRemoved }`. Deletes every solve of the challenge (team scores drop with them), sets
  `solveCount` to 0 and optionally deletes the attempts. Manual adjustments are kept.
- `GET /admin/challenges/export` -> file download (`Content-Disposition: attachment; filename="challenges.json"`):
  ```json
  { "version": 1, "exportedAt": "...", "challenges": [ { "slug": "x", "title": "X", "category": "web", "difficulty": "easy",
      "points": 100, "description": "...", "type": "static", "attachments": [ { "name": "a", "url": "/a" } ], "visible": true } ] }
  ```
  Optional keys (`image`, `internalPort`) appear only when set. No flag, hash or salt, and no terminal challenges (they are
  seeded by `npm run seed:terminal`).
- `POST /admin/challenges/import` body `{ "challenges": [ ... up to 100 ... ], "mode": "skip" | "update", "dryRun": false }`
  (items use the "Challenge body" fields; `flag` optional). Each item is validated like create; one bad item never blocks
  the others. 200:
  ```json
  { "dryRun": false, "created": ["a"], "updated": [], "skipped": ["b"], "needsFlag": ["c"],
    "errors": [ { "index": 3, "slug": "bad", "message": "slug: must be lowercase letters, digits and dashes" } ] }
  ```
  `mode: "skip"` (default) leaves existing slugs alone; `"update"` rewrites their metadata and keeps the stored flag hash.
  A static challenge without a flag (and no stored one) is saved hidden and listed in `needsFlag`; set its flag with
  `PUT /admin/challenges/:id`, then publish. Terminal items are rejected. `dryRun: true` validates and reports without
  writing (and without an audit entry).

### Solves and submissions

`GET /admin/solves` - sort `solvedAt` (default `-solvedAt`), `points`; filters `teamId`, `challengeId`, `userId`,
`adjustments` (`include` default | `only` | `exclude`), `from`, `to` (solvedAt range). `q` is accepted but unused.
```json
{ "items": [ { "id": "...", "solvedAt": "...", "points": 110, "firstBlood": true, "adjustment": false, "reason": null,
               "team": { "id": "...", "name": "Rustaceans" }, "user": { "id": "...", "displayName": "Alice" },
               "challenge": { "id": "...", "slug": "x", "title": "X" } } ], "page": 1, "limit": 25, "total": 310 }
```
`challenge` is `null` for adjustments; deleted teams, users or challenges show `name`/`displayName`/`slug`/`title` `null`.

`DELETE /admin/solves/:id?reason=optional` -> 200 `{ id, teamId, pointsRemoved, teamScore }`. The document is deleted
atomically (of two concurrent calls only one succeeds, the other gets 404 `NOT_FOUND`), then the challenge's `solveCount`
is decremented (never below 0) and, if the removed solve held first blood, the earliest remaining solver of that challenge
gets the bonus (`points += floor(10%)`, `firstBlood: true`). The team score is the sum of its solves, so it follows by
itself; `teamScore` is the recomputed value. Deleting an adjustment row skips the challenge bookkeeping.

`GET /admin/submissions` - sort `createdAt` (default `-createdAt`); filters `teamId`, `challengeId`, `userId`,
`result` (`correct|wrong`), `from`, `to`:
```json
{ "items": [ { "id": "...", "createdAt": "...", "correct": false, "team": { "id": "...", "name": "..." },
               "user": { "id": "...", "displayName": "..." }, "challenge": { "id": "...", "slug": "x", "title": "X" } } ],
  "page": 1, "limit": 25, "total": 1500 }
```
Only who, which challenge, when and whether it was right: the typed text and its stored hash are never returned (the
real flag is never known to this API at all). Attempts older than 30 days no longer exist.

### Integrity (fair-play review)

`GET /admin/integrity` (legacy bare array) is unchanged. New:

- `GET /admin/integrity/summary` -> `{ flaggedUsers, signalRows, signalEvents, activeLast24h, highRiskThreshold: 10,
  byKind: [ { kind, rows, events, lastAt } ] }` with one entry per kind (`honeypot-endpoint`, `tainted-flag`,
  `terminal-canary`, `terminal-velocity`, `terminal-cadence`, `automation-ua`), zeros when there are none.
- `GET /admin/integrity/users` - sort `risk` (default `-risk`) or `lastSignalAt`; filters `q` (display or team name),
  `kind` (users with at least one signal of that kind), `minRisk`. Items are the entries of the legacy list plus
  `lastSignalAt`: `{ userId, displayName, teamName, risk, signals: [ ... ], lastSignalAt }`; the anonymous-scrapers entry has
  `userId: null`. Built from the 200 highest-risk entries.
- `POST /admin/integrity/:userId/resolve` body `{ "note": "3-500 chars" }` -> 200
  `{ userId, resolved: { signals, events, kinds: { "tainted-flag": 2 } } }`. Deletes the user's signals (same as the
  dismiss route) and records the note plus that summary in the audit log (`integrity.resolve`). 404 when the user has no
  signals. Resolving never bans anyone: use `PATCH /admin/users/:id/ban` or the team ban separately.
- `DELETE /admin/integrity/:userId` is unchanged (204) and now audited (`integrity.dismiss`, no note).

### Instances

`GET /admin/instances?page=1` (any query parameter selects the paginated form; sort `createdAt` (default), `expiresAt`;
filters `status` = `active` (default) | `all` | `starting|running|stopping|stopped|failed`, `teamId`, `challengeId`) returns the
envelope plus `"dockerEnabled": true|false`; items have the shape of the legacy list. `POST /admin/instances/:id/kill`
is unchanged (204) and audited. With `DOCKER_ENABLED=false` there is no container to remove, so the kill only marks the
record `stopped` (404 when it is not active) and never calls Docker.

### Audit log

`GET /admin/audit` - sort `createdAt` (default `-createdAt`); filters `action` (exact, for example `team.ban`), `actorId`,
`targetType`, `targetId`, `from`, `to`, `q` (matches actor email, action or note):
```json
{ "items": [ { "id": "...", "createdAt": "...", "actor": { "id": "...", "email": "admin@example.com" },
               "action": "team.score-adjust", "targetType": "team", "targetId": "...",
               "before": null, "after": { "adjustmentId": "...", "points": -50, "teamScore": 790 },
               "note": "shared hint", "ip": "203.0.113.7" } ], "page": 1, "limit": 25, "total": 88 }
```
Written after the action succeeded, by every mutating admin call. Actions: `user.ban`, `user.unban`, `user.remove-from-team`,
`user.reset-terminal`, `team.ban`, `team.unban`, `team.rename`, `team.delete`, `team.remove-member`,
`team.invite-code-regenerate`, `team.score-adjust`, `challenge.create`, `challenge.update` (note `flag replaced` when a flag
was set), `challenge.delete`, `challenge.publish`, `challenge.hide`, `challenge.duplicate`, `challenge.reset-solves`,
`challenge.import`, `solve.delete`, `solve.delete-adjustment`, `integrity.resolve`, `integrity.dismiss`, `instance.kill`,
`settings.update`, `export.users|teams|submissions|leaderboard` (exports can contain emails). `before`/`after` are small
summaries (primitives and short strings, secret-looking keys dropped). `ip` is the raw address of the admin (staff only).
**Retention:** a TTL index deletes entries after 365 days; there is no delete or edit endpoint.

### Platform settings

`GET /admin/settings` and `PUT /admin/settings` (partial: send only what changes, at least one key):
```json
{ "registrationOpen": true, "submissionsFrozen": false,
  "announcement": { "text": "CTF starts at 18:00 UTC", "level": "info" }, "updatedAt": "2026-11-22T10:00:00.000Z" }
```
`announcement.text` 0-500 chars (empty hides the banner), `level` is `info | warning | critical`. Defaults: registration
open, not frozen, no banner, no event (`"event": null`), default hint costs.

`hintCosts` (always present in the view, additive): `{ enabled, nudge, approach, walkthrough, maxPercent }`, integers 0..100, defaults
`{ true, 5, 10, 25, 40 }`. `PUT` replaces it as a whole (`.strict()`: missing fields take the default; out-of-range numbers, fractions,
strings, non-booleans and unknown keys are 400 `VALIDATION_ERROR`) or resets it with `{ "hintCosts": null }`. Audited as `settings.update`
like the rest. Rules and examples: `docs/HINTS.md` "Hint costs".

`event` is optional (scheduled Arena event, `docs/EVENT_MODE.md`): `null` or `{ name, startsAt, endsAt, freezeAt, phase }` where
`phase` is `upcoming | live | frozen | ended` right now. `PUT` replaces it as a whole with `{ name?, startsAt, endsAt, freezeAt? }`
(ISO 8601 with a zone; `name` 0-80 chars; `endsAt` after `startsAt`; `freezeAt` strictly between them or `null`) or clears it
with `{ "event": null }`. Unknown keys, bad dates and an invalid window are 400 `VALIDATION_ERROR`. Changes are audited as `settings.update`.

- **`submissionsFrozen`** is enforced server side on every answer route: `POST /challenges/:id/submit`,
  `POST /terminal/:mode/submit`, `POST /cipherlab/levels/:id/answer`, `POST /crackme/levels/:id/answer`,
  `POST /weblab/labs/:slug/submit`, `POST /forensics/tracks/:track/stages/:n/answer` and
  `POST /osint/cases/:track/questions/:n/answer` answer
  423 `SUBMISSIONS_FROZEN` (the check runs right after body validation, so a frozen platform also leaves no attempt
  records). Browsing, hints, instances, the terminal `exec` and the Web Exploit Lab simulator (`/weblab/labs/:slug/request`,
  which never records a solve) stay available. The settings read has a 2 s timeout and fails **closed**:
  if the read errors or times out, the submission is refused with a retryable 503 `SETTINGS_UNAVAILABLE` (never "allowed").
- **Scheduled event.** Only when an event is configured, the same guard also answers 423 `EVENT_NOT_STARTED` (before `startsAt`) and
  423 `EVENT_ENDED` (from `endsAt`) on all of the routes above plus `POST /crackme/levels/:id/patch` and `PUT /osint/cases/:track/board`.
  `live` and `frozen` accept submissions. `SUBMISSIONS_FROZEN` is checked first. With no event the guard is unchanged.
- **`registrationOpen`** is stored and published only. Sign-up happens in Cognito (outside this API), so the backend cannot
  block it; the web app should hide its sign-up form when it is `false`. Closing Cognito self-sign-up is a follow-up.
- **`GET /hint-costs`** (public, no token, `Cache-Control: public, max-age=10`): `{ enabled, nudge, approach, walkthrough, maxPercent }`, the same
  five numbers as `hintCosts` above and nothing else, so the play screens can show a price before a hint is opened. Normalised: a missing
  or unreadable setting answers the defaults. Percentages of the level's base points; `GET` only. No rate limit of its own in the app (nginx limits `/api`).
- **Hint costs on the games (additive fields).** The cost of a hint is a percentage of the level's base points by the hint's position
  (`tier`: `nudge` first, `approach` second, `walkthrough` third and later); the level total is capped at `maxPercent` and a solve awards at least 1.
  It is deducted when the level is solved: `Solve.points` holds the net value, so `pointsAwarded`, the leaderboard and achievements use it unchanged.
  Cipher Lab, Crackme and OSINT: hint-open responses add `cost: { percent, points, tier }` (this hint) and `spent: { points, percent, cap }` (the level
  so far, `cap` in points); level views (Cipher Lab and Crackme `GET /levels/:id`, each OSINT question of `GET /cases/:track`) add, for players only,
  `hintPricing: [{ index, tier, percent, points }]` for the hints still closed (no text) and `hintSpent: { points, percent, cap }`; a correct
  answer adds `hintCost: { spent, openedCount, base, awarded }` only when something was deducted. Admin previews have none of these fields and
  record nothing. The price is fixed when a hint is opened (stored on its ledger row) and tiers are cumulative: opening hint N also pays for the cheaper tiers below it, and `hintPricing` of a closed hint is what opening it would add. Web Exploit Lab (scope `weblab`, key lab slug), Forensics (`forensics`, `<track>:<stage>`) and Terminal (`terminal`, `<mode>:<code>`)
  use the same `cost`, `spent`, `hintPricing`, `hintSpent` and `hintCost` shapes where they appear in the tables above; their answers add `hintCost` too.
- **`GET /announcement`** (public, no token, `Cache-Control: no-store`):
  `{ "announcement": { "text": "...", "level": "info" }, "registrationOpen": true, "submissionsFrozen": false }`.
- **`GET /event`** (public, no token, `Cache-Control: public, max-age=3`):
  `{ "name": "Winter Cup", "phase": "none | upcoming | live | frozen | ended", "startsAt": "<ISO>|null", "endsAt": "<ISO>|null", "freezeAt": "<ISO>|null", "serverTime": "<ISO>" }`.
  `serverTime` lets clients show a countdown without trusting their own clock. Nothing else is exposed.

### CSV exports

`GET /admin/export/users.csv`, `teams.csv`, `submissions.csv`, `leaderboard.csv` -> `text/csv; charset=utf-8` with
`Content-Disposition: attachment; filename="<name>.csv"`, CRLF line endings, a header row, at most **10,000 rows** (capped,
not streamed; narrow with filters). `users.csv`, `teams.csv` and `submissions.csv` accept the same filters and `sort` as the
matching list endpoint and ignore `page`/`limit`; `leaderboard.csv` takes no parameters and lists the visible (not banned)
ranking like `GET /leaderboard`. Columns:
- users: `id,displayName,email,role,banned,teamId,teamName,createdAt`
- teams: `id,name,members,score,solves,banned,createdAt,lastSolveAt`
- submissions: `id,createdAt,correct,teamId,teamName,userId,userName,challengeId,challengeSlug`
- leaderboard: `rank,teamId,teamName,points,solves,lastSolveAt`

Cells are formula-injection safe: a text cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`; cells with a
comma, quote or newline are quoted with doubled quotes. Numbers and booleans are written as-is. Each export is audited.

---

## Rules every endpoint follows
- Validate with `zod`; return `VALIDATION_ERROR` with details.
- Validation details are carried in `error.message`; there is no separate `details` field.
- Players never receive `flag`, `flagHash`, or other teams' data except the leaderboard fields above.
- A banned team gets `403 TEAM_BANNED` on submit and instance routes (and on terminal `exec`, `complete` and `submit`).
  A banned user gets `403 USER_BANNED` on the same routes. While submissions are frozen (`/admin/settings`) every
  answer route (challenges, terminal and every range category) answers `423 SUBMISSIONS_FROZEN`.
- Changing this file is a contract change: tell the group.
