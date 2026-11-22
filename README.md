# CTF Arena

*Train on the Range. Compete in the Arena.*

A small Capture-The-Flag platform built for our Cloud Computing (CC) project.
Players log in with **MFA**, join a team, start a **Docker container per challenge**,
submit flags, and climb a **live leaderboard**. Everything runs in the cloud.

**Team (build order):** Swarup -> Gururaj -> Shubham

---

## The four cloud services (project requirement)

| # | Cloud service | Tool we use | Where it shows up on the website |
|---|---------------|-------------|----------------------------------|
| 1 | IAM + MFA | AWS Cognito (TOTP authenticator app) | Sign up, login, 6-digit code, `player` / `admin` roles |
| 2 | Database as a Service | MongoDB Atlas (free tier) | Teams, challenges, solves, submissions, leaderboard |
| 3 | Docker + scaling | Docker, Docker Compose, Nginx | One container per team per challenge, 3 backend replicas |
| 4 | Deployment | Vercel (free) + GitHub Actions CI | Public URL, auto-deploy from Git; Docker challenges run locally only |

## Who builds what

| Phase | Owner | Part of the website | Ends with tag |
|-------|-------|---------------------|---------------|
| 1 | **Swarup** | Foundation: repo, IAM + MFA login, teams, database, frontend shell | `v0.1-foundation` |
| 2 | **Gururaj** | Challenges, Docker engine, flag submission, scoring | `v0.2-engine` |
| 3 | **Shubham** | Leaderboard, admin dashboard, scaling, deployment, demo, report | `v1.0-release` |

## What is in the box

Two sides, one platform. The **Arena** is the competition: teams, the live leaderboard, an optional scheduled event with a
scoreboard freeze, and the admin dashboard. **The Range** is the practice side: six categories of simulated, browser-playable
flags that need no Docker, so they also work on the hosted site. Every flag is derived per team, so answers cannot be shared.

| Category | What you do | Flags | Points | Design doc |
|----------|-------------|-------|--------|-----------|
| Arena Terminal | Shell puzzles in a virtual Unix box, with a reactive story and in-world mail | 15 (3 modes) | 1690 | [`docs/TERMINAL_GAME.md`](docs/TERMINAL_GAME.md) |
| Cipher Lab | Break ciphers with a decoder toolbox and a chainable recipe workbench | 15 | 2060 | [`docs/CIPHER_LAB.md`](docs/CIPHER_LAB.md) |
| Web Exploit Lab | Attack simulated vulnerable sites with a request inspector | 10 | 1470 | [`docs/WEB_EXPLOIT_LAB.md`](docs/WEB_EXPLOIT_LAB.md) |
| Forensics Desk | Case files with logs, files, a packet viewer, a timeline board and suspect interviews | 20 | 2310 | [`docs/FORENSICS_DESK.md`](docs/FORENSICS_DESK.md) |
| Crackme Arcade | Reverse small programs for a made-up VM, with a time-travel debugger and the Patch Bay bonus | 16 | 1905 | [`docs/CRACKME_ARCADE.md`](docs/CRACKME_ARCADE.md) |
| OSINT Trail | Investigate a fictional town and company, pin evidence on a shared case board | 22 | 2300 | [`docs/OSINT_TRAIL.md`](docs/OSINT_TRAIL.md) |

Counts and points come from the level data in `backend/src` (one flag is one answer that earns points; states are Captured,
Open and Locked; wording rules in [`docs/VOCABULARY.md`](docs/VOCABULARY.md)). The Docker challenges at `/challenges` are separate and
run in local mode only. Around the flags:

- **Learning aids:** a free three-step hint ladder on every play screen ([`docs/HINTS.md`](docs/HINTS.md)), a first-run
  "Capture your first flag" checklist ([`docs/ONBOARDING.md`](docs/ONBOARDING.md)), a Skills map ([`docs/SKILLS_MAP.md`](docs/SKILLS_MAP.md))
  and a Debrief after each capture ([`docs/DEBRIEF.md`](docs/DEBRIEF.md)).
- **Competition:** event mode ([`docs/EVENT_MODE.md`](docs/EVENT_MODE.md)), badges, profile, activity feed and daily spotlight
  ([`docs/ACHIEVEMENTS.md`](docs/ACHIEVEMENTS.md)), fair-play signals and decoys ([`docs/FAIR_PLAY.md`](docs/FAIR_PLAY.md)).
