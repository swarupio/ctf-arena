# Local load test (2026-11-22)

A bounded load test of the local full-stack mode: Nginx plus 3 stateless backend replicas plus MongoDB, all in Docker on
one developer laptop. It extends the P3-07 table in `deploy/loadtest/README.md` (which only measured `/api/health` at 1,
3 and 5 replicas) with a concurrency ramp, the other cheap public endpoints, the Nginx rate limiter, killing a replica
mid-test, cold start, and "Nginx on versus off".

Note: sections 1 to 8 describe the configuration that was measured (20 r/s, burst 60, `proxy_connect_timeout 5s`, no micro-cache). The current values (30 r/s, burst 100, 1 s connect timeout, 2 s micro-cache) are in section 9.

**Read section 6 first: this test has no real sign-in, a noisy machine and a local network. The numbers are indicative
and the extrapolations are estimates.**

## 1. Headline

| Question | Result (medians of 2 runs unless stated) |
|---|---|
| Capacity of the stack, load generator inside the Docker network, 100 connections, `GET /api/health` | **2,605 req/s through Nginx**, p50 29 ms, p95 100 ms, p99 125 ms, 0 failures |
| Same, without Nginx (generator talks to the 3 replicas directly) | **5,008 req/s**, p50 17 ms, p95 43 ms, p99 64 ms, 0 failures. Nginx costs about half the throughput on this path |
| Same load from the laptop host (Windows, through Docker Desktop port forwarding), 10 to 200 connections | 290 to 380 req/s, 0 failures. This is the limit of the host-to-container path, not of the stack (section 4.1) |
| Endpoint that reads MongoDB on every request (`GET /api/event`, frozen event), in-network, 100 connections | **932 req/s**, p50 89 ms, p95 272 ms, 0 failures |
| Balancing | `X-Served-By` split between the 3 replicas within 1 to 8 percent of each other in every run (section 4.2) |
| Kill one replica at about 1,000 req/s per replica | **0 failed requests**, but a **stall of about 5 s with 0 responses** and a worst latency of 10.0 s, then full service on the 2 survivors (section 4.5) |
| Cold start of one replica | 3.8 to 5.1 s from container start to the first successful `/api/health` (3 trials) |
| Rate limiter | Engaged as designed: about 377 of 28,026 requests allowed in 15 s from a non-exempt address (60 burst + 20 per second); the rest were 429, which are reported separately and are not failures |
| Bugs found in the backend | None: no crash, no 5xx, no leak, no replica-dependent behaviour |

## 2. Environment

| Item | Value |
|---|---|
| Machine | Intel Core i5-13420H (8 cores / 12 threads), 16 GB RAM, Windows 11 Home |
| Docker | Docker Desktop, engine 29.7.2 (Linux engine, 12 CPUs / about 7.6 GB visible to Docker) |
| Stack | the repo's `docker-compose.yml` + `docker-compose.localdb.yml`, copied (not edited) with 3 backend replicas, `nginx:1.27-alpine`, `mongo:7` one-node replica set. Backend image built from `backend/Dockerfile` and tagged `ctf-loadtest-backend` |
| Load generators | host: Node v24.14.0 + autocannon 8.0.0 (`deploy/loadtest/loadtest.mjs`). In-network: the same script in a `node:20-alpine` container on the compose network |
| Config differences from a normal local stack | `DOCKER_ENABLED=false` and no Docker socket mounted (so the reaper cannot touch real containers); empty `frontend/dist` (only `/api` is tested); dummy environment values (throwaway `FLAG_SECRET`, fake Cognito ids); Mongo published on 28017 and Nginx on 18080; the Mongo data volume is removed at the end. Everything else (Nginx config, memory limit 512 MB per replica, read-only filesystem, `cap_drop`, `no-new-privileges`) is the repo's |
| Database | a throwaway MongoDB container in the same compose project. Atlas was never used and no real `.env` was read |
| Concurrent noise | **High.** The same laptop was running other agents' tests, an unrelated 5-container stack, the owner's own `ctf-arena-*` stack (idle), VS Code, OneDrive and Docker Desktop. Whole-machine CPU was 45 to 85 percent busy before any load was applied. Treat run-to-run differences of 30 to 60 percent as noise (the two host runs of one phase differ by up to 1.7x) |

