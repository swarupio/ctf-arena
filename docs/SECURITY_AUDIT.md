# Security audit: API, access control, infrastructure

Scope: the whole backend API (Express 5, Mongoose, zod), the Cognito token handling, Nginx, Docker Compose, the challenge-container
network and the frontend production bundle. Driver: other CTFs were beaten by opening DevTools, listing the API endpoints and handing
them to an AI that exploited the unprotected ones. The goal here is that **knowing every endpoint gives an attacker nothing**:
every route is behind a verified token and an exact role, every object is scoped to the caller's team, no response carries a secret,
and every input is validated before it reaches the database.

Method: read every route, middleware and service; drive the real Express app with an in-memory database that really evaluates
filters, updates and unique indexes (`backend/tests/security/helpers/fakeDb.js`); mutation-test the fixes (revert a fix, watch the
matching test fail); review Nginx, Compose, Docker, `.env` handling, git history and the built frontend bundle.
Terminal engine, honeypot and integrity code (written by other people at the same time) were reviewed read-only and not edited.

## 1. Summary

| Severity | Total | Fixed | Open |
|----------|-------|-------|------|
| High     | 3     | 1     | 2 (SEC-01, SEC-02: owner actions, cannot be fixed in code) |
| Medium   | 4     | 2     | 2 (SEC-11, SEC-12: infrastructure hardening) |
| Low      | 9     | 5     | 4 (SEC-13 to SEC-16) |
| Info     | 5     | -     | 5 (accepted or by design) |

Tests: 7 files and 367 tests in `backend/tests/security/` (route matrix, data exposure, IDOR, injection, token handling, join limit,
env guard); the whole backend suite is green (50 files, 1446 passed, 1 skipped).

## 2. Findings

Status: **fixed** (in this change, with tests) or **open** (needs an owner decision or lives in a file owned by someone else).

