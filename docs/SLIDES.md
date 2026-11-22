# Slides outline (14 slides)

Task P3-14 (report and slides). One slide per heading: title, 3 to 5 bullets, speaker notes (2 to 3 sentences) and the suggested
visual. Figures come from the cited docs. The demo (10 to 12 minutes) is in `docs/DEMO_SCRIPT.md`; this deck is the frame around it
(about 6 minutes of slides: slides 1 to 3 before the demo, slides 11 to 14 after). Wording follows `docs/VOCABULARY.md`.

Screenshot conventions: "light" and "dark" mean the theme set with the header switch; size "1440" means a 1440 x 900 browser
window, "390" means a 390 x 844 phone viewport. Hosted URL placeholder: `https://<your-vercel-app>.vercel.app` (`<URL>` below).

## 1. CTF Arena: Train on the Range. Compete in the Arena.
- A cloud-hosted capture-the-flag platform for clubs and classes.
- Sign in with a password and an authenticator code, join a team, capture flags, climb a live leaderboard.
- Two sides: the Arena (competition) and The Range (six categories of practice).
- Team: Swarup, Gururaj, Shubham; course: Cloud Computing.

**Speaker notes.** Introduce the name and the tagline in one sentence each. Say that the platform is live at the URL on the slide and that you will
show it working. Name the three people and that each owned one phase.

**Visual.** Screenshot `S01-home-hero-light`: page `<URL>/`, light theme, 1440 window, signed out, hero fully visible with the tagline.

## 2. The problem and what a CTF is
- Running a CTF is hard: isolated challenges, accounts, live scoring (`docs/PROJECT_BRIEF.md` section 1).
- A flag is a secret string hidden in a puzzle; submit it and your team scores.
- Our answer: managed cloud services plus per-team puzzles, so setup is small and sharing answers does not work.
- Goals: show four cloud services in one site, make scaling visible, keep it finishable by three people.

**Speaker notes.** Explain a flag in one sentence with an example shape such as `CTF{...}`. State that the brief demanded identity with MFA, a managed database,
Docker scaling and cloud deployment in one website. This is the slide where you say what the teacher will see.

**Visual.** Simple diagram (no screenshot): puzzle -> flag string -> submit box -> points. Optional screenshot `S02-challenge-detail-light`: `<URL>/challenges`
then one challenge's detail page, light, 1440, showing the submit box.

## 3. The four cloud services
- IAM + MFA: AWS Cognito with TOTP; roles `player` and `admin` from groups.
- Database as a Service: MongoDB Atlas free tier: teams, challenges, solves, submissions.
- Docker and scaling: Docker Compose, Nginx and three backend replicas (local mode).
- Deployment: Vercel (static frontend plus one serverless function) and GitHub Actions CI.

**Speaker notes.** This is the course requirement, so read the four lines slowly and tie each to a place in the demo. Mention that Docker challenges cannot run on Vercel,
which is why scaling and containers are shown on the local stack. The Azure VM from the first phase was dropped for cost and replaced by Vercel.

**Visual.** The four-row table of `README.md` ("The four cloud services") redrawn as four icons; no screenshot needed. (If you want one: `S03-architecture-demo-page`: `<URL>/demo`,
the architecture diagram, light, 1440.)

## 4. Architecture
- Hosted: browser -> Vercel CDN (static) and `/api` -> one serverless Express function -> MongoDB Atlas; sign-in goes to Cognito.
- Local: browser -> Nginx -> three stateless backend replicas -> Atlas and Docker Engine -> one container per team per challenge.
- Replicas are stateless: limits, sessions and counters live in MongoDB; port claims use a unique index.
- The same Express app runs in both modes.

**Speaker notes.** Show both pictures from `docs/ARCHITECTURE.md` sections 1 and 1b. Say why stateless matters: any replica or any function instance can serve any request.
Point at Cognito on both pictures because it is the one service that stays on AWS.

**Visual.** Two diagrams drawn from `docs/ARCHITECTURE.md` (ASCII in the doc): hosted and local. Optional screenshot `S04-demo-architecture-dark`: `<URL>/demo`, dark, 1440.

