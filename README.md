# CTF Arena

*Train on the Range. Compete in the Arena.*

CTF Arena is a cloud-hosted Capture-The-Flag platform built for our Cloud Computing (CC) project.
Players sign in with a password and an authenticator code (MFA), join a team, capture flags and climb a live leaderboard.
The **Arena** is the competition (teams, scoreboard, scheduled events, admin); **The Range** is practice: six categories of
simulated flags that play in the browser with no Docker. Docker challenges (one container per team) run in local mode only.

**Live demo:** `https://<your-vercel-app>.vercel.app` (placeholder: fill in after the first deploy, `docs/TASKS.md` P4-05)

<!-- Screenshot checklist (owner): capture these into docs/screenshots/ once the site is live. The exact pages, themes and
     sizes are in docs/SLIDES.md ("Screenshots to capture"): S01 home hero, S06 The Range hub (dark), S07a Arena Terminal after a
     capture, S08a Crackme debugger, S10a leaderboard, S10b frozen leaderboard. Then add 2 or 3 of them here as images. -->

**Team (build order):** Swarup -> Gururaj -> Shubham.
**Demo and report:** [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) (10 to 12 minute live demo and backup plan),
[`docs/DEMO_AND_REPORT.md`](docs/DEMO_AND_REPORT.md) (report outline), [`docs/SLIDES.md`](docs/SLIDES.md) (slides and screenshot list).

---

## What you can do in it

Every category is browser-playable. A flag is one answer that earns points; its state is Captured, Open or Locked
(wording rules: [`docs/VOCABULARY.md`](docs/VOCABULARY.md)). Flags are derived per team, so answers cannot be shared.
Counts and points come from the level data in `backend/src` (they change when levels are added).

| Category | What you do | Flags | Points | Feel | Design doc |
|----------|-------------|-------|--------|------|-----------|
| Arena Terminal | Shell puzzles in a virtual Unix box, with a reactive story and in-world mail | 15 (3 modes) | 1690 | easy, medium and hard modes | [`ARENA_TERMINAL.md`](docs/ARENA_TERMINAL.md) |
| Cipher Lab | Break ciphers with a decoder toolbox and a chainable recipe workbench | 15 | 2060 | tracks from easy to insane | [`CIPHER_LAB.md`](docs/CIPHER_LAB.md) |
| Web Exploit Lab | Attack simulated vulnerable sites with a request inspector | 10 | 1470 | one lab per web weakness | [`WEB_EXPLOIT_LAB.md`](docs/WEB_EXPLOIT_LAB.md) |
| Forensics Desk | Case files with logs, files, a packet viewer, a timeline board and suspect interviews | 20 | 2310 | tracks from easy to insane, plus a whodunit | [`FORENSICS_DESK.md`](docs/FORENSICS_DESK.md) |
| Crackme Arcade | Reverse small programs for a made-up VM, with a time-travel debugger and the Patch Bay bonus | 16 | 1905 | arcade cabinets, rising difficulty | [`CRACKME_ARCADE.md`](docs/CRACKME_ARCADE.md) |
| OSINT Trail | Investigate a fictional town and company, pin evidence on a shared case board | 22 | 2300 | four cases of questions | [`OSINT_TRAIL.md`](docs/OSINT_TRAIL.md) |

Separate from The Range, the Docker **challenges** (`/challenges`, templates in `challenges/`) start one container per team
and run in local mode only.

## Features

- **Event mode:** optional scheduled event with start, end, countdown bar and scoreboard freeze; with none configured nothing
  changes ([`docs/EVENT_MODE.md`](docs/EVENT_MODE.md)).
- **Hint costs:** every play screen has the same three-step hint ladder (Nudge, Approach, Walkthrough-lite). Hints cost a
  percentage of the level's points, taken when your team captures it: defaults 5%, 10% and 25%, capped at 40% of the level,
  asked before opening, and adjustable or switchable off by admins under Settings. Backend and frontend are implemented for
  all six categories ([`docs/HINTS.md`](docs/HINTS.md); parts of that file still describe the earlier free ladder) [CHECK].
- **Fair play:** per-team flags, scraping and shared-solution signals, decoys and admin review
  ([`docs/FAIR_PLAY.md`](docs/FAIR_PLAY.md)).
