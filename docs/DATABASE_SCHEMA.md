# Database Schema (MongoDB Atlas, database `ctf_arena`)

Models are written with Mongoose. Field types: S = string, N = number, D = date, B = boolean, OID = ObjectId.
Owner: **S** Swarup, **G** Gururaj, **H** Shubham.
Arena Terminal addition: `challenges.type` / `category` gain `terminal` plus the `terminal` sub-document (see below).
Implementation status: all 20 models, listed here with their collection names, exist and are described in this file: (`User`, `Team`, `Challenge`, `Instance`, `Submission`, `Solve`, `ReplicaStat`, `AuditLog`, `AppSetting`, `AttemptCounter`, `Achievement`, `CheatSignal`, `TaintedFlag`, `TerminalActivity`, `CipherHint`, `CrackmeHint`, `OsintHint`, `CrackmePatch`, `OsintBoard`, `HintOpen`)
exist (collections: `users`, `teams`, `challenges`, `instances`, `submissions`, `solves`, `replicastats`, `auditlogs`, `appsettings`,
`attemptcounters`, `achievements`, `cheatsignals`, `taintedflags`, `terminalactivities`, `cipherhints`, `crackmehints`, `osinthints`,
`crackmepatches`, `osintboards`, plus `hintopens`, see below). The core six were verified live on Atlas; `ReplicaStat` was also exercised live by the
end-to-end browser run. The leaderboard query is implemented in `services/leaderboardService.js`.
Mongoose also adds its default `__v` version key to documents, except on the collections whose schema sets `versionKey: false`
(`replicastats` keeps it; `auditlogs`, `appsettings`, `attemptcounters`, `cheatsignals`, `taintedflags`, `terminalactivities`, the three hint
collections, `crackmepatches` and `osintboards` do not).
Fair-play addition (`docs/FAIR_PLAY.md`): `cheatsignals`, `taintedflags` and `terminalactivities`, all with TTL indexes.
Phase 2 detail: `instances` has no `updatedAt`; a failed start sets `status: 'failed'`, which sits outside the
partial unique indexes and so frees the port. `solves.points` starts as the base points and is raised to include
the bonus when the team is the first solver (`solveCount` becomes 1 atomically). For Cipher Lab, Crackme and OSINT (and the categories wired in phase 2) the starting value is the base points minus the hint cost of the level (`docs/HINTS.md` "Hint costs"), never below 1. Team score is the sum of `solves.points`.

## users (S)
| Field | Type | Notes |
|-------|------|-------|
| _id | OID | |
| cognitoSub | S | required, **unique index**, from the token `sub` |
| email | S | required; token email validated by auth middleware, no schema email-format validator or unique index |
| displayName | S | default = part before `@` |
| role | S | required, `player` or `admin`; refreshed from verified token on GET/PATCH `/me` and team create/join, not by login itself |
| teamId | OID or null | Mongoose ref `Team`, default null (collection `teams`) |
| banned | B | default false; set by `PATCH /admin/users/:id/ban`. A banned user gets 403 `USER_BANNED` from `getTeamContext` (submit, instances, terminal) |
| createdAt, updatedAt | D | |

Indexes: **unique** `{ cognitoSub: 1 }`, `{ createdAt: -1 }` (admin user list, newest first).

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
| type | S | `static`, `docker`, `terminal`, `forensics`, `reversing` or `osint`. Two more values are used by seeds: `game` (Cipher Lab levels, category `crypto`) and `weblab` (Web Exploit Lab, category `web`); see each category's doc |
| image | S | Docker image name (docker type) |
| internalPort | N | port inside the container (docker type) |
| flagHash, flagSalt | S | static type only. **Never sent to clients** |
| terminal | `{ mode, code }` | terminal type only (`_id: false`): `mode` is `easy`, `medium` or `hard`, `code` a number >= 1. Required when `type` is `terminal` |
| attachments | [{ name, url }] | |
| visible | B | |
| solveCount | N | incremented with `$inc` on each first solve per team |
| createdAt | D | |

