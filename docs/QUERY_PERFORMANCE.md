# Query performance

Review of every MongoDB call in `backend/src`, with measured query counts per request and (on a throwaway local
MongoDB) `explain('executionStats')` plans for the heavy ones. Nothing here touched Atlas: counts come from the in-memory
fake database (`backend/tests/queryCount.test.js`, helper `backend/tests/helpers/queryCounter.js`) and plans from a
disposable `mongo:7` container with synthetic data (see section 4).

Unit of "queries": one round trip to MongoDB (a find, count, aggregate, upsert, create, findOneAndUpdate). The fake counts
every model call that reaches it. Set `QUERY_COUNT_REPORT=1` to print the table:
`cd backend && QUERY_COUNT_REPORT=1 npx vitest run tests/queryCount.test.js`. Without it the file asserts a **budget** per
endpoint (the numbers in the "After" column), so a change that adds a query to a hot path fails a test; raise a budget
only with a reason written here.

## 1. Query table (static review)

Legend: IX = served by an index (name = declared index), lean = `.lean()`/projection, N+1 = a query inside a loop,
unbounded = no `limit`. "Poll" = repeated by the frontend.

### Every request
| File | Query | Filter / sort | Index | lean / proj | N+1 / unbounded | Frequency |
|---|---|---|---|---|---|---|
| `services/teamContext.js` | `User.findOne`, then `Team.findById` | `cognitoSub`; `_id` | IX unique `cognitoSub`; `_id` | both | no (two dependent reads) | every team-scoped request |
| `services/adminSettings.js` `assertSubmissionsOpen` | `AppSetting.findOne({key})` | `key` | IX unique `key` | lean, 2 fields | no | every submit (fails closed with 503) |
| `services/adminSettings.js` `getEventConfig` | same document | `key` | IX unique `key` | lean, `event` only | no | `/event` (poll, `max-age=3`), `/leaderboard*`, `/feed`, `/challenges` |
| `middleware/requestCounter.js` | `ReplicaStat` upsert | `replica` | IX unique | n/a | no | batched, one write per 5 s per replica |

### Submit paths (once per answer)
| File | Query | Filter / sort | Index | lean / proj | N+1 / unbounded | Frequency |
|---|---|---|---|---|---|---|
| `routes/challenges.js` | `Challenge.findOne({_id, visible})` | `_id` | IX `_id` | lean, full row (flag fields are needed) | no | per submit |
| same | `Solve.exists`, `Submission.countDocuments` (twice: before and after the insert, closes a parallel-burst race) | `{teamId, challengeId}`; `+ createdAt >=` | IX unique `{teamId,challengeId}`; IX `{teamId,challengeId,createdAt:-1}` | count/exists | no | per submit |
| `services/scoringService.js` `recordSolve` | `Solve.create`, `Challenge.findOneAndUpdate $inc solveCount`, `Solve.updateOne` (first blood only) | unique pair; `_id` | IX | proj `solveCount` | no | per correct answer |
| `services/attemptLimiter.js` | `AttemptCounter.findOneAndUpdate` (1 per call; 3 on the first attempt of a window: miss, miss, create) | `key` | IX unique `key`, TTL `expiresAt` | n/a | no; osint/forensics call it twice (two windows) | every game attempt |
| `services/achievementService.js` | `Solve.find` (`$or` user/team), `Challenge.find $in`, `Challenge.aggregate` (terminal totals, only when a terminal code was solved), `Achievement.find`, `Achievement.updateOne` per **new** badge | `userId` / `teamId`; `_id`; `type`; `userId` | IX `{userId,solvedAt}` + `{teamId,challengeId}` (OR); `_id`; `{type,terminal.mode}`; `{userId,key}` | lean + projections | no (was one upsert per earned badge) | per correct answer, bounded by 1.5 s |
| `games/cipherlab`, `games/crackme` `service.js` | `Challenge.find({type:'game',visible})` (about 30 rows), `Solve.find` team + `$in`, `Submission.find sort createdAt -1 limit 40` (streak), `*Hint.countDocuments` | | IX prefix `type`; `{teamId,challengeId}`; `{teamId,challengeId,createdAt}`; unique hint index | lean | `Challenge.find` unbounded but a handful of rows | per answer / overview |
| `services/osintService.js`, `forensicsService.js` | `Challenge.find({type,'x.track'})`, `Solve.find`, `consumeAttempt` x2, `Submission.create`, `OsintBoard.findOne` | | IX `{type,osint.track}`, `{type,forensics.track}` | lean | tracks list was N+1 (see 3) | per answer |
| `services/weblabService.js`, `terminalService.js` | `Challenge.find` by type/mode, `Solve.find`, `Submission.countDocuments` x2 (terminal: limiter), `consumeAttempt` | | IX `{type,terminal.mode}` | lean | no | per submit |

