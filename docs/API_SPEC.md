# API Specification (the contract)

Base path: `/api`. JSON in, JSON out.
Auth: `Authorization: Bearer <Cognito ID token>` on everything except `/api/health`.
Authentication middleware is attached per protected route. P1-07 attaches
`req.user = { cognitoSub, email, role }` from verified ID-token claims;
`cognitoSub` is the Cognito `sub`, not a database user ID. Exact membership
in the `admin` Cognito group grants `admin`; other users (including those
without groups) are `player`. Missing or malformed Bearer credentials and
invalid/expired tokens return 401 `UNAUTHENTICATED`. Role mismatches return
403 `FORBIDDEN`. P1-08 persists the current user through `/me`.
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
and return `team: null` until teams are implemented.

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
| POST | `/teams/me/leave` | player | S | Leaves team. If last member, team is deleted. Stops team's running instances. |

## Challenges (players)

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| GET | `/challenges` | player | G | List visible challenges. Item: `{ id, slug, title, category, difficulty, points, type, solveCount, solvedByMyTeam }` |
| GET | `/challenges/:id` | player | G | Adds `description`, `attachments:[{name,url}]`, `hasInstance`, `myInstance` (see below) |
| POST | `/challenges/:id/submit` | player | G | Body `{ flag }`. Response `{ correct:boolean, pointsAwarded:number, firstBlood:boolean, message }`. 429 after 5 tries per minute per team per challenge. 409 if already solved. |

## Instances (Docker containers)

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| POST | `/challenges/:id/instance` | player | G | Start container for my team. Returns `{ id, status, url, expiresAt }`. Errors: `NO_TEAM`, `INSTANCE_LIMIT`, `ALREADY_RUNNING`, `NOT_DOCKER_CHALLENGE`, `NO_FREE_PORT`. |
| GET | `/instances` | player | G | My team's active instances |
| POST | `/instances/:id/extend` | player | G | Adds 15 minutes, allowed once per instance |
| DELETE | `/instances/:id` | player | G | Stops and removes the container |

`myInstance` object: `{ id, status: "starting|running|stopping", url, expiresAt, extended }`

## Leaderboard

| Method | Path | Auth | Owner | Description |
|--------|------|------|-------|-------------|
| GET | `/leaderboard` | player | H | `[{ rank, teamId, teamName, points, solves, lastSolveAt }]`, banned teams hidden |
| GET | `/leaderboard/timeline` | player | H | `{ teams:[{ teamId, teamName, points:[{ t, score }] }] }` (top 10 teams) |

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
- Players never receive `flag`, `flagHash`, or other teams' data except the leaderboard fields above.
- A banned team gets `403 TEAM_BANNED` on submit and instance routes.
- Changing this file is a contract change: tell the group.
