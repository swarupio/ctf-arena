# Setup Guide

Console screens change over time. If a button name differs, look for the closest option and check the
current AWS / MongoDB docs. Do the cloud setup once (Swarup) and share values privately.

## 1. Prerequisites (everyone)
- Git, Node.js 20+, Docker Desktop (or Docker Engine on Linux) with Compose v2
- A phone with Google Authenticator or Microsoft Authenticator
- GitHub account added to the repo, an AWS account, a MongoDB Atlas account

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
3. **Network Access:** add your IP for local work. On the EC2 server, add the Elastic IP later
   (avoid `0.0.0.0/0` outside quick tests).
4. **Connect -> Drivers:** copy the connection string and put it in `MONGODB_URI`, with the database name `ctf_arena`.
5. Run the backend; it should log `MongoDB connected`.

## 4. AWS Cognito (IAM + MFA) - Swarup
1. AWS Console -> **Cognito -> User pools -> Create user pool**.
2. Application type: **Single-page application** (no client secret).
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
docker compose up --build

# or develop separately
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## 6. Docker notes
- The backend needs `/var/run/docker.sock` to start challenge containers. On Docker Desktop (Windows/Mac) this works through the mounted socket path in `docker-compose.yml`.
- First run creates the `ctf-challenges` network automatically.
- Build challenge images before testing instances: `docker build -t ctf/<slug> challenges/<slug>`.

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
| Container starts but URL does not open | Security group / firewall does not allow 30000-30100; wrong `PUBLIC_HOST` |
| `permission denied` on docker.sock | Run the backend container as root or add the socket's group in compose |
| Nginx 502 after scaling | Nginx cached old replica IPs; use the `resolver` + variable `proxy_pass` pattern |
