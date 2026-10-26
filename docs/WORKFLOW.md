# Workflow - How Swarup, Gururaj and Shubham build this together

We build **one after another**. Each person owns one part of the website, finishes it,
hands it over, and the next person builds on top.

```
  PHASE 1                    PHASE 2                     PHASE 3
  SWARUP                     GURURAJ                     SHUBHAM
  Foundation + IAM + DB  ->  Challenges + Docker     ->  Leaderboard + Admin + Scale + Deploy
  tag: v0.1-foundation       tag: v0.2-engine            tag: v1.0-release
        |                          |                           |
        +--- HANDOFF GATE #1 ------+--- HANDOFF GATE #2 -------+--- DEMO ---
```

Suggested time per phase (adjust to your deadline): Phase 1 about 4-5 days, Phase 2 about 5-6 days,
Phase 3 about 4-5 days. Agree the real dates in the group on day 1 and write them in the table below.

| Phase | Owner | Start | Handoff deadline |
|-------|-------|-------|------------------|
| 1 | Swarup | ____ | ____ |
| 2 | Gururaj | ____ | ____ |
| 3 | Shubham | ____ | ____ |

---

## 1. Ownership map (who may edit what)

Most merge conflicts come from two people editing the same file. Each folder has one owner.
If you need a change in someone else's folder, ask them or make a tiny PR and tag them.

| Path | Owner | Notes |
|------|-------|-------|
| `backend/src/config/`, `middleware/auth.js`, `middleware/requireRole.js`, `middleware/errorHandler.js` | Swarup | |
| `backend/src/models/User.js`, `Team.js` | Swarup | |
| `backend/src/routes/auth.js`, `teams.js`, `health.js` | Swarup | |
| `backend/src/scripts/seed.js` | Swarup creates, others append | |
| `frontend/src/auth/`, `layout/`, `api/`, `pages/Login*`, `pages/Team*` | Swarup | Frontend shell |
| `backend/src/models/Challenge.js`, `Instance.js`, `Submission.js`, `Solve.js` | Gururaj | |
| `backend/src/routes/challenges.js`, `instances.js`, `admin/challenges.js` | Gururaj | |
| `backend/src/services/dockerService.js`, `flagService.js`, `scoringService.js`, `reaper.js` | Gururaj | |
| `challenges/` (all challenge images) | Gururaj | |
| `frontend/src/pages/Challenges*`, `components/Challenge*` | Gururaj | |
| `backend/src/routes/leaderboard.js`, `admin/stats.js`, `admin/instances.js`, `admin/teams.js` | Shubham | |
| `frontend/src/pages/Leaderboard*`, `pages/Admin*` | Shubham | |
| `nginx/`, `docker-compose.yml` (final), `.github/workflows/`, `deploy/` | Shubham | Swarup creates the starter compose |
| `docs/` | Everyone | Update the doc that matches your change |

---

## 2. Git rules

**Branches**
- `main` is always working. Nobody pushes directly to it.
- Work on feature branches named `<name>/<short-feature>`, for example `swarup/cognito-auth`,
  `gururaj/docker-service`, `shubham/nginx-lb`.

**Commits** (one idea per commit, present tense)
```
feat: add team invite code generation
fix: stop duplicate solves on double click
docs: update API_SPEC for instance extend
chore: add dockerode dependency
test: cover flag verification
```

**Pull requests**
- Keep PRs small (under about 400 changed lines when possible).
- Fill the PR template (section 6).
- Another team member reviews. In the middle of a phase, the next owner reviews the current owner's PRs.
  This is on purpose: reviewing teaches you the code you will build on.
- Merge with "Squash and merge".

**Tags**: after the handoff gate passes, the owner tags `main`:
```bash
git tag -a v0.1-foundation -m "Phase 1 complete: auth, teams, db, frontend shell"
git push origin v0.1-foundation
```

---

## 3. Handoff gate (the most important part of this workflow)

A phase is **not finished** until every box below is ticked. The next person then starts from the tag.

