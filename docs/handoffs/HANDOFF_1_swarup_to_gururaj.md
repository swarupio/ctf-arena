# Handoff: Phase 1 -> Phase 2
From: Swarup   To: Gururaj   Date: 2026-10-27   Tag: not created (gate pending)

## What is done

| Task | Delivered / acceptance status |
| --- | --- |
| P1-01 | Repo structure/docs exist; collaborator access and branch protection need human verification. |
| P1-02 | Express skeleton, Helmet, bounded JSON, standardized errors and replica header. |
| P1-03 | Validated config; process environment wins over root `.env`, then `backend/.env`. |
| P1-04 | Mongoose connects before HTTP startup; live DB health; Atlas acceptance needs human confirmation. |
| P1-05 | Non-root backend Dockerfile, starter Compose with three replicas; prior verification recorded in TASKS, not repeated here. |
| P1-06 | Cognito setup documented; live pool/MFA acceptance remains unchecked. |
| P1-07 | ID-token verifier, `{ cognitoSub, email, role }` request identity and exact-role guards. |
| P1-08 | User model and GET/PATCH `/api/me`, profile projection and token-field refresh. |
| P1-09 | Mocked auth/configuration/API tests. |
| P1-10 | Team model and create/join/read/leave; atomic membership transactions and unique indexes. |
| P1-11 | React/Vite routing, layout, API client and replica footer locally implemented; Compose mounts the build. |
| P1-12 | Amplify SRP, email confirmation and TOTP setup/code screens locally implemented; real phone/auth flow unverified. |
| P1-13 | Team UI and membership synchronization locally implemented; real two-account acceptance unverified. |
| P1-14 | Transactional idempotent seed, scoped reset and mocked-model tests. Existing npm seed command already targets the script. |

## What is NOT done / known issues

- Gate pending. P1-01, P1-06, P1-11, P1-12 and P1-13 remain unchecked in TASKS.
  P1-14/P1-15 remain unchecked at the user's request. No tag created.
- Existing staged/unstaged frontend and TASKS changes were preserved. Branch
  `swarup/handoff` was created from the current `swarup/auth-pages` checkout,
  not freshly pulled main, to retain that work. No commit, push or merge done.
- Compose now mounts `frontend/dist` and Nginx has an SPA fallback (run
  `npm run build` first). Not yet verified with Docker on a fresh clone.
- Live Atlas seed verified 2026-11-03 (2/2 created, then 0/0). Compose run verified 2026-11-03 (3 backends, `db: up`, 3 replicas in X-Served-By, SPA route 200) after adding the container egress IP to Atlas Network Access. Not done: reset, Cognito signup/email/TOTP/login, two-account team test,
  fresh clone, Docker run or next-developer laptop verification in this session.
- Prior TASKS notes record a local Cognito region/pool mismatch. Verify private
  settings locally; this session did not inspect or change them.
- [P1_DOCS_AUDIT.md](P1_DOCS_AUDIT.md) lists observed contract mismatches and
  code concerns for Swarup review. No out-of-scope application fixes made.
- Phase 2/3 challenge, Docker, reaper, flags, scoring, leaderboard/admin and
  deployment logic remains unimplemented. Team leave has a Phase 2 cleanup TODO.

## How to run it

Use Node.js 20+, npm, Docker with Linux containers and Atlas (or a local MongoDB
replica set for transactions). In PowerShell, from the repository root:

```powershell
# Fresh clone only: do not overwrite an existing private .env.
Copy-Item .env.example .env
```

Fill placeholders privately. Every variable in `.env.example` is required,
including frontend and future challenge limits. Each developer must add their
own IP or approved range under Atlas **Network Access**. A teammate's allowance
does not allow your laptop. Localhost in a backend container means that container.
Keep backend PORT=4000 for the current proxy.

```powershell
cd backend
npm ci
npm test
npm run seed
npm run seed
# Second run: created 0 users, 0 teams.
# Optional fixture cleanup:
npm run seed -- --reset
cd ..
cd frontend
npm ci
npm test
npm run build
cd ..
docker compose up --build
```

The frontend needs **`npm run build` before `docker compose up --build`**.
Compose serves the built app at `http://localhost`; API health is at
`http://localhost/api/health`. For hot reload use separate development servers:

```powershell
# Terminal 1, from repository root:
cd backend
npm run dev
```

```powershell
# Terminal 2, from repository root:
cd frontend
npm run dev
```

