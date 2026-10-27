# Task List

Tick boxes as you go. IDs are used in commit messages and PRs (for example `feat: P1-06 team invite codes`).
Each task has an **acceptance** line: if it is true, the task is done.

---

# PHASE 1 - Swarup: Foundation, IAM + MFA, Database

**Goal:** a person can register, set up MFA, log in, create or join a team, and the backend knows who they are.

### Setup
- [ ] **P1-01 Repo and structure.** Create the GitHub repo, add the folder layout from `AGENTS.md`, add the docs from this package, protect `main`, invite Gururaj and Shubham.
  *Acceptance:* all three can clone and push a branch.
  *Local progress:* folder skeleton and docs are present; GitHub protection, invitations, and collaborator access remain unverified.
- [x] **P1-02 Backend skeleton.** Express app with `app.js` / `server.js`, `helmet`, JSON parsing, CORS off (same origin via Nginx), central error handler returning `{ "error": { "code", "message" } }`.
  *Acceptance:* `GET /api/health` returns `{ "status": "ok", "replica": "<hostname>" }`.
- [x] **P1-03 Env config.** `config/env.js` loads and validates all variables with `zod`; app refuses to start if one is missing.
  *Acceptance:* removing `MONGODB_URI` makes startup fail with a clear message.
- [x] **P1-04 MongoDB Atlas.** Create the free cluster, DB user, allow IPs, connect with Mongoose in `config/db.js` (see `SETUP.md`).
  *Acceptance:* backend logs "MongoDB connected"; health route also reports `db: "up"`.
  *Code complete:* startup connects before listening, fails safely, and health reports live DB state. Mocked tests need no database or `.env`.
- [x] **P1-05 Docker for backend.** `backend/Dockerfile` (node:20-alpine, non-root user) and the starter `docker-compose.yml` with 3 replicas.
  *Acceptance:* `docker compose up --build` starts 3 replicas; hitting `/api/health` shows different replica names.
  *Verified:* image built; Compose started 3 backend replicas; health responses and X-Served-By headers reached all 3. Nginx syntax and root placeholder passed. Backend runs as UID 1000 without `.env`, tests, or Vitest in the image. Frontend mount deferred to P1-11.

### IAM + MFA
- [ ] **P1-06 Cognito User Pool.** Create pool, app client (no secret), email sign-in, **MFA required, authenticator app only**, groups `player` and `admin` (see `SETUP.md`).
  *Acceptance:* a test user can sign in on the Cognito hosted UI and is asked for a TOTP code.
- [x] **P1-07 Auth middleware.** `middleware/auth.js` verifies the ID token with `aws-jwt-verify`; `requireRole('admin')` checks `cognito:groups`.
  *Acceptance:* no token -> 401, wrong role -> 403, valid token -> `req.user = { cognitoSub, email, role }`.
- [x] **P1-08 User model + `GET /api/me`.** On first valid request create the `users` doc (upsert by Cognito `sub`).
  *Acceptance:* returns `{ id, email, displayName, role, team }`.
- [x] **P1-09 Auth tests.** Tests for 401 / 403 / success using a mocked verifier.
  *Acceptance:* `npm test` passes.

### Teams
- [ ] **P1-10 Team model and routes.** `POST /api/teams`, `POST /api/teams/join`, `GET /api/teams/me`, `POST /api/teams/me/leave`. Invite code is 6 characters, max 3 members, one team per user.
  *Acceptance:* all rules enforced, with tests (cannot join twice, cannot exceed 3, name unique).

### Frontend shell
- [ ] **P1-11 Vite React app.** Router, layout with navbar and footer, `api/client.js` that adds the token and shows the `X-Served-By` header in the footer.
  *Acceptance:* footer shows the replica name after any API call.
- [ ] **P1-12 Auth pages.** Sign up, confirm email, login, **MFA setup (QR code)**, **MFA code entry**, logout, protected route wrapper, auth context.
  *Acceptance:* complete flow works end to end on a phone authenticator app.
- [ ] **P1-13 Team page.** Create team, join by code, show members and invite code.
  *Acceptance:* two accounts can form one team.

### Data and handoff
- [ ] **P1-14 Seed script.** `npm run seed` creates demo data (placeholder challenge docs can be added by Gururaj later).
- [ ] **P1-15 Docs sync and handoff.** Update API_SPEC, DATABASE_SCHEMA, `.env.example`; write `HANDOFF_1_swarup_to_gururaj.md`; tag `v0.1-foundation`.
  *Acceptance:* **Handoff gate checklist in WORKFLOW.md is fully ticked.**

---

# PHASE 2 - Gururaj: Challenges, Docker Engine, Flags, Scoring

**Goal:** a team can see challenges, start their own container, solve it, submit the flag and earn points.

### Challenge images (can start during Phase 1)
- [ ] **P2-01 Challenge template.** `challenges/_template/` with Dockerfile rules from `CHALLENGES.md`.
- [ ] **P2-02 Build the starter challenges** listed in `CHALLENGES.md` (at least 3 Docker ones and 2 static ones).
  *Acceptance:* `docker run -e FLAG=CTF{test} -p 8080:80 ctf/cookie-monster` serves the page and the flag is only obtainable by solving.

### Data and admin
- [ ] **P2-03 Models.** `Challenge`, `Instance`, `Submission`, `Solve` exactly as in `DATABASE_SCHEMA.md`, including the unique and TTL indexes.
- [ ] **P2-04 Admin challenge CRUD.** `GET/POST/PUT/DELETE /api/admin/challenges` (role `admin`), with validation. Flag is stored hashed for static challenges and never returned to players.
  *Acceptance:* admin creates a challenge; player cannot see the flag or hash in any response.
