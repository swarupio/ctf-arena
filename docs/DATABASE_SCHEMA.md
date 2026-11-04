# Database Schema (MongoDB Atlas, database `ctf_arena`)

Models are written with Mongoose. Field types: S = string, N = number, D = date, B = boolean, OID = ObjectId.
Owner: **S** Swarup, **G** Gururaj, **H** Shubham.
Terminal game addition: `challenges.type` / `category` gain `terminal` plus the `terminal` sub-document (see below).
Implementation status: `User`, `Team`, `Challenge`, `Instance`, `Submission`, `Solve` and `ReplicaStat`
exist with the indexes below (the first six were verified live on Atlas; `ReplicaStat` was also exercised live by the
end-to-end browser run). The leaderboard query is implemented in `services/leaderboardService.js`.
Mongoose also adds its default `__v` version key to documents (the three fair-play collections below set `versionKey: false`).
Fair-play addition (`docs/FAIR_PLAY.md`): `cheatsignals`, `taintedflags` and `terminalactivities`, all with TTL indexes.
Phase 2 detail: `instances` has no `updatedAt`; a failed start sets `status: 'failed'`, which sits outside the
partial unique indexes and so frees the port. `solves.points` starts as the base points and is raised to include
the bonus when the team is the first solver (`solveCount` becomes 1 atomically). Team score is the sum of `solves.points`.

## users (S)
| Field | Type | Notes |
|-------|------|-------|
| _id | OID | |
| cognitoSub | S | required, **unique index**, from the token `sub` |
| email | S | required; token email validated by auth middleware, no schema email-format validator or unique index |
| displayName | S | default = part before `@` |
| role | S | required, `player` or `admin`; refreshed from verified token on GET/PATCH `/me` and team create/join, not by login itself |
| teamId | OID or null | Mongoose ref `Team`, default null (collection `teams`) |
| createdAt, updatedAt | D | |

## teams (S)
| Field | Type | Notes |
|-------|------|-------|
| _id | OID | |
| name | S | required, trimmed, 3-24 chars; **unique index** with `{ locale: 'en', strength: 2 }` collation |
| inviteCode | S | required, **unique index**, exactly 6 from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` |
| captainId | OID | required, Mongoose ref `User` (collection `users`) |
| memberIds | [OID] | ref `User`, default empty array, schema max 3; route transactions maintain membership and captain consistency |
| banned | B | default false |
| createdAt | D | |

`User.displayName` defaults from email on creation; the 3-30 character constraint
is enforced by PATCH `/me`, not by the User schema. GET may create shorter or
longer defaults. Neither schema enforces foreign-key existence. Team uniqueness
depends on indexes being installed; membership routes initialize models before
transactions. Transactions require Atlas or a MongoDB replica set.

Demo fixtures are described in `handoffs/HANDOFF_1_swarup_to_gururaj.md`.
They use the existing schemas; no seed-marker field or new model was added.

## challenges (G)
| Field | Type | Notes |
|-------|------|-------|
| _id | OID | |
| slug | S | **unique index**, also used in dynamic flags |
| title, description | S | description is markdown |
| category | S | web, crypto, forensics, misc, pwn, terminal |
| difficulty | S | easy, medium, hard |
| points | N | |
| type | S | `static`, `docker` or `terminal` |
| image | S | Docker image name (docker type) |
| internalPort | N | port inside the container (docker type) |
| flagHash, flagSalt | S | static type only. **Never sent to clients** |
| terminal | `{ mode, code }` | terminal type only (`_id: false`): `mode` is `easy`, `medium` or `hard`, `code` a number >= 1. Required when `type` is `terminal` |
| attachments | [{ name, url }] | |
| visible | B | |
| solveCount | N | incremented with `$inc` on each first solve per team |
| createdAt | D | |

Index: `{ type: 1, 'terminal.mode': 1 }` (loads the codes of a terminal mode in one query).

Terminal challenges (Arena Terminal game, `docs/TERMINAL_GAME.md`) have `type: 'terminal'`, `category: 'terminal'`,
slug `terminal-<mode>-<n>`, title `Terminal <Mode> #<n>`, `difficulty` equal to the mode and the points of the mode
definition. Nothing is stored for their flag: like docker challenges it is derived per team
(`dynamicFlag` over the slug, team id and challenge id), so `flagHash` and `flagSalt` stay unset. They are created by
`npm run seed:terminal` (idempotent upsert keyed by slug; re-running resets title, description, points and difficulty,
keeps `visible` and `solveCount`) and are not creatable through the admin API; admins may edit or hide them. A hidden
one (`visible: false`) is switched off for the game. Solves and submissions use the normal `solves` and `submissions`
collections.

