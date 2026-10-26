# Database Schema (MongoDB Atlas, database `ctf_arena`)

Models are written with Mongoose. Field types: S = string, N = number, D = date, B = boolean, OID = ObjectId.
Owner: **S** Swarup, **G** Gururaj.

## users (S)
| Field | Type | Notes |
|-------|------|-------|
| _id | OID | |
| cognitoSub | S | **unique index**, from the token `sub` |
| email | S | |
| displayName | S | default = part before `@` |
| role | S | `player` or `admin`, copied from the token on each login |
| teamId | OID or null | ref `teams` |
| createdAt, updatedAt | D | |

## teams (S)
| Field | Type | Notes |
|-------|------|-------|
| _id | OID | |
| name | S | **unique index** (case-insensitive collation) |
| inviteCode | S | **unique index**, 6 uppercase characters |
| captainId | OID | ref `users` |
| memberIds | [OID] | max 3 |
| banned | B | default false |
| createdAt | D | |

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
