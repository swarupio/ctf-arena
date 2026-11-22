# AGENTS.md - Instructions for AI coding agents

This file is read by AI coding tools (Codex CLI reads `AGENTS.md` automatically; for Claude Code,
copy it to `CLAUDE.md`). Humans should read it too: it is the shortest summary of how this repo works.

## 1. Project in one paragraph
**CTF Arena** is a cloud-hosted Capture-The-Flag platform. Players sign in with Cognito (password + TOTP MFA),
join a team, start a private Docker container per challenge, submit flags, and appear on a live leaderboard.
Backend replicas run behind Nginx; data lives in MongoDB Atlas. Three people build it in order:
**Swarup (Phase 1) -> Gururaj (Phase 2) -> Shubham (Phase 3)**.

## 2. Before you write any code
1. Ask (or check) **which phase and task ID** you are working on. Open `docs/TASKS.md`.
2. Read `docs/API_SPEC.md` and `docs/DATABASE_SCHEMA.md`. They are contracts.
3. Check `docs/WORKFLOW.md` section 1 (ownership map). **Only edit files owned by the current phase owner.**
4. If the task needs a contract change, update the docs in the same change and say so clearly.

## 3. Tech stack
Node.js 20, Express, Mongoose (MongoDB Atlas), `dockerode`, `aws-jwt-verify`, `zod`, `helmet`,
Vitest or Jest + Supertest. Frontend: React + Vite + React Router + `aws-amplify` (Auth only).
Infra: Vercel (hosting), Docker Compose + Nginx (local full-stack mode with Docker challenges), GitHub Actions (CI). IAM/MFA: AWS Cognito (the only AWS service).

## 4. Repository layout
```
ctf-arena/
├── AGENTS.md
├── README.md
├── docker-compose.yml  docker-compose.localdb.yml   # local full stack (the second adds a local MongoDB)
├── vercel.json  .env.example
├── docs/                      # all documentation (index in README.md), handoffs in docs/handoffs/, screenshot harness in docs/harness/
├── nginx/nginx.conf
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── src/
│   │   ├── app.js  server.js
│   │   ├── config/            # env.js, db.js, cognito.js
│   │   ├── middleware/        # auth.js, requireRole.js, errorHandler.js, servedBy.js, requestCounter.js, lazyRouter.js
│   │   ├── models/            # 19 models: User Team Challenge Instance Submission Solve + admin, fair-play, hint and counter models
│   │   ├── routes/            # auth teams challenges instances leaderboard health announcement event social honeypot admin/* + one per range category
│   │   ├── services/          # dockerService flagService scoringService reaper admin* leaderboardService *Service per range category
│   │   ├── games/             # range categories: cipherlab crackme weblab (level data + services)
│   │   ├── terminal/          # Arena Terminal shell, modes and regex engine
│   │   ├── forensics/ osint/  # generators and case definitions
│   │   ├── utils/             # AppError and small helpers
│   │   └── scripts/           # seed*.js, syncIndexes.js (npm run db:indexes), repair scripts
│   └── tests/                 # Vitest, one folder per area (admin, cipherlab, crackme, event, forensics, osint, security, terminal, weblab, ...)
├── frontend/
│   ├── tests/                 # node --test
│   └── src/ { auth/ api/ layout/ pages/ pages/admin/ components/ admin/ games/ (Range registry) terminal/ cipherlab/ forensics/ osint/
│            hints/ onboarding/ skills/ debrief/ event/ theme/ demo/ fairplay/ }
├── challenges/
│   ├── _template/
│   └── <challenge-slug>/      # Dockerfile + app + README (solution notes)
├── api/index.js               # Vercel serverless entry (wraps backend/src/app.js); vercel.json at the root
├── deploy/ { loadtest/, deploy.sh }
└── .github/ { workflows/ci.yml, workflows/tests.yml, pull_request_template.md }
```

## 5. Commands
```bash
# whole stack
docker compose up --build
docker compose up -d --scale backend=5

# backend
cd backend && npm install && npm run dev      # nodemon
npm test                                      # unit + API tests
npm run seed                                  # demo data

# frontend
cd frontend && npm install && npm run dev     # Vite dev server
npm run build                                 # outputs frontend/dist for Nginx

# build one challenge image
docker build -t ctf/cookie-monster challenges/cookie-monster
```

## 6. Coding conventions
- JavaScript (ES modules). 2-space indent, semicolons, single quotes.
- One responsibility per file. Routes stay thin: validate -> call a service -> respond.
- Validate every request body, query and param with `zod`.
- Errors: throw an `AppError(status, code, message)`; the central handler returns
  `{ "error": { "code": "TEAM_FULL", "message": "..." } }`. Never leak stack traces.
