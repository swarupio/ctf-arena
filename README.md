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

## Quick start (after Phase 1 is done)

```bash
cp .env.example .env        # fill in Atlas + Cognito values
docker compose up --build   # starts nginx + 3 backend replicas
```

Open http://localhost and log in.
