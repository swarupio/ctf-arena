# Setup Guide

Console screens change over time. If a button name differs, look for the closest option and check the
current AWS / MongoDB docs. Do the cloud setup once (Swarup) and share values privately.

## 1. Prerequisites (everyone)
- Git, Node.js 20+, Docker Desktop (or Docker Engine on Linux) with Compose v2
- A phone with Google Authenticator or Microsoft Authenticator
- GitHub account added to the repo, an AWS account (Cognito only), an Azure subscription for deployment (a friend provides it), a MongoDB Atlas account

Check:
```bash
node -v && docker -v && docker compose version && git --version
```

## 2. Clone and configure
```bash
git clone <repo-url> ctf-arena && cd ctf-arena
cp .env.example .env
```
Fill `.env` using sections 3 and 4. Never commit it.

## 3. MongoDB Atlas (DBaaS) - Swarup
1. Create an Atlas account and a **free (M0) cluster**.
2. **Database Access:** add a user with a strong password and read/write on any database.
3. **Network Access:** each developer must add their own current IP or approved
   range for local work. On the Azure VM, add its static public IP later
   (avoid `0.0.0.0/0` outside quick tests).
4. **Connect -> Drivers:** copy the connection string and put it in `MONGODB_URI`, with the database name `ctf_arena`.
5. Run the backend; it should log `MongoDB connected`.

## 4. AWS Cognito (IAM + MFA) - Swarup
1. AWS Console -> **Cognito -> User pools -> Create user pool**.
2. Application type: **Single-page application** (no client secret).
   Enable SRP (`ALLOW_USER_SRP_AUTH`) for the frontend's `USER_SRP_AUTH` flow.
   The template region is `ap-south-1`; use the actual pool region consistently
   in backend/frontend settings and match it to the pool ID prefix.
3. Sign-in identifier: **Email**. Self-registration: **enabled**. Email verification: **enabled**.
4. **Multi-factor authentication: Required.** MFA methods: **Authenticator apps only** (turn SMS off, it costs money).
5. Create the pool, then note:
   - **User pool ID** -> `COGNITO_USER_POOL_ID` and `VITE_COGNITO_USER_POOL_ID`
   - **App client ID** -> `COGNITO_CLIENT_ID` and `VITE_COGNITO_CLIENT_ID`
   - **Region** -> `COGNITO_REGION` and `VITE_COGNITO_REGION`
6. **Groups:** create `player` and `admin`. Add your own account to `admin` after you sign up.
7. Check the pool's pricing tier and free allowance in the console when you create it, and confirm that
   TOTP MFA is available on that tier.
8. Test: sign up in the React app, confirm the email, scan the QR code, log in again with a code.

**Fallback if Cognito blocks us:** implement TOTP in the backend with `otplib` + `qrcode`, store the secret
encrypted in `users`, and sign our own JWT. Tell the team before switching.

## 5. Run locally
```bash
# whole stack
cd frontend
npm ci
npm run build
cd ..
docker compose up --build

# or develop separately
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

Compose mounts `frontend/dist` into Nginx (with SPA fallback), so run
`npm run build` first. Teams and seed require Atlas or a local MongoDB replica set, not standalone MongoDB.
The site is then on http://localhost (set `NGINX_HOST_PORT` in `.env` if port 80 is taken) and the backend runs as
3 replicas (`docker compose up -d --scale backend=5` for more).

First-time data and challenge images (once per database / per machine):
```bash
cd backend && npm run seed:challenges      # registers challenges/*/challenge.json in MongoDB (repeatable)
cd ..
for d in challenges/*/; do s=$(basename "$d"); [ -f "$d/Dockerfile" ] && [ "${s#_}" = "$s" ] && docker build -t "ctf/$s" "$d"; done
```
Optional demo teams: `cd backend && npm run seed` (see the README). To check everything before a demo, run the
backend tests (`cd backend && npm test`) and the frontend tests and build (`cd frontend && npm test && npm run build`).
Unit tests need no database but do need the variables of `.env.example` to be set (a copy of it is enough; CI sets
placeholder values the same way).

## 6. Docker notes
- The backend needs `/var/run/docker.sock` to start challenge containers. On Docker Desktop (Windows/Mac) this works through the mounted socket path in `docker-compose.yml` (default `DOCKER_GID=0`). On a Linux host set `DOCKER_GID=$(getent group docker | cut -d: -f3)` in `.env` so the non-root backend can use the socket.
- The backend creates the `ctf-challenges` network on startup (`dockerService.ensureNetwork`); challenge containers join it and publish host ports `CHALLENGE_PORT_MIN..MAX`.
- Build challenge images before testing instances: `docker build -t ctf/<slug> challenges/<slug>` (the loop above builds all of them).
- Replica names in the footer and on the admin dashboard are container ids; `docker ps --filter name=backend --format '{{.ID}}  {{.Names}}'` maps them to Compose names.

## 7. Create an admin
1. Sign up normally.
2. Cognito -> User pools -> your pool -> Groups -> `admin` -> **Add user to group**.
3. Log out and in again so the token contains the group.

## 8. Troubleshooting

| Problem | Likely fix |
|---------|-----------|
| `MongoNetworkError` | Your IP is not in Atlas Network Access |
| 401 on every call | Wrong user pool ID / client ID, or you sent the access token instead of the ID token |
| User is `player` but should be `admin` | Log out and in after adding to the group |
| Container starts but URL does not open | Azure network security group / firewall does not allow 30000-30100; wrong `PUBLIC_HOST` |
| `permission denied` on docker.sock | Set `DOCKER_GID` in `.env` to the socket's group id (Linux: `getent group docker \| cut -d: -f3`), then `docker compose up -d --force-recreate backend`. Do not run the backend as root |
| The challenge list is empty | Run `npm run seed:challenges` in `backend/` (or `SEED_CHALLENGES=1 bash deploy/deploy.sh` on the VM) |
| Nginx 502 after scaling | Nginx cached old replica IPs; use the `resolver` + variable `proxy_pass` pattern |
