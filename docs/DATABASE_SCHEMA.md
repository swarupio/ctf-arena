# Database Schema (MongoDB Atlas, database `ctf_arena`)

Models are written with Mongoose. Field types: S = string, N = number, D = date, B = boolean, OID = ObjectId.
Owner: **S** Swarup, **G** Gururaj, **H** Shubham.
Implementation status: `User`, `Team`, `Challenge`, `Instance`, `Submission`, `Solve` and `ReplicaStat`
exist with the indexes below (the first six were verified live on Atlas; `ReplicaStat` was also exercised live by the
end-to-end browser run). The leaderboard query is implemented in `services/leaderboardService.js`.
Mongoose also adds its default `__v` version key to documents.
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
| category | S | web, crypto, forensics, misc, pwn |
| difficulty | S | easy, medium, hard |
| points | N | |
| type | S | `static` or `docker` |
| image | S | Docker image name (docker type) |
| internalPort | N | port inside the container (docker type) |
| flagHash, flagSalt | S | static type only. **Never sent to clients** |
| attachments | [{ name, url }] | |
| visible | B | |
| solveCount | N | incremented with `$inc` on each first solve per team |
| createdAt | D | |

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

## Relationships
```
users --(teamId)--> teams <--(teamId)-- instances --(challengeId)--> challenges
                      ^                                                 ^
                      +--------------- solves / submissions ------------+
```
