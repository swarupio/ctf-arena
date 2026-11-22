# Release checklist (Vercel)

Written from what was checked in the repo on 2026-11-22. Nothing here was run against Vercel, Atlas or Cognito (no
deploy has happened yet, P4-05). Details for each step: `docs/DEPLOY_VERCEL.md`.

## 0. Before you merge
- [ ] The CI run on the PR is green: backend lint and tests, frontend lint and tests (with `CHECK_DEBRIEF_COMPLETE=1`),
      frontend build, bundle budget (`deploy/bundle-size.mjs`), and the `Browser checks` job (axe, hover, hero, header, terminal; the Lighthouse
      step and the `Dependency audit` job are report only: read them, do not block on them). Every check and its local command: see below.
- [ ] Locally, if you changed content: `cd frontend && CHECK_DEBRIEF_COMPLETE=1 npm test`.
- [ ] No secrets in the diff (`git diff --cached | grep -i secret`), only `.env.example` changed.

### CI checks and how to run each one locally
`.github/workflows/ci.yml` runs on every push to `main`, on pull requests and by hand (`gh workflow run CI --ref main`, then
`gh run watch`). Runs on `main` are never cancelled; a new push to a PR cancels that PR's older run.

| Check (job) | Fails the run | Run it locally |
|---|---|---|
| Backend lint and tests (`tests.yml`, Node 20, `--maxWorkers=3`) | yes | `cd backend && npm ci && npm run lint && npm test` (the CI placeholder variables are in `tests.yml`; a copy of `.env.example` as `.env` also works) |
| Frontend lint, tests, build (`tests.yml`, Node 20) | yes | `cd frontend && npm ci && npm run lint && CHECK_DEBRIEF_COMPLETE=1 npm test && npm run build` |
| Bundle budget (`tests.yml`) | yes | `node deploy/bundle-size.mjs frontend/dist` |
| Dependency audit (`tests.yml`) | no, report only | `cd backend && npm audit --omit=dev` (and `frontend`) |
| axe, WCAG A/AA + best practices, 41 page states, light and dark (`browser-checks`) | yes, on serious or critical outside the allowlist in `docs/harness/axe.cjs` | harness build, then `DIST=<dist> PERF_TOOLS=<tools> SUMMARY=1 node docs/harness/axe.cjs` |
| Hover contrast, dark and light, threshold 4.5 (`browser-checks`) | yes, on any offender | harness dev server, then `THEME=dark THRESH=4.5 node docs/harness/hover.cjs` (and `THEME=light`) |
| Home hero layout (`browser-checks`) | yes, on an assertion | harness dev server, then `OUT=<dir> node docs/harness/hero.cjs` |
| Header account area (`browser-checks`) | yes, on an assertion | harness dev server, then `OUT=<dir> node docs/harness/header.cjs` |
| Arena Terminal on phones (`browser-checks`) | yes, on overflow | harness dev server, then `node docs/harness/terminal.cjs` |
| Lighthouse, mobile, 5 pages (`browser-checks`) | no, report only (table in the job summary) | harness build, then `DIST=<dist> PERF_TOOLS=<tools> PRESETS=mobile ONLY=/,/login node docs/harness/lighthouse.cjs` |

The browser checks need three things outside the repo's package files (`docs/LIGHTHOUSE.md` has the full recipe):
```bash
# 1. tools (puppeteer-core, lighthouse, axe-core; Lighthouse 13 needs Node >= 22.19)
mkdir -p /tmp/tools && cd /tmp/tools && npm init -y && npm i --no-save puppeteer-core lighthouse axe-core
# 2. production build of the real frontend with stubbed auth (frontend/node_modules must exist: cd frontend && npm ci)
cd docs/harness && node ../../frontend/node_modules/vite/bin/vite.js build --config vite.perf.config.js --outDir /tmp/dist-harness --emptyOutDir
# 3. the harness dev server, for hover, hero, header and terminal (stop it with Ctrl+C when done)
cd docs/harness && PORT=5480 node ../../frontend/node_modules/vite/bin/vite.js --config vite.config.js
```
The scripts find Chrome by themselves (Windows, Linux and macOS locations); set `CHROME=<path>` to override. `PERF_TOOLS` is the
folder from step 1 (or set `PUPPETEER_CORE` to the puppeteer-core path), `PORT` the dev server port (default 5480). On failure the job
uploads `harness-out/` (screenshots, `axe.json`, hover JSON, logs) as the artifact `browser-checks-failure-<check>` for 7 days. The browser checks are a matrix (axe, hover-dark, hover-light, layout = hero + header + terminal, lighthouse) so they run in parallel.
Line endings: `.gitattributes` keeps shell scripts, workflows and `.cjs`/`.mjs` files LF so the Linux runner can run them.

## 1. Environment variables (Vercel > Project Settings > Environment Variables)
Names only; values never go in git. `VITE_*` are compiled into the bundle, so changing them needs a redeploy.

