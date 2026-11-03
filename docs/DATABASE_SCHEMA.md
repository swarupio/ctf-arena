# Database Schema (MongoDB Atlas, database `ctf_arena`)

Models are written with Mongoose. Field types: S = string, N = number, D = date, B = boolean, OID = ObjectId.
Owner: **S** Swarup, **G** Gururaj.
Implementation status (Phase 2): `User`, `Team`, `Challenge`, `Instance`, `Submission` and `Solve`
exist with the indexes below (verified live on Atlas). The leaderboard query is a Phase 3 contract.
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

## Leaderboard query (H)
```js
Solve.aggregate([
  { $group: { _id: '$teamId', points: { $sum: '$points' }, solves: { $sum: 1 }, lastSolveAt: { $max: '$solvedAt' } } },
  { $sort: { points: -1, lastSolveAt: 1 } },
  { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
  { $unwind: '$team' },
  { $match: { 'team.banned': false } }
]);
```
Teams with zero solves are appended at the bottom with 0 points.

## Relationships
```
users --(teamId)--> teams <--(teamId)-- instances --(challengeId)--> challenges
                      ^                                                 ^
                      +--------------- solves / submissions ------------+
```
