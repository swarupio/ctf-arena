# Demo Script and Report Outline

## 1. Pre-demo checklist
- [ ] Public URL works, certificate or HTTP choice decided
- [ ] Two player accounts (two teams) and one admin account exist, MFA set up on a phone
- [ ] At least 4 challenges visible; images built on the server
- [ ] Load-test results table filled in
- [ ] Backup: a 3-minute screen recording of the full flow
- [ ] Laptop, phone and hotspot ready

## 2. Demo script (about 8 minutes)

| Min | What to do | Cloud service shown |
|-----|-----------|---------------------|
| 0:00 | One-line pitch and architecture diagram | All |
| 0:45 | Sign up a new user, scan QR, enter the 6-digit code on the phone | **IAM + MFA** |
| 2:00 | Show that a player cannot open `/admin`; log in as admin and open it | **IAM roles** |
| 2:45 | Create a team on device 1, join with the invite code on device 2 | **DBaaS** |
| 3:30 | Start the Cookie Monster instance, show the countdown, open its URL | **Docker** |
| 4:30 | Run `docker ps` to show the labeled container with limits | **Docker** |
| 5:00 | Solve the challenge, submit the flag, leaderboard moves on the other device | **DBaaS** |
| 5:45 | Refresh several times, point at "Served by backend-1/2/3" in the footer | **Scaling** |
| 6:15 | Run the load test, then `docker compose up -d --scale backend=5`, show new replicas serving | **Scaling** |
| 7:00 | Admin kills a live instance, container disappears | **Docker + IAM** |
| 7:30 | Show GitHub Actions deploying a small change to the live site | **Deployment** |
| 8:00 | Summary slide: four services, who built what | |

## 3. Likely viva questions and short answers
- *Why Cognito instead of our own login?* IAM is a managed service: MFA, password policy and token signing are handled for us and are much harder to get right ourselves.
- *Why per-team flags?* Stops teams copying a flag from someone else.
- *How do replicas avoid clashes?* State is in MongoDB; port claims use a unique index; the reaper uses atomic updates.
- *What if a challenge container is hacked?* It has no capabilities, no host mounts, resource limits, a separate network and a TTL.
- *How would this scale beyond one server?* Move challenges to a worker pool (ECS or Kubernetes), keep Mongo and Cognito as they are.
- *Why Docker Compose and not Kubernetes?* Scope. Compose gives the same replica and load-balancing idea with far less setup.

## 4. Report outline (one section per owner where marked)

1. **Title page, team members, contributions table**
2. **Abstract** (half page)
3. **Introduction:** CTF, the problem, motivation
4. **Objectives and scope**
5. **Cloud services used:** IAM + MFA, DBaaS, Docker scaling, deployment (what, why, alternatives)
6. **System architecture:** diagram from `ARCHITECTURE.md`, component table, data flow
7. **Implementation**
   - 7.1 Foundation, IAM + MFA, teams (**Swarup**)
   - 7.2 Challenge engine, Docker, flags, scoring (**Gururaj**)
   - 7.3 Leaderboard, admin, scaling, deployment (**Shubham**)
8. **Database design:** collections and indexes from `DATABASE_SCHEMA.md`
9. **Security design:** table from `SECURITY.md`
10. **Testing and results:** unit tests, end-to-end checklist, load-test table
11. **Screenshots:** login + MFA, team page, challenge page, running container, leaderboard, admin, GitHub Actions, EC2 console
12. **Challenges faced and lessons learned**
13. **Future scope:** Kubernetes, per-challenge subdomains, dynamic scoring, hints, scoreboard freeze, SSE live updates
14. **Conclusion**
15. **References**

## 5. Load-test results table (fill in)

| Replicas | Requests/sec | p95 latency (ms) | Error rate |
|----------|--------------|------------------|------------|
| 1 | | | |
| 3 | | | |
| 5 | | | |

## 6. Screenshot checklist
Take these while building, not on the last night: Cognito pool settings, MFA QR screen, Atlas collections,
`docker ps` with challenge containers, Nginx footer showing replicas, EC2 instance page, GitHub Actions run.
