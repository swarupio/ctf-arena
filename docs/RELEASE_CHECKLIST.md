# Release checklist (Vercel)

Written from what was checked in the repo on 2026-11-22. Nothing here was run against Vercel, Atlas or Cognito (no
deploy has happened yet, P4-05). Details for each step: `docs/DEPLOY_VERCEL.md`.

## 0. Before you merge
- [ ] The CI run on the PR is green: backend lint and tests, frontend lint and tests (with `CHECK_DEBRIEF_COMPLETE=1`),
      frontend build, bundle budget (`deploy/bundle-size.mjs`). The `Dependency audit` job is report only: read it, do not block on it.
- [ ] Locally, if you changed content: `cd frontend && CHECK_DEBRIEF_COMPLETE=1 npm test`.
- [ ] No secrets in the diff (`git diff --cached | grep -i secret`), only `.env.example` changed.

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