### Polled and page-load reads
| File | Query | Index | lean / proj | N+1 / unbounded | Frequency |
|---|---|---|---|---|---|
| `services/leaderboardService.js` | `Solve.aggregate` (`$group` by team, `$lookup` teams) + `Team.find({banned:{$ne:true}},'name')` | live: collection scan (see 4); frozen: `{solvedAt,adjustment,teamId,points}` covered | lean | bounded by team count (hundreds) | every client polls every 10 s, **memoised 5 s per replica and view** |
| same, `getTimeline` | `Solve.find({teamId:{$in:top 10}}).sort(solvedAt,_id)` | `{teamId,challengeId}` + in-memory sort | lean + proj | bounded (10 teams' solves) | poll, shares the ranking memo |
| same, `getTeamScore`, `scoringService.teamScore` | `Solve.aggregate $match teamId` | `{teamId,points,solvedAt,adjustment}` covered | n/a | no | frozen `/leaderboard/me`, `/teams/me` |
| `services/socialService.js` `getFeed` | 3 newest-first bounded reads (`Solve`, `Achievement`, `Team`, each `limit n`) then at most 2 lookups | `{solvedAt,...}` (covered filter), `{awardedAt:-1}`, `_id` | lean + proj | no, bounded by `limit` (max 50) | ActivityTicker poll |
| `routes/challenges.js` GET `/` | `Challenge.find({visible})` sort `points,title`; `Solve.find({teamId})` | `{visible,points,title}`; `{teamId,challengeId}` | lean + proj | team's solves bounded by challenge count | page load |
| cipherlab / crackme / osint / forensics / weblab / terminal overviews | one `Challenge.find` for the whole game, one `Solve.find` for the team (was one per track), streak/patch reads | see above | lean | no | page load |
| `routes/auth.js` GET `/me` | `User.findOne` (+ `Team.findById`) | unique `cognitoSub` | lean | no | page load |

### Admin
| File | Query | Notes |
|---|---|---|
| `services/adminStats.js` `getOverview` | 4 counts, 3 per-day aggregations (`createdAt`/`solvedAt` ranges), top teams, per-challenge solve and submission groupings, terminal codes, active instances | polled every 15 s per open dashboard. Collection-wide groupings are full scans by nature (MongoDB scans the collection for a predicate-less `$group`). Now 15 queries (was 18). |
| `services/adminTeams.js` | list: all teams (hundreds) + one grouped aggregate, sorted and paged in memory; detail: **one team's** aggregate (was every team's) | list is bounded by the team count |
| `services/adminUsers.js`, `adminSolves.js`, audit, submissions | paginated with `skip`/`limit <= 100` (`adminCommon.MAX_LIMIT`), sorted on indexed fields (`createdAt`, `{userId,solvedAt}`, `{challengeId,solvedAt}`) | on demand |
| `services/adminExport.js` | capped by `EXPORT_CAP` | on demand |
| `services/adminService.js` `getStats` (legacy `GET /admin/stats`) | 5 counts + `ReplicaStat.find`; `Submission.countDocuments({correct:false})` has no index (collection scan, about 110 ms at 200k rows) | not used by the current dashboard; left as is to keep the legacy shape |
| `services/reaper.js`, `instanceService.js` | `Instance` by `{status,expiresAt}`, `{status,port}`, partial unique `port` | background, small |

## 2. Before and after: queries per request

Measured on the fake database with an established world (two teams, seeded games). The "Before" column is the code at
the start of this review.