- **Admin:** users, teams, challenges, solves, audit log, settings and CSV exports ("Admin API v2" in [`docs/API_SPEC.md`](docs/API_SPEC.md)).
- **Devices:** phones, tablets, laptops and large monitors ([`docs/DEVICE_COMPATIBILITY.md`](docs/DEVICE_COMPATIBILITY.md)).

## Status

All three phases are in the code base: login with MFA and teams, challenges with one Docker container per team,
flags and scoring, the live leaderboard, the admin dashboard, Nginx load balancing across backend replicas, a load
test, and hosting on Vercel (the Azure VM plan was dropped; see `docs/DEPLOY_VERCEL.md`). Phase 4 added the six Range
categories, event mode, hints, onboarding, skills, debrief, device support and a security review. What is still open
(see `docs/TASKS.md`, which separates owner-only actions): the live end-to-end check with two teams on two devices (P3-12),
demo data and script (P3-13), report and slides (P3-14), the first real Vercel deploy (P4-05) and the final tags.
The running log of the polish wave is `docs/PROGRESS.md`. Handoffs: `docs/handoffs/`.

## Hosting: Vercel (hosted) and local Docker mode

The public site runs on **Vercel**: the Vite frontend is static output and the Express app runs as one serverless
function under `/api` (`api/index.js`, `vercel.json`). Arena Terminal, static challenges, teams, leaderboard and admin
all work there. **Docker challenges cannot run on Vercel**, so with `DOCKER_ENABLED=false` (the Vercel default) they are
listed but their Start button is disabled (`503 DOCKER_DISABLED`). To play Docker challenges, run the full stack on a
laptop with the Quick start below. Step by step: [`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md).

## Quick start (whole stack on your machine, Docker challenges included)

```bash
cp .env.example .env                      # then fill in Atlas + Cognito values (docs/SETUP.md); never commit .env
cd backend && npm ci && npm run seed:challenges && cd ..          # register the starter challenges once
for d in challenges/*/; do s=$(basename "$d"); [ -f "$d/Dockerfile" ] && [ "${s#_}" = "$s" ] && docker build -t "ctf/$s" "$d"; done
cd frontend && npm ci && npm run build && cd ..                   # Nginx serves frontend/dist
docker compose up -d --build              # Nginx + 3 backend replicas on http://localhost
# No Atlas (laptop): docker compose -f docker-compose.yml -f docker-compose.localdb.yml up -d --build, then seed the
# local database (docs/SETUP.md section 6b: seed:challenges, seed:terminal, seed:cipherlab, seed:weblab, seed:forensics, seed:crackme, seed:osint;
# optional: seed:demo for demo teams and solves)
```

| Page | Who | What |
|------|-----|------|
| `/`, `/login`, `/signup`, `/confirm`, `/mfa-setup`, `/mfa`, `/forgot`, `/demo`, `/fair-play` | everyone | home, Cognito sign-up and sign-in with TOTP MFA, password reset, demo page, fair-play rules |
| `/challenges`, `/challenges/:id` | signed in | list by category, start/stop/extend an instance, submit a flag |
| `/range` | signed in | The Range: hub of the six categories below (`/games` redirects here). First-run "Capture your first flag" checklist, see `docs/ONBOARDING.md`. Every play screen shares one hint ladder (Nudge, Approach, Walkthrough-lite; free, see `docs/HINTS.md`) |
| `/skills` | everyone | Skills map: which skills each flag teaches (OWASP Top 10, MITRE ATT&CK, NICE categories, CTF areas), your team's coverage, printable summary. After a capture every level shows a collapsed Debrief (what, how it works, how defenders stop it, tools; write-ups open to all once the event has ended), see `docs/DEBRIEF.md` |
| `/terminal`, `/terminal/:mode` | signed in | Arena Terminal (shell puzzles, three modes) |
| `/cipherlab/*` | signed in | Cipher Lab (cryptography levels with a decoder toolbox) |
| `/weblab`, `/weblab/:slug` | signed in | Web Exploit Lab (practice web vulnerabilities) |
| `/forensics`, `/forensics/:track` | signed in | Forensics Desk (case files per track) |
| `/reversing`, `/reversing/:levelId` | signed in | Crackme Arcade (reverse a small VM) |
| `/osint`, `/osint/:track` | signed in | OSINT Trail (cases of questions) |
| `/leaderboard` | players and admins | standings, score-over-time chart, your team highlighted, refreshes every 10 s |
| `/team` | players | create or join a team, invite code, members, score |
| `/profile`, `/profile/:id` | signed in | badges, streak and recent solves |
| `/admin` | admins | sections: Overview, Users, Teams, Challenges (`/admin/challenges`), Submissions & solves, Fair play, Instances, Audit log, Settings, Exports |

The public `GET /api/announcement` (no token) returns the banner text and the platform flags (`registrationOpen`,
`submissionsFrozen`); admins set them under Settings. `GET /api/health` is also public.

Optional scheduled **event mode** (start, end, scoreboard freeze, countdown bar, 423 outside the window): see `docs/EVENT_MODE.md`. Public `GET /api/event` returns its phase and times. With no event configured nothing changes.

Roles: `admin` and `player` do not imply each other on role-specific routes (a player is redirected away from `/admin`
and gets 403 on `/api/admin/*`; admins have no team and cannot submit flags). The leaderboard, challenge list and
Range overviews accept both roles.

**Tests and lint.** `cd backend && npm test` (Vitest, no database needed), `cd frontend && npm test` (`node --test`) and
`npm run lint` in each folder (ESLint; CI runs lint and tests on pull requests). The backend tests need the variables of
`.env.example` to be set (a copy of it as `.env` is enough). All seed scripts are listed in `backend/package.json`
(`seed:challenges`, `seed:terminal`, `seed:cipherlab`, `seed:weblab`, `seed:forensics`, `seed:crackme`, `seed:osint`, `seed:demo`), and
`npm run db:indexes` builds the indexes on a database where `autoIndex` is off (Vercel).

**Environment variables.** Required (startup exits without them): `NODE_ENV`, `MONGODB_URI`, `COGNITO_REGION`,
`COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, the three `VITE_COGNITO_*` values and `FLAG_SECRET` (32+ characters, private
in production). `PORT`, `PUBLIC_HOST` and the Docker limits (`CHALLENGE_*`, `INSTANCE_TTL_MINUTES`,
`MAX_INSTANCES_PER_TEAM`) are required locally but get inert defaults on Vercel. Optional: `DOCKER_ENABLED`,
`MONGOOSE_AUTO_INDEX`, `DOCKER_GID`, `NGINX_HOST_PORT`, `API_PROXY_TARGET` (Vite dev proxy) and `ARENA_TERMINAL_DEBUG`
(rethrow internal terminal errors, development only). See `.env.example`.

## Docs index

Read the first group in order when you join; the rest are references per area. Everything lives in `docs/`, plus
[`AGENTS.md`](AGENTS.md) for AI coding agents (Codex CLI, Claude Code, etc.).

**Start here**

| File | What it is |
|------|-----------|
| [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md) | What we are building and why, scope and success criteria |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the pieces fit together |
| [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | How work is handed from one person to the next, file ownership |
| [`docs/TASKS.md`](docs/TASKS.md) | The task list per phase, with acceptance lines and status |
| [`docs/API_SPEC.md`](docs/API_SPEC.md) | The API contract, including Admin API v2 |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | The MongoDB collections, fields and indexes |

**Setup, deployment and security**

| File | What it is |
|------|-----------|
| [`docs/SETUP.md`](docs/SETUP.md) | Local setup, Atlas, Cognito |
| [`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md) | Hosting on Vercel, env vars, Cognito and Atlas settings, local Docker mode |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Rules that keep the platform safe, plus the production checklist |
| [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) | The API, access-control and infrastructure review with findings |
| [`docs/FAIR_PLAY.md`](docs/FAIR_PLAY.md) | Scraping, AI agents and shared solutions: signals, decoys, admin review |
| [`docs/CHALLENGES.md`](docs/CHALLENGES.md) | The starter challenges and the container template |
| [`docs/DEMO_AND_REPORT.md`](docs/DEMO_AND_REPORT.md) | Demo script and report outline |

**The Range (design and contract per category)**

| File | What it is |
|------|-----------|
| [`docs/TERMINAL_GAME.md`](docs/TERMINAL_GAME.md) | Arena Terminal: virtual shell, modes, codes, story and mail |
| [`docs/CIPHER_LAB.md`](docs/CIPHER_LAB.md) | Cipher Lab: tracks, levels, toolbox and workbench |
| [`docs/WEB_EXPLOIT_LAB.md`](docs/WEB_EXPLOIT_LAB.md) | Web Exploit Lab: simulated sites, labs and bounties |
| [`docs/FORENSICS_DESK.md`](docs/FORENSICS_DESK.md) | Forensics Desk: cases, artefacts, packet tools, timeline and interviews |
| [`docs/CRACKME_ARCADE.md`](docs/CRACKME_ARCADE.md) | Crackme Arcade: the VM, cabinets, debugger and Patch Bay |
| [`docs/OSINT_TRAIL.md`](docs/OSINT_TRAIL.md) | OSINT Trail: the generated world, cases and the evidence board |

**Product features and wording**

| File | What it is |
|------|-----------|
| [`docs/EVENT_MODE.md`](docs/EVENT_MODE.md) | The optional scheduled event: phases, freeze, countdown |
| [`docs/ACHIEVEMENTS.md`](docs/ACHIEVEMENTS.md) | Badges, profile, activity feed and daily spotlight (cosmetic) |
| [`docs/HINTS.md`](docs/HINTS.md) | The shared hint ladder |
| [`docs/ONBOARDING.md`](docs/ONBOARDING.md) | The first-run checklist and welcome cards |
| [`docs/SKILLS_MAP.md`](docs/SKILLS_MAP.md) | The `/skills` page and its framework mappings |
| [`docs/DEBRIEF.md`](docs/DEBRIEF.md) | The after-capture explanation of what a level taught |
| [`docs/DEVICE_COMPATIBILITY.md`](docs/DEVICE_COMPATIBILITY.md) | Device and display-size support and known limits |
| [`docs/VOCABULARY.md`](docs/VOCABULARY.md) | The words and voice used in the UI and docs |

**Project history and research**

| File | What it is |
|------|-----------|
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Running log of the Phase 4 polish wave, decisions and owner actions |
| [`docs/WORKQUEUE.md`](docs/WORKQUEUE.md) | The task board of the polish wave |
| [`docs/CTF_DESIGN_RESEARCH.md`](docs/CTF_DESIGN_RESEARCH.md) | Research note behind the design and naming decisions |
| [`docs/handoffs/`](docs/handoffs/README.md) | Phase handoff notes and the Phase 1 docs audit |
| `docs/harness/` | Scripts for the headless-browser device and colour checks (not documentation) |

## Backend foundation (P1-01 through P1-04)

Use Node.js 20 or later. From the repository root:

```bash
cp .env.example .env
cd backend
npm ci
npm run dev
```

On PowerShell use `Copy-Item .env.example .env` instead of `cp`.
The backend loads the root `.env` and then `backend/.env`, regardless of the
working directory. Existing process variables take precedence; root `.env`
wins over `backend/.env`, which fills missing values. Every variable in
`.env.example` is required. Keep real credentials private.
Set `MONGODB_URI` in the root `.env` to your Atlas URI (see `docs/SETUP.md`)
or a running local MongoDB. Both `mongodb://` (including multi-host URIs)
and `mongodb+srv://` are accepted. Startup connects before listening, logs
`MongoDB connected`, and exits with code 1 and a generic error if connection
fails. Driver errors, URIs, and passwords are never logged. Initial server
selection times out after 10 seconds.
Replace Cognito placeholders before using protected routes and the flag secret
before challenge features are implemented. Health does not contact Cognito.

Visit `http://localhost:4000/api/health` for
`{ "status": "ok", "db": "up", "replica": "<hostname>", "indexes": "ok" }` (`indexes` is `ok` or `missing`, and absent when it cannot be checked; `missing` means run `npm run db:indexes`).
The response stays HTTP 200; `db` becomes `down` whenever Mongoose is not connected.
Run `npm test` in `backend/` for API, startup, database, and environment tests
(no real database or real credentials needed; the placeholder values of `.env.example`
in a root `.env` or in the environment are enough, which is how CI runs them), or
`npm start` to run without nodemon. Removing `MONGODB_URI` from the environment
and both `.env` files makes startup exit with code 1 and an error naming the variable.

Nginx serves the built frontend (`frontend/dist`, SPA fallback) and load-balances the API
across the backend replicas.

## Demo seed data (P1-14)

With the root `.env` configured, run from `backend/`:

```bash
npm run seed
npm run seed -- --reset
```

The first command creates two demo players and two linked teams, Demo Alpha
and Demo Beta, with invite codes `SEEDAA` and `SEEDBB`. Repeating it preserves
existing fixtures and creates only missing ones. `--reset` removes only these
exact fixtures; run the first command again to recreate them. A collision,
modified fixture, or another account referencing a fixture makes either command
refuse without changing documents. Writes and removal use a single transaction,
so Atlas or a MongoDB replica set is required. Standalone MongoDB is unsupported.

These are database fixtures with synthetic Cognito subjects and `.invalid`
emails, not login accounts. The script creates no Cognito users, passwords,
admin roles, challenges, flags, scores, or containers. Real accounts still use
the normal Cognito signup and required MFA flow. Gururaj adds challenge seed
data in Phase 2.

Production runs refuse unless explicitly passed `--force` (including resets).
Success prints document counts and exits 0; failures exit 1 without database
credentials or driver details. No new environment variables or dependencies
are needed. Run `npm test` in `backend/` for fixture, collision, transaction
rollback, command guard, and Mongoose validation coverage without a live database.

## Authentication middleware (P1-07 and P1-09)

`src/config/cognito.js` exposes `getCognitoVerifier()`, configured for ID tokens
from `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`. On protected routes, use
`auth` from `src/middleware/auth.js`, followed by `requireRole('admin')` where
needed. Authentication is not installed globally; `/api/health` stays public.
Successful verification attaches `{ cognitoSub, email, role }` to `req.user`.
The role comes only from verified Cognito groups. Tokens and verifier errors
are never logged or returned.

Run `npm test` in `backend/`. Auth tests use a test-only router and injected
mock verifiers; configuration tests mock environment settings and AWS verifier
creation, so no real `.env`, credentials, or AWS requests are needed. Production
routes for teams are implemented with transactions. P1-08 provides GET/PATCH
`/api/me`, with user persistence and display-name validation.

Dependency reasons: Express handles HTTP; Helmet adds security headers;
Zod validates configuration and future requests; dotenv loads local settings;
Mongoose and aws-jwt-verify are the requested foundations for later database
and Cognito work. Vitest runs tests, Supertest exercises HTTP, and nodemon
restarts the development server.

## Docker backend and Nginx (P1-05)

Start Docker Desktop with Linux containers. From the repository root, copy
`.env.example` to `.env` if you have not configured it yet. Keep `PORT=4000`
for the internal proxy. Compose injects the root `.env` at runtime through
`env_file`; no environment file is copied into the backend image.

```bash
cd frontend
npm ci
npm run build
cd ..
docker compose up --build   # starts nginx + 3 backend replicas
```

Build the frontend before Compose: Nginx mounts `frontend/dist`. For hot reload,
start `npm run dev` in `backend/` and, in a second terminal, `npm run dev` in
`frontend/`. Open Vite's printed URL; it proxies `/api` to port 4000. Rebuild or
restart Vite after changing public Cognito settings in the root `.env`.

See [the Phase 1 handoff](docs/handoffs/HANDOFF_1_swarup_to_gururaj.md) for
remaining checks and [the audit](docs/handoffs/P1_DOCS_AUDIT.md) for mismatches.

Open http://localhost for the web app, or
http://localhost/api/health for the backend health response and `X-Served-By`
header. Repeated requests should show different replica names:

```powershell
1..10 | ForEach-Object { (Invoke-WebRequest http://localhost/api/health).Headers['X-Served-By'] }
```

The backend image uses Node.js 20 Alpine, installs production dependencies
only, and runs as the non-root `node` user. The built frontend is mounted
into Nginx. Stop the stack with `docker compose down`.

## Scaling, load test and deployment (Phase 3)

Scale the backend without any code change (Nginx re-resolves the `backend` service every 10 seconds):

```bash
docker compose up -d --scale backend=5
```

Set `NGINX_HOST_PORT` (for example in `.env`) if host port 80 is taken, and on a Linux host `DOCKER_GID` (the group id
of `/var/run/docker.sock`; both are explained at the end of `.env.example`). Replica names in the footer and on the
admin dashboard are container ids. A free load test with results at
1, 3 and 5 replicas is in [`deploy/loadtest/`](deploy/loadtest/README.md).

Hosting is on Vercel ([`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md)); Vercel builds from Git on every push. Locally,
`bash deploy/deploy.sh` builds the frontend and challenge images and restarts the docker compose stack. GitHub Actions
(`.github/workflows/ci.yml`) runs the backend and frontend tests and the frontend build on pull requests. Before real
players arrive, go through the checklist in [`docs/SECURITY.md`](docs/SECURITY.md).
