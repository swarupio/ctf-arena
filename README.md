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

The frontend shell provides navigation and a public connection check. Challenge
and deployment features are later tasks. `npm run seed` currently exits with a
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
creation, so no real `.env`, credentials, or AWS requests are needed. P1-08 provides
authenticated GET/PATCH `/api/me`; P1-10 adds team membership routes. The frontend
does not yet provide login, MFA, or team management.

Dependency reasons: Express handles HTTP; Helmet adds security headers;
Zod validates configuration and future requests; dotenv loads local settings;
Mongoose and aws-jwt-verify are the requested foundations for later database
and Cognito work. Vitest runs tests, Supertest exercises HTTP, and nodemon
restarts the development server.

## Frontend shell (P1-11)

Use Node.js 20.19+ or 22.12+. Start the backend in one terminal with
`cd backend` then `npm run dev`. In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to `http://localhost:4000`;
override this with `API_PROXY_TARGET` in the process environment or
`frontend/.env.local`. The browser API base is `VITE_API_URL`, default `/api`.
Only `VITE_` settings are exposed to the browser; never put secrets in them.
On PowerShell, for example, `$env:API_PROXY_TARGET = 'http://localhost:4000'`.

`npm test` in `frontend/` checks the API wrapper and replica store without a
backend. `npm run build` produces ignored `frontend/dist`; `npm run preview`
previews that build on port 4173 (the dev API proxy is not used in preview).
The token provider is a null-returning stub for P1-12. Challenges, Leaderboard,
Team and Login are placeholder routes. No component library is used.

Dependency reasons: React and React DOM render the UI; react-router-dom provides
page navigation; Vite and its React plugin provide local development and builds.

## Docker backend and Nginx

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

Open http://localhost for the frontend shell, or
http://localhost/api/health for the backend health response and `X-Served-By`
header. Repeated requests should show different replica names:

```powershell
1..10 | ForEach-Object { (Invoke-WebRequest http://localhost/api/health).Headers['X-Served-By'] }
```

The backend image uses Node.js 20 Alpine, installs production dependencies
only, and runs as the non-root `node` user. Nginx serves the built frontend,
supports direct navigation to client routes, and proxies `/api` to backend
replicas while preserving `X-Served-By`. Rebuild the frontend after editing it.
Stop the stack with `docker compose down`.