Open Vite's printed URL (normally `http://localhost:5173`); `/api` proxies to 4000.
Rebuild/restart Vite after public Cognito settings change. Stop the stack with
`docker compose down`. Production seed/reset refuses without `--force`:
`npm run seed -- --force` or `npm run seed -- --reset --force`.

## Test accounts

- No real emails, account IDs, passwords, pool IDs or connection strings here.
  Arrange a real admin and two players privately for acceptance testing.
- Seed players: `seed-demo-alpha@example.invalid`, `seed-demo-beta@example.invalid`.
  Their subjects start with `seed-`. They are database fixtures, cannot sign in,
  and do not bypass normal Cognito authentication or required MFA.
- Teams: Demo Alpha (`SEEDAA`) and Demo Beta (`SEEDBB`), each with its demo player
  as captain/member. Reserved IDs and complete fingerprints scope ownership.
  Modified fixtures, collisions or external membership references cause refusal.
  Reset never uses broad email-domain, subject-prefix or team-name deletes.

## Things you need to know

- Cognito target region: `ap-south-1` in the template; verify actual pool region
  privately and align backend/frontend values. Configure email sign-in and
  confirmation, public SPA client without a secret, SRP enabled
  (`ALLOW_USER_SRP_AUTH`), **MFA required, authenticator apps only**, and groups
  **admin** and **player**. Console setup is a human check.
- Use a Cognito **ID token**, not access token, as Bearer. Exact admin group
  grants admin; other verified users are players. Admin does not pass player guards.
- Existing models: `User` (users: unique cognitoSub, email, displayName, role,
  teamId, createdAt/updatedAt) and `Team` (teams: case-insensitive unique name,
  unique inviteCode, captainId, memberIds max 3, banned, createdAt). Both have
  Mongoose's `__v`. Challenge/Instance/Submission/Solve are future models.
- Membership routes and seed need transactions and initialize model indexes.
  Repeated seed does no updates, including timestamps. No new dependencies or
  seed variables. The seed logs counts, never driver credentials.
- API/schema docs distinguish implemented behavior from Phase 2/3 plans.

## Where to start

- First file: `docs/TASKS.md`, then `docs/CHALLENGES.md`, `docs/API_SPEC.md`,
  `docs/DATABASE_SCHEMA.md` and `docs/ARCHITECTURE.md` section 3.2.
- Start **P2-01** (`challenges/_template/`) and **P2-03** (Challenge, Instance,
  Submission, Solve and indexes) first. Prepare challenge images independently
  while human checks are pending; integrate dependent work after verified handoff.

## Validation and handoff gate

- Backend: all 156 tests pass with `npm test -- --testTimeout=15000`, including
  18 seed tests. Default `npm test` timed out twice in the existing environment
  precedence test during sandboxed runs with slower startup. The successful
  longer-timeout run used an approved unsandboxed process. No test configuration
  or application logic was changed to address this; default-command acceptance
  remains a human check on the developer machine.
- Frontend: all 14 `npm test` tests pass; `npm run build` passes with the existing
  bundle-size warning (main JS about 668 kB). No frontend source edits by this task.
- `git diff --check` passes; only seed.js changed under backend/src.
- Live services and full deployment remain untested, as listed above.

The following reproduces WORKFLOW section 3 with explicit status:

| Gate item | Status / evidence |
| --- | --- |
| All tasks for the phase in TASKS.md are ticked | **not done** — acceptance checks pending; P1-14/P1-15 intentionally unchecked. |
| Everything merged into main, no open PRs for the phase | **not done** — local work; no merge performed. |
| Compose works on a fresh clone following README only | **partly done** — Compose verified on this machine with frontend mount; true fresh clone still untested. |
| .env.example lists every new variable | **done** — all 18 validated application variables present; seed adds none. |
| API_SPEC matches real endpoints | **done** — current behavior audited; future routes labeled. |
| DATABASE_SCHEMA matches real models | **done** — User/Team audited; future schemas labeled. |
| Tests for the phase pass (backend npm test) | **needs a human check** — 156 pass with longer timeout; default command has an existing environment-test timeout in this sandbox. |
| A handoff note exists | **done** — this file follows the section 3 template. |
| Next person ran app on their own laptop and confirmed | **needs a human check** — Gururaj must verify. |
| Tag created and pushed | **not done** — explicitly excluded from this task. |