Indexes: `{ type: 1, 'terminal.mode': 1 }` (loads the codes of a terminal mode in one query), `{ visible: 1, points: 1, title: 1 }` (the player challenge list: filter and sort).

Forensics Desk (`docs/FORENSICS_DESK.md`) adds `type: 'forensics'` (category `forensics`) and the optional
`forensics` sub-document `{ track, stage }` (`_id: false`; `track` is `easy`, `medium`, `hard` or `insane`, `stage` a
number >= 1; required when `type` is `forensics`), slug `forensics-<track>-<n>`, index `{ type: 1, 'forensics.track': 1 }`.
`difficulty` is `hard` for the insane track (the enum has no `insane`). Nothing generated is stored: artefacts, answers
and flags derive from `FLAG_SECRET`. Created by `npm run seed:forensics` (idempotent upsert keyed by slug).

Crackme Arcade (`docs/CRACKME_ARCADE.md`) adds `type: 'reversing'` (category `pwn`), slug `crackme-<id>`, `difficulty`
`hard` for the insane track, dynamic per-team flags (nothing stored), created by `npm run seed:crackme`. Hint openings
are rows of the `crackmehints` collection (`teamId`, `userId`, `levelId`, `index`, `createdAt`; unique
`{ teamId, levelId, index }`, 90-day TTL).

OSINT Trail (`docs/OSINT_TRAIL.md`) adds `type: 'osint'` (category `misc`) and the optional `osint` sub-document
`{ track, stage }` (`_id: false`; `track` is `easy`, `medium`, `hard` or `insane`, `stage` a number >= 1; required when `type`
is `osint`), slug `osint-<track>-<n>`, index `{ type: 1, 'osint.track': 1 }`. `difficulty` is `hard` for the insane case.
Flags are dynamic per team (`flagService.hasDynamicFlag`), nothing generated is stored, and the type is **not** in the
first-blood allowlist. Hints opened by teams are logged in the collection `osinthints` (`{ teamId, userId, key, index,
createdAt }`, unique on `{ teamId, key, index }`, TTL 90 days; `key` is `<track>:<question>`). Created by
`npm run seed:osint` (idempotent upsert keyed by slug).

Terminal challenges (Arena Terminal, `docs/ARENA_TERMINAL.md`) have `type: 'terminal'`, `category: 'terminal'`,
slug `terminal-<mode>-<n>`, title `Terminal <Mode> #<n>`, `difficulty` equal to the mode and the points of the mode
definition. Nothing is stored for their flag: like docker challenges it is derived per team
(`dynamicFlag` over the slug, team id and challenge id), so `flagHash` and `flagSalt` stay unset. They are created by
`npm run seed:terminal` (idempotent upsert keyed by slug; re-running resets title, description, points and difficulty,
keeps `visible` and `solveCount`) and are not creatable through the admin API; admins may edit or hide them. A hidden
one (`visible: false`) is switched off for the Arena Terminal. Solves and submissions use the normal `solves` and `submissions`
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
| createdAt, stoppingAt, stoppedAt | D | `stoppingAt` is set when a stop claims the instance (`stopping`); the reaper finishes claims older than 5 minutes (crashed replica) |

Indexes:
- **Partial unique** on `{ port: 1 }` where `status` in `starting|running|stopping` -> atomic port claim across replicas.
- **Partial unique** on `{ teamId: 1, challengeId: 1 }` where status is active -> one live instance per team per challenge.
- `{ status: 1, expiresAt: 1 }` for the reaper.
- `{ teamId: 1, status: 1, createdAt: 1 }` for the team's active instances (list, limit checks).
- `{ status: 1, port: 1 }` so the free-port scan is answered from the index alone.

`stopping` is the short claim state while a replica removes the container. If that replica crashes mid-stop the
instance stays `stopping` (still holding its port); the reaper and the player routes only claim `starting|running`,
so the admin kill route claims it with `{ force: true }` and finishes the cleanup (see `API_SPEC.md`). The reaper also takes over `stopping` claims older than 5 minutes (`stoppingAt`, atomic `findOneAndUpdate`).