## 5. Identity and roles: MFA on a phone
- Password plus a six-digit authenticator code, mandatory; Cognito handles sign-up, e-mail confirmation and tokens.
- The backend verifies the signed ID token and reads the role only from the token's groups.
- A player opening `/admin` is redirected and the API answers 403; an admin has no team and cannot submit.
- If Cognito's keys cannot be fetched the API answers 503, not 401, so valid sessions are not lost.

**Speaker notes.** This is the live moment the demo starts with: the phone sign-in. We never store a password. The role is never taken from the client.

**Visual.** Screenshot `S05-mfa-code-390`: `<URL>/mfa` on a phone, light, 390, the six-digit code step (do not include a real code or e-mail; use a test account). Pair with
`S05b-admin-redirect`: the Home page after typing `<URL>/admin` as a player (or the 403 body in a terminal).

## 6. The Range: six categories, 98 flags
- Arena Terminal 15 flags, Cipher Lab 15, Web Exploit Lab 10, Forensics Desk 20, Crackme Arcade 16, OSINT Trail 22.
- 11,735 points in total; Easy, Medium, Hard and Insane tracks; fixed points, no first-blood bonus.
- Everything is simulated and fictional; nothing real is executed; no Docker needed, so it works on Vercel.
- Every puzzle value and flag is derived per team from a server secret.

**Speaker notes.** The numbers are the sum of the category tables in `README.md`; they were recomputed from the level data. Stress that it works on the hosted site. Say that two
teams never get the same answer.

**Visual.** Screenshot `S06-range-hub-dark`: `<URL>/range`, dark, 1440, signed in as a player with the checklist visible, all six category cards in view.

## 7. Highlight: Arena Terminal and the Cipher Lab workbench
- Terminal: a virtual Unix shell where the mail and logs react to your captures, one story over three modes.
- The story is a pure function of the team seed and progress: no extra database state.
- Cipher Lab: ten tools that unlock level by level, and a recipe workbench that chains decoders.
- "Magic" suggests what a text looks like; it never decodes.

**Speaker notes.** The terminal is the most visible feature, because the world changes when you capture a code. The workbench is gated, so tools are earned. Both are client-heavy
and need no server state beyond the answer.

**Visual.** Two screenshots side by side: `S07a-terminal-mail-dark` (`<URL>/terminal/easy`, dark, 1440, after one capture, the `mail` output with the reaction message and "You have new mail")
and `S07b-cipher-workbench-light` (`<URL>/cipherlab`, a level with the workbench open and three steps chained, light, 1440; use the admin preview or a prepared account).

## 8. Highlight: Crackme, Forensics and OSINT tools
- Crackme: time-travel debugger (step back, "What decided it"), flow graph, and the Patch Bay bonus.
- Forensics: packet viewer with layer tree, byte highlight, follow stream and display filter; timeline board; interviews.
- OSINT: a shared evidence board; the final question unlocks when the board has held the hidden chain.
- Each tool is built from data the player already has; answers never leak through the tool.

**Speaker notes.** Pick one tool per category and say what problem it solves for a learner. The board gives only a coarse level because an exact count was an oracle that a
tester could use to recover the chain; this was a finding of our second security review.

**Visual.** Three screenshots in a row: `S08a-crackme-debugger-dark` (`<URL>/reversing/h1`, dark, 1440, the debugger stepped back with "What decided it" visible), `S08b-packet-viewer-light`
(`<URL>/forensics/medium`, light, 1440, a packet selected with the layer tree and highlighted bytes) and `S08c-osint-board-light` (`<URL>/osint/easy`, light, 1440, case board tab with three pins and two links).

## 9. Teaching, not just scoring
- A three-step hint ladder (Nudge, Approach, Walkthrough-lite) with real costs: defaults 5, 10 and 25 percent of the level's points (cumulative tiers, total capped at 40 percent). The price is shown before opening, a confirm step asks first, the price is fixed when the hint is opened, and the deduction is applied when the level is captured. Admins can change or switch off the costs in Settings (`docs/HINTS.md`).
- A first-run "Capture your first flag" checklist and a welcome card.
- A Skills map aligned with OWASP Top 10, MITRE ATT&CK and NICE categories; mappings are our judgement.
- A debrief after each capture: what, how it works, how defenders stop it, tools, what to practise next (102 of 102 written).

**Speaker notes.** The research note says engagement evidence for CTF-style learning is positive but thin, so we claim engagement support and say nothing about learning outcomes.
The Skills page states plainly that it is not a certification.

