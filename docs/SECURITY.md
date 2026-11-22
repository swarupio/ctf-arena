# Security Rules

We are running other people's puzzle containers on a real server. These rules protect the platform.
The full API security review (findings, tests, open items) is in `docs/SECURITY_AUDIT.md`; the route and access matrix is enforced by
`backend/tests/security/routeMatrix.test.js`, which fails when an endpoint is added without a decision about who may call it.

## 1. Threats we care about

| Threat | Protection |
|--------|-----------|
| Stolen or weak accounts | Cognito password policy and email verification; TOTP MFA is optional for players (owner decision) and required for admins, see section 1a |
| Player acts as admin | Role comes from the verified token only; admin routes use `requireRole('admin')` |
| Flag guessing / brute force | 5 attempts per minute per team per challenge, every attempt logged; the count is checked again after the insert, so a parallel burst cannot test more guesses |
| Invite-code guessing (6 characters, 32^6 codes) | 10 join attempts per 15 minutes per account (MongoDB counter, `429 RATE_LIMITED`), plus Nginx `limit_req` per IP |
| Flag sharing between teams | Per-team dynamic flags for Docker challenges |
| Double scoring | Unique index `teamId + challengeId` on `solves` |
| Escaping a challenge container | Non-root user, `CapDrop ALL`, `no-new-privileges`, pids/memory/CPU limits, no host mounts |
| Resource abuse (fork bombs, many containers) | Limits per container, max 2 instances per team, TTL with reaper |
| Players attacking the host or each other | Challenge containers on their own network, no access to Mongo or backend |
| Secrets leaking | `.env` ignored by git, secrets only in env, rotate `FLAG_SECRET` if exposed |
| Misbehaving team | Admin dashboard: Ban (exact `admin` role, flips `teams.banned` then stops the team's containers; a banned team gets 403 on submit and instance routes, cannot leave its team (so it cannot start over with a fresh one), and is hidden from the leaderboard) and Kill (forced stop, also for an instance stuck in `stopping`) |
| API abuse | `limit_req` in Nginx (30 requests/s per IP, burst 100, JSON 429; `/api/event` and `/api/announcement` are micro-cached for 2 s), `helmet`, 128 KB request bodies at Nginx and 100 KB in the backend |

## 1a. MFA: what is and is not enforced (owner decision, read this)
**Decision.** MFA (authenticator app, TOTP) is OPTIONAL for players: password sign-in by default, "Two-step sign-in" as an opt-in card on the profile page
(set up and turn off by the player). Admin accounts must use MFA. AGENTS.md hard rule 6 was reworded to match.

**What the backend verifies.** The backend verifies the Cognito **ID token** (`aws-jwt-verify`, `tokenUse: 'id'`, pool and client checked, signature, expiry).
Role comes from `cognito:groups` only. The ID token can also carry the `amr` claim (authentication methods, for example `["pwd","otp","mfa"]` after
password + authenticator app, `["pwd"]` after a password only). Evidence: AWS docs "Understanding the identity (ID) token" and "Authentication levels with ACR and AMR
claims" (`cognito-user-pools-step-up-authentication`): `amr` is added by Cognito, cannot be changed by a Lambda trigger, and is preserved on token refresh. The same
page says the feature is "rolling out gradually" and "might not yet be available to your user pool", and that on the hosted UI (classic) the claim is not accurate. `aws-jwt-verify`
returns every signed claim in the payload, so it can be read, but it has no typed field or built-in check for `amr`.

**Enforced (fail-closed where the claim exists).**
- `middleware/auth.js` reads `amr` (must be an array of strings, otherwise 401) and sets `req.user.mfa`: `true` (amr contains `mfa`), `false` (amr present, no `mfa`),
  `null` (no `amr` claim: unknown).
- `middleware/requireRole.js`: an `admin` with `mfa === false` gets **403 `ADMIN_MFA_REQUIRED`** on every admin route and every route open to admins. `/api/me` stays
  reachable so the app can explain what to do. The claim is signed, so a client cannot add or alter it (tested with a forged payload).
- Optional strict mode `ADMIN_REQUIRE_MFA_CLAIM=true` (off by default): an admin token with no `amr` claim also counts as `mfa === false`. Turn it on only after you
  have confirmed that your pool's tokens carry `amr` (decode one of your own admin tokens locally, never paste it into a website), because on a pool without the claim it
  locks every admin out.

**NOT enforced (the backend cannot prove it).**
- If the pool does not issue `amr` (rolling release, feature plan, classic hosted UI) and strict mode is off, the backend cannot tell whether an admin used MFA. Then
  the admin guarantee rests on: (1) admin accounts being added to the `admin` group only by the owner, (2) the owner turning on MFA for each admin
  (see Owner actions below), and (3) the front end showing a "Two-step sign-in required" page before any admin screen until an authenticator app is turned on. The front-end
  gate (`frontend/src/auth/AdminMfaGate.jsx`) is a convenience: anyone calling the API directly bypasses it.
- A token issued before the admin enabled MFA keeps its `amr` until the admin signs in again (a refresh preserves `amr`). The card tells the admin to log out and in.
- Cognito lets a user turn MFA off again by design; nothing in the pool stops an admin from doing the same, so check the admin's MFA preference after changes.
- Players without MFA are weaker against password theft: this is the accepted trade-off. Rate limits and the Cognito password policy still apply.

**Owner actions (Cognito console).**
1. Change the user pool MFA setting from **Required** to **Optional** and keep **Authenticator apps** enabled: **Cognito -> User pools -> your pool -> Authentication -> Sign-in ->
   Multi-factor authentication -> Edit -> Optional MFA**, tick **Authenticator apps**, leave SMS off, save. (Older console layout: **Sign-in experience -> Multi-factor
   authentication**.) While the pool stays on "Required", every player is still forced to set it up and the opt-in card is never needed.
2. Set each existing admin's MFA: the admin signs in once, opens Profile -> Two-step sign-in and turns it on. If needed from the AWS CLI:
   `aws cognito-idp admin-set-user-mfa-preference --user-pool-id <pool> --username <user> --software-token-mfa-settings Enabled=true,PreferredMfa=true`
   (works only after the user has verified a TOTP once; a TOTP secret is always registered by the user, you cannot create it for them).
3. Decode one admin token locally after signing in with MFA and look for `amr`; if it contains `"mfa"`, set `ADMIN_REQUIRE_MFA_CLAIM=true` (backend env on Vercel or in `.env`) so a
   missing claim also fails closed.
4. Do the switch outside event hours.

**Risks before switching the pool to Optional.** Users who already registered TOTP are unaffected (their preference stays on). Users who signed up but never finished the TOTP
setup (still on the "set up authenticator" step) can log in with the password only after the switch. An admin who has not enabled MFA is blocked from admin routes where `amr` is
present (and everywhere in strict mode). Revert path: set the pool back to Required; the app still handles the TOTP code and setup steps.

## 2. The Docker socket risk (read this)
Mounting `/var/run/docker.sock` into the backend means a bug in the backend could control the host.
Reduce the risk:
1. Only the backend service gets the mount, and the backend never runs user-provided code.
2. Validate everything that reaches `dockerService` (image must start with `ctf/`; ports come from the allowed range; no user-supplied command, volume or env).
3. Optional hardening: run `tecnativa/docker-socket-proxy` and point the backend at it, allowing only `CONTAINERS` and `NETWORKS` APIs.
4. Docker challenges are LOCAL-ONLY (`DOCKER_ENABLED`): on Vercel the socket is never mounted and no container can start, so this risk exists only on a machine you run yourself. Do not expose that machine's challenge ports to the internet unless you accept the risk.

## 3. Container creation checklist (`dockerService.createInstance`)
```js
HostConfig: {
  Memory: 128 * 1024 * 1024,
  NanoCpus: 0.25 * 1e9,
  PidsLimit: 64,
  CapDrop: ['ALL'],
  SecurityOpt: ['no-new-privileges'],
  ReadonlyRootfs: true,          // add Tmpfs: { '/tmp': 'rw,size=16m' } if the app needs temp space
  NetworkMode: 'ctf-challenges',
  PortBindings: { '<internalPort>/tcp': [{ HostPort: '<claimed port>' }] },
  RestartPolicy: { Name: 'no' }
},
Labels: { 'ctf.instance': '<id>', 'ctf.team': '<teamId>' },
Env: ['FLAG=<team flag>']
```

### Challenge network isolation
`dockerService.ensureNetwork` creates `ctf-challenges` with `com.docker.network.bridge.enable_icc=false`, so challenge
containers (different teams, different challenges) cannot talk to each other; published ports still work through the
host. A network that already exists keeps its old options: the backend never deletes it (it may hold running
containers) and logs a one-line warning once per process if `enable_icc` is not `false`. To fix it: stop the challenge
containers, `docker network rm ctf-challenges`, and let the backend recreate it.

Egress caveat: `enable_icc=false` does not stop a container from reaching the host, the LAN or, on a cloud VM, the
metadata service (`169.254.169.254`, which can hand out the VM's credentials). Optional hardening for cloud VMs: drop
that traffic in the `DOCKER-USER` chain (replace `172.20.0.0/16` with the subnet from
`docker network inspect ctf-challenges`):
```bash
sudo iptables -I DOCKER-USER -s 172.20.0.0/16 -d 169.254.169.254 -j DROP
sudo iptables -I DOCKER-USER -s 172.20.0.0/16 -d 10.0.0.0/8 -j DROP        # private ranges, adjust to your VPC
sudo iptables -I DOCKER-USER -s 172.20.0.0/16 -d 192.168.0.0/16 -j DROP
```
Rules in `DOCKER-USER` survive Docker restarts but not reboots unless saved (`iptables-persistent`). Challenges that must
reach the internet keep working; add a stricter `-j DROP` default only if none of them needs it.

## 4. Secrets handling
- Only `.env.example` is committed.
- Share real values privately, never in screenshots.
- Vercel: secrets live in the project's Environment Variables (Settings > Environment Variables), never in `vercel.json`. Only the
  `VITE_*` Cognito values are public by design (they are compiled into the frontend). GitHub Actions needs no secrets.
- If a secret leaks: rotate it immediately (Atlas password, Cognito app client, `FLAG_SECRET`).

## 5. Ethics and rules for players (put on the site footer or rules page)
- Attack only the challenge container you started, never the platform, other teams or the network.
- No denial-of-service, no scanning the server.
- Breaking these rules gets the team banned.

## 6. Production checklist (P3-11)
Tick every box before real players arrive. Items marked (local) apply only to the docker compose mode on your own machine; on Vercel use the Vercel items.

**Vercel**
- [ ] `FLAG_SECRET`, `MONGODB_URI` and the Cognito values are set under Environment Variables for Production only as needed; nothing secret is in git or `vercel.json`.
- [ ] `DOCKER_ENABLED` is unset or `false` on Vercel.
- [ ] Atlas Network Access: serverless functions have no fixed IP, so `0.0.0.0/0` is required. Compensate with a strong DB password, a least-privilege DB user (read/write on `ctf_arena` only) and no other data in the cluster.
- [ ] Cognito callback and sign-out URLs list only the real Vercel domain (and localhost for development); no wildcards.
- [ ] Preview deployments use their own `FLAG_SECRET`/DB (or are disabled), so previews cannot forge production flags.
- [ ] HTTPS and HSTS come from Vercel; check the response headers of `/` once after deploy.

**Secrets and configuration**
- [ ] `FLAG_SECRET` is a real random value, at least 32 characters (`openssl rand -hex 32`), not the placeholder and not a value used on a laptop. Set it once before play: changing it changes every team's dynamic flag. With `NODE_ENV=production` the backend refuses to start while `FLAG_SECRET` still looks like the public `.env.example` placeholder.
- [ ] `NODE_ENV=production` in `.env`.
- [ ] `.env` is mode 600 and was never committed: `ls -l .env` and `git status` (clean).
- [ ] `PUBLIC_HOST` is the public IP or DNS name players use.
- [ ] No debug logging: `git grep -nE "console\.(log|debug|info)" backend/src frontend/src` prints nothing, and `docker compose logs backend` contains only startup and reaper lines (never tokens, flags or URIs).

**Challenge containers (limits confirmed)**
- [ ] Start one instance from the site, then check the real container:
  ```bash
  docker inspect "$(docker ps -q --filter label=ctf.instance | head -n 1)" \
    --format 'mem={{.HostConfig.Memory}} cpu={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}} caps={{.HostConfig.CapDrop}} sec={{.HostConfig.SecurityOpt}} ro={{.HostConfig.ReadonlyRootfs}} labels={{.Config.Labels}}'
  ```
  Expected with the defaults: `mem=134217728 cpu=250000000 pids=64 caps=[ALL] sec=[no-new-privileges] ro=true` and `ctf.instance` / `ctf.team` labels.
- [ ] The instance disappears after `INSTANCE_TTL_MINUTES` (the reaper), and `MAX_INSTANCES_PER_TEAM` is enforced.

**Network (local)**
- [ ] Only the Nginx port and 30000-30100 are reachable from outside your machine. Nothing for 4000, 27017 or the Docker API (2375/2376).
- [ ] `docker compose ps` shows the backend as `4000/tcp` only (not published).

**Runtime hardening already in `docker-compose.yml`**
- Backend and Nginx: `restart: unless-stopped`, log rotation (3 x 10 MB), memory limits, `cap_drop: ALL` (Nginx re-adds only the four it needs), `no-new-privileges`, read-only root filesystem with `tmpfs` scratch space.
- Backend health check (`/api/health`) so `depends_on` and deploys wait for healthy replicas.
- The backend keeps the Docker socket mount (see section 2); nothing else does.
- Nginx exempts loopback and Docker-bridge source addresses from the rate limit so load tests measure the replicas. Internet clients always arrive with a public address, so they are limited. If you add a TLS proxy (below), enable the `real_ip` lines in `nginx/nginx.conf`, otherwise every client looks local and the limit stops working.

### Optional (local mode): HTTPS with Caddy (free certificate, about 10 minutes)
Only relevant if you expose the docker compose stack under a DNS name; Vercel already serves HTTPS. Ports 80 and 443 must be reachable.
1. Move Nginx off port 80: put `NGINX_HOST_PORT=8080` in `.env` (keep 8080 closed to the outside) and run `bash deploy/deploy.sh`.
2. In `nginx/nginx.conf` uncomment `set_real_ip_from 172.16.0.0/12;` and `real_ip_header X-Forwarded-For;` so client IPs (and the rate limit) stay correct, then redeploy.
3. Install Caddy on the host (official apt repository, see caddyserver.com/docs/install#debian-ubuntu-raspbian), then write `/etc/caddy/Caddyfile`:
   ```
   <your-domain> {
       reverse_proxy 127.0.0.1:8080
   }
   ```
   and run `sudo systemctl reload caddy`. Caddy obtains and renews the certificate by itself.
4. Optional once it works: add `add_header Strict-Transport-Security "max-age=31536000" always;` to the two static locations in `nginx/nginx.conf`.
5. Players now use `https://<name>`. Challenge instances stay plain HTTP on 30000-30100 (they are opened as links, so no mixed-content problem). Certbot also works but needs more wiring because Nginx runs in a container; Caddy is the simpler choice.

### Optional: docker-socket-proxy
Reduces what a compromised backend can ask the Docker daemon. It cannot stop a malicious `create` request body, so it is defence in depth, not a cure; test it before relying on it.
```yaml
  docker-proxy:
    image: tecnativa/docker-socket-proxy
    environment:
      CONTAINERS: 1     # list, create, start, remove containers
      NETWORKS: 1       # ensure the ctf-challenges network
      POST: 1
      DELETE: 1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - ctf-net
    restart: unless-stopped
```
Then in `backend`: remove the `docker.sock` volume and `group_add`, and add `environment: [DOCKER_HOST=tcp://docker-proxy:2375]` (dockerode reads `DOCKER_HOST`). Published host ports for challenge containers are still bound by the Docker daemon itself, so instances keep working.
