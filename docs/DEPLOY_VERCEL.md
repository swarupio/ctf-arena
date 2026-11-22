# Deploy on Vercel (free)

The hosted site runs on Vercel: the Vite frontend is static output and the Express backend runs as one serverless
function under `/api`. Docker challenges cannot run there; they stay available in local mode (section 6).

```
repo root
├── vercel.json          build + rewrites + security headers
├── api/index.js         serverless entry: wraps backend/src/app.js (no listen())
├── backend/             Express app (also used by server.js locally and in Docker)
└── frontend/            Vite app -> frontend/dist (static output)
```

## 1. Import the project
1. Push the repo to GitHub. In Vercel: **Add New > Project > Import** the repository.
2. **Root Directory:** the repository root (leave it empty). **Framework Preset:** Other.
3. Build settings are read from `vercel.json`, so leave the overrides alone:
   - Install: `npm ci --prefix backend && npm ci --prefix frontend`
   - Build: `npm run build --prefix frontend`
   - Output directory: `frontend/dist`
   - Routing: `/api/*` goes to the function; any other path that is not under `/assets/` or `/fonts/` falls back to
     `index.html` (client-side routes such as `/range`, `/skills`, `/games`). A missing hashed asset is a real 404, so a
     stale tab can never cache an HTML page as JavaScript.
   - `api/package.json` only sets `"type": "module"` so the function's ES module syntax loads on Node.
4. Node.js version: 20.x or newer (Project Settings > General).
5. Add the environment variables (section 2) **before** the first deploy: `VITE_*` values are compiled into the frontend
   at build time, so changing them needs a redeploy.

## 2. Environment variables

Set these in Project Settings > Environment Variables (Production, and Preview if you use previews).

| Variable | Required | Value |
|----------|----------|-------|
| `MONGODB_URI` | yes | Atlas `mongodb+srv://...` string with database `ctf_arena` |
| `FLAG_SECRET` | yes | private random value, 32+ characters (`openssl rand -hex 32`); must not be the `.env.example` placeholder (`NODE_ENV` is `production` on Vercel). Changing it changes every team flag. |
| `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | yes | the backend token verifier |
| `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` | yes | same values; public, baked into the bundle at build time (`vite build` prints an `[auth] WARNING` if one is missing, so set them before the first deploy) |
| `DOCKER_ENABLED` | no | defaults to `false` on Vercel (`true`, `false`, `1` or `0` are accepted; anything else stops startup). Do not set it to `true` there (no Docker daemon exists). |
| `MONGOOSE_AUTO_INDEX` | no | `true`/`false`. Whether Mongoose builds indexes when a function starts. Defaults to `false` on Vercel (every cold start would re-check every index) and `true` locally. Run `npm run db:indexes` instead (section 5). |
| `PORT`, `PUBLIC_HOST`, `CHALLENGE_*`, `INSTANCE_TTL_MINUTES`, `MAX_INSTANCES_PER_TEAM` | no | only used by Docker mode; inert defaults apply on Vercel |

Never commit real values. If a variable is missing or invalid the API answers `503 SERVICE_UNAVAILABLE` and the
function log (Vercel > Deployment > Logs) lists the variable names that failed (never their values).

## 3. MongoDB Atlas network access
Vercel functions run from changing addresses, so Atlas Network Access must allow `0.0.0.0/0`. Trade-offs and how to
limit them:
- The database is then reachable from anywhere; the only barrier is the credentials. Use a long random password and a
  dedicated DB user with read/write on `ctf_arena` only, and keep no other data in that cluster.
- Never reuse that user elsewhere, and rotate its password if it leaks.
- (Paid alternatives: Vercel Secure Compute / static IPs, or Atlas private endpoints.)
- Cold starts open a new connection (pool of 3 per warm instance); the free Atlas M0 limit is 500 connections, which is
  plenty for a class-sized event.

## 4. Cognito URLs
In the Cognito app client add the Vercel domain (for example `https://your-project.vercel.app`, plus your custom
domain if any) to **Allowed callback URLs** and **Allowed sign-out URLs**, next to `http://localhost:5173` for development.
Use exact URLs, no wildcards. Preview deployments get new domains; add them only if you need to sign in on previews.