| Variable | Needed | Note |
|----------|--------|------|
| `MONGODB_URI` | yes | Atlas `mongodb+srv://`, database `ctf_arena`, dedicated DB user |
| `FLAG_SECRET` | yes | 32+ chars, not the placeholder. Never rotate after players have flags: every team flag changes |
| `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | yes | backend token verifier |
| `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` | yes | same values, build time. The backend validates these too, so missing ones give 503 |
| `DOCKER_ENABLED` | no | leave unset (false on Vercel). Never `true` |
| `MONGOOSE_AUTO_INDEX` | no | leave unset (false on Vercel); use step 3 instead |
| `NODE_ENV` | automatic | `production` on Vercel |
| `VERCEL` | automatic | selects the serverless defaults (Docker off, request counter off, awaited fair-play writes) |

Not needed on Vercel: `PORT`, `PUBLIC_HOST`, `CHALLENGE_*`, `INSTANCE_TTL_MINUTES`, `MAX_INSTANCES_PER_TEAM` (inert defaults),
`DOCKER_GID`, `NGINX_HOST_PORT`, `API_PROXY_TARGET` (local only), `ARENA_TERMINAL_DEBUG` (debugging only, never set in production).
`CTF_LAZY_ROUTES` is test-only (the app already loads the game and admin routers lazily outside tests).

## 2. Cognito
- [ ] App client callback and sign-out URLs include the exact Vercel URL (and custom domain).
- [ ] Groups `player` and `admin` exist; your account is in `admin` (sign out and in again after adding).
- [ ] MFA stays on (TOTP). Do not relax it to make a test pass.

## 3. Database (from your laptop, against Atlas, never from Vercel)
```bash
cd backend
MONGODB_URI='<atlas uri>' npm run db:indexes                     # first deploy and after every schema change; additive, never drops
for s in terminal challenges cipherlab weblab forensics crackme osint; do
  MONGODB_URI='<atlas uri>' npm run seed:$s                      # idempotent: updates in place, keeps solveCount and visibility
done
```
Do not run `npm run seed` or `seed:demo` on the real database (demo data). Do not run `db:indexes -- --prune` unless you read its output first.
- [ ] `GET /api/health` shows `"indexes": "ok"` (can take up to 5 minutes to flip after `db:indexes`).

## 4. Deploy
- [ ] Push to the branch Vercel builds (Preview first, then promote or merge to `main`).
- [ ] Build log shows `npm ci` for both packages and `vite build` succeeding; function `api/index.js` listed.

## 5. Smoke test (about 10 minutes)
Against the deployed URL (`$URL`):
```bash
curl -s  $URL/api/health                      # 200, "status":"ok", "indexes":"ok"
curl -s  $URL/api/event                       # 200 JSON with phase and serverTime
curl -s  $URL/api/announcement                # 200 JSON
curl -sI $URL/api/leaderboard                 # 401 without a token (never public data)
curl -sI $URL/                                # Cache-Control: no-cache, Content-Security-Policy present
curl -sI $URL/assets/<any hashed file>        # Cache-Control: public, max-age=31536000, immutable
curl -sI $URL/assets/does-not-exist.js        # 404 (not index.html)
curl -sI $URL/range                           # 200 (SPA fallback)
```
In a browser:
- [ ] Sign up or sign in with password plus TOTP; the browser console shows no CSP violation.
- [ ] Home, The Range (checklist), Challenges, Leaderboard (refreshes), Team (create or join), Profile load.
- [ ] Arena Terminal: `ls`, `cat` a file, submit a wrong flag (clear error) and a right one on a throwaway account.
- [ ] One game per category opens (Cipher Lab, Web Lab, Forensics Desk with interviews, Crackme with Patch Bay, OSINT Trail board save).
- [ ] After a capture the debrief appears.
- [ ] Admin: Dashboard, Challenges, Settings (event panel shows the phase), Integrity load; the player account cannot open `/admin`.
- [ ] Docker challenge list has the Start button disabled (expected on Vercel, `dockerAvailable: false`).
- [ ] Event mode (if used): set a test event in Admin > Settings, check the banner, the 423 on submit before start, the frozen board headers, then clear it.

## 6. Rollback
- App code: Vercel > Deployments > previous good deployment > **Promote to Production** (instant, no rebuild).
  Or `git revert` the merge and push.
- Environment variables: change back, then redeploy (a rollback to an old deployment keeps that deployment's old values only for `VITE_*`;
  runtime variables are read at request time from the current settings).
- Database: index creation and seeds are additive and idempotent, so there is nothing to undo for an app rollback. Do not drop indexes
  by hand; the unique ones are part of correctness. Back up in Atlas before any destructive script (`repairTerminalScores.js` is a one-off, read it first).
- Event or announcement trouble: Admin > Settings can clear the event and set a banner without a deploy.
- Local full stack fallback (Docker challenges): `docker compose up -d --build`.

## 7. Known gaps found during this pass
See the bottom of `docs/PROGRESS.md` (Done: CI and deployment readiness) for open items and their severity.