- **Skills map and Debrief:** `/skills` maps flags to OWASP Top 10, MITRE ATT&CK, NICE and CTF areas; after a capture each
  level shows a Debrief ([`docs/SKILLS_MAP.md`](docs/SKILLS_MAP.md), [`docs/DEBRIEF.md`](docs/DEBRIEF.md)).
- **Onboarding, badges and profile:** a first-run "Capture your first flag" checklist, badges, streaks, activity feed and
  daily spotlight ([`docs/ONBOARDING.md`](docs/ONBOARDING.md), [`docs/ACHIEVEMENTS.md`](docs/ACHIEVEMENTS.md)).
- **Admin:** users, teams, challenges, solves, fair-play integrity view, audit log, settings and CSV exports ("Admin API v2" in
  [`docs/API_SPEC.md`](docs/API_SPEC.md)).
- **Light and dark theme** with a no-flash script ([`docs/THEMING.md`](docs/THEMING.md)).
- **Devices:** phones, tablets, laptops and large monitors ([`docs/DEVICE_COMPATIBILITY.md`](docs/DEVICE_COMPATIBILITY.md)).

## The four cloud services (project requirement)

| # | Service | Tool | Where it shows up |
|---|---------|------|-------------------|
| 1 | IAM + MFA | AWS Cognito (TOTP authenticator app) | Sign up, login, 6-digit code, `player` / `admin` roles |
| 2 | Database as a Service | MongoDB Atlas (free tier) | Teams, challenges, solves, submissions, leaderboard |
| 3 | Docker + scaling | Docker, Docker Compose, Nginx | One container per team per challenge, 3 backend replicas |
| 4 | Deployment | Vercel (free) + GitHub Actions CI | Public URL, auto-deploy from Git; Docker challenges run locally only |

## Architecture

```
          Vercel (hosted)                              Local docker compose
 Browser -> static React app (Vite)           Browser -> Nginx :80 (serves frontend/dist)
         -> /api -> one serverless function           -> /api -> backend x3 (scale with --scale)
                    (api/index.js -> Express)                     |  X-Served-By = replica id
                          |                                       +-> Docker socket -> challenge containers
                          +------> MongoDB Atlas <----------------+   (limits, TTL, ctf.* labels)
 Sign-in: browser <-> AWS Cognito (password + TOTP); the backend only verifies the ID token (aws-jwt-verify)
```

Backend replicas are stateless: counters, locks and uniqueness live in MongoDB (atomic updates and unique indexes).
More in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick start

Three ways to run it. Use Node.js 20 or later.

| Way | When | What you get |
|-----|------|--------------|
| 1. Vercel | the public site and the demo | everything except Docker challenges; HTTPS, deploy from Git |
| 2. Docker Compose | Docker challenges, replicas, load test | Nginx plus 3 backend replicas on `http://localhost` |
| 3. Stub harness | offline layout, accessibility and device checks, demo fallback | the real frontend with stubbed sign-in and API data; no Cognito, database or backend; not a real capture |