| ID | Sev | Area | Status | Where | How verified |
|----|-----|------|--------|-------|--------------|
| SEC-01 | High | Repository | open | The GitHub repository is **public** (`gh repo view`: PUBLIC). It contains the static flags (`challenges/sanity-check`, `challenges/caesar-says`: `challenge.json` and README solution notes), the source and solution notes of every Docker challenge, and the full terminal game (`backend/src/terminal`), which spells out where each code hides. Per-team flags (Docker, terminal) are HMACs and are **not** in the repo, but anyone can solve the static challenges and play the terminal quickly from the source. | `gh repo view --json visibility`; `grep CTF{`. |
| SEC-02 | High | Transport | open | The stack serves plain HTTP unless the optional Caddy step in `docs/SECURITY.md` is done. Cognito ID tokens (sent as `Authorization` on every call), invite codes and the flags the terminal prints cross the network unencrypted; on shared Wi-Fi anyone can lift a token (valid up to 60 minutes) and act as that player. | `nginx/nginx.conf` listens on 80 only; `docker-compose.yml` publishes only that. |
| SEC-03 | High | Secrets | fixed (guard) | Every team flag is `HMAC(FLAG_SECRET, teamId:challengeId)`; `teamId` is public on the leaderboard and `challengeId` on `/api/challenges`. The local `.env` uses the **public placeholder** from `.env.example` (checked by comparing, value never printed). On a server with that value anyone could compute every team's flags. `env.js` now refuses to start with `NODE_ENV=production` and a placeholder-looking secret (error names the variable only). The VM value itself must still be verified by the owner. | `tests/security/envGuard.test.js` |
| SEC-04 | Med | Brute force | fixed | `POST /api/teams/join` had no attempt counter (6 characters, 32^6 = 1.07e9 codes, Nginx 20 r/s per IP only). Now 10 attempts per 15 minutes per account, counted atomically in MongoDB (`services/attemptLimiter.js`, collection `attemptcounters`, TTL), every attempt counts, other accounts are unaffected, parallel bursts cannot exceed it. One account needs about 5 years of nonstop guessing for even odds against 200 live teams. | `tests/security/joinLimit.test.js` (13 tests incl. window reset and 40-way burst) |
| SEC-05 | Low | Rate limits | fixed | Count-then-insert races let a parallel burst pass a limit together. **Fixed:** flag submit (`routes/challenges.js` recounts after its own insert, so at most 5 attempts per minute get an answer) and instance start (`services/instanceService.js` recounts after its port claim, so a team never exceeds `MAX_INSTANCES_PER_TEAM`). **Also fixed:** terminal submit (`services/terminalService.js` recounts after its own insert, so a 25-request burst gets at most 10 answers). | Mutation-tested: `tests/security/accessControl.test.js` (burst tests fail without the fixes; the terminal burst test covers the terminal route too). |
| SEC-06 | Med | Ban | fixed | A banned team could leave (the last member deletes the team) and create a fresh, unbanned team. `POST /teams/me/leave` is now 403 `TEAM_BANNED` for a banned team. Residual: a new Cognito account (new e-mail plus MFA device) still starts clean; ban the e-mail in Cognito for that. | `accessControl.test.js` "keeps a banned team banned" |
| SEC-07 | Low | Stored XSS | fixed | Admin-entered attachment `url` was any string (`javascript:`, `data:`, `//host`). Rendered as `<a href>`; React 19 blocks `javascript:` itself, but the API is the contract. Now only `/path` or `http(s)://` without spaces or control characters. | `injection.test.js` "admin challenge input" |
| SEC-08 | Low | Caching | fixed | API answers had no `Cache-Control`. All `/api` responses now send `no-store` (invite codes and terminal flags must not sit in a browser or proxy cache). | `routeMatrix.test.js` "transport headers" |
| SEC-09 | Low | Errors / logging | fixed | Body-parser client errors (unsupported charset or encoding) came back as 500, and no 500 was ever logged, so attacks and bugs were invisible. Now 4xx `VALIDATION_ERROR` with a fixed message; unexpected errors write one line `[error] METHOD path ErrorName code=...` to stderr (never the message, stack, query string or connection string). | `injection.test.js`, `dataExposure.test.js` "failures do not leak internals" |
| SEC-10 | Low | Frontend build | fixed | `build.sourcemap` relied on Vite's default. Now explicit `false` in `frontend/vite.config.js`. The built bundle has no `.map` and no `sourceMappingURL` (scanned). The build itself could not be run here (the frontend `node_modules` has no local Vite); the change is one valid option. | scan of `frontend/dist` (section 5) |
| SEC-11 | Med | Challenge network | open | All challenge containers share one bridge (`ctf-challenges`) with container-to-container traffic and unrestricted outbound. A player who gets code execution in their own container can reach other teams' containers, the Azure metadata service (169.254.169.254), the VM's gateway address (and so every host service such as sshd) and the internet. They **cannot** reach the backend, Nginx or Docker API: those live on the separate `ctf-net` network and published ports exist only for Nginx and the 30000-30100 range. Recommendation: `DOCKER-USER` iptables rules for the challenge subnet (drop 169.254.169.254, drop RFC1918 and the host, allow DNS and replies), and create the network with `com.docker.network.bridge.enable_icc=false` (needs removing the existing network once). | Reading `dockerService.js`, `docker-compose.yml`; not testable without Docker. |
| SEC-12 | Med | Docker socket | open (accepted risk) | The backend mounts `/var/run/docker.sock`; a backend compromise is host root. Already reduced: non-root user, read-only filesystem, `cap_drop ALL`, `no-new-privileges`, images limited to `ctf/`, no user-supplied command, volume or env. For the event use the documented `docker-socket-proxy`. | `docs/SECURITY.md` section 2 |
| SEC-13 | Low | Token lifecycle | open | A Cognito ID token cannot be revoked server-side: a disabled or deleted Cognito user keeps API access until the token expires (default 60 minutes). Set the app client's ID-token validity to 15-30 minutes. `email_verified` is not checked: confirm the pool auto-verifies e-mail and does not allow unverified sign-in. `aws-jwt-verify` accepts a validly signed token with no `exp` (only matters if the signing key leaked). Clock grace is 0 s: keep NTP running on the VM. | `tests/security/authHardening.test.js` (real library, local key) |
| SEC-14 | Low | Browser | open | CSP `connect-src` allows `https://*.amazonaws.com` (needed: only `cognito-idp.<region>.amazonaws.com`); tighten once the region is final. Amplify keeps tokens in `localStorage` (readable by any script that runs in the page; mitigated by `script-src 'self'`, text-only rendering of all API data and no `dangerouslySetInnerHTML`). HSTS only after HTTPS (SEC-02). | `nginx/nginx.conf`, `grep dangerouslySetInnerHTML` |
| SEC-15 | Low | Rate limit | open | Nginx exempts `127.0.0.0/8`, `::1` and `172.16.0.0/12` from `limit_req` (for load tests). Anything that reaches Nginx through Docker's userland proxy (IPv6 on a host with IPv6, or hairpin traffic) looks local and is not limited. Azure VMs are IPv4-only by default. Check `docker compose logs nginx` shows real client addresses; enable the `real_ip` lines when Caddy is added (documented). | `nginx/nginx.conf` |
| SEC-16 | Low | Build | open | `deploy/deploy.sh` builds the frontend in a container with the whole repository mounted, so `npm ci` install scripts of any dependency can read `.env` (FLAG_SECRET, MONGODB_URI). Mount only `frontend/` and pass the `VITE_*` values with `--env-file` filtered to that prefix (Vite reads them from the process environment). | `deploy/deploy.sh` |
| SEC-17 | Info | Privacy | open | `displayName` defaults to the e-mail local part, visible to teammates (`/teams/me`) and admins. Consider `player-xxxxxx`. | `routes/auth.js` |
| SEC-18 | Info | Disclosure | accepted | `X-Served-By` and `/api/health` show the container hostname and DB state (feature of the load-balancing demo). | docs |
| SEC-19 | Info | Honeypot / integrity | accepted | Decoys are public by design and were checked: no real secret, flag, team, e-mail, invite code or hash in any answer; all values are HMAC-derived fakes. Decoy paths ship in the public repo (SEC-01); rotate them before the event. Integrity bookkeeping is fail-open and inactive without a DB connection (by design). Unauthenticated hits write bounded rows (TTL indexes on all three collections). | `dataExposure.test.js` "public honeypot decoys" |
| SEC-20 | Info | Terminal CPU | accepted | The shell engine runs on the event loop; measured worst case of ten adversarial command lines per mode was about 80 ms (work budget `MAX_WORK`, regex limits, no `fs`/`net`/`child_process` imports). Per-user pacing (300 ms gap, 50 per minute, players only, DB-backed, fail-open) bounds abuse. `complete` costs about 0.03 ms. | `scratchpad/benchTerminal.mjs` (not committed) |
| SEC-21 | Info | Terminal debug flag | accepted | `ARENA_TERMINAL_DEBUG` makes the engine rethrow; it cannot be set remotely. Do not put it in the VM `.env`. | `terminal/shell.js` |

