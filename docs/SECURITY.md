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
| API abuse | `limit_req` in Nginx, `helmet`, request size limits |

## 2. The Docker socket risk (read this)
Mounting `/var/run/docker.sock` into the backend means a bug in the backend could control the host.
Reduce the risk:
1. Only the backend service gets the mount, and the backend never runs user-provided code.
2. Validate everything that reaches `dockerService` (image must start with `ctf/`; ports come from the allowed range; no user-supplied command, volume or env).
3. Optional hardening: run `tecnativa/docker-socket-proxy` and point the backend at it, allowing only `CONTAINERS` and `NETWORKS` APIs.
4. Keep EC2 security groups tight: SSH only from known IPs.

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
- GitHub Actions secrets: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`.
- If a secret leaks: rotate it immediately (Atlas password, Cognito app client, `FLAG_SECRET`).

## 5. Ethics and rules for players (put on the site footer or rules page)
- Attack only the challenge container you started, never the platform, other teams or the network.
- No denial-of-service, no scanning the server.
- Breaking these rules gets the team banned.