### Gate checklist (owner ticks, next person verifies)
- [ ] All tasks for the phase in `TASKS.md` are ticked
- [ ] Everything is merged into `main`, no open PRs for the phase
- [ ] `docker compose up --build` works on a **fresh clone** by following README only
- [ ] `.env.example` lists every new variable
- [ ] `docs/API_SPEC.md` matches the real endpoints (change the doc, not just the code)
- [ ] `docs/DATABASE_SCHEMA.md` matches the real models
- [ ] Tests for the phase pass (`npm test` in backend)
- [ ] A handoff note exists at `docs/handoffs/HANDOFF_<phase>.md` (template below)
- [ ] The next person ran the app on their own laptop and confirmed it works
- [ ] Tag created and pushed

### Handoff note template (`docs/handoffs/HANDOFF_1_swarup_to_gururaj.md`)
```markdown
# Handoff: Phase 1 -> Phase 2
From: Swarup   To: Gururaj   Date: ____   Tag: v0.1-foundation

## What is done
- (list)

## What is NOT done / known issues
- (list, be honest)

## How to run it
1. (exact commands)

## Test accounts
- admin: email ____ (password shared privately)
- player: email ____

## Things you need to know
- (gotchas, decisions, shortcuts taken)

## Where to start
- First file to open: ____
- Suggested first task: ____
```

---

## 4. Working while you wait (no one sits idle)

Because the build is sequential, the next person can still do useful **independent** work early.
API contracts are fixed in `API_SPEC.md`, so mocks are allowed.

| While this person is building... | ...the next person prepares |
|----------------------------------|-----------------------------|
| **Swarup** (Phase 1) | **Gururaj:** builds the challenge Docker images in `challenges/` (they need no login), writes the Dockerfile template, tests them with plain `docker run`. Reads `dockerode` docs. Prototypes `dockerService.js` in a scratch script. |
| **Gururaj** (Phase 2) | **Shubham:** writes `nginx.conf`, creates the EC2 instance, security groups, Elastic IP, installs Docker, writes the GitHub Actions workflow, builds the leaderboard UI against mock JSON, prepares the load-test script. |
| **Shubham** (Phase 3) | **Swarup and Gururaj:** write test cases, fix bugs reported in the final QA, draft the report sections for their own parts, prepare their part of the demo. |

Rule: prep work lives on its own branch and only merges **after** the previous handoff gate passes.

---

## 5. Communication

- One WhatsApp or Discord group for the team.
- **Daily 5-minute update** from the current owner: done yesterday / doing today / blocked on.
- If blocked for more than 2 hours, say so in the group. Do not wait silently.
- **Secrets are never pasted in git, issues or PRs.** Share `.env` values privately (direct message or a shared password manager).
- Decisions that change the contract (a new endpoint, a renamed field) go in the group AND in the docs.

## 6. Pull request template (`.github/pull_request_template.md`)
```markdown
## What does this PR do?
## Task IDs from TASKS.md
## How to test it
## Docs updated? (API_SPEC / DATABASE_SCHEMA / .env.example)
## Screenshots (if UI)
```

## 7. Definition of done (for every task)
1. Works locally with `docker compose up --build`.
2. No secrets, no `console.log` debug leftovers, no commented-out blocks.
3. Input validated with `zod`; errors use the standard error format.
4. At least one test for new backend logic (flags, scoring, auth rules are mandatory).
5. Docs updated if a contract changed.
6. PR reviewed and merged.

## 8. When things go wrong

| Situation | What to do |
|-----------|------------|
| Previous phase has a bug that blocks you | Open a GitHub Issue, message the owner. If it is under 20 lines, fix it on a branch and tag the owner in the PR. |
| You need a new field or endpoint | Update `API_SPEC.md` / `DATABASE_SCHEMA.md` in the same PR and tell the group. |
| Merge conflict | Pull `main`, resolve locally, run the app, then push. If unsure, call the file owner. |
| Running out of time | Cut "Could have" features first (see PROJECT_BRIEF section 5). Never cut tests for auth, flags, scoring. |
| Someone is unavailable | The next owner takes over reviews; the group lead (Swarup) rebalances tasks. |