## submissions (G)
Every attempt, right or wrong. Used for rate limiting and admin stats.
| Field | Type | Notes |
|-------|------|-------|
| teamId, userId, challengeId | OID | |
| correct | B | |
| submittedHash | S | SHA-256 of what was submitted (do not store raw wrong flags) |
| createdAt | D | |

Indexes: `{ teamId: 1, challengeId: 1, createdAt: -1 }`, `{ userId: 1, createdAt: -1 }` (admin submissions filtered by player). TTL index deletes rows after 30 days.

Arena Terminal: `POST /terminal/:mode/submit` stores every attempt here. A correct attempt is stored against the code it
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
| adjustment | B | default false. `true` marks a **manual score adjustment** by an admin (Admin API v2): `challengeId` is a fresh random ObjectId that matches no challenge, `userId` is the admin, `points` may be negative |
| reason | S | max 200; set on adjustments only |

Indexes: **unique** `{ teamId: 1, challengeId: 1 }` (blocks double solves; adjustments never collide because each has its own random `challengeId`), `{ solvedAt: 1, adjustment: 1, teamId: 1, points: 1 }` for everything ordered by time (the activity feed, the frozen leaderboard and the admin per-day series are answered from the index alone; it replaces the older `{ solvedAt: 1 }`, which is now only a prefix of it and can be dropped, see docs/QUERY_PERFORMANCE.md), `{ teamId: 1, points: 1, solvedAt: 1, adjustment: 1 }` (covers the team score, `$match` on one team, without reading solve documents; the unfiltered live leaderboard `$group` gets a collection scan whatever the indexes, which is why its result is memoised; an older index without `adjustment` may remain in existing databases and can be dropped), `{ userId: 1, solvedAt: -1 }` (a player's solves, newest first: admin user detail and terminal reset) and `{ challengeId: 1, solvedAt: 1 }` (a challenge's solves in order: first-blood promotion, admin filters).
Team score is still the sum of `points`, so adjustments count everywhere without query changes. Code that counts "solves" must
filter `adjustment: { $ne: true }` (the admin API does; the public leaderboard's `solves` counter does too, while its `points` include adjustments).

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

## achievements (cosmetic badges, see `docs/ACHIEVEMENTS.md`)
| Field | Type | Notes |
|-------|------|-------|
| userId | OID | the player who earned the badge |
| key | S | badge key from the catalog in `services/achievementService.js` |
| awardedAt | D | |

Indexes: **unique** `{ userId: 1, key: 1 }` (awarding is an upsert with `$setOnInsert`, so it is idempotent across replicas),
`{ awardedAt: -1 }` for the public feed. Badges never change `solves.points`.
## Admin API v2 collections
### auditlogs
Append-only record of every mutating admin action (`services/adminAudit.js`). Written after the action succeeded.
| Field | Type | Notes |
|-------|------|-------|
| actorId | OID or null | ref `User`; null when the admin never opened the app (no user row) |
| actorEmail | S | required, from the verified token |
| action | S | required, dotted verb such as `team.ban`, `solve.delete`, `settings.update` (list in `API_SPEC.md` "Audit log") |
| targetType, targetId | S | `user`, `team`, `challenge`, `solve`, `instance`, `settings`, `export`; id as text |
| before, after | Mixed | small secret-free summaries (primitives, strings cut to 200 chars, keys matching flag/hash/salt/secret/token/password/inviteCode/containerId dropped) |
| note | S | max 500, the admin's reason |
| ip | S | raw address of the admin (staff only) |
| createdAt | D | |

Indexes: `{ createdAt: -1 }`, `{ action: 1, createdAt: -1 }`, `{ actorId: 1, createdAt: -1 }`,
`{ targetType: 1, targetId: 1, createdAt: -1 }`, and a **TTL** on `{ createdAt: 1 }` of 365 days (bounded, no cron needed).

### appsettings
Platform settings: ONE document with `key: 'platform'` (`services/adminSettings.js`), upserted by `PUT /admin/settings`.
Read on demand by every replica; nothing is cached in a process.
| Field | Type | Notes |
|-------|------|-------|
| key | S | required, **unique index**, always `platform` |
| registrationOpen | B | default true. Published through `GET /announcement`; not enforced by the API (sign-up is in Cognito) |
| submissionsFrozen | B | default false. Enforced: every answer route (challenges, terminal, Cipher Lab, Crackme, Web Exploit Lab, Forensics, OSINT) answers 423 `SUBMISSIONS_FROZEN`. With `event` set, the same routes answer 423 `EVENT_NOT_STARTED` / `EVENT_ENDED` outside the window |
| announcement.text | S | max 500, empty = no banner |
| announcement.level | S | `info`, `warning`, `critical` |
| event | object | optional scheduled Arena event (`docs/EVENT_MODE.md`); absent = no event. Cleared with `$unset`. The phase is never stored, it is derived from these timestamps and the clock |
| event.name | S | optional, max 80 |
| event.startsAt, event.endsAt | D | both required for the event to count; `endsAt` > `startsAt` (validated by the admin API) |
| event.freezeAt | D | optional, strictly between start and end; the public scoreboard shows solves with `solvedAt <= freezeAt` from then until `endsAt` |
| hintCosts | object | optional hint costs (`docs/HINTS.md`); absent = defaults `{ enabled: true, nudge: 5, approach: 10, walkthrough: 25, maxPercent: 40 }`. Replaced as a whole by `PUT /admin/settings`, cleared with `$unset`; read through `normalizeCosts` (clamped, defaulted) |
| hintCosts.enabled | B | false = hints are free |
| hintCosts.nudge, .approach, .walkthrough, .maxPercent | N | integers 0..100: percent of the level's base points for the 1st, 2nd and 3rd-or-later hint, and the cap on the level total |
| updatedBy | S | email of the last admin who saved |
| updatedAt | D | |

## Leaderboard query (H)
```js
Solve.aggregate([
  { $group: { _id: '$teamId', points: { $sum: '$points' }, solves: { $sum: { $cond: [{ $eq: ['$adjustment', true] }, 0, 1] } }, lastSolveAt: { $max: '$solvedAt' } } },
  { $sort: { points: -1, lastSolveAt: 1 } },
  { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
  { $unwind: '$team' },
  { $match: { 'team.banned': { $ne: true } } },
  { $project: { points: 1, solves: 1, lastSolveAt: 1, teamName: '$team.name' } }
]);
```
Teams with zero solves (and not banned) are appended at the bottom with 0 points. The service then sorts the whole list
in memory with the tie-breaks points desc, earliest `lastSolveAt`, team name, team id, so every replica returns the same
order. The timeline reads the `solves` of the top 10 teams in `solvedAt` order (the `{ teamId: 1, challengeId: 1 }` index, then a small in-memory sort).

## cipherhints (G)
One row per hint a team opened in Cipher Lab (an admin audit log, and the source of the hint cost of the level, `docs/HINTS.md`). Admin previews write no row.
| Field | Type | Notes |
|-------|------|-------|
| teamId, userId | OID | who opened it |
| levelId | S | Cipher Lab level id, for example `e1` |
| index | N | 0-based hint number |
| createdAt | D | no `updatedAt`, no `__v` |

Indexes: **unique** `{ teamId: 1, levelId: 1, index: 1 }` (a double click or a second replica writes one row), TTL on `{ createdAt: 1 }` of 90 days.

## osintboards (G)
The team's shared red-string evidence board per OSINT case (model `OsintBoard`, one document per team and case). Only evidence ids, positions and relation types are stored; the required chain is recomputed from the team's deterministic world.
| Field | Type | Notes |
|-------|------|-------|
| teamId | OID | ref Team |
| track | S | case id, at most 20 characters |
| version | N | default 0; every save is `findOneAndUpdate({ teamId, track, version }, { $set, $inc: { version: 1 } })`, a stale version is a 409 |
| pins | `[{ id, x, y }]` | no `_id`; `id` is `<source>:<id>` (at most 70 chars), `x` and `y` numbers 0..1000; at most 40 pins (service limit) |
| links | `[{ a, b, rel }]` | no `_id`; `a` and `b` evidence ids (at most 70 chars), `rel` at most 12 chars; at most 2 x M (M = required links of the case, service limit) |
| unlocked | B | default false; set in the same atomic update as the save that completed the chain, never cleared |
| updatedBy | OID | ref User |
| createdAt, updatedAt | D | |

Indexes: **unique** `{ teamId: 1, track: 1 }`. Run `npm run db:indexes` once after deploy.

## crackmepatches (G)
Cosmetic Patch Bay badges (model `CrackmePatch`): written once when a team's patch makes a hard or insane cabinet accept every hidden test input.
| Field | Type | Notes |
|-------|------|-------|
| teamId, userId | OID | who patched |
| levelId | S | cabinet id, for example `h2` |
| edits | N | number of edits used |
| createdAt | D | |

Indexes: **unique** `{ teamId: 1, levelId: 1 }` (an atomic `$setOnInsert` upsert), no TTL. No points are stored here.

## crackmehints and osinthints (G)
Same shape and purpose as `cipherhints` (admin audit log and hint-cost source, no `updatedAt`, no `__v`). Fields: `teamId`, `userId`, `index` (0-based),
`createdAt`, plus `levelId` (S, `crackmehints`, for example `h2`) or `key` (S, `osinthints`, `<track>:<question>`). Indexes: **unique**
`{ teamId, levelId, index }` (`crackmehints`) or `{ teamId, key, index }` (`osinthints`), and a TTL on `{ createdAt: 1 }` of 90 days.

## hintopens (G)
Ledger of hints a team opened, for categories without an older hint collection (Web Exploit Lab, Forensics, Terminal; all wired). Written by `services/hintLedger.js` `recordHintOpen`, read together with `cipherhints`, `crackmehints` and `osinthints` by `spentForLevel` (every index counted once). No `updatedAt`, no `__v`.
| Field | Type | Notes |
|-------|------|-------|
| teamId, userId | OID | team charged, user who opened it |
| scope | S | category id, for example `weblab`, `forensics`, `terminal` |
| key | S | level within the category (lab slug, `<track>:<stage>`, ...) |
| index | N | 0-based hint number, min 0 |
| percent | N | percent of the level's base charged by this open, fixed when it was opened (cumulative tiers: the marginal cost). Absent on older rows (current rates apply) |
| capPercent | N | the `maxPercent` in force at that moment (0 when costs were off) |
| createdAt | D | |

Indexes: **unique** `{ teamId: 1, scope: 1, key: 1, index: 1 }` (an atomic `$setOnInsert` upsert: a repeated open never costs twice) and a TTL on `{ createdAt: 1 }` of 400 days. Declared in the model; create it with `npm run db:indexes` (not run by this change). Without the unique index a concurrent double open could write two rows, which the union still counts once.

## attemptcounters (security)
Fixed-window counters shared by all replicas (`services/attemptLimiter.js`). One document per limiter key; used by team join (`join:<cognito sub>`: 10 attempts per 15 minutes, then 429) and by every range category's answer, hint and request limits (`cipherlab:`, `crackme:`, `forensics:`, `osint:`, `weblab-req:`, `weblab-submit:`, `crackme-patch:`, `osint-board:` keys and `forensics:<teamId>:<track>:interview:<i>`).
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

## Performance notes
- Read paths use `lean()` (via the query options argument) with field projections; flag fields are never selected for player lists.
- The ranking is memoised in each replica for about 5 s (one entry, public data only), and `GET /api/leaderboard` sends
  `Cache-Control: private, max-age=5` plus an ETag. Staleness is therefore at most a few seconds.
- Indexes are built by Mongoose `autoIndex` at startup, in the background on modern MongoDB (no blocking of reads and writes).
  Existing deployments get the new indexes the next time a replica starts; the old ones stay valid.
  `autoIndex` is on locally and off on Vercel (`MONGOOSE_AUTO_INDEX=true|false` overrides). With it off, run
  `cd backend && npm run db:indexes` once and after every schema change (`-- --prune` also drops indexes no longer in a schema).
  The unique indexes (users, teams, solves, ...) are part of correctness, so never skip it on a fresh database.
- Connection pool: `maxPoolSize: 10`, `minPoolSize: 1` per replica.