| Endpoint | Before | After | What changed |
|---|---:|---:|---|
| POST `/challenges/:id/submit` wrong flag | 9 | 9 | already minimal (the second count closes a race on purpose) |
| POST `/challenges/:id/submit` correct, first solve of a user (6 badges new) | 23 | 21 | no `teamScore` aggregation, no Instance lookup for non-docker, team doc reused |
| same, badges already held (usual case) | 23 | 16 | badges read once instead of one upsert per earned badge |
| POST `/terminal/:mode/submit` correct | 22 | 22 | -3 from this review, +3 from the per-mode attempt limiter another agent added meanwhile (first attempt of a window; 1 query afterwards) |
| POST `/cipherlab/levels/:id/answer` correct | 25 | 22 | no `teamScore`, streak reuses the solves already read, user+team solves in one read |
| POST `/crackme/levels/:id/answer` correct | 24 | 22 | same |
| POST `/osint/.../answer` correct | 25 | 23 | same |
| POST `/forensics/.../answer` correct | 26 | 24 | same |
| POST `/weblab/labs/:slug/submit` correct | 22 | 20 | same |
| GET `/leaderboard` | 3 | 3 | the idle-teams read now runs in parallel with the aggregation (2 sequential round trips, was 3) |
| GET `/leaderboard/timeline` | 4 | 4 | same shared ranking |
| GET `/event`, `/announcement` | 1 | 1 | |
| GET `/me` | 2 | 2 | |
| GET `/challenges` | 4 | 5 | +1 is the event read another agent added (frozen/ended view), not part of this review |
| GET `/cipherlab/overview` | 6 | 5 | streak shares the team's solves read |
| GET `/crackme/overview` | 6 | 6 | |
| GET `/osint/cases` | 7 | 4 | one solves read for all tracks instead of one per track |
| GET `/forensics/tracks` | 7 | 4 | same |
| GET `/weblab/labs`, `/terminal/modes` | 4 | 4 | |
| GET `/feed` | n/m | 6 | bounded newest-first reads, already minimal |
| GET `/admin/stats/overview` | 18 | 15 | solve and submission totals derived from the two per-challenge groupings (3 collection-wide counts removed) |
| GET `/admin/teams/:id` | 1 full-collection aggregate over all solves | 1 aggregate over that team's solves | indexed `$match`, same result |

Sequential round trips (latency) also dropped on every game submit: the team context and the game rows are read at the
same time (`both()` in `routes/challenges.js`, errors reported in the order the sequential code did), and the badge
evaluation reads the held badges in the same round trip as the facts.

## 3. What was changed, and why

1. **`recordSolve` no longer computes `score`** (`teamScore` aggregation per solve). No caller used it; the field was
   only asserted by one test (updated). Read a team's score with `teamScore` when it is needed.
2. **Achievements** (`services/achievementService.js`): user and team solves come from one `$or` read (index union),
   split in memory (same `userSolves` / `teamSolves` as before); held badges are read in parallel and only missing ones
   are upserted (the unique `{userId,key}` index plus the upsert still make it idempotent across replicas; only the call
   that really inserts reports a badge); the team document is not read when the caller passes `memberCount` (the
   submit routes already hold the team). Results are identical (new tests in `tests/social/achievements.test.js`).
   Worst case (first evaluation, every badge new) is one find more than before; every later solve saves most upserts.
3. **N+1 on category pickers** (`forensics/tracks`, `osint/cases`): one `Solve.find` for all tracks
   (`teamSolvesByTrack`) instead of one per track.
4. **Cipher Lab streak** reuses the team's solves read for the status check (and adds the just-recorded solve in
   memory) instead of reading `Solve` again; a duplicate/raced solve still re-reads, as before.
5. **Independent reads in parallel**: team context with game rows on every game submit; leaderboard aggregation with
   the idle-teams read (the `$nin` list of solved ids is replaced by a set difference in the service, same output).
6. **Static challenges** no longer look up an instance to stop (`instanceService.start` refuses every type but docker).
7. **Admin**: overview totals derived from groupings already computed; team detail aggregates one team.
8. **Index** `{ solvedAt: 1, adjustment: 1, teamId: 1, points: 1 }` on `solves`, replacing `{ solvedAt: 1 }`.

## 4. Plans (throwaway MongoDB 7, 50,300 solves, 200,000 submissions, 20,000 users, 2,000 teams, 220 challenges)

`explain('executionStats')`, base = indexes as declared before this review, new = with the replacement index.
Times are single runs on a laptop; read the document counts and plan stages rather than the milliseconds.