## 3. What was changed (files)

Source: `backend/src/app.js` (no-store), `middleware/errorHandler.js` (4xx mapping, safe log line), `config/env.js` (production
placeholder guard), `routes/teams.js` (join limiter, banned team cannot leave), `routes/challenges.js` (recount after insert),
`services/instanceService.js` (recount after claim), `routes/admin/challenges.js` (attachment URL rule),
new `models/AttemptCounter.js` and `services/attemptLimiter.js`, `frontend/vite.config.js` (sourcemap false).
Existing tests touched only to register the new model or service: `tests/app.test.js`, `tests/teams.test.js` (one `vi.mock` line each).
Docs: `API_SPEC.md` (429 on join, 403 on leave of a banned team, attachment rule, `no-store`, error logging, and the stale statements that
admins get 403 on `GET /challenges` and `/leaderboard`, which the code has allowed since the "admins can browse" change),
`DATABASE_SCHEMA.md` (`attemptcounters`), `SECURITY.md` (new protections, link here).

## 4. Verified as sound (no change needed)

- **Every route is guarded.** `tests/security/routeMatrix.test.js` walks the real router stack and compares it with a table of
  32 documented routes plus the 20 honeypot decoy routes (5 paths x 4 methods): a new route that is not in the table fails the suite. Public routes are exactly
  `GET /api/health` and the honeypot decoys. For all protected routes: no token, garbage, expired or wrong-audience tokens, malformed
  headers (`Basic`, `Bearer`, `Bearer a b`) and malformed claims all give 401; the wrong role gives 403 (players on admin routes, admins on
  player-only mutations such as submit and start instance, near-miss groups such as `Admin`, ` admin`, `administrators`); and no model call
  happens before the decision. Sub-routers also guard unmatched sub-paths.
- **Token verification** (`authHardening.test.js`, real `aws-jwt-verify`, production options, local signing key): access tokens, wrong
  client, wrong issuer, expired, not-yet-valid, alg `none`, HS256 key confusion, payload swapped after signing, foreign key, truncated and
  oversized tokens are all 401 with one fixed message. Role is an exact `admin` entry in `cognito:groups`; e-mail is information only, a
  differently cased address is a different person (identity is the Cognito `sub`).
