# Backend resilience

What the backend guarantees when things go wrong, how it starts and stops, and how to test it. It applies to both
hosting modes: Docker replicas behind Nginx (long-running `src/server.js`) and Vercel (`api/index.js`, one function
instance per burst of traffic, no `listen()`).

## 1. Guarantees

| Area | Guarantee | Where |
|---|---|---|
| Error shape | Every failure is `{ "error": { "code", "message" } }` with fixed text. No stack, driver message, query string or token ever reaches a response or a log line. | `middleware/errorHandler.js` |
| Malformed input | Invalid JSON is 400, a body above 100 KB is 413, unknown keys are 400 (strict zod), unknown routes and undocumented methods are 404 in the same shape. | `app.js`, route schemas |
| Escaped database errors | `CastError`, mongoose `ValidationError`, `ZodError` map to 400, duplicate key (E11000) to 409 `CONFLICT`, unreachable or overloaded database (network, server selection, `maxTimeMS`) to 503 `SERVICE_UNAVAILABLE`. Anything else is 500 `SERVER_ERROR`. | `errorHandler.js` |
| Sign-in outage | When Cognito's signing keys (JWKS) cannot be fetched the answer is 503, not 401, so a valid session is not thrown away. Every other token problem (expired, wrong audience, wrong `token_use`, malformed, bad signature) stays 401 with one fixed message. | `middleware/auth.js` |
| First-login race | Two parallel first requests of a new user both succeed: the unique `cognitoSub` index rejects one insert and the loser retries once as an update. | `routes/auth.js` (teams already did this) |
| Request id | Every response carries `X-Request-Id` (an inbound id is kept only if it is 8 to 64 characters of `A-Za-z0-9._-`). The one-line error log carries the same id: `[error] GET /api/x TypeError code=... id=...`. | `middleware/requestId.js` |
| Slow handlers | An `/api` request that has not answered after 25 s (12 s on Vercel, under `maxDuration` 15 s) gets 503 `REQUEST_TIMEOUT`. A late failure of the abandoned handler is logged as one line and never crashes the process. | `middleware/requestTimeout.js` |
| Slow queries | Every Mongo query and aggregation gets `maxTimeMS` (20 s, 10 s on Vercel) so the database stops work the HTTP layer has given up on. | `config/mongoLimits.js` |
| Slow clients | `requestTimeout` 35 s, `headersTimeout` 15 s, `keepAliveTimeout` 65 s. Nginx talks to replicas with `Connection: close` and 30 s proxy timeouts, so no idle-socket race exists; the values stay above Nginx's. | `server.js` |
| Replicas | No in-memory state that matters across replicas (rate limits, sessions, counters live in MongoDB). | AGENTS.md rule 4 |

## 2. Startup, shutdown and restart (Docker replicas)

Startup order in `server.js`:

1. `config/env.js` validates the environment (section 3). A bad variable prints its name and constraint, never its value, and exits 1.
2. Process-level handlers are installed (`lifecycle.js`).
3. MongoDB connects, **5 attempts with exponential backoff** (1 s, 2 s, 4 s, 8 s between attempts, each attempt bounded by the 10 s server-selection timeout). Progress lines never contain the driver error. After the last failure the process prints `MongoDB connection failed. Check MONGODB_URI, credentials, and network access.` and exits 1 (Docker restarts it).
4. The server starts listening. `EADDRINUSE` and `EACCES` print a plain explanation naming the port, then exit 1.
5. The reaper starts when Docker challenges are enabled. The index guard only warns (one loud line) when unique indexes are missing; it never blocks startup and never creates indexes (`npm run db:indexes` does).

Shutdown on `SIGTERM` or `SIGINT` (`docker stop`, deploys, Ctrl+C):

1. stop accepting connections, close idle keep-alive sockets, let in-flight requests finish (limit 10 s, then remaining connections are closed);
2. stop the reaper and the request-count flush timer, save the buffered request counts;
3. close MongoDB; exit 0. A second signal exits 1 at once.

Fatal errors (`uncaughtException`, `unhandledRejection`): one line `[fatal] <kind> <ErrorClass> code=...` (no message, no stack), the same drain with a 5 s limit, exit 1 so the orchestrator starts a fresh replica. Express 5 already forwards a rejected async route handler to the error handler, so a request failure is a 500 and not a process failure; only a promise nobody awaits reaches this path.

Health: `GET /api/health` is both liveness and a cheap readiness hint. It always answers 200 quickly (the index check is cached and capped at 1.5 s) and reports `db: "up"` or `"down"`; it never throws. The Docker healthcheck therefore marks a replica healthy while its database link is down. This is deliberate: restarting every replica because Atlas blipped would make an outage worse. Alert on `db: "down"` instead.

Vercel: `api/index.js` loads the app lazily, connects once per warm instance (single attempt, fails fast, retried by the next invocation) and answers 503 `SERVICE_UNAVAILABLE` when configuration or the database is unusable. There is no process lifecycle to manage.