Total wall time was about 50 minutes (a little over the 40 minute target, mostly waiting for the ramp).

## 3. Method and exact commands

The tests are `GET` only, against public endpoints, so no login is needed (section 6 explains why).

```bash
# 0. Throwaway env file: dummy values for EVERY variable of .env.example (never copy the real .env).
#    NODE_ENV=production PORT=4000 MONGODB_URI=mongodb://mongo:27017/x?replicaSet=rs0 COGNITO_*=fake VITE_COGNITO_*=fake
#    PUBLIC_HOST=localhost FLAG_SECRET=<random, 32+ chars> CHALLENGE_*=values from .env.example DOCKER_ENABLED=false
# 1. Copy docker-compose.yml and docker-compose.localdb.yml to a scratch folder and change only:
#    build context -> absolute path of ./backend, image: ctf-loadtest-backend:latest, env_file -> the throwaway file,
#    nginx.conf bind mount -> absolute path, frontend/dist mount -> an empty folder, delete the docker.sock volume line,
#    Mongo port 127.0.0.1:28017, Mongo data volume renamed (so it cannot reuse ctf-mongo-data).
export NGINX_HOST_PORT=18080
docker compose -p ctf-loadtest -f compose.yml -f compose.localdb.yml up -d mongo      # wait until healthy
docker compose -p ctf-loadtest -f compose.yml -f compose.localdb.yml up -d --build    # 3 replicas + nginx

# 2. Tooling (outside the repo is fine; the repo folder only needs node_modules, which is git-ignored)
cd deploy/loadtest && npm ci

# 3. Host-side ramp and endpoint phases: 30 s measured, 3 s warm-up, 2 runs each, results to docs/loadtest-results/host-nginx/
BASE=http://localhost:18080 OUT=$PWD/../../docs/loadtest-results/host-nginx STATS_FILTER=ctf-loadtest ./run-suite.sh all

# 4. In-network generator: Nginx on versus off (replace $S by the folder that holds loadtest.mjs, package.json, node_modules)
docker run --rm --network ctf-loadtest_ctf-net -v "$S:/lt:ro" -w /lt node:20-alpine \
  node loadtest.mjs --url http://nginx/api/health --connections 100 --duration 30 --warmup 3 --no-probe     # via Nginx
docker run --rm --network ctf-loadtest_ctf-net -v "$S:/lt:ro" -w /lt node:20-alpine \
  node loadtest.mjs --url http://backend:4000/api/health --connections 100 --duration 30 --warmup 3 --no-probe   # no Nginx

# 5. Event freeze path: put a frozen event into the THROWAWAY database, then load GET /api/event
docker exec ctf-loadtest-mongo-1 mongosh --quiet --eval 'const n=Date.now(); db.getSiblingDB("ctf-arena").appsettings.updateOne({key:"platform"},{$set:{key:"platform",event:{name:"loadtest",startsAt:new Date(n-3600e3),freezeAt:new Date(n-600e3),endsAt:new Date(n+3600e3)}}},{upsert:true})'
#    ... same in-network command as step 4 with --url http://nginx/api/event

# 6. Kill a replica mid-test: 60 s run with a per-second timeline, then at about 20 s:
node loadtest.mjs --url http://nginx/api/health --connections 100 --duration 60 --no-probe --timeline kill-timeline.json   # (in the container)
docker kill ctf-loadtest-backend-2

# 7. Rate limiter: a second Nginx container using a COPY of nginx.conf with the three exempt lines removed from the geo block
#    (port 18081), then: node loadtest.mjs --url http://localhost:18081/api/health --connections 50 --duration 15 --warmup 0 --no-probe

# 8. Teardown (always)
docker rm -f ctf-loadtest-nginx-limited ctf-loadtest-cold ctf-loadtest-gen
docker compose -p ctf-loadtest -f compose.yml -f compose.localdb.yml down -v --remove-orphans
docker image rm ctf-loadtest-backend:latest
docker ps -a | grep ctf-loadtest     # must print nothing
```