**Visual.** Screenshot `S09a-skills-map-light` (`<URL>/skills`, light, 1440, a framework filter selected and coverage bars visible) and `S09b-debrief-light` (a captured flag's debrief opened,
for example on `<URL>/cipherlab` after a capture, light, 1440).

## 10. Competition: leaderboard and event mode
- Live leaderboard: polls every 10 s, shows your team highlighted and a score-over-time chart.
- Optional scheduled event: upcoming, live, frozen, ended; derived from three timestamps on every request.
- Frozen view: players see standings up to the freeze plus their own live score; admins see live data.
- Submissions answer 423 outside the window, on every scoring route; the guard fails closed.

**Speaker notes.** This is the moment with two devices: one team captures a flag and the other board moves, then the freeze happens and it stops moving. Say that we found and fixed a leak
where the feed and profiles still showed live solves during the freeze.

**Visual.** Two screenshots: `S10a-leaderboard-live-light` (`<URL>/leaderboard`, light, 1440, own team highlighted, chart visible) and `S10b-leaderboard-frozen-dark`
(same page during the freeze, dark, 1440, the "Scoreboard frozen at HH:MM" note and the event bar visible).

## 11. Security: what we assumed and what we found
- Assumption: an attacker lists every endpoint and gives it to an AI; knowing the endpoints must give nothing.
- Per-team flags, atomic limits in MongoDB, no flag or hash ever returned to players, fail-closed guards.
- Fair play: decoy endpoints, tainted flags and terminal pacing give admins evidence; nothing is banned automatically.
- Two reviews: 21 findings in the first (3 high, 4 medium, 9 low, 5 info) and 8 in the second; fixes have tests that fail on the old code.

**Speaker notes.** Be honest about limits: retyping puzzle output into a chat window is undetectable by design, and a coarse level on the OSINT board is still a slow threshold oracle. The public repository
contains solution notes, which is an owner decision recorded in the audit.

**Visual.** Screenshot `S11-admin-fairplay-dark`: `<URL>/admin`, Fair play section, dark, 1440, as admin (signals table; no real names). Optional: a table slide of the second review's eight findings
from `docs/SECURITY_REVIEW_2.md`.

## 12. Performance and accessibility
- First-load JavaScript 197.7 to 136.4 KB gzip, then 99.5 KB for a signed-out visitor; total JS 493.5 to 401.3 KB (`docs/PERFORMANCE.md`, `docs/LIGHTHOUSE.md`).
- Lighthouse: accessibility, best practices and SEO 100 on the measured pages; layout shift from 0.28 to 0 on most pages.
- Query budgets per endpoint are asserted by a test; one new index makes the frozen leaderboard covered (0 documents examined against 25,351).
- Devices: 14 emulated profiles plus four desktop sizes; 0 targets under 44 px on touch; no sideways scroll from 160 CSS px; light and dark.

**Speaker notes.** All of this is measured on a laptop with stubbed data, so use it to compare before and after, not as a service level. Real devices and a real login are still open items.

**Visual.** Screenshot of the Lighthouse report summary `S12a-lighthouse-range-mobile` (run it yourself on `<URL>/range`, mobile, in Chrome DevTools, light) and a phone photo `S12b-phone-dark-390`
(`<URL>/range`, dark, 390, on a real phone). Optional bar chart of the before and after bundle sizes from `docs/PERFORMANCE.md` (use the dataviz conventions).

## 13. Scaling and testing
- Load test, local stack: 1,893 req/s at 1 replica, 3,016 at 3, 3,626 at 5; p95 43.9, 45.2, 45.4 ms (`docs/DEMO_AND_REPORT.md`).
- `docker compose up -d --scale backend=5` needs no code or config change; footer shows the serving replica.
- Hosted-site load test: **[RESULT]** from `docs/LOADTEST.md` when it exists.
- Tests: backend 108 files and 2,881 tests, frontend 624 tests, plus accessibility, Lighthouse and device harnesses (`docs/PROGRESS.md`).

**Speaker notes.** Say that the 1.6x and 1.9x growth is not linear because the laptop ran out of CPU and the load generator shared it. State that the health endpoint is a trivial route. Do not claim a hosted number
until the load test document exists.