- [ ] **P2-05 Player challenge routes.** `GET /api/challenges` (grouped info, solved flag for my team, solve count) and `GET /api/challenges/:id`. Hidden challenges are not listed.

### Docker engine
- [ ] **P2-06 `dockerService.js`.** Functions: `ensureNetwork`, `createInstance`, `stopInstance`, `listManagedContainers`. Applies limits from `.env` (memory, CPU, pids, cap-drop ALL, no-new-privileges).
  *Acceptance:* unit-test with a fake docker client; manual test starts a real container.
- [ ] **P2-07 Instance routes.** `POST /api/challenges/:id/instance`, `GET /api/instances`, `DELETE /api/instances/:id`, `POST /api/instances/:id/extend` (once, +15 min). Atomic port claim via unique index.
  *Acceptance:* two replicas starting instances at once never get the same port; team limit enforced.
- [ ] **P2-08 Reaper.** `reaper.js` runs every 60 s, claims expired instances atomically, stops containers; on startup reconciles DB vs real containers (kills orphans, marks missing ones stopped).
  *Acceptance:* an instance with a 1-minute TTL disappears from `docker ps` without manual action.

### Flags and scoring
- [ ] **P2-09 `flagService.js`.** Per-team dynamic flags with HMAC, static flag hashing and verification with `timingSafeEqual`.
  *Acceptance:* two teams get different flags for the same Docker challenge; tests cover both types.
- [ ] **P2-10 Submission route.** `POST /api/challenges/:id/submit` with rate limit (5 per minute per team per challenge), writes `Submission`, creates `Solve` on success (duplicate-safe), stops the team's instance.
  *Acceptance:* double-click gives exactly one solve; wrong flags are logged; banned teams get 403.
- [ ] **P2-11 `scoringService.js`.** Fixed points plus 10% first-blood bonus. Returns the team's updated score.
  *Acceptance:* tests for first blood vs second solve.

### Frontend
- [ ] **P2-12 Challenges page.** Cards grouped by category, points, solved badge, solve count.
- [ ] **P2-13 Challenge detail.** Description, attachments, **Start / Stop / Extend** with countdown timer and connection URL, flag input with clear success/error messages.
  *Acceptance:* complete play-through in the browser.
- [ ] **P2-14 Admin challenge manager UI** (simple form + table; Shubham extends the admin area later).

### Handoff
- [ ] **P2-15 Docs sync and handoff.** Update docs, write `HANDOFF_2_gururaj_to_shubham.md`, tag `v0.2-engine`.
  *Acceptance:* **Handoff gate checklist fully ticked.**

---

# PHASE 3 - Shubham: Leaderboard, Admin, Scaling, Deployment, Demo

**Goal:** the platform is public, scalable, observable, and ready to demo and submit.

### Leaderboard and admin
- [ ] **P3-01 Leaderboard API.** `GET /api/leaderboard` (aggregation: points desc, latest solve asc) and `GET /api/leaderboard/timeline` (cumulative score per team over time for the chart).
- [ ] **P3-02 Leaderboard UI.** Table with rank, team, points, solves, polling every 10 s, score-over-time chart, highlight "my team".
- [ ] **P3-03 Admin stats API.** `GET /api/admin/stats`: users, teams, solves, submissions, wrong-flag rate, active instances, requests served per replica (counter kept in Mongo or from logs).
- [ ] **P3-04 Admin instance and team tools.** `GET /api/admin/instances`, `POST /api/admin/instances/:id/kill`, `PATCH /api/admin/teams/:id/ban`.
- [ ] **P3-05 Admin dashboard UI.** Stats cards, active instances table with Kill button, teams table with Ban button. Route guarded for `admin`.

### Scaling
- [ ] **P3-06 Nginx.** Final `nginx.conf`: serves the built frontend, proxies `/api` to the `backend` service with Docker DNS (`resolver 127.0.0.11`), round-robin, `limit_req` for the API, gzip, adds nothing that hides `X-Served-By`.
  *Acceptance:* refreshing the page shows different replica names in the footer.
- [ ] **P3-07 Load test.** `k6` or Apache Bench script in `deploy/loadtest/`; record results at 1, 3, and 5 replicas (requests/second, p95 latency) in a table.
- [ ] **P3-08 Scale demo.** Verify `docker compose up -d --scale backend=5` works with no code change; document it.

### Deployment
- [ ] **P3-09 EC2 setup.** Ubuntu instance, Docker + Compose installed, Elastic IP, security group (80, 443 optional, 22 restricted, 30000-30100 open), swap file if the instance is small.
- [ ] **P3-10 CI/CD.** `.github/workflows/deploy.yml`: on push to `main` run tests, SSH to EC2, `git pull`, build frontend, `docker compose up -d --build`.
  *Acceptance:* merging a PR updates the live site within a few minutes.
- [ ] **P3-11 Production hardening.** Real `FLAG_SECRET`, no debug logs, challenge limits confirmed, optional HTTPS (Caddy or Certbot) and optional docker-socket-proxy.

### Quality, demo, report
- [ ] **P3-12 End-to-end QA.** Run the full checklist in `DEMO_AND_REPORT.md` with 2 teams on 2 devices; log bugs; coordinate fixes with Swarup and Gururaj.
- [ ] **P3-13 Demo data and script.** Seed demo teams, rehearse the demo script, record a backup video.
- [ ] **P3-14 Report and slides.** Compile the report using the outline; each person writes their own section.
- [ ] **P3-15 Final tag.** Update README with the live URL, tag `v1.0-release`.
  *Acceptance:* the success criteria in `PROJECT_BRIEF.md` section 7 all pass on the public URL.
