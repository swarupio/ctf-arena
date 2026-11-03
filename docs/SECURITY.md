# Security Rules

We are running other people's puzzle containers on a real server. These rules protect the platform.

## 1. Threats we care about

| Threat | Protection |
|--------|-----------|
| Stolen or weak accounts | Cognito with mandatory TOTP MFA, email verification |
| Player acts as admin | Role comes from the verified token only; admin routes use `requireRole('admin')` |
| Flag guessing / brute force | 5 attempts per minute per team per challenge, every attempt logged |
| Flag sharing between teams | Per-team dynamic flags for Docker challenges |
| Double scoring | Unique index `teamId + challengeId` on `solves` |
| Escaping a challenge container | Non-root user, `CapDrop ALL`, `no-new-privileges`, pids/memory/CPU limits, no host mounts |
| Resource abuse (fork bombs, many containers) | Limits per container, max 2 instances per team, TTL with reaper |
| Players attacking the host or each other | Challenge containers on their own network, no access to Mongo or backend |
| Secrets leaking | `.env` ignored by git, secrets only in env, rotate `FLAG_SECRET` if exposed |
| Misbehaving team | Admin dashboard: Ban (exact `admin` role, flips `teams.banned` then stops the team's containers; a banned team gets 403 on submit and instance routes and is hidden from the leaderboard) and Kill (forced stop, also for an instance stuck in `stopping`) |
| API abuse | `limit_req` in Nginx (20 requests/s per IP, burst 60, JSON 429), `helmet`, 128 KB request bodies at Nginx and 100 KB in the backend |

## 2. The Docker socket risk (read this)
Mounting `/var/run/docker.sock` into the backend means a bug in the backend could control the host.
Reduce the risk:
1. Only the backend service gets the mount, and the backend never runs user-provided code.
2. Validate everything that reaches `dockerService` (image must start with `ctf/`; ports come from the allowed range; no user-supplied command, volume or env).
3. Optional hardening: run `tecnativa/docker-socket-proxy` and point the backend at it, allowing only `CONTAINERS` and `NETWORKS` APIs.
4. Keep the Azure network security group tight: SSH (22) only from known IPs.

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

## 4. Secrets handling
- Only `.env.example` is committed.
- Share real values privately, never in screenshots.
- GitHub Actions secrets: `AZURE_VM_HOST`, `AZURE_VM_USER`, `AZURE_VM_SSH_KEY` (a key pair used only for deployments),
  and optionally `AZURE_VM_HOST_KEY` to pin the VM's SSH host key. Setup steps: `docs/AZURE_SETUP.md` section 11.
- If a secret leaks: rotate it immediately (Atlas password, Cognito app client, `FLAG_SECRET`).

## 5. Ethics and rules for players (put on the site footer or rules page)
- Attack only the challenge container you started, never the platform, other teams or the network.
- No denial-of-service, no scanning the server.
- Breaking these rules gets the team banned.

## 6. Production checklist (P3-11)
Tick every box on the VM before real players arrive. Commands run on the VM in `~/ctf-arena`.

**Secrets and configuration**
- [ ] `FLAG_SECRET` is a real random value, at least 32 characters (`openssl rand -hex 32`), not the placeholder and not a value used on a laptop. Set it once before play: changing it changes every team's dynamic flag.
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

**Network**
- [ ] Azure NSG inbound allows only 22 (known IPs, or key-only with a deploy key), 80, 443 (only if HTTPS is on) and 30000-30100. Nothing for 4000, 27017 or the Docker API (2375/2376). From your laptop: `nc -vz <ip> 4000` must fail.
- [ ] `docker compose ps` shows the backend as `4000/tcp` only (not published). Docker bypasses ufw for published ports, so the NSG and not ufw is the perimeter.
- [ ] MongoDB Atlas Network Access lists only the VM's public IP (remove `0.0.0.0/0` and personal IPs after setup).
- [ ] SSH uses keys only: `sudo sshd -T | grep -i passwordauthentication` prints `no`. Optional: `sudo apt install fail2ban`.

**Runtime hardening already in `docker-compose.yml`**
- Backend and Nginx: `restart: unless-stopped`, log rotation (3 x 10 MB), memory limits, `cap_drop: ALL` (Nginx re-adds only the four it needs), `no-new-privileges`, read-only root filesystem with `tmpfs` scratch space.
- Backend health check (`/api/health`) so `depends_on` and deploys wait for healthy replicas.
- The backend keeps the Docker socket mount (see section 2); nothing else does.
- Nginx exempts loopback and Docker-bridge source addresses from the rate limit so load tests measure the replicas. Internet clients always arrive with a public address, so they are limited. If you add a TLS proxy (below), enable the `real_ip` lines in `nginx/nginx.conf`, otherwise every client looks local and the limit stops working.

### Optional: HTTPS with Caddy (free certificate, about 10 minutes)
Needs a DNS name pointing at the VM. The Azure public IP gets one for free: `<label>.<region>.cloudapp.azure.com`. NSG 80 and 443 must be open.
1. Move Nginx off port 80: put `NGINX_HOST_PORT=8080` in `.env` (keep 8080 closed in the NSG) and run `bash deploy/deploy.sh`.
2. In `nginx/nginx.conf` uncomment `set_real_ip_from 172.16.0.0/12;` and `real_ip_header X-Forwarded-For;` so client IPs (and the rate limit) stay correct, then redeploy.
3. Install Caddy on the VM (official apt repository, see caddyserver.com/docs/install#debian-ubuntu-raspbian), then write `/etc/caddy/Caddyfile`:
   ```
   <label>.<region>.cloudapp.azure.com {
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