Script changes (in `deploy/loadtest/`, portable between Git Bash and Linux): `loadtest.mjs` now reports the status-code mix,
**separates 429 from failures** (the old script counted a 429 as a non-2xx failure), records the `X-Served-By` of every
response during the measured run (not only the 40 probe requests), and has `--timeline` (one row per second) and
`--no-probe`. `run-suite.sh` is new (the ramp and endpoint phases). `README.md` is unchanged.

Definitions: p50/p95/p99 are the response times seen by the load generator. Error rate = (connection errors + non-2xx
other than 429) / attempts. Where a table says "median of 2 runs" it is the mean of the two (the median of two numbers);
both runs are in the raw files.

## 4. Results

Raw files are in `docs/loadtest-results/` (one JSON per run, console output, `docker stats` samples, per-second timelines).

### 4.1 Concurrency ramp, `GET /api/health`, from the laptop host through Nginx (3 replicas)

| Connections | Runs (req/s) | Median req/s | p50 ms | p95 ms | p99 ms | 2xx | 429 | Other non-2xx | Conn. errors |
|---|---|---|---|---|---|---|---|---|---|
| 10 | 292 / 294 | 293 | 20 | 107 | 155 | 17,944 | 0 | 0 | 1 |
| 50 | 272 / 356 | 314 | 145 | 324 | 452 | 19,461 | 0 | 0 | 0 |
| 100 | 342 / 412 | 377 | 240 | 495 | 734 | 23,226 | 0 | 0 | 0 |
| 200 | 286 / 410 | 348 | 496 | 956 | 4,102 | 21,758 | 0 | 0 | 0 |