- Money-like or score logic must be covered by tests (flags, scoring, auth rules).
- Use `async/await`; no unhandled promises.
- Log with a small logger; no `console.log` debug leftovers in commits.
- Frontend: function components and hooks; API calls only through `src/api/client.js`.

## 7. Hard rules (never break these)
1. **No secrets in git.** Only `.env.example` is committed. Never print env values.
2. **Never trust the client.** Role, team, score and flag correctness are decided on the server.
3. **Never return flags or flag hashes** to players, not even in admin-only fields exposed to the player routes.
4. **Backend replicas must stay stateless.** No in-memory sessions, counters or locks that matter across replicas. Use MongoDB atomic operations (`findOneAndUpdate`, unique indexes).
5. **Every Docker challenge container** must be created with memory limit, CPU limit, pids limit, `CapDrop: ['ALL']`, `no-new-privileges`, a TTL and the `ctf.*` labels.
6. **Do not weaken security to make a demo pass** (no disabling MFA, no wildcard roles).
7. Do not add new dependencies without a one-line reason in the PR.
8. Do not edit files outside your phase's ownership without telling the owner.
9. Keep responses and docs in sync: if you change an endpoint or model, update `docs/`.

## 8. Phase agents (use one brief per working session)

### Agent 1 - Foundation Agent (Swarup, Phase 1)
- **Mission:** repo structure, backend skeleton, MongoDB connection, Cognito auth + MFA, teams, frontend shell and auth pages.
- **May edit:** `backend/src/config`, `middleware`, `models/User.js`, `models/Team.js`, `routes/auth.js`, `routes/teams.js`, `routes/health.js`, `frontend/src/{auth,api,layout}`, auth/team pages, root files.
- **Must not touch:** challenge, instance, scoring, leaderboard logic.
- **Done when:** tasks P1-01 to P1-15 are ticked and the handoff gate passes.
- **Starter prompt:**
  > Read AGENTS.md, docs/TASKS.md (Phase 1) and docs/API_SPEC.md. We are on task P1-07. Implement `middleware/auth.js` using `aws-jwt-verify` with the env vars from `.env.example`, attach `req.user = { id, email, role }`, add `requireRole`, and write tests with a mocked verifier. Do not edit files outside the Foundation Agent scope.

### Agent 2 - Engine Agent (Gururaj, Phase 2)
- **Mission:** challenge CRUD, Docker service, instances, reaper, flags, scoring, challenge images, challenge UI.
- **May edit:** `backend/src/models/{Challenge,Instance,Submission,Solve}.js`, `routes/{challenges,instances}.js`, `routes/admin/challenges.js`, `services/*`, `challenges/*`, `frontend/src/pages/Challenge*`, `components/Challenge*`.
- **Must not touch:** auth middleware internals, team logic, nginx, deployment files.
- **Done when:** tasks P2-01 to P2-15 are ticked and the handoff gate passes.
- **Starter prompt:**
  > Read AGENTS.md, docs/ARCHITECTURE.md section 3.2 and docs/DATABASE_SCHEMA.md. We are on task P2-07. Implement `POST /api/challenges/:id/instance` using `dockerService.createInstance`, claim a port atomically through the unique partial index on `instances.port`, enforce MAX_INSTANCES_PER_TEAM, and return the connection URL. Add tests with a fake docker client.

### Agent 3 - Release Agent (Shubham, Phase 3)
- **Mission:** leaderboard, admin dashboard, Nginx load balancing, load testing, Vercel deployment, CI, demo and report.
- **May edit:** `routes/leaderboard.js`, `routes/admin/{stats,instances,teams}.js`, `frontend/src/pages/{Leaderboard,Admin}*`, `nginx/`, `docker-compose.yml`, `.github/`, `deploy/`, `docs/`.
- **Must not touch:** flag generation, scoring rules, auth verification (open an issue instead).
- **Done when:** tasks P3-01 to P3-15 are ticked and `v1.0-release` is tagged.
- **Starter prompt:**
  > Read AGENTS.md, docs/TASKS.md (Phase 3) and docs/ARCHITECTURE.md section 4. We are on task P3-06. Write `nginx/nginx.conf` that serves `frontend/dist`, proxies `/api` to the Docker service `backend` using `resolver 127.0.0.11 valid=10s` and a variable in `proxy_pass` so scaled replicas are discovered, adds `limit_req` for `/api`, and keeps the `X-Served-By` header.

## 9. Standard checklist for any agent session
- [ ] I know the task ID and the phase owner.
- [ ] I only edited files in my scope.
- [ ] Inputs validated, errors standardised, no secrets.
- [ ] Tests added or updated and passing.
- [ ] `docs/` and `.env.example` updated if needed.
- [ ] I summarised what changed, what I did not do, and how to test it.

## 10. When unsure
Prefer the simplest design that satisfies `docs/PROJECT_BRIEF.md`. If a request conflicts with a hard rule in section 7, stop and explain the conflict instead of working around it.