- **No data exposure** (`dataExposure.test.js`): every GET, for six different callers, and the sensitive POSTs, are deep-scanned for
  forbidden keys (`flag`, `flagHash`, `flagSalt`, `secret`, `containerId`, `cognitoSub`, `__v`, `memberIds`, ...), the FLAG_SECRET, the
  Mongo URI, static flag text and hashes, other teams' invite codes and flags, other people's e-mails, stack frames and paths. Payload
  shapes of the main endpoints are pinned. Forced 500s return one generic body and the log has no message or stack.
- **No IDOR** (`accessControl.test.js`, two teams): teams, instances (list, extend, stop), flag judging, terminal progress, flags and
  solves are all scoped to the caller's team; other teams' objects are 404; mass assignment through any body is 400; admins cannot play;
  team-less, unknown-to-the-database and banned callers behave as documented.
- **Injection and parsing** (`injection.test.js`): 15 hostile value shapes (`$ne`, `$gt`, `$regex`, `$where`, `$in`, arrays, nested
  objects, numbers, null) on all 18 body fields, unknown and operator-looking keys, `__proto__` and `constructor` (Object.prototype stays
  clean), invalid JSON, bodies over 100 KB (413), other content types, bad charsets and encodings, 30 000-deep nesting, thousands of keys,
  20 malformed ids on 10 id routes, Express 5 query syntax (`?limit[$gt]=1` is only an unknown flat key; the answer equals the unfiltered
  list), `limit` edge values, method-override headers, admin image, port, points and slug rules. A static check requires `.strict()` on every
  `z.object` in `routes/` except the two documented query schemas (`leaderboard`, `admin/integrity`, whose unknown parameters are ignored by
  contract) and that route code reads `req.body`, `req.params` and `req.query` only through zod or `objectId()`.
- **No dangerous sinks:** the backend has no `child_process`, `eval`, outbound `fetch`, file serving or `$where`; the terminal engine is
  pure JavaScript over an in-memory filesystem.
- **Express hardening:** no `X-Powered-By`, Helmet headers, no CORS headers (also not for a foreign-origin preflight), JSON limit 100 KB,
  Nginx 128 KB, `server_tokens off`, 429 JSON, X-Forwarded-For overwritten at the edge.
- **Secrets handling:** `.env` is git-ignored (`.env`, `.env.*`, `!.env.example`), never present in history (`git log --all -- .env` is
  empty), no key or certificate files are tracked, the only credential-looking strings in history are fake test URIs, `.dockerignore`
  excludes `.env`, and the backend image copies only `package*.json` and `src`.
- **Compose exposure:** only Nginx publishes a port; the backend uses `expose`; MongoDB is Atlas; backend and Nginx are read-only with all
  capabilities dropped (Nginx re-adds four) and `no-new-privileges`; challenge containers get memory, CPU, pids limits, `CapDrop ALL`,
  `no-new-privileges`, read-only root, `ctf.*` labels, a TTL, run as non-root users and sit on a separate network.

## 5. Frontend bundle (`frontend/dist`, both the repo copy and the scratchpad build)

No source maps, no `sourceMappingURL`, no MongoDB URI, no AWS access key, no ARN, no private key, no `FLAG_SECRET`. Every server-only
value from `.env` (MONGODB_URI, FLAG_SECRET) is absent. Present, public by design: Cognito region `ap-southeast-2`, user pool id and the app client id (the `VITE_*` values; the client has no secret), the API route paths (all
protected, see section 4) and five fictional flags plus a `CTF{...}` placeholder used by the demo page (`CTF{demo_sanity_flag}`, `CTF{cookie_monster_9f3a1c7e2b40}`,
`CTF{robots_rule_5b2e90d4a6c1}`, `CTF{login_bypass_e7a30c915d28}`, `CTF{demo_guess}`, `CTF{...}`; none is accepted by the platform).

## 6. Rate-limit inventory

Nginx `limit_req` (20 r/s per IP, burst 60, exempt: loopback and Docker bridge) covers everything under `/api/`. Extra limits:

| Endpoint | Beyond Nginx | Recommendation |
|----------|--------------|----------------|
| `GET/PATCH /me` | nothing (one upsert per call) | fine; add `consumeAttempt('me:<sub>')` only if abuse shows |
| `POST /teams` | unique name and one team per user | optional `consumeAttempt('create:<sub>', 5 per hour)` |
| `POST /teams/join` | **10 per 15 min per account (MongoDB)** | done |
| `POST /challenges/:id/submit` | **5 per minute per team and challenge (MongoDB, rechecked after insert)** | done |
| `POST /challenges/:id/instance` | max instances per team, one per challenge, unique port claim (rechecked after claim) | add `consumeAttempt('start:<teamId>', 10 per minute)`: each start is a Docker create |
| `POST /instances/:id/extend`, `DELETE /instances/:id` | extend is once per instance (atomic) | fine |
| `GET /leaderboard`, `/timeline` | none (one aggregation per call, UI polls every 10 s) | fine for hundreds of teams; add a few seconds of caching beyond that |
| Terminal `exec` | pacing 300 ms gap and 50 per minute per player (DB-backed, fail-open) | terminal author: keep; `complete` is unpaced but cheap |
| Terminal `submit` | 10 per minute per team and mode (MongoDB), burst-safe (recount after insert, SEC-05) | none needed |
| Admin routes, honeypot decoys | none | trusted; decoys write bounded rows |

`attemptLimiter.consumeAttempt(key, { limit, windowMs })` is the reusable building block (atomic, replica-safe, TTL cleaned).

## 7. What an attacker or an AI agent can still do, and what it cannot

**Can**
- Read all frontend code and every endpoint path, and call them. Without a valid Cognito ID token every protected call is 401.
- Create a normal player account (if sign-up is open: e-mail verification and TOTP MFA are required) and play, including with an AI doing
  the clicking and typing. The terminal game cannot stop that; the fair-play layer (pacing, canary commands, tainted decoy flags,
  `docs/FAIR_PLAY.md`) only makes it visible to admins.
- Guess flags at 5 per minute per challenge and team (10 per minute per terminal mode), guess invite codes at 10 per 15 minutes per account.
- Run their own challenge containers (up to the team limit) and attack them, which is the game. From inside one they can currently
  reach other containers, the host and the metadata service until SEC-11 is closed.
- Sniff tokens and flags of anyone using the site over HTTP until SEC-02 is closed, and read puzzle solutions and static flags from the
  public repository until SEC-01 is closed.
- Burn CPU: Nginx lets one IP send 20 requests per second; a heavy terminal command costs about 80 ms on one replica.

**Cannot**
- Call any API route without a token, reach an admin route as a player (role comes only from the exact `admin` group in a signed ID token;
  forged, tampered, downgraded or confused tokens fail), or act as a player while being an admin.
- Read, change, stop or extend another team's team, instance, solves, progress or flags (404/403), or learn another team's invite code,
  members, e-mails or flag.
- Obtain a flag, a flag hash, a salt or the secret from any response, an error body, a log line or the frontend bundle.
- Inject NoSQL operators or pollute prototypes through bodies, queries or ids; send oversized or malformed bodies to anything but a 4xx.
- Reach the backend, MongoDB or the Docker API from outside (only Nginx is published) or from a challenge container (separate network).
- Run server-side code or fetch server-side URLs through the API (no such sinks exist).

## 8. Owner actions before the event

1. Make the repository private, or move static flags and solution notes out of it; rotate the static flags (SEC-01).
2. Turn on HTTPS with Caddy and then HSTS (SEC-02). Shorten the Cognito ID-token validity to 15-30 minutes (SEC-13).
3. Check the VM `.env`: `NODE_ENV=production`, `FLAG_SECRET` from `openssl rand -hex 32` (the backend now enforces the first half).
4. Add the DOCKER-USER rules and `enable_icc=false` for the challenge network (SEC-11); consider `docker-socket-proxy` (SEC-12).
6. Change the honeypot paths in `services/integrityBait.js` before the event (SEC-19).
7. After any new endpoint: add it to `TABLE` in `backend/tests/security/routeMatrix.test.js` (the suite fails until you do).

## 9. Re-running

```bash
cd backend && npx vitest run                       # everything
cd backend && npx vitest run tests/security        # the audit tests only (about 15 s)
```
`tests/security/helpers/fakeDb.js` is an in-memory model double: extend it (and add the model to the `vi.mock` list of the security test
files) when a route starts using a new Mongoose model or query operator; an unsupported operator throws on purpose.
