# Mini CTF Arena

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
| 4 | Deployment | Azure VM + GitHub Actions | Public URL, auto-deploy on push to `main` |

## Who builds what

| Phase | Owner | Part of the website | Ends with tag |
|-------|-------|---------------------|---------------|
| 1 | **Swarup** | Foundation: repo, IAM + MFA login, teams, database, frontend shell | `v0.1-foundation` |
| 2 | **Gururaj** | Challenges, Docker engine, flag submission, scoring | `v0.2-engine` |
| 3 | **Shubham** | Leaderboard, admin dashboard, scaling, deployment, demo, report | `v1.0-release` |

## Status

All three phases are in the code base: login with MFA and teams, challenges with one Docker container per team,
flags and scoring, the live leaderboard, the admin dashboard, Nginx load balancing across backend replicas, a load
test, and the Azure VM deployment scripts with CI/CD. What is still open (see `docs/TASKS.md`): creating the real Azure
VM (P3-09), the live end-to-end check with two teams on two devices (P3-12), demo data and script (P3-13), report
and slides (P3-14) and the final tag `v1.0-release` (P3-15). Handoffs: `docs/handoffs/`.

## Quick start (whole stack on your machine)

```bash
cp .env.example .env                      # then fill in Atlas + Cognito values (docs/SETUP.md); never commit .env
cd backend && npm ci && npm run seed:challenges && cd ..          # register the starter challenges once
for d in challenges/*/; do s=$(basename "$d"); [ -f "$d/Dockerfile" ] && [ "${s#_}" = "$s" ] && docker build -t "ctf/$s" "$d"; done
cd frontend && npm ci && npm run build && cd ..                   # Nginx serves frontend/dist
docker compose up -d --build              # Nginx + 3 backend replicas on http://localhost
```

| Page | Who | What |
|------|-----|------|
| `/challenges`, `/challenges/:id` | players | list by category, start/stop/extend an instance, submit a flag |
| `/leaderboard` | players | standings, score-over-time chart, your team highlighted, refreshes every 10 s |
| `/team` | players | create or join a team, invite code, members, score |
| `/admin` | admins | stats cards, requests per replica, active instances (Kill), teams (Ban/Unban) |
| `/admin/challenges` | admins | create, edit, hide and delete challenges |

Roles are exact: `admin` and `player` do not imply each other (an admin gets 403 on player routes such as the
leaderboard, and a player is redirected away from `/admin`). Tests: `cd backend && npm test`, `cd frontend && npm test`.
Unit tests need no database, but the variables of `.env.example` must be set (a copy of it as `.env` is enough).

## Read the docs in this order

1. `docs/PROJECT_BRIEF.md` - what we are building and why
2. `docs/ARCHITECTURE.md` - how the pieces fit together
3. `docs/WORKFLOW.md` - **how we hand work from one person to the next**
4. `docs/TASKS.md` - the exact task list for each person
5. `AGENTS.md` - instructions for AI coding agents (Codex CLI, Claude Code, etc.)
6. `docs/API_SPEC.md` and `docs/DATABASE_SCHEMA.md` - the contracts everyone codes against
7. `docs/CHALLENGES.md` - the starter challenges and the container template
8. `docs/SETUP.md` - local setup, Atlas, Cognito
9. `docs/SECURITY.md` - rules that keep the platform safe, plus the production checklist
10. `docs/DEMO_AND_REPORT.md` - demo script and report outline
11. `docs/AZURE_SETUP.md` - create the Azure VM and deploy (runbook for whoever owns the Azure account)

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
`{ "status": "ok", "db": "up", "replica": "<hostname>" }`.
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

Deployment is one Ubuntu VM on Azure. [`docs/AZURE_SETUP.md`](docs/AZURE_SETUP.md) is the step-by-step runbook
(VM, network rules, `deploy/azure-setup.sh`, `.env` for production, first deploy, troubleshooting).
On the VM, `bash deploy/deploy.sh` builds the frontend and challenge images and restarts the stack; the GitHub
Actions workflow `.github/workflows/deploy.yml` runs the same script after the tests on every push to `main`
(pull requests run only the tests, `.github/workflows/ci.yml`). Before real players arrive, tick the production
checklist in [`docs/SECURITY.md`](docs/SECURITY.md).