## instances (G)
| Field | Type | Notes |
|-------|------|-------|
| _id | OID | |
| teamId, challengeId, userId | OID | who started it |
| containerId | S | Docker container id (set after creation) |
| port | N | host port |
| status | S | `starting`, `running`, `stopping`, `stopped`, `failed` |
| expiresAt | D | start + `INSTANCE_TTL_MINUTES` |
| extended | B | one extension allowed |
| createdAt, stoppedAt | D | |

Indexes:
- **Partial unique** on `{ port: 1 }` where `status` in `starting|running|stopping` -> atomic port claim across replicas.
- **Partial unique** on `{ teamId: 1, challengeId: 1 }` where status is active -> one live instance per team per challenge.
- `{ status: 1, expiresAt: 1 }` for the reaper.

`stopping` is the short claim state while a replica removes the container. If that replica crashes mid-stop the
instance stays `stopping` (still holding its port); the reaper and the player routes only claim `starting|running`,
so the admin kill route claims it with `{ force: true }` and finishes the cleanup (see `API_SPEC.md`).

## submissions (G)
Every attempt, right or wrong. Used for rate limiting and admin stats.
| Field | Type | Notes |
|-------|------|-------|
| teamId, userId, challengeId | OID | |
| correct | B | |
| submittedHash | S | SHA-256 of what was submitted (do not store raw wrong flags) |
| createdAt | D | |

Indexes: `{ teamId: 1, challengeId: 1, createdAt: -1 }`. TTL index deletes rows after 30 days.

