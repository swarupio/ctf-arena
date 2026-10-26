# Project Brief - Mini CTF Arena

## 1. Problem statement
Tech clubs and colleges run CTF (Capture The Flag) events, but setting one up is painful:
challenges need isolated environments, players need accounts, and scores must be tracked live.
We will build a **small, cloud-hosted CTF platform** where every challenge runs in its own
Docker container, players log in securely with MFA, and a leaderboard ranks teams in real time.

## 2. What is a CTF? (60-second version)
Organisers hide a secret string called a **flag** (for example `CTF{c00kies_are_tasty_a1b2c3}`)
inside a puzzle: a vulnerable web page, an encrypted message, a hidden file. Players solve the
puzzle, find the flag, and submit it on the website. A correct flag gives points to the team.

## 3. Goals
1. Show real, working use of **IAM + MFA, DBaaS, Docker scaling, and cloud deployment** in one website.
2. Let a team start **their own private container** for a challenge, with limits, and have it auto-destroy.
3. Make the scaling **visible** in the demo (which replica served each request).
4. Keep it small enough that three people can finish it.

## 4. Users and roles

| Role | Who | Can do |
|------|-----|--------|
| `player` | Any registered user | Join/create one team, view challenges, start/stop instances, submit flags, view leaderboard |
| `admin` | Organisers (us) | Everything a player can, plus create/edit challenges, kill instances, ban teams, view stats |

Roles come from **Cognito groups** (`player`, `admin`). Users with no group are treated as `player`.

## 5. Feature list

**Must have (MVP)**
- Sign up, email verification, login with password + TOTP code (MFA mandatory)
- Create a team, join with an invite code (max 3 members)
- Challenge list by category with points and solve counts
- Static challenges (flag in a file or text) and Docker challenges (live container)
- Start / stop / extend a challenge instance (auto-expires)
- Flag submission with rate limiting and per-team dynamic flags for Docker challenges
- Live leaderboard (polls every 10 seconds)
- Admin: manage challenges, see active instances, kill any instance, see platform stats
- 3 backend replicas behind Nginx, replica ID shown in the footer
- Public deployment on EC2 with auto-deploy from GitHub

**Should have**
- First-blood bonus (+10% points for the first team to solve)
- Score-over-time chart on the leaderboard
- Admin can ban a team

**Could have (only if time remains)**
- Hints that cost points
- Event start/end time and scoreboard freeze
- HTTPS with a domain name

## 6. Out of scope (do NOT build)
- Our own login system or password storage (Cognito does it)
- Kubernetes or ECS (Docker Compose is enough)
- Email notifications, chat, payments
- Per-challenge VPNs or custom DNS names

## 7. Success criteria (what the teacher sees)
- [ ] Log in on a phone with the authenticator code
- [ ] Start a challenge, open its URL, solve it, submit the flag, score appears
- [ ] Leaderboard updates for a second team on another device
- [ ] Footer shows `Served by backend-1/2/3` and changes between refreshes
- [ ] Run a load test, then `docker compose up --scale backend=5` and show the change
- [ ] Admin kills a running instance and the container disappears
- [ ] Site opens from a public URL

## 8. Tech stack (decided, do not change without telling the team)

| Layer | Choice |
|-------|--------|
| Frontend | React + Vite + React Router, plain CSS or Tailwind, `aws-amplify` for Cognito |
| Backend | Node.js 20 + Express, Mongoose, `dockerode`, `aws-jwt-verify`, `zod` |
| Database | MongoDB Atlas (M0 free tier) |
| IAM + MFA | AWS Cognito User Pool, TOTP only |
| Containers | Docker + Docker Compose |
| Load balancer | Nginx |
| Hosting | AWS EC2 (Ubuntu) + Elastic IP |
| CI/CD | GitHub Actions (SSH deploy) |
| Tests | Vitest or Jest + Supertest |

## 9. Risks and how we handle them

| Risk | Handling |
|------|----------|
| Docker socket gives the backend powerful access | Isolate in one service, add resource limits, optional socket proxy (see SECURITY.md) |
| Cognito setup is confusing | Step-by-step in SETUP.md; fallback is self-made TOTP with `otplib` + JWT |
| Later phases blocked by earlier ones | API contract is fixed up front, so mocks are allowed (see WORKFLOW.md) |
| Port clashes between replicas | Atomic port claim using a unique index in MongoDB |
| EC2 free tier too small for many containers | Limit to 128 MB / 0.25 CPU per container, max 2 per team |
