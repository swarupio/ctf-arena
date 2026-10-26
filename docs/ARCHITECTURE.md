# Architecture - Mini CTF Arena

## 1. Big picture

```
                    Player's browser (React app)
                       |                    |
          login / MFA  |                    | /api/* (Bearer token)
                       v                    v
              +----------------+     +----------------+
              |  AWS Cognito   |     |     Nginx      |  <- load balancer + static files
              | (IAM + MFA)    |     +--------+-------+
              +----------------+              |  round-robin
                                   +----------+----------+
                                   v          v          v
                              backend-1   backend-2   backend-3   <- Docker replicas (Express)
                                   |          |          |
                                   +----+-----+-----+----+
                                        |           |
                                        v           v
                              +----------------+  +-------------------+
                              | MongoDB Atlas  |  | Docker Engine     |
                              | (DBaaS)        |  | (via docker.sock) |
                              +----------------+  +---------+---------+
                                                            |
                                    +-----------+-----------+-----------+
                                    v           v                       v
                              [teamA-cookie] [teamB-cookie] ...  one container per team per challenge
                              port 30001     port 30002          (limits, TTL, own flag)

All of the above runs on one AWS EC2 instance (Deployment).
```

## 2. Components

| Component | Responsibility | Built by |
|-----------|----------------|----------|
| Cognito User Pool | Sign-up, password, TOTP MFA, groups (`player`, `admin`), issues JWTs | Swarup |
| Auth middleware | Verifies the JWT, loads the user, attaches `req.user` with role | Swarup |
| Teams module | Create/join/leave team, invite codes | Swarup |
| Frontend shell | Router, layout, auth context, API client, login/MFA/team pages | Swarup |
| Challenge module | Challenge CRUD (admin), listing for players, attachments | Gururaj |
| Docker engine service | Start/stop containers, port allocation, limits, reaper | Gururaj |
| Flag + scoring service | Generate per-team flags, verify, award points, first blood | Gururaj |
| Challenge UI | Challenge list, detail modal, instance controls, submit box | Gururaj |
| Leaderboard module + UI | Aggregation, timeline chart, live polling | Shubham |
| Admin dashboard | Stats, instance table, ban team | Shubham |
| Nginx + scaling | Load balancer config, replica header, load test | Shubham |
| Deployment | EC2 setup, GitHub Actions deploy, domain/HTTPS (optional) | Shubham |

## 3. Key flows

### 3.1 Login with MFA
1. User signs up in the React app (Amplify Auth talks to Cognito directly).
2. Cognito emails a verification code. User confirms.
3. First login: Cognito says "set up MFA". The app shows a QR code (TOTP secret). User scans it
   with Google Authenticator and enters the first 6-digit code.
4. Every later login: password, then 6-digit code.
5. Cognito returns JWTs. The app sends the **ID token** as `Authorization: Bearer <token>`.
6. Backend `auth` middleware verifies signature, expiry and audience using `aws-jwt-verify`,
   reads `cognito:groups`, upserts a `users` document, and sets `req.user`.

### 3.2 Starting a Docker challenge
1. Player clicks **Start instance** on a Docker challenge.
2. `POST /api/challenges/:id/instance`
3. Backend checks: user has a team, team is not banned, fewer than `MAX_INSTANCES_PER_TEAM` active,
   no active instance of this challenge for the team.
4. Backend claims a free port from `CHALLENGE_PORT_MIN..MAX` by inserting an `instances` document
   (unique index on `port` among active instances). If the insert fails, try the next port.
5. `dockerode` creates the container from the challenge image with:
   - env `FLAG=<team's dynamic flag>`
   - memory limit, CPU limit, pids limit, all capabilities dropped, `no-new-privileges`
   - port mapping `port:internalPort`
   - label `ctf.instance=<id>`, `ctf.team=<id>`
6. Instance document is updated to `running` with `expiresAt = now + INSTANCE_TTL_MINUTES`.
7. Response gives the player `http://<PUBLIC_HOST>:<port>`.
8. The **reaper** (runs every 60 s on each replica) stops and removes expired containers. It claims
   each expired instance with an atomic `findOneAndUpdate` so two replicas never fight over one.

### 3.3 Submitting a flag
1. `POST /api/challenges/:id/submit { "flag": "CTF{...}" }`
2. Backend checks: team not banned, challenge not already solved by the team, submission rate limit
   (5 per minute per team per challenge).
3. Expected flag is computed:
   - Docker challenge: `CTF{<slug>_<first 12 hex of HMAC-SHA256(FLAG_SECRET, teamId:challengeId)>}`
   - Static challenge: compare against the stored salted hash.
4. Comparison uses `crypto.timingSafeEqual`.
5. A `submissions` document is always written (correct or not).
6. If correct: insert into `solves` (unique index `teamId + challengeId` makes it safe against double
   clicks), award points, add first-blood bonus if this is the first solve.
7. If an instance of that challenge is running for the team, stop it.

### 3.4 Leaderboard
`GET /api/leaderboard` runs an aggregation on `solves`: group by team, sum points, take the latest
solve time, sort by points descending then latest solve time ascending. Frontend polls every 10 s.

## 4. Why this design scales (explain this in the demo)
- Backend replicas are **stateless**. All state is in MongoDB Atlas or in Docker itself, so any
  replica can serve any request.
- Nginx spreads requests round-robin. Each response carries `X-Served-By: <container hostname>`.
- Scaling is one command: `docker compose up -d --scale backend=5`.
- Port claims and instance expiry use **atomic database operations**, so replicas never clash.
- Challenge containers are separate from the backend, so a crashing challenge never takes the site down.

## 5. Networking and ports

| Port | Purpose | Public? |
|------|---------|---------|
| 80 (and 443 if HTTPS) | Nginx: website + API | Yes |
| 4000 | Backend replicas (inside Docker network) | No |
| 30000-30100 | Player challenge instances | Yes (EC2 security group rule) |
| 22 | SSH for deployment | Only our IPs / GitHub Actions |

## 6. Decisions and fallbacks

| Decision | Reason | Fallback if it breaks |
|----------|--------|-----------------------|
| Cognito for IAM | Matches the "IAM" requirement of the course, real MFA | Self-made TOTP using `otplib` + JWT signed by backend (tell the team first) |
| Mongo Atlas | Free managed DB, TTL indexes, easy aggregation | Supabase Postgres (would change all models) |
| Ports for challenge access | Simplest, no wildcard DNS needed | Nginx path-based proxy `/i/<instanceId>/` |
| Docker socket mount | Only practical way to start containers from the backend | `tecnativa/docker-socket-proxy` to restrict the API |
| Polling leaderboard | Works across replicas with zero extra infra | Server-Sent Events if time remains |