## 5. First data and admin
Before the first admin signs in: the Cognito pool must have MFA set to **Optional** with **Authenticator apps** enabled (`docs/SETUP.md` section 4), and
the admin must have turned on an authenticator app (see `docs/SECURITY.md` section 1a). Optional backend variable `ADMIN_REQUIRE_MFA_CLAIM` (off by default) is
explained there; set it in the Vercel project settings only after you have confirmed that your tokens carry the `amr` claim.

Seed the database from your laptop against the same Atlas cluster (never from Vercel):
```bash
cd backend && MONGODB_URI='<atlas uri>' npm run db:indexes       # unique/TTL indexes (autoIndex is off on Vercel); repeat after schema changes
MONGODB_URI='<atlas uri>' npm run seed:terminal                  # Arena Terminal challenges
MONGODB_URI='<atlas uri>' npm run seed:challenges                # static + docker challenge entries
for s in cipherlab weblab forensics crackme osint; do MONGODB_URI='<atlas uri>' npm run seed:$s; done   # Range categories (idempotent: update in place)
```
Release steps in order, with a smoke test and rollback: `docs/RELEASE_CHECKLIST.md`.
Create an admin as in `docs/SETUP.md` section 7 (Cognito group `admin`).

**Index guard.** With autoIndex off, a database that never had `npm run db:indexes` run silently loses its unique
constraints (double solves, duplicate team names, a broken attempt limiter). The backend therefore checks, read-only,
that the critical unique indexes exist (`Solve(teamId,challengeId)`, `Team(name)`, `Team(inviteCode)`,
`User(cognitoSub)`, `AttemptCounter(key)`, `TaintedFlag(hash)`, `CheatSignal(subjectKey,kind,detail)` and the partial
`Instance(port)`):
- `GET /api/health` returns `"indexes": "ok"` or `"indexes": "missing"` (no names, so nothing leaks publicly). Point your
  uptime monitor at it and alert on `missing`. The field is absent while the database is down. The result is cached for
  5 minutes per function instance, so the check adds no query to normal routes; after you run `db:indexes` it flips
  to `ok` within that time.
- On the first connect of each function instance a non-test environment writes one line to the log starting with
  `[indexes] WARNING` that lists the missing indexes and says to run `npm run db:indexes`.
The guard only reads index lists; it never creates indexes.

**Fair-play signals on Vercel.** A serverless function can be frozen right after it responds, so the honeypot, canary
and decoy-flag signal writes are awaited (at most 1.5 s, failures ignored) before the response when `VERCEL` is set.
Locally they stay fire-and-forget.

## 6. Run Docker challenges locally
Docker challenges need a Docker daemon, so run the full stack on a laptop (Docker Desktop):
```bash
cp .env.example .env            # Atlas or local DB, Cognito, FLAG_SECRET
cd frontend && npm ci && npm run build && cd ..
docker compose up -d --build                # Nginx + 3 backend replicas on http://localhost
docker compose up -d --scale backend=5      # optional
```
`DOCKER_ENABLED` defaults to `true` outside Vercel. Build the challenge images first (`docker build -t ctf/<slug> challenges/<slug>`,
or `bash deploy/deploy.sh`). For local Cognito sign-in add `http://localhost` to the callback URLs.

## 7. Limitations on Vercel
- **Docker challenges are disabled.** Listings carry `dockerAvailable: false`, the Start button is disabled and
  `POST /api/challenges/:id/instance` returns `503 DOCKER_DISABLED`. Arena Terminal, static challenges, teams,
  leaderboard and admin are unaffected.
- **No background jobs.** The instance reaper is not started (nothing to reap without Docker).
- **Per-replica request counts are off.** `/api/admin/stats` still works; `requestsByReplica` is `{}` (the counter needs a
  long-lived process to flush). The `X-Served-By` header shows the function host name.
- **Function limits:** 15 s max duration per request (`vercel.json`), cold starts add a few hundred milliseconds,
  and the Hobby plan has usage quotas. No Nginx rate limiting: the backend's own limits (5 flag submits per minute per
  team and challenge, terminal limits) still apply because they are stored in MongoDB.
- **Hobby plan is non-commercial**; this class project fits, a paid event would need a Pro plan.