## 3. Environment validation (`config/env.js`)

All of these are required unless a default is stated. Failure output is `<NAME>: <constraint>`, never the supplied value.

`NODE_ENV` (development, test or production), `PORT` (1 to 65535), `MONGODB_URI` (must start with `mongodb://` or `mongodb+srv://`), `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `PUBLIC_HOST`, `FLAG_SECRET` (at least 32 characters; in production the `.env.example` placeholder is refused), `CHALLENGE_PORT_MIN`, `CHALLENGE_PORT_MAX` (not below MIN), `INSTANCE_TTL_MINUTES`, `MAX_INSTANCES_PER_TEAM`, `CHALLENGE_MEMORY_MB`, `CHALLENGE_CPU_LIMIT`, `CHALLENGE_PIDS_LIMIT` (positive numbers).
Optional: `DOCKER_ENABLED` (default true, false on Vercel), `MONGOOSE_AUTO_INDEX` (default true locally, false on Vercel). On Vercel the container-only settings and `PORT` get inert defaults.

## 4. Reviewed and deliberately unchanged

- **Trust proxy:** not enabled, because nothing reads `req.ip`. The two places that need a client address (`integrityService.clientIp`, `adminAudit.addressOf`) use the last `X-Forwarded-For` entry. That is right behind our Nginx (it overwrites the header with `$remote_addr`) and on Vercel (the platform sets it to the client address). Do not expose a replica port directly to the internet, or the entry can be forged.
- **Rate limiting:** flag, join, terminal, game and Web Lab attempts are limited per user or team in MongoDB. Unauthenticated endpoints (health, announcement, event, honeypot decoys) have no application limit; Nginx limits 30 requests per second per IP (burst 100) in Docker mode, and Vercel's platform protections apply there. Adding a MongoDB write to every anonymous request was judged worse than the exposure.
- **CORS and cookies:** none. The frontend is same-origin (Nginx or Vercel rewrite), no CORS headers are sent, no cookies are set, the bearer token travels in `Authorization`. Helmet adds HSTS, CSP, `nosniff` and frame protection; API answers are `no-store`.
- **Method not allowed:** an undocumented method on a known path answers 404 in the standard shape, not 405. Changing it would alter the API for no security gain.
- **Content type:** only JSON bodies are parsed. Any other content type leaves the body empty and fails schema validation with 400.
- **Clock skew:** the verifier accepts no grace period on `exp` (a test pins this). Cognito ID tokens last an hour and the frontend refreshes them, so a client with a wrong clock sees a 401 and re-authenticates.
- **Mongoose `sanitizeFilter`:** not enabled; it would also rewrite the backend's own `$gt`/`$in` filters. Instead every id, string and query comes through zod or `objectId()` (static audit in `tests/security/injection.test.js`) and the route sweep below sends `{"$gt":""}` payloads everywhere.
- **Regular expressions:** admin search escapes user text before `new RegExp`; the terminal engine uses its own linear matcher; the remaining patterns on user input (`Bearer` header, slugs) are linear. No `fetch` or `fs` call takes user input (the only outbound request is the JWKS fetch inside `aws-jwt-verify`, to a fixed Cognito URL), so there is no SSRF or path traversal surface.
- **Transactions:** used only for team membership, which needs an Atlas replica set (documented in `docs/SETUP.md`).
- **Unbounded reads:** the admin overview reads all teams and all active instances, and the leaderboard aggregates all solves. These are admin-only or board-sized by design for an event of hundreds of teams; they now also run under `maxTimeMS`.

## 5. How to test

```bash
cd backend
npx vitest run tests/lifecycle.test.js tests/serverStartup.test.js tests/serverResilience.test.js \
  tests/requestPipeline.test.js tests/userUpsertRace.test.js tests/env.test.js --maxWorkers=2
npx vitest run tests/security/routeMatrix.test.js --maxWorkers=2   # includes the malformed-input sweep of every route
npx eslint src tests
```

| Test file | Proves |
|---|---|
| `tests/lifecycle.test.js` | drain order, drain limit, double signal, fatal handlers log class only and exit 1 |
| `tests/serverStartup.test.js`, `tests/server.test.js` | connect before listen, retry count, timeouts, `EADDRINUSE` message, exit codes |
| `tests/serverResilience.test.js` | backoff delays, no driver text in logs, single attempt by default |
| `tests/requestPipeline.test.js` | request id, request timeout, error mapping table, no stack in production, JWKS outage is 503 |
| `tests/userUpsertRace.test.js` | parallel first requests, duplicate retry, banned account stays 403 |
| `tests/security/routeMatrix.test.js` | every route in the matrix: broken JSON, operator bodies, hostile ids and queries stay below 500 with the standard shape; no stack or driver text in production; HSTS, CSP, no cookies, request id |
| `tests/env.test.js` | missing or malformed variables are named and never printed |