**1. Vercel.** Follow [`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md); [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) checks it
step by step. The Express app runs as one serverless function under `/api` (`api/index.js`, `vercel.json`). With
`DOCKER_ENABLED=false` (the Vercel default) Docker challenges are listed but Start is disabled (`503 DOCKER_DISABLED`).

**2. Docker Compose** (needs Docker Desktop with Linux containers, a MongoDB Atlas URI and Cognito values from [`docs/SETUP.md`](docs/SETUP.md)):

```bash
cp .env.example .env            # fill in Atlas + Cognito values; never commit .env (PowerShell: Copy-Item)
cd backend && npm ci && npm run seed:challenges && cd ..      # register the starter challenges once
for d in challenges/*/; do s=$(basename "$d"); [ -f "$d/Dockerfile" ] && [ "${s#_}" = "$s" ] && docker build -t "ctf/$s" "$d"; done
cd frontend && npm ci && npm run build && cd ..               # Nginx serves frontend/dist
docker compose up -d --build                                  # Nginx + 3 backend replicas on http://localhost
docker compose up -d --scale backend=5                        # optional: more replicas
```

No Atlas: `docker compose -f docker-compose.yml -f docker-compose.localdb.yml up -d --build`, then seed the local database
(`docs/SETUP.md` section 6b; the seed scripts are listed under "Commands"). Open `http://localhost`, and
`http://localhost/api/health` for `{ "status": "ok", "db": "up", "replica": "...", "indexes": "ok" }` (`indexes: "missing"` means
run `npm run db:indexes`). `bash deploy/deploy.sh` rebuilds the frontend and challenge images and restarts the stack. Set
`NGINX_HOST_PORT` if port 80 is taken and, on Linux, `DOCKER_GID` (see the end of `.env.example`). Stop with `docker compose down`.

**Hot reload (development):** `cd backend && npm run dev` and, in a second terminal, `cd frontend && npm run dev` (Vite proxies
`/api` to port 4000). The backend loads the root `.env`, then `backend/.env`; process variables win.

**3. Stub harness** (after `cd frontend && npm ci`):

```bash
cd docs/harness && PORT=5480 node ../../frontend/node_modules/vite/bin/vite.js --config vite.config.js
# open http://127.0.0.1:5480/   (add ?as=admin or ?as=mfa)
```

Details: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) section 5 and [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).

### Commands

```bash
# backend (cd backend)
npm run dev | npm start | npm test | npm run lint
npm run seed                    # two demo teams (Demo Alpha SEEDAA, Demo Beta SEEDBB); needs Atlas or a replica set; -- --reset removes them
npm run seed:challenges | seed:terminal | seed:cipherlab | seed:weblab | seed:forensics | seed:crackme | seed:osint
npm run seed:demo               # optional demo teams and solves
npm run db:indexes              # build indexes where autoIndex is off (Vercel)
# frontend (cd frontend)
npm run dev | npm run build | npm run preview | npm test | npm run lint
```

### Pages and public endpoints

| Page | Who | What |
|------|-----|------|
| `/`, `/login`, `/signup`, `/confirm`, `/mfa-setup`, `/mfa`, `/forgot`, `/demo`, `/fair-play` | everyone | home, sign-up and sign-in with TOTP MFA, password reset, demo page, fair-play rules |
| `/range` | signed in | The Range hub (`/games` redirects here) |
| `/terminal`, `/cipherlab`, `/weblab`, `/forensics`, `/reversing` (Crackme Arcade), `/osint` | signed in | the six categories |
| `/skills` | everyone | Skills map and your team's coverage |
| `/challenges`, `/challenges/:id` | signed in | Docker challenges: start, stop, extend, submit |
| `/leaderboard` | players and admins | standings, score over time, refreshes every 10 s |
| `/team`, `/profile`, `/profile/:id` | players / signed in | team and invite code; badges and recent solves |
| `/admin` | admins | Overview, Users, Teams, Challenges, Submissions & solves, Fair play, Instances, Audit log, Settings, Exports |

Public APIs without a token: `GET /api/health`, `GET /api/announcement` (banner text, `registrationOpen`, `submissionsFrozen`) and
`GET /api/event` (event phase and times). Roles `admin` and `player` do not imply each other: a player gets 403 on `/api/admin/*`,
and admins have no team and cannot submit flags. Full contract: [`docs/API_SPEC.md`](docs/API_SPEC.md).

## Environment variables

Names only; copy `.env.example` to `.env` (git-ignored) and fill it in. Never commit real values.

| Variable | Needed | Purpose |
|----------|--------|---------|
| `NODE_ENV`, `PORT`, `PUBLIC_HOST` | always (PORT and PUBLIC_HOST get defaults on Vercel) | runtime mode, internal port (keep 4000 for Nginx), host shown in container URLs |
| `MONGODB_URI` | always | MongoDB Atlas or local MongoDB (`mongodb://` and `mongodb+srv://`) |
| `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | always | backend token verification |
| `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` | always | the same pool for the browser (rebuild after changing) |
| `FLAG_SECRET` | always | derives per-team flags; 32+ characters, private in production |
| `CHALLENGE_PORT_MIN`, `CHALLENGE_PORT_MAX`, `INSTANCE_TTL_MINUTES`, `MAX_INSTANCES_PER_TEAM`, `CHALLENGE_MEMORY_MB`, `CHALLENGE_CPU_LIMIT`, `CHALLENGE_PIDS_LIMIT` | locally (inert defaults on Vercel) | Docker challenge limits |
| `DOCKER_ENABLED`, `MONGOOSE_AUTO_INDEX`, `DOCKER_GID`, `NGINX_HOST_PORT`, `API_PROXY_TARGET`, `ARENA_TERMINAL_DEBUG` | optional | Docker on/off, index building, Linux socket group, host port, Vite dev proxy target, rethrow terminal errors (development only) |

Startup exits with code 1 and an error naming a missing required variable; MongoDB errors, URIs and passwords are never logged.

## Tests and CI

```bash
cd backend  && npm ci && npm test && npm run lint     # Vitest + Supertest, in-memory database
cd frontend && npm ci && npm test && npm run lint     # node --test; CHECK_DEBRIEF_COMPLETE=1 adds the full debrief check (CI sets it)
cd frontend && npm run build && cd .. && node deploy/bundle-size.mjs   # production build and bundle budget
```

No database or real credentials are needed: the backend tests read the placeholder values of `.env.example`, so a copy as
`.env` is enough. Last recorded run (`docs/PROGRESS.md`): backend 108 test files, 2,881 tests; frontend 624 tests (1 skipped).

GitHub Actions (`.github/workflows/ci.yml`; `tests.yml` also exists) runs on pushes to `main`, pull requests and by hand
(`gh workflow run CI --ref main`): backend lint and tests, frontend lint, tests and build, the bundle budget, a report-only
`npm audit`, and a `Browser checks` job (axe accessibility, hover contrast in both themes, hero layout, header, Arena Terminal on
phones; Lighthouse is report only). Each check and its local command: [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md);
browser tools: [`docs/LIGHTHOUSE.md`](docs/LIGHTHOUSE.md). Load test (Nginx plus 3 replicas): [`docs/LOADTEST.md`](docs/LOADTEST.md) and
[`deploy/loadtest/`](deploy/loadtest/README.md).

## Project structure

```
ctf-arena/
├── backend/src/    app.js server.js | config/ middleware/ models/ (20) routes/ (+ admin/) services/ games/ terminal/ forensics/ osint/ scripts/
├── backend/tests/  Vitest, one folder per area
├── frontend/src/   auth/ api/ layout/ pages/ components/ games/ terminal/ cipherlab/ forensics/ osint/ hints/ onboarding/ skills/ debrief/ event/ theme/
├── frontend/tests/ node --test
├── challenges/     _template/ and one folder per Docker challenge (Dockerfile + app + solution notes)
├── api/index.js    Vercel serverless entry           vercel.json   Vercel routing
├── nginx/          nginx.conf                        docker-compose.yml  docker-compose.localdb.yml
├── deploy/         deploy.sh, bundle-size.mjs, loadtest/
├── docs/           documentation (below), handoffs/, harness/ (stub harness and browser checks)
└── .github/        workflows/ci.yml, workflows/tests.yml, pull_request_template.md
```

## Security notes

- No secrets in git: only `.env.example` is committed. Role, team, score and flag correctness are decided on the server.
- Roles come only from verified Cognito groups; MFA (TOTP) is required. Flags and flag hashes are never sent to players.
- Docker challenge containers get memory, CPU and pids limits, all capabilities dropped, `no-new-privileges`, a TTL and `ctf.*` labels.
- The Arena Terminal uses a linear-time regex engine (no ReDoS), submissions have atomic attempt limits, and an index guard
  fails closed when required indexes are missing.
- Two security reviews are written up: [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) and [`docs/SECURITY_REVIEW_2.md`](docs/SECURITY_REVIEW_2.md).
  Before real players arrive, go through the checklist in [`docs/SECURITY.md`](docs/SECURITY.md).

## Docs index

Read "Start here" in order when you join. Everything is in `docs/`, plus [`AGENTS.md`](AGENTS.md) for AI coding agents.

| Group | Files |
|-------|-------|
| Start here | [`PROJECT_BRIEF`](docs/PROJECT_BRIEF.md) (what and why), [`ARCHITECTURE`](docs/ARCHITECTURE.md), [`WORKFLOW`](docs/WORKFLOW.md) (handoffs, file ownership), [`TASKS`](docs/TASKS.md) (tasks and status), [`API_SPEC`](docs/API_SPEC.md), [`DATABASE_SCHEMA`](docs/DATABASE_SCHEMA.md) |
| Setup and deployment | [`SETUP`](docs/SETUP.md) (local, Atlas, Cognito), [`DEPLOY_VERCEL`](docs/DEPLOY_VERCEL.md), [`RELEASE_CHECKLIST`](docs/RELEASE_CHECKLIST.md), [`BACKEND_RESILIENCE`](docs/BACKEND_RESILIENCE.md), [`CHALLENGES`](docs/CHALLENGES.md) (Docker challenges and template) |
| Security | [`SECURITY`](docs/SECURITY.md), [`SECURITY_AUDIT`](docs/SECURITY_AUDIT.md), [`SECURITY_REVIEW_2`](docs/SECURITY_REVIEW_2.md), [`FAIR_PLAY`](docs/FAIR_PLAY.md) |
| The Range | [`ARENA_TERMINAL`](docs/ARENA_TERMINAL.md), [`CIPHER_LAB`](docs/CIPHER_LAB.md), [`WEB_EXPLOIT_LAB`](docs/WEB_EXPLOIT_LAB.md), [`FORENSICS_DESK`](docs/FORENSICS_DESK.md), [`CRACKME_ARCADE`](docs/CRACKME_ARCADE.md), [`OSINT_TRAIL`](docs/OSINT_TRAIL.md) |
| Product features and wording | [`EVENT_MODE`](docs/EVENT_MODE.md), [`ACHIEVEMENTS`](docs/ACHIEVEMENTS.md), [`HINTS`](docs/HINTS.md), [`ONBOARDING`](docs/ONBOARDING.md), [`SKILLS_MAP`](docs/SKILLS_MAP.md), [`DEBRIEF`](docs/DEBRIEF.md), [`DEVICE_COMPATIBILITY`](docs/DEVICE_COMPATIBILITY.md), [`VOCABULARY`](docs/VOCABULARY.md), [`THEMING`](docs/THEMING.md) |
| Performance and quality | [`PERFORMANCE`](docs/PERFORMANCE.md), [`LIGHTHOUSE`](docs/LIGHTHOUSE.md), [`QUERY_PERFORMANCE`](docs/QUERY_PERFORMANCE.md), [`LOADTEST`](docs/LOADTEST.md), [`FIXLOG`](docs/FIXLOG.md) |
| History and research | [`DEMO_SCRIPT`](docs/DEMO_SCRIPT.md), [`DEMO_AND_REPORT`](docs/DEMO_AND_REPORT.md), [`SLIDES`](docs/SLIDES.md), [`PROGRESS`](docs/PROGRESS.md), [`WORKQUEUE`](docs/WORKQUEUE.md), [`CTF_DESIGN_RESEARCH`](docs/CTF_DESIGN_RESEARCH.md), [`handoffs/`](docs/handoffs/README.md) |

## Contributing basics

Three people build it in order (Phase 1 Swarup: foundation, auth, teams; Phase 2 Gururaj: challenges, Docker, flags, scoring;
Phase 3 Shubham: leaderboard, admin, scaling, deployment, demo). Only edit files owned by the current phase
([`docs/WORKFLOW.md`](docs/WORKFLOW.md) section 1) and read [`AGENTS.md`](AGENTS.md) first. Conventions: ES modules, `zod` on every
input, `AppError` for errors, tests for scoring and auth rules, docs updated with any contract change. Tags so far: `v0.1-foundation`,
`v0.2-engine`, `v1.0-release` (the earlier presentation snapshot); `v1.1-vercel` is planned. Tagging and pushing are owner actions.

There is no LICENSE file in the repository; this is a course project.

## Status

All three phases are in the code base: login with MFA and teams, challenges with one Docker container per team, flags and
scoring, the live leaderboard, the admin dashboard, Nginx load balancing, a load test, and the six Range categories with event
mode, hints with costs, onboarding, skills, debrief, dark theme and device support. Hosting is on Vercel (the Azure VM plan
was dropped). The running log is [`docs/PROGRESS.md`](docs/PROGRESS.md).

Honest limitations and open work (owner-only items are separated in [`docs/TASKS.md`](docs/TASKS.md)):
- Not yet done: the first real Vercel deploy and smoke test (P4-05), the live check with two teams on two devices (P3-12),
  demo rehearsal and backup video (P3-13), final report and slides (P3-14), and the final tags.
- Docker challenges do not run on Vercel (local mode only).
- Tests use stubbed sign-in and emulated devices: real Cognito login, real iOS Safari and real touch are unchecked.
- Load-test numbers come from one laptop without real sign-in; treat them as indicative ([`docs/LOADTEST.md`](docs/LOADTEST.md)).
- `npm run seed` uses a transaction, so it needs Atlas or a MongoDB replica set (standalone MongoDB is unsupported).