Terminal game: `POST /terminal/:mode/submit` stores every attempt here. A correct attempt is stored against the code it
matched, a wrong one against the mode's first code (lowest `terminal.code`). The per-mode rate limit (10 per minute per
team) counts the team's rows over `challengeId in <the mode's challenge ids>` with `createdAt` in the last minute,
which uses the index above.

## solves (G)
| Field | Type | Notes |
|-------|------|-------|
| teamId, challengeId, userId | OID | who submitted |
| points | N | points awarded including bonus |
| firstBlood | B | |
| solvedAt | D | |

Indexes: **unique** `{ teamId: 1, challengeId: 1 }` (blocks double solves), `{ solvedAt: 1 }` for the timeline.

## replicastats (H)
Per-replica request counter for the admin dashboard (`GET /admin/stats` -> `requestsByReplica`).
One document per backend replica; written by `middleware/requestCounter.js`.
| Field | Type | Notes |
|-------|------|-------|
| replica | S | required, **unique index**, the replica hostname (same value as `X-Served-By`) |
| requests | N | `/api/*` requests served (not `/api/health`), default 0 |
| updatedAt | D | set on every write |

Each replica buffers counts in memory and flushes with one `updateOne({ replica }, { $inc: { requests: n } }, { upsert: true })`
about every 5 s and on SIGTERM. Indexes: TTL on `{ updatedAt: 1 }` deletes a replica's document after 30 days without traffic.
`replica` is the container hostname (a 12-character container id under Docker Compose), so a replica replaced by a
deploy leaves a stale document until that expiry (see "Replica names" in `API_SPEC.md`).

## Fair play (`docs/FAIR_PLAY.md`)
Three small collections written by `services/integrityService.js`. Every write is best effort (a failure never fails a
request) and nothing here stores a raw IP address, a full user agent, a raw flag or more than 120 characters of a command.

### cheatsignals
Evidence for admins, one row per (subject, kind, detail). Repeats only raise `count` and `lastAt`, so the collection
cannot grow from repetition.
| Field | Type | Notes |
|-------|------|-------|
| subjectKey | S | required; a user id (24 hex) or `ip:<salted sha256 of the address>` for callers without an account |
| userId | OID or null | ref `User`; null for ip-keyed (anonymous) signals |
| kind | S | `honeypot-endpoint`, `tainted-flag`, `terminal-canary`, `terminal-velocity`, `terminal-cadence`, `automation-ua` |
| severity | N | 1 to 3 (`automation-ua` 1; `honeypot-endpoint`, `terminal-canary`, `terminal-velocity`, `terminal-cadence` 2; `tainted-flag` 3) |
| detail | S | at most 120 chars: decoy path, `from:<user id, self or anonymous>`, `<mode>:<first 60 chars of a command>`, mode, or a user-agent family |
| count | N | incremented with `$inc` on every repeat |
| firstAt, lastAt | D | set on insert / on every repeat |

Indexes: **unique** `{ subjectKey: 1, kind: 1, detail: 1 }` (the upsert key), `{ userId: 1 }`, TTL on `{ lastAt: 1 }` of 90 days.
Each signal is one `updateOne({ subjectKey, kind, detail }, { $inc: { count: 1 }, $set: { lastAt }, $setOnInsert: { userId, severity, firstAt } }, { upsert: true })`.
The address salt is `HMAC-SHA256(FLAG_SECRET, 'integrity:ip-salt')`, so no new secret exists.

### taintedflags
Decoy flags that were handed to a caller by a decoy path or a canary reply. Only the hash is stored.
| Field | Type | Notes |
|-------|------|-------|
| hash | S | required, **unique index**, SHA-256 of the decoy flag |
| subjectKey | S | who received it (user id or `ip:<hash>`) |
| slug | S | the slug the decoy flag was built from |
| issuedAt | D | TTL index of 90 days |

Inserted with `insertMany(docs, { ordered: false })` and duplicate-key errors ignored. Every WRONG submission does one
lookup by the SHA-256 of the submitted flag (unique index); a hit records a `tainted-flag` signal.

### terminalactivities
Per user and UTC minute, for the terminal pacing rules. One atomic `findOneAndUpdate` (an update pipeline, MongoDB 4.2+)
per `exec` request with `upsert: true` and `returnDocument: 'before'`.
| Field | Type | Notes |
|-------|------|-------|
| userId | OID | required, ref `User` |
| bucket | D | required, start of the UTC minute |
| count | N | commands executed in the minute (commands rejected by the 300 ms floor are not counted) |
| gapN, gapSum, gapSumSq | N | number, sum and sum of squares of the gaps (ms) between consecutive commands inside the minute |
| lastAt | D | time of the last executed command |

Indexes: **unique** `{ userId: 1, bucket: 1 }`, TTL on `{ bucket: 1 }` of 2 days. The gap to the previous command is
computed inside the same operation that writes `lastAt`, from the document read "before", so concurrent requests on
different replicas see consistent data. The first command of a minute has no previous command in its document, so the
rules have no memory across the minute boundary.

## Leaderboard query (H)
```js
Solve.aggregate([
  { $group: { _id: '$teamId', points: { $sum: '$points' }, solves: { $sum: 1 }, lastSolveAt: { $max: '$solvedAt' } } },
  { $sort: { points: -1, lastSolveAt: 1 } },
  { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
  { $unwind: '$team' },
  { $match: { 'team.banned': { $ne: true } } },
  { $project: { points: 1, solves: 1, lastSolveAt: 1, teamName: '$team.name' } }
]);
```
Teams with zero solves (and not banned) are appended at the bottom with 0 points. The service then sorts the whole list
in memory with the tie-breaks points desc, earliest `lastSolveAt`, team name, team id, so every replica returns the same
order. The timeline reads the `solves` of the top 10 teams in `solvedAt` order (the `{ solvedAt: 1 }` index).

## attemptcounters (security)
Fixed-window counters shared by all replicas (`services/attemptLimiter.js`). One document per limiter key; today only the team join
limit uses it (`join:<cognito sub>`: 10 attempts per 15 minutes, then 429).
| Field | Type | Notes |
|-------|------|-------|
| key | String | Unique, for example `join:<cognito sub>` |
| count | Number | Attempts in the current window (atomic `$inc`) |
| expiresAt | Date | End of the window; TTL index (`expireAfterSeconds: 0`) removes the document afterwards |

Updates are single-document atomic operations (`$inc` in a live window, conditional reset of an expired one, unique-key insert for the
first attempt), so the count is exact across replicas. Reusable for other limits: call `consumeAttempt(key, { limit, windowMs })`.

## Relationships
```
users --(teamId)--> teams <--(teamId)-- instances --(challengeId)--> challenges
                      ^                                                 ^
                      +--------------- solves / submissions ------------+
```
