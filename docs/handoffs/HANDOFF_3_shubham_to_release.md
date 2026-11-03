# Handoff: Phase 3 -> release
From: Shubham (Phase 3 code, integrated and hardened on `release/phase3`)   To: the whole team   Tag: `v1.0-release` (not created yet)

## What is built
- Leaderboard API + page (rank, tie-breaks, timeline chart, 10 s polling, my team highlighted).
- Admin API + dashboard: stats, requests per replica (`replicastats`), active instances with forced Kill, teams with Ban/Unban.
- Nginx (round-robin via Docker DNS, rate limit, CSP, `X-Served-By` kept), hardened `docker-compose.yml`, load test (laptop numbers in `deploy/loadtest/README.md` and `docs/DEMO_AND_REPORT.md`).
- Azure scripts (`deploy/azure-setup.sh`, `deploy/deploy.sh`), CI and deploy workflows, `docs/AZURE_SETUP.md`, production checklist in `docs/SECURITY.md`.
- Light "Google CTF" theme on every page.

## What remains
- **P3-09** the Azure VM (created by the friend who owns the subscription), then the Atlas IP allowlist.
- **P3-10 live check** of the SSH deploy job and its secrets (written, never run).
- **P3-12** end-to-end QA with 2 teams on 2 devices and a real Cognito login (only automated, locally signed-token runs so far).
- **P3-13** demo data and script, backup video. **P3-14** report and slides. **P3-15** README live URL and tag `v1.0-release`.
- Azure load-test numbers (table in `docs/DEMO_AND_REPORT.md` section 5).

## How to run everything
1. `cp .env.example .env` and fill it (docs/SETUP.md). On Linux set `DOCKER_GID`.
2. `cd backend && npm ci && npm run seed:challenges`; build the challenge images (loop in docs/SETUP.md section 5).
3. `cd frontend && npm ci && npm run build`; `docker compose up -d --build` then open http://localhost.
4. Tests: `cd backend && npm test`, `cd frontend && npm test`.
5. VM: follow `docs/AZURE_SETUP.md`; after that `bash deploy/deploy.sh` or push to `main`.

## Things to know
- Replica names are container ids (footer and dashboard).
- Admins get 403 on the leaderboard (roles are exact); the nav still shows the link.
- An open tab does not learn about a ban until reload (team context); the API itself refuses immediately.