Throughput is flat at about 300 to 400 req/s from 10 to 200 connections while latency grows in proportion to the
connection count (Little's law: 100 connections / 0.25 s per request = 400 req/s). That is a **saturated bottleneck
that is neither the replicas nor Nginx**: sampled during a 100-connection run the three replicas were at 10 to 50 percent
CPU each and Nginx at 15 to 30 percent (`docs/loadtest-results/during/stats-during-load.txt`). The in-network run
(4.3) pushes 7 times more requests through the same Nginx and replicas, so the limit here is the Windows host to Docker
Desktop path plus the load generator on a busy laptop. The older figure in `deploy/loadtest/README.md` (3,016 req/s at 3
replicas on the same laptop) was measured on a quieter machine; this run measured 8 times less through the same path, which
shows how much the noise matters. Use the in-network numbers (4.3) for the capacity of the stack and these only as the
"what a laptop test sees" figures.

p99 at 200 connections (4.1 s) is a tail from the saturated path (a few requests wait for several seconds), not a backend error: there were 0 failures.

### 4.2 Balancing and statelessness

`X-Served-By` counted on every response of the measured run (host ramp, 100 connections, run 2):
`79ef888fb4fc` 4,307, `575ac13c56dd` 4,251, `0f0dbd204f1f` 4,182, that is 33.8 / 33.4 / 32.8 percent. Every run without a
kill (16 host runs, 4 in-network, 2 frozen-event) shows three replicas within 8 percent of each other (round robin by Docker DNS). All
three replicas returned identical bodies and status codes for every endpoint, and the honeypot decoys (which keep state in
MongoDB: deduplicated signals and tainted flags) produced exactly 1 signal and 4 tainted flags in the database after
21,000+ hits spread across the 3 replicas, so deduplication works across replicas. No replica-dependent behaviour was seen.

### 4.3 Nginx on versus off (generator inside the Docker network, 100 connections, 30 s, 2 runs)

| Path | Runs (req/s) | Median req/s | p50 ms | p95 ms | p99 ms | Failures |
|---|---|---|---|---|---|---|
| Through Nginx (`http://nginx/api/health`) | 2,465 / 2,744 | 2,605 | 29 | 100 | 125 | 0 |
| Direct to the 3 replicas (`http://backend:4000/api/health`, Docker DNS round robin) | 5,009 / 5,007 | 5,008 | 17 | 43 | 64 | 0 |

Nginx roughly halves the throughput of this trivial endpoint and adds about 12 ms at p50. The cost is the design:
Nginx opens a new TCP connection to a replica for every request (`Connection: close`, no upstream keep-alive because the
replicas are discovered through DNS), and does an access-log line per request. For endpoints that really do work (4.4)
this overhead is a small share. What Nginx buys: the rate limit, TLS/static hosting, retry to another replica
(`proxy_next_upstream`) and a single front door. Both runs had 0 failures and no 502 (the `sysctls` fix described in
`deploy/loadtest/README.md` held).

### 4.4 Other cheap endpoints (host side, through Nginx, 30 s, 2 runs; expect the same host-path ceiling as 4.1)

| Endpoint | Connections | Runs (req/s) | Median req/s | p50 ms | p95 ms | p99 ms | Result mix |
|---|---|---|---|---|---|---|---|
| `GET /api/event` (no event configured) | 100 | 437 / 309 | 373 | 231 | 566 | 1,148 | 23,274 x 2xx |
| `GET /api/announcement` | 100 | 396 / 702 | 549 | 171 | 383 | 685 | 34,100 x 2xx |
| `GET /api/internal/config` (honeypot decoy, writes a deduplicated signal) | 50 | 274 / 415 | 344 | 129 | 320 | 530 | 21,114 x 2xx |
| `GET /api/leaderboard` with no token (the 401 path: no sign-in, rejected before the database) | 100 | 496 / 475 | 486 | 184 | 412 | 617 | 30,180 x 401, as designed (counted as "other non-2xx" by the script; they are the expected answer) |

All four are at or slightly above the health ceiling, so on the host path they are indistinguishable from each other.
The in-network run of `/api/event` below separates them.

**Event-mode freeze path** (`docs/EVENT_MODE.md`): with a schedule stored in the throwaway database so that the phase is
`frozen` (verified: `{"phase":"frozen", ... }`), `GET /api/event` in-network at 100 connections gave **870 and 995 req/s
(median 932)**, p50 89 ms, p95 272 ms, p99 323 ms, 0 failures, load split evenly over the 3 replicas.
Compared with `/api/health` through Nginx (2,605 req/s) this endpoint is about 2.8 times slower because it reads the
settings document from MongoDB on every request (by design: "derived on every request, no timers", so every replica
answers the same). `Cache-Control: public, max-age=3` is sent, but Nginx does not cache it, so every poll reaches MongoDB. The freeze logic
itself (phase maths) is pure and cheap; the cost is the database round trip. The frozen leaderboard (`/api/leaderboard`,
aggregation up to `freezeAt`) and every player route need a sign-in and were **not** measured (section 6).

### 4.5 Kill one replica mid-test

100 connections, 60 s, `GET /api/health` through Nginx from inside the network, per-second timeline in
`docs/loadtest-results/kill-replica/kill-timeline.json`. `docker kill ctf-loadtest-backend-2` was issued about 21 s after the
measured phase started (the `docker kill` call itself took about 4 s to return on this busy machine, and log polling adds
a few seconds of uncertainty to the exact second; the timeline shows the stall about 10 s after my recorded kill time, which I could not fully explain by that uncertainty, so read the durations, not the absolute seconds).

| Phase | What the per-second timeline shows |
|---|---|
| Before (seconds 0 to 30) | 2,700 to 3,400 req/s, all 3 replicas answering |
| Outage | second 31: 1,539 req/s (2 replicas only); **seconds 32 to 35: 0 responses**; second 36: 1,029 req/s |
| After (seconds 37 to 60) | 1,900 to 2,300 req/s on the 2 surviving replicas, no further errors |
| Failures | **0 non-2xx, 0 connection errors** in 145,068 requests |
| Worst latency | **10,050 ms** (p99 199 ms) |

What happened: requests that Nginx had sent to the dead replica's address waited for `proxy_connect_timeout 5s`; because
the killed container's network is gone, the connect does not fail fast (no reset), it times out. With 100 closed-loop
connections nearly all of them were stuck behind that timeout at once, hence **about 5 s with almost no responses**;
`proxy_next_upstream` then re-sent every one of those GET requests to a healthy replica (so clients saw a slow
success, not an error: the 10 s worst case is two 5 s connect attempts), and Nginx stopped using the dead address.
**Error window: 0 seconds of errors, about 5 s of stall.** Interpretation (not separately verified): this is the
`error timeout` case in `proxy_next_upstream`.

Recovery: `docker kill` is not undone by `restart: unless-stopped` in this Docker version: the container stayed
`Exited (137)` (restart count 0 after 45 s). An explicit `docker start` brought the replica back; it answered its first
request 3.8 to 5.1 s after container start and **Nginx used it again 8.8 s after `docker start`** (DNS cache `valid=10s`).
A first attempt, in which the replica was already dead before the measured phase began (my timing was wrong; its raw file was not kept), showed
steady state on 2 replicas: 2,035 req/s, 0 failures, so steady-state survival of one loss is clean. POST/PATCH are never retried by Nginx, so a flag
submission in flight to the killed replica would fail with 502/504 instead of being replayed (by design, not measured).

### 4.6 Rate limiter (429)

A second Nginx container with a copy of `nginx.conf` whose `geo` block has no exempt ranges (so the load generator looks
like a normal internet client; the repo file was not changed). `GET /api/health`, 50 connections, 15 s:

| Run | Requests/s | 2xx | 429 | Other non-2xx | Conn. errors |
|---|---|---|---|---|---|
| 1 | 1,248 | 356 | 19,128 | 0 | 0 |
| 2 | 1,476 | 333 | 23,578 | 0 | 0 |
| 3 (`rate-limit/limited-c50.console.txt`) | 1,679 | 377 | 27,649 | 0 | 0 |

The allowed count matches the configuration: `rate=20r/s burst=60 nodelay` admits 60 + 20 x 15 = 360 requests in 15 s. The
429 answer is, per the config, the JSON `{"error":{"code":"RATE_LIMITED",...}}` with `Retry-After: 1` (the body was not inspected in this run), produced by Nginx without touching a
backend (which is why the "throughput" of 429 answers is high). 429 is **protection working, not a failure**, so it is
excluded from the error rate. In the normal local setup every test above came from an exempt address (loopback or the
Docker bridge, `172.16.0.0/12`) and saw zero 429. A single human-speed client (100 sequential `curl` calls) saw 100 x 200.

### 4.7 Resources per container

Sampled with `docker stats --no-stream` (`docs/loadtest-results/during/`, `host-nginx/stats.txt`; the latter was sampled after each
run and mostly shows idle values, so use the "during" file). Host ramp at 100 connections, 3 samples during the run:

| Container | CPU during load | Memory (limit) | Notes |
|---|---|---|---|
| backend-1/2/3 | 9 to 52 percent of one core each | 46 to 47 MiB (512 MiB) at the end; 33 to 42 MiB idle at start | after roughly 200,000 requests in total, memory rose by about 5 to 14 MiB and then stayed flat; no sign of a leak in this short test; 12 processes/threads each |
| nginx | 15 to 31 percent | 16 to 17 MiB (128 MiB) | |
| mongo | 0.7 to 70 percent (spikes) | 147 MiB at the end (98 MiB at the start) | the high CPU readings are mostly the `mongosh` health check that `docker-compose.localdb.yml` runs every 5 s inside the container, not query load |

In-network phases were not sampled (a sampler would have competed with the 5,000 req/s generator).

**MongoDB connections** (`db.serverStatus().connections`): 13 to 14 current, 4 active, during the ramp and 18 at the end of one
sampled run, 99,850 available, 0 rejected. `totalCreated` rose from 303 to about 1,100 over the whole test (the driver
re-opens monitor and pool connections; each replica holds one to a few, `minPoolSize 1`, `maxPoolSize 10`). `/api/health`
barely uses the pool, so this number is **not** a measure of what a database-heavy load would hold: 3 replicas x 10 = 30
connections at most, against Atlas M0's 500 limit, is the planning figure.

### 4.8 Cold start of one replica

`docker run` of the same image on the compose network, then a poller container fetching `/api/health` every 20 ms from the
moment of start; start time is the container's `StartedAt`, first-success time is `Date.now()` in the poller (same VM clock).

| Trial | Start to first successful `/api/health` |
|---|---|
| 1 | 4.4 s |
| 2 | 3.8 s |
| 3 | 5.1 s |

This includes Node boot, loading the app, MongoDB connection and the 20 ms poller granularity, and (about 0.5 s) the poller
container's own start-up. It does not include Docker's healthcheck (`start_period 30s`, `interval 15s`), which makes
`docker compose up` wait up to about 30 s before Nginx starts.

## 5. What it means for a classroom event

All of this section is **estimation** from the numbers above, with the assumptions stated.

Assumptions: a player's browser makes about 1 API request per second at the busiest (a 10 s leaderboard poll, announcement and
event polls, plus clicks; the repo's own comment in `nginx.conf` assumes less than 1 per second). So 100 to 300 concurrent
players is about **100 to 300 requests per second at peak**, about 5 to 10 times that only for a short synchronized spike (everyone refreshing at the start).

- **Cheap and public paths (health, announcement, event):** measured capacity in-network is about 930 req/s for a path that
  reads MongoDB on every request and 2,600 req/s for a path that does not. 100 to 300 req/s is a **3 to 9 times margin** on
  this laptop with the noise described. A machine for a real event that is not busy with other work should do better.
- **Authenticated paths (leaderboard, challenges, submit flag):** **not measured.** Each request additionally verifies a JWT
  (local signature check with a cached key) and runs one or more MongoDB queries or aggregations. They will be slower than the
  930 req/s of `/api/event`; whether 300 req/s fits is **unknown** until it is tested with real tokens. `docs/QUERY_PERFORMANCE.md` and
  the query-count tests show the queries are indexed and bounded, which is the reason to expect it is fine, but that is not a load measurement.
- **One shared address (the real risk found):** Nginx admits 20 requests/second per client IP (burst 60). If a classroom
  of 30 or more players sits behind **one NAT address** and they all poll about once per second, the limiter will start answering
  429 for part of them. The 60-request burst only covers a spike, not sustained load. Estimate: the limit is reached at roughly
  20 to 25 players per public IP at 1 req/s each. Options in section 7. The limiter is not present on Vercel hosting.
- **Replica loss:** one replica dying costs a 5 s stall and no failed GETs; at 300 req/s all in-flight requests during
  that window would just be 5 s slow. Flag submissions (POST) in flight to the dying replica would fail and need a manual retry.
- **MongoDB** was a single local container. With Atlas M0 the network round trip (tens of ms from Docker on a laptop) is added to every
  database-backed request, so the 930 req/s figure would be lower; expect the DB round trip to dominate.

## 6. Limits of this test

- **No real sign-in.** The backend verifies real Cognito ID tokens with `aws-jwt-verify` and the repository ships no signing
  stand-in for the running server (the fake verifier in `backend/tests` is for unit tests only, and adding a bypass to
  production code was explicitly out of bounds). So authenticated routes were not loaded. The only authenticated-route
  measurement is the cheap 401 rejection of a request without a token. Challenges, teams, flag submission, leaderboard,
  hints, the terminal and the games were **not** load tested.
- **Noisy machine.** Other agents and apps shared the CPU; the host-path numbers vary by up to 1.7x between two runs.
  Only 2 runs per phase, 30 s each, and a single sample per phase for the kill test.
- **Load generator limits.** From the Windows host the Docker Desktop path capped the test at about 300 to 400 req/s (4.1),
  so host-side phases did not stress the stack. The in-network generator (4.3) did, but it competes with the stack for the same CPUs (a lower bound).
  The generator is closed-loop (a fixed number of connections), not a fixed request rate, so latency under overload is
  worse than an open system would show for the first seconds, and it hides the effect of a 20 r/s limiter on a real crowd.
- **Local network, one machine, one database container.** No TLS, no public-internet latency, no Atlas.
- **Docker challenges not tested.** `DOCKER_ENABLED=false`; starting challenge containers under load was out of scope.
- `docker stats` was sampled only at a few moments; connection counts were sampled only during `/api/health` load.
- The kill test used `docker kill`; a graceful `docker stop` (the backend drains in-flight requests on SIGTERM, see
  `docs/BACKEND_RESILIENCE.md`) or an out-of-memory kill would behave differently and was not measured.

## 7. Bottlenecks found and recommendations

No backend bug was found; these are findings and suggestions for the owners (nothing outside `deploy/loadtest/` and the docs was changed).

1. **Rate limit per IP for a classroom behind one NAT.** If one public address will hold more than about 20 players, raise
   `rate`/`burst` in `nginx/nginx.conf` for that event, or use the `set_real_ip_from` lines in the file when a TLS proxy
   is in front (otherwise all players look like one local address). Test with the limiter-copy method (step 7 of section 3). Owner: Release.
2. **A killed or crashed replica costs a 5 s stall.** `proxy_connect_timeout 5s` makes every request that picks the dead
   address wait 5 s, and two tries make the worst case 10 s. Lowering `proxy_connect_timeout` to 1 s (a local network connects in
   milliseconds), or adding passive health marking, would cut the stall to about 1 s. Untested suggestion. Owner: Release.
3. **Public polled endpoints read MongoDB on every request** (`/api/event` about 930 req/s versus `/api/health` 2,600). A 2 to 3 s Nginx
   `proxy_cache` for `/api/event` and `/api/announcement` (the responses already carry `max-age=3`) would remove most of that
   database load for the whole crowd with no stale data beyond the 3 s the API already allows. Untested. Owner: Release.
4. **Nginx halves throughput on trivial requests** (2,605 versus 5,008 req/s). Not a problem at classroom scale; only worth
   changing if the stack is ever pushed past 2,000 req/s.
5. **`restart: unless-stopped` did not restart a `docker kill`ed replica.** Real crashes (non-zero exit by the process) are restarted
   by Docker; a manual `kill` is treated as a stop here. Operators should `docker compose up -d` after killing a replica on purpose.
6. **Test the authenticated paths with real tokens before the event**, from a second computer, with about 100 to 300 simulated
   users and the player journey (list challenges, open one, submit a wrong flag, read the leaderboard). This is the main gap
   of this report, and it needs real Cognito test users (owner action).
7. **Mongo health check cost.** `docker-compose.localdb.yml` runs `mongosh` every 5 s, which shows as CPU spikes in the Mongo
   container; a longer interval after the first start would remove the noise. Cosmetic.
8. **Measure from inside the network or from a separate machine.** A Windows host test through Docker Desktop port
   forwarding measures the forwarding layer, not the stack. (The README of `deploy/loadtest/` was not changed; its P3-07 numbers were measured through the same host path.)

## 8. Files

| Path | What |
|---|---|
| `deploy/loadtest/loadtest.mjs` | updated tool (status mix, 429 separated, served-by during run, `--timeline`, `--no-probe`) |
| `deploy/loadtest/run-suite.sh` | new: ramp and endpoint phases |
| `docs/loadtest-results/host-nginx/` | host-side ramp and endpoint runs (JSON per run, console, `stats.txt`) |
| `docs/loadtest-results/in-network/` | Nginx on versus off |
| `docs/loadtest-results/event-frozen/` | `/api/event` under a frozen event |
| `docs/loadtest-results/kill-replica/` | replica kill: per-second timeline, container state, markers |
| `docs/loadtest-results/cold-start/cold-start.txt` | cold start trials and rediscovery time |
| `docs/loadtest-results/rate-limit/` | 429 runs |
| `docs/loadtest-results/during/` | `docker stats` and Mongo connection samples during load |
| `docs/loadtest-results/idle-docker-stats.txt` | idle container sample before the load |

## 9. After tuning (2026-11-22)

Changes made for recommendations 1, 2, 3 and 7 of section 7 (files: `nginx/nginx.conf`, `docker-compose.localdb.yml`; `docker-compose.yml` needed no change, `/var/cache/nginx` was already a tmpfs). Verified with `nginx -t` (`nginx:1.27-alpine`) and a throwaway stack (two fake replicas that echo method, URL, `Authorization` and `X-Served-By`, behind this exact `nginx.conf`). This is a functional check, not a repeat of the load test: the throughput numbers above were not re-measured.

| Item | Before | After | Evidence |
|---|---|---|---|
| Dead replica stall (`proxy_connect_timeout`) | 5 s per attempt, 10 s worst case | 1 s per attempt, `proxy_next_upstream_timeout 3s` | Replica disconnected from the network after Nginx had resolved it: the first request that hit it took 1.00 to 1.2 s and was answered by the healthy replica (log: `upstream timed out ... while connecting`, `upstream=dead, healthy`); the following requests took about 0.2 s (curl round trip) |
| POST retry | not retried once sent | unchanged: `non_idempotent` is not set | Finding: when the CONNECT fails, nothing was sent, so Nginx moves any method to the next replica (the test POST was answered by the healthy replica after 1 s). A POST already delivered to a replica that dies is not replayed. A flag submission therefore cannot be applied twice by Nginx |
| Micro-cache `GET /api/event`, `/api/announcement` | every poll read MongoDB | 2 s cache, `proxy_cache_lock on` | MISS, then HIT, HIT inside 2 s (backend counter stayed at 1); MISS again after 2.5 s. `?x=N` does not bypass it (the key ignores the query). `POST /api/event` and `/api/health` are never cached. `X-Served-By` still present. `Authorization` is not forwarded to these two routes |
| Rate limit | 20 r/s, burst 60 | 30 r/s, burst 100 (constants, no env variables) | Limiter copy with no exempt ranges, 50 connections, 15 s: 548 x 200 and 35,368 x 429. Expected 100 + 30 x 15 = 550. [CHECK: no result file for this post-tuning run is stored under `docs/loadtest-results/rate-limit/` (only the pre-tuning `limited-c50.*`)] |
| Mongo health check (localdb) | `mongosh` every 5 s | every 30 s after start; every 3 s during the first 60 s (`start_interval`) | Compose file still validates (`docker compose config`). Needs Docker Engine 25+ / Compose 2.20+ (older ones reject `start_interval`). CPU not re-measured |

Notes and risks:
- The cache is safe only because both routes are public and identical for everyone (`routes/event.js`, `routes/announcement.js`: no user data, no auth). If a per-user field is ever added to either, remove the cache location. Staleness is bounded by 2 s (an admin change to the event schedule, freeze or announcement is visible within 2 s plus the client poll). Expired entries are never served because the backend failed (only `updating`), and the submit guard reads the settings itself on the backend, so flag submission is not affected by the cache.
- The announcement response sends `Cache-Control: no-store` (global API rule); Nginx caches it anyway through `proxy_ignore_headers`, and the browser still receives `no-store`.
- Per address, 30 r/s admits roughly 30 players at 1 request per second each (section 5 estimated 20 to 25 at the old limit). A bigger single-NAT crowd still needs a manual edit of `rate=` and `burst=`. Other docs that quoted the old 20 r/s figure (`docs/SECURITY.md`, `docs/SECURITY_AUDIT.md`, `docs/BACKEND_RESILIENCE.md`) were aligned on 2026-11-22.
- The 1 s connect timeout is far above a local connect (milliseconds). If Nginx ever fronts replicas on a slow network, raise it.
