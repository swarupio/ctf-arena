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
| 4 | Deployment | AWS EC2 + GitHub Actions | Public URL, auto-deploy on push to `main` |

## Who builds what

| Phase | Owner | Part of the website | Ends with tag |
|-------|-------|---------------------|---------------|
| 1 | **Swarup** | Foundation: repo, IAM + MFA login, teams, database, frontend shell | `v0.1-foundation` |
| 2 | **Gururaj** | Challenges, Docker engine, flag submission, scoring | `v0.2-engine` |
| 3 | **Shubham** | Leaderboard, admin dashboard, scaling, deployment, demo, report | `v1.0-release` |

## Read the docs in this order

1. `docs/PROJECT_BRIEF.md` - what we are building and why
2. `docs/ARCHITECTURE.md` - how the pieces fit together
3. `docs/WORKFLOW.md` - **how we hand work from one person to the next**
4. `docs/TASKS.md` - the exact task list for each person
5. `AGENTS.md` - instructions for AI coding agents (Codex CLI, Claude Code, etc.)
6. `docs/API_SPEC.md` and `docs/DATABASE_SCHEMA.md` - the contracts everyone codes against
7. `docs/CHALLENGES.md` - the starter challenges and the container template
8. `docs/SETUP.md` - local setup, Atlas, Cognito
9. `docs/SECURITY.md` - rules that keep the platform safe
10. `docs/DEMO_AND_REPORT.md` - demo script and report outline

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
(no real database or `.env` needed), or
`npm start` to run without nodemon. Removing `MONGODB_URI` from the environment
and both `.env` files makes startup exit with code 1 and an error naming the variable.

The folder placeholders contain no frontend, challenge, or deployment
implementation. Nginx currently serves a plain text placeholder and proxies the API.
Teams and seed data are later tasks. `npm run seed` currently exits with a
P1-14 reminder.
GitHub branch protection and collaborator access still need verification for P1-01.

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
routes for teams are not implemented yet. P1-08 provides authenticated GET/PATCH
`/api/me`, with user persistence and display-name validation.

Dependency reasons: Express handles HTTP; Helmet adds security headers;
Zod validates configuration and future requests; dotenv loads local settings;
Mongoose and aws-jwt-verify are the requested foundations for later database
and Cognito work. Vitest runs tests, Supertest exercises HTTP, and nodemon
restarts the development server.

## Docker backend and placeholder Nginx (P1-05)

Start Docker Desktop with Linux containers. From the repository root, copy
`.env.example` to `.env` if you have not configured it yet. Keep `PORT=4000`
for the internal proxy. Compose injects the root `.env` at runtime through
`env_file`; no environment file is copied into the backend image.

```bash
docker compose up --build   # starts nginx + 3 backend replicas
```

Open http://localhost for `CTF Arena is running`, or
http://localhost/api/health for the backend health response and `X-Served-By`
header. Repeated requests should show different replica names:

```powershell
1..10 | ForEach-Object { (Invoke-WebRequest http://localhost/api/health).Headers['X-Served-By'] }
```

The backend image uses Node.js 20 Alpine, installs production dependencies
only, and runs as the non-root `node` user. The frontend mount is disabled
until P1-11. Stop the stack with `docker compose down`.