**Visual.** Bar chart `S13a-loadtest-replicas` (requests per second at 1, 3, 5 replicas; one series; title "Local stack, laptop, indicative") and screenshot `S13b-footer-served-by`
(`http://localhost/`, local stack, light, 1440, footer with the replica id; or a terminal showing `X-Served-By` values).

## 14. Process, limits and what is next
- Three sequential phases with one owner each, handoff gates and review by the next owner (`docs/WORKFLOW.md`).
- Built with AI coding agents under written rules (`AGENTS.md`), with independent review agents and human decisions.
- Open: first real deploy, two-team two-device check with real accounts, hosted load test, tags.
- Next: dynamic scoring, network hardening for challenge containers (hint costs are implemented, see `docs/HINTS.md`).

**Speaker notes.** Describe the AI-assisted process in one honest sentence: agents wrote a lot of the code and ran the audits, the team set direction, made decisions and did the checks that need real
accounts and real devices. Close with the single open item that matters: the first deploy and the real end-to-end run.

**Visual.** Screenshot `S14a-github-actions-run` (a green CI run on a pull request: lint, tests, build, bundle budget; light) and the phase timeline from `docs/WORKFLOW.md` redrawn.
The Actions screenshot needs a real run **[OWNER]**.

---

## Screenshots to capture (exact list)

Capture in the folder `docs/screenshots/` (not created by this task; a binary folder is the owner's choice). Use test accounts only; blur or avoid any real e-mail address.

| ID | Page or URL | Theme | Size | Notes |
|----|-------------|-------|------|-------|
| S01-home-hero-light | `<URL>/` | light | 1440 | signed out |
| S02-challenge-detail-light | `<URL>/challenges/<id>` | light | 1440 | submit box visible |
| S03-architecture-demo-page | `<URL>/demo` | light | 1440 | architecture diagram in view |
| S04-demo-architecture-dark | `<URL>/demo` | dark | 1440 | optional alternative for slide 4 |
| S05-mfa-code-390 | `<URL>/mfa` | light | 390 | test account, no real code |
| S05b-admin-redirect | `<URL>/admin` as a player, or the 403 in a terminal | light | 1440 | |
| S06-range-hub-dark | `<URL>/range` | dark | 1440 | player with checklist visible |
| S07a-terminal-mail-dark | `<URL>/terminal/easy` | dark | 1440 | after one capture, `mail` output |
| S07b-cipher-workbench-light | `<URL>/cipherlab` | light | 1440 | workbench with three steps |
| S08a-crackme-debugger-dark | `<URL>/reversing/h1` | dark | 1440 | stepped back, "What decided it" |
| S08b-packet-viewer-light | `<URL>/forensics/medium` | light | 1440 | packet selected, layers and bytes |
| S08c-osint-board-light | `<URL>/osint/easy` | light | 1440 | case board with pins and links |
| S09a-skills-map-light | `<URL>/skills` | light | 1440 | framework filter on |
| S09b-debrief-light | a captured flag's debrief | light | 1440 | |
| S10a-leaderboard-live-light | `<URL>/leaderboard` | light | 1440 | own team highlighted, chart |
| S10b-leaderboard-frozen-dark | `<URL>/leaderboard` during the freeze | dark | 1440 | frozen note and event bar |
| S11-admin-fairplay-dark | `<URL>/admin` Fair play | dark | 1440 | as admin |
| S12a-lighthouse-range-mobile | DevTools Lighthouse on `<URL>/range` | light | mobile preset | report summary |
| S12b-phone-dark-390 | `<URL>/range` on a real phone | dark | phone | photo or screen capture |
| S13a-loadtest-replicas | chart from `docs/DEMO_AND_REPORT.md` section 5 | light | 1440 | make with the numbers cited, label "indicative" |
| S13b-footer-served-by | `http://localhost/` | light | 1440 | local stack footer |
| S14a-github-actions-run | GitHub Actions, a CI run | light | 1440 | needs a real run |

Also for the report (`docs/DEMO_AND_REPORT.md` section 6, `docs/REPORT.md` appendix C): the Cognito user pool settings, the MFA QR screen (use a throwaway pool entry, never a real secret), the Atlas
collections, `docker ps` with challenge containers (local mode), the Vercel deployment page and a GitHub Actions run. The last two need the first deploy and a real CI run **[OWNER]**.