| Query | Base | New |
|---|---|---|
| Frozen leaderboard (`$match solvedAt <= freeze`, `$group` by team) | `IXSCAN solvedAt_1` + FETCH, 25,351 docs, 73 ms | covered `IXSCAN solvedAt_1_adjustment_1_teamId_1_points_1`, **0 docs**, 27 ms |
| Admin solves per day (14 d, real solves) | FETCH over 50,300 docs, 118 ms | covered, **0 docs**, 46 ms |
| Feed (newest 20 real solves) | `IXSCAN solvedAt_1` | `IXSCAN` of the new index, same 20 keys / 20 docs |
| `getTeamScore` (`$match teamId`) | covered `IXSCAN {teamId,points,solvedAt,adjustment}`, 3 ms | unchanged |
| Achievements: user solves, team solves | 2 queries (14 + 144 docs) | one `OR` of the two index scans (158 keys, 144 docs, 2 ms) |
| Held badges `{userId}` | `IXSCAN {userId,key}`, 4 docs | unchanged |
| Rate-limit count (team, challenge, 60 s) | `IXSCAN {teamId,challengeId,createdAt}` | unchanged |
| Live leaderboard (`$group` over every solve) | COLLSCAN 50,300 docs, 65 to 87 ms | unchanged: a pipeline without a predicate is a collection scan, with or without a covering index. A leading `$sort`/`$match` trick to force the covered index measured 73 to 76 ms, no real gain, so it was not adopted. The 5 s memo per replica is what bounds this. |
| Admin submissions grouped by challenge | COLLSCAN 200,000 docs, 143 ms | tried `{challengeId,correct}`: not used by the planner (no predicate), so it was **not** added |
| Admin solves by challenge (real) | COLLSCAN 50,300 docs, 34 ms | tried `{challengeId,adjustment}`: not used, **not** added |
| Admin counts it replaced (`Submission.countDocuments({})`, `{correct:false}`, real solves) | COLLSCAN 200,000 / 200,000 / 50,300 docs, 60 + 116 + 24 ms | removed from the overview |

The container (`ctf-optimiser-mongo`, bound to 127.0.0.1:27999, no volume) was removed afterwards.

## 5. Owner actions (nothing was run against Atlas)

1. Create the new index: `cd backend && npm run db:indexes` (creates missing indexes, never drops).
2. After it has built, drop the now redundant `solvedAt_1` index of the `solves` collection (removing it from the
   schema does not drop it from Atlas): in Atlas (Collections > solves > Indexes) or `db.solves.dropIndex('solvedAt_1')`.
   `npm run db:indexes -- --prune` would also do it, but it drops **every** index that is not in a schema, so only use
   it if you have checked `db.solves.getIndexes()` (an old `{teamId,points,solvedAt}` index without `adjustment` can
   also be dropped, as already noted in DATABASE_SCHEMA.md).

New indexes: `solves { solvedAt:1, adjustment:1, teamId:1, points:1 }`. Removed from the schema: `solves { solvedAt:1 }`
(drop in Atlas as above). No other index changed.

## 6. Looked at and deliberately not changed

- **Settings read on every submit** (`AppSetting`, 1 query): it is the freeze/event guard and must be consistent across
  replicas and fail closed, so there is no process cache. It could be merged into other reads only by changing the
  documented guard order.
- **`getTeamContext`** (2 dependent reads on every request): a `$lookup` aggregation would make it one query but changes
  the model calls that dozens of route tests mock, and the two reads are indexed point lookups.
- **Attempt limiter**: 1 query per call in steady state; the first attempt of each window costs 3 (miss, miss, create).
  A single upsert with an update pipeline would make it 1, but changes the call shapes the game tests emulate and the
  atomic three-step design documented in `attemptLimiter.js`. osint and forensics call it twice on purpose (two
  windows with different budgets; the second counter must not move when the first one refuses).
- **Second `Submission.countDocuments` after the insert** (flag submit and terminal): it closes the parallel-burst race.
- **Live leaderboard aggregation**: see section 4; memoised per replica for 5 s.
- **Achievement user solves**: the evaluation still reads all of a player's solves (needed for the streak and the "3 in
  an hour" rules); a bounded read would change results. The read is one indexed query, bounded by the challenge count.
- **Legacy `GET /admin/stats`** counts: left as is (not polled by the current dashboard).
- **Count queries** (`estimatedDocumentCount`): not used, they are not exact and the admin output must stay identical.
