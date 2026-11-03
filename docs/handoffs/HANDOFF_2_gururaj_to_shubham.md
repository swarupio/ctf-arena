# Handoff: Phase 2 -> Phase 3 (engine)

Status: backend engine, challenge images and challenge UI implemented. Written by the Foundation
agent on Swarup's request while Gururaj's own work was in flight. **Gururaj: review this before tagging `v0.2-engine`.**

## What now exists
- Models: `Challenge`, `Instance`, `Submission`, `Solve` with the unique/partial/TTL indexes from `DATABASE_SCHEMA.md` (verified on Atlas).
- Services: `dockerService` (network, create/stop/list, all limits), `instanceService` (atomic port claim, start/stop/extend), `reaper` (expiry + startup reconcile), `flagService` (per-team HMAC flags, salted static hashes, `timingSafeEqual`), `scoringService` (10% first blood, team score = sum of solves), `teamContext`.
- Routes: `/api/challenges` (list, detail, instance, submit), `/api/instances`, `/api/admin/challenges` (CRUD). See `API_SPEC.md` (Phase 2 notes).
- Challenges: `_template` plus `sanity-check`, `caesar-says` (static) and `robots-rule`, `cookie-monster`, `login-bypass` (docker). Each has a `challenge.json`; `npm run seed:challenges` (in `backend/`) registers them (repeatable).
- Frontend: challenge list, challenge detail (start/stop/extend with countdown, flag form), admin challenge manager at `/admin/challenges`.
- `teams/me/leave`: the last member leaving deletes the team and now stops its instances.

## Verified
- Backend 203 tests, frontend 18 tests, frontend build.
- Live smoke test against Atlas + Docker: instance started with the team's flag served by the real container, second start rejected, two teams got different ports and flags, one extension of exactly 15 minutes then 409, first blood 110 / second team 100 / duplicate null, forced-expiry instance removed by the reaper, startup reconcile clean.
- Challenge images built and solved by hand under the production flags (read-only rootfs, cap-drop ALL, no-new-privileges).
- Compose: 3 replicas start, reach Atlas and Docker, and the reaper reconciles at startup.

## Not verified yet (needs a human)
- **P2-12/13/14:** a full browser play-through (sign in, join team, start instance, solve, see score) and the admin form with a real `admin` Cognito user. Tests and builds pass; boxes left unticked.
- Two replicas racing for the same port on a real second process (covered by the unique partial index and unit tests, not by a concurrent live run).
- Tag `v0.2-engine` and the handoff gate in `WORKFLOW.md`.

## Things Shubham must know
1. **Docker socket group.** The backend image runs as non-root `node`. `docker-compose.yml` now has `group_add: ["${DOCKER_GID:-0}"]`. On EC2 set `DOCKER_GID=$(getent group docker | cut -d: -f3)` in `.env`; on Docker Desktop the default `0` works.
2. **Ports.** Instances bind host ports `CHALLENGE_PORT_MIN..MAX` (default 30000-30100). Open them in the EC2 security group. `PUBLIC_HOST` must be the public address players can reach, or instance URLs will point at `localhost`.
3. **Images must exist on the host.** Build them on EC2 before play: `docker build -t ctf/<slug> challenges/<slug>` for each challenge folder.
4. **Reaper runs on every replica** every 60 s. Each stop is an atomic `findOneAndUpdate` claim, so replicas never fight; no extra config.
5. **Rate limit** (5 submits/min/team/challenge) is stored in MongoDB (`submissions`), not in memory, so scaling replicas is safe.
6. **Leaderboard:** `GET /leaderboard` can aggregate `solves` as in `DATABASE_SCHEMA.md`. Team score is also `scoringService.teamScore(teamId)`. `GET /teams/me` still returns `score: 0` (Swarup's file); switch it to `teamScore` when wiring the leaderboard.
7. **Admin team ban** (P3-04) should also stop that team's instances: `instanceService.stopTeamInstances(teamId)`.
8. Deleting a challenge keeps its solves (points are kept); admins can hide a challenge with `visible: false` instead.

## Contract changes (already in `docs/`)
`myInstance` and instance responses include `challengeId`; admin challenge responses include `hasFlag` and never the flag or hash; new error codes in use: `NO_TEAM`, `TEAM_BANNED`, `INSTANCE_LIMIT`, `ALREADY_RUNNING`, `NOT_DOCKER_CHALLENGE`, `NO_FREE_PORT` (503), `RATE_LIMITED`.

## New dependency
`dockerode` (backend): the standard Node client for the Docker Engine API, required by `dockerService`.
