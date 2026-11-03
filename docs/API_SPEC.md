# API Specification (the contract)

Base path: `/api`. JSON in, JSON out.
Implementation status (Phase 2): Health, identity, Teams, Challenges, Instances and
`/admin/challenges` are implemented. Leaderboard and the other Admin sections are Phase 3
contracts; their routes are not mounted yet and currently return 404 `NOT_FOUND`.
Auth: `Authorization: Bearer <Cognito ID token>` on everything except `/api/health`.
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
`CONFLICT` 409, `RATE_LIMITED` 429, `SERVER_ERROR` 500.

Legend for the owner column: **S** = Swarup (Phase 1), **G** = Gururaj (Phase 2), **H** = Shubham (Phase 3).

---

## Health and identity

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| GET | `/health` | none | S | `{ "status":"ok", "db":"up", "replica":"backend-2" }` |
| GET | `/me` | any | S | Current user: `{ id, email, displayName, role, team: { id, name } or null }` |
| PATCH | `/me` | any | S | Body `{ displayName }` (3-30 chars) |

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
`SERVER_ERROR` with a generic message and no internal details.

## Teams

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| POST | `/teams` | player | S | Body `{ name }` (3-24 chars, unique). Creates team, user becomes captain. Returns team with `inviteCode`. 409 if user already has a team. |
| POST | `/teams/join` | player | S | Body `{ inviteCode }`. 404 bad code, 409 already in a team, `TEAM_FULL` 409 if 3 members. |
| GET | `/teams/me` | player | S | `{ id, name, inviteCode, members:[{id,displayName}], score }` |
| POST | `/teams/me/leave` | player | S | Leaves team (204). If last member, team is deleted; otherwise the next member becomes captain if the captain leaves. Instance cleanup is deferred to Phase 2. |

Create returns 201; join and GET return 200, all with the GET `/teams/me` shape
above. `score` is 0 until Phase 2. Banned teams remain readable and include
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
| GET | `/challenges` | player | G | List visible challenges. Item: `{ id, slug, title, category, difficulty, points, type, solveCount, solvedByMyTeam }` |
| GET | `/challenges/:id` | player | G | Adds `description`, `attachments:[{name,url}]`, `hasInstance`, `myInstance` (see below) |
| POST | `/challenges/:id/submit` | player | G | Body `{ flag }`. Response `{ correct:boolean, pointsAwarded:number, firstBlood:boolean, message }`. 429 after 5 tries per minute per team per challenge. 409 if already solved. |

Phase 2 implementation notes (Challenges):
- Admins get 403 on player routes (roles are exact). Hidden challenges and malformed ids return 404 `NOT_FOUND`.
- Players without a team can list and read challenges (`solvedByMyTeam` is false). Submit and instance routes need a team: 404 `NO_TEAM`; banned teams get 403 `TEAM_BANNED`.
- Submit body is strict `{ flag }` (1-200 chars). A wrong flag returns 200 with `correct: false`. A correct flag returns 200 with `pointsAwarded` (base points, plus 10% on first blood, rounded down) and `firstBlood`. The rate limit (5 per minute per team per challenge) is counted in MongoDB, so it holds across replicas. A team that already solved it gets 409 `CONFLICT`, including the losing side of a double click.
- Correct submissions stop the team's instance of that challenge.

## Instances (Docker containers)

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| POST | `/challenges/:id/instance` | player | G | Start container for my team. Returns `{ id, status, url, expiresAt }`. Errors: `NO_TEAM`, `INSTANCE_LIMIT`, `ALREADY_RUNNING`, `NOT_DOCKER_CHALLENGE`, `NO_FREE_PORT`. |
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
| GET | `/leaderboard` | player | H | `[{ rank, teamId, teamName, points, solves, lastSolveAt }]`, banned teams hidden |
| GET | `/leaderboard/timeline` | player | H | `{ teams:[{ teamId, teamName, points:[{ t, score }] }] }` (top 10 teams) |

Phase 3 implementation notes (`services/leaderboardService.js`, `routes/leaderboard.js`):
- Both endpoints are `player` only (admins get 403, no token 401) and need no team, so team-less and banned-team players can read them. Banned and deleted teams are hidden.
- `rank` is the 1-based position. Order: points desc, then earliest `lastSolveAt`, then team name (case-insensitive), then team id, so ties are deterministic on every replica. Teams with no solves are appended with `points: 0`, `solves: 0`, `lastSolveAt: null`. `lastSolveAt` is an ISO string.
- Optional query `?limit=1..500` truncates the list after ranking (default: all teams). Anything else in the query string is ignored; an invalid `limit` is 400 `VALIDATION_ERROR`.
- Timeline: teams are in rank order (top 10 including zero-solve teams). Each `points` array starts with `{ t, score: 0 }` at the time of the earliest solve shown (the current time if there are no solves yet), then one entry per solve in `solvedAt` order with the running total (`solves.points`, bonus included). A chart should hold a score flat until the next entry.
- Responses contain only the fields above: no invite codes, member lists, emails, user ids or flag material. Nothing is cached in the process, so any replica returns the same data.

## Admin (role `admin`)

| Method | Path | Owner | Description |
|--------|------|-------|-------------|
| GET | `/admin/challenges` | G | All challenges including hidden |
| POST | `/admin/challenges` | G | Create. Body: see **Challenge body** below |
| PUT | `/admin/challenges/:id` | G | Update |
| DELETE | `/admin/challenges/:id` | G | Delete (also stops its instances) |
| GET | `/admin/stats` | H | `{ users, teams, solves, submissions, wrongRate, activeInstances, requestsByReplica:{ "backend-1": 120, ... } }` |
| GET | `/admin/instances` | H | All active instances with team and challenge names |
| POST | `/admin/instances/:id/kill` | H | Force stop |
| GET | `/admin/teams` | H | All teams with score and ban state |
| PATCH | `/admin/teams/:id/ban` | H | Body `{ banned: true|false }` |

Admin responses never contain a flag or hash. They return the challenge fields plus `hasFlag` (static only),
`visible`, `solveCount` and `createdAt`. `PUT` takes the same body as create; for static challenges
omitting `flag` keeps the stored hash. `image` must start with `ctf/`. Duplicate slugs return 409 `CONFLICT`.
Deleting a challenge stops its instances; existing solves are kept.

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
`category`: `web | crypto | forensics | misc | pwn`. `difficulty`: `easy | medium | hard`. `type`: `static | docker`.

---

## Rules every endpoint follows
- Validate with `zod`; return `VALIDATION_ERROR` with details.
- Validation details are carried in `error.message`; there is no separate `details` field.
- Players never receive `flag`, `flagHash`, or other teams' data except the leaderboard fields above.
- A banned team gets `403 TEAM_BANNED` on submit and instance routes.
- Changing this file is a contract change: tell the group.
