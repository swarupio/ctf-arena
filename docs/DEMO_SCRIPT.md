# Demo script (10 to 12 minutes)

Task P3-13 (demo data and script). This replaces the 8-minute table in `docs/DEMO_AND_REPORT.md` section 2 for the final
presentation: that table was written for the original VM deployment and still shows the Docker and scaling steps. The same
steps are kept here as the short local-mode segment (section 4, "Segment L"). What the demo has to prove comes from
`docs/PROJECT_BRIEF.md` section 7; the mapping is in section 9.

Wording follows `docs/VOCABULARY.md`: the hub is **The Range**, a unit of progress is a **flag**, states are Captured, Open and
Locked. Say "category" for Arena Terminal, Cipher Lab and the others.

Placeholders you fill in before the day: `<URL>` = `https://<your-vercel-app>.vercel.app` (no deploy has happened yet,
`docs/TASKS.md` P4-05), the three accounts below, and the Arena Terminal commands marked `[OWNER]` (the solutions are
owner-only, so they are not written here).

## 1. Cast and set-up

| Role | Device | Account (you create it) | Team | What it is used for |
|------|--------|--------------------------|------|---------------------|
| Player A | **phone** (authenticator app) and the presenting laptop | `<player-a email>` (Cognito sign-up, TOTP) | Team Red | live sign-in with MFA, Arena Terminal, Crackme, OSINT, Forensics |
| Player B | second device or second browser profile | `<player-b email>` | Team Blue | joins the leaderboard moment, captures one flag live |
| Admin | laptop, private window | `<admin email>` in the Cognito group `admin` | none (admins have no team) | `/admin`, event settings, previews of locked tools |

Rules the audience will see, so state them once: a player opening `/admin` is redirected and gets 403 from the API; an admin has
no team and cannot submit flags (`README.md`, Roles). That is the reason the admin is only used for settings and previews.

URLs (replace `<URL>`):

| Step | URL |
|------|-----|
| Landing, sign-in | `<URL>/`, `<URL>/login` |
| The Range hub | `<URL>/range` |
| Skills map | `<URL>/skills` |
| Arena Terminal | `<URL>/terminal/easy` |
| Crackme Arcade | `<URL>/reversing` then a cabinet, for example `<URL>/reversing/h1` (hard track, Patch Bay) |
| OSINT Trail | `<URL>/osint/easy` |
| Forensics Desk | `<URL>/forensics/easy` (log viewer), `<URL>/forensics/medium` (packet viewer) |
| Cipher Lab | `<URL>/cipherlab` (the workbench opens with level h3, see "Tool unlocks" below) |
| Leaderboard | `<URL>/leaderboard` |
| Team | `<URL>/team` |
| Admin | `<URL>/admin`, settings section for the event |
| Health (warm-up and proof) | `<URL>/api/health`, `<URL>/api/event` |
| Scripted match (offline-safe) | `<URL>/demo` |

Route names come from the page table in `README.md`. The cabinet id `h1` comes from `docs/CRACKME_ARCADE.md`
(hard track h1 to h4 have the Patch Bay). Whether `/forensics/medium` is open to a new team from the start is [CHECK]: open it
once on Team Red during rehearsal; if it is locked, use the admin preview for the packet viewer.

## 2. Pre-demo checklist (do it the day before and again 30 minutes before)

Every item has a way to check it. Do not run anything marked "not on the real database" against Atlas.

### Data and configuration
- [ ] **Indexes.** `cd backend && npm run db:indexes` was run against the real database (the owner reported it done on
      2026-11-22, `docs/PROGRESS.md` owner actions; not independently checked). Check: `curl -s <URL>/api/health` shows
      `"indexes":"ok"`. The field can take up to 5 minutes to flip after the command (`docs/RELEASE_CHECKLIST.md` step 3).
- [ ] **Category seeds.** `seed:terminal`, `seed:challenges`, `seed:cipherlab`, `seed:weblab`, `seed:forensics`, `seed:crackme`,
      `seed:osint` ran against Atlas (idempotent, updates in place; `docs/DEPLOY_VERCEL.md` section 5). Check: `/range` shows
      six categories with open flags and the Challenges board lists the four starter challenges.
- [ ] **Demo seed, local database only.** `npm run seed` and `npm run seed:demo` create two fixture teams (Demo Alpha, Demo Beta,
      invite codes `SEEDAA`, `SEEDBB`) with a few solves, and they are **not login accounts** (`README.md`, Demo seed data).
      **Not on the real database** (`docs/RELEASE_CHECKLIST.md` step 3). On Atlas, make the two teams by hand with the two
      player accounts; that is also the better demo because the audience sees the real create and join flow.
- [ ] **Admin group.** `<admin email>` is in the Cognito group `admin`; sign out and in again after adding it. Check: `/admin` opens.
- [ ] **Teams.** Player A created Team Red; Player B created Team Blue (or joins with the invite code live, 30 seconds, optional).
- [ ] **Progress on Team Red.** Keep the first Arena Terminal easy code open for the live story moment. Capture nothing in Crackme (h1 is open from the start, `docs/CRACKME_ARCADE.md` Rules). Pre-capture one or two
      Cipher Lab levels only if you want a player to show the workbench; otherwise use the admin preview (every tool unlocked).
- [ ] **Event schedule.** In Admin, Settings, Scheduled event: name `Demo Cup`, start = now minus 30 minutes, freeze = demo minute 9
      (clock time, in your browser time zone), end = start plus 3 hours. Save. Check: the bar under the header reads "live - ends in ...",
      `curl -s <URL>/api/event` shows `"phase":"live"` (`docs/EVENT_MODE.md` operator runbook). Remember that while an event is
      configured, no flag can be submitted before the start or after the end anywhere, including The Range. **After the demo clear
      the event** or practice stays closed.
- [ ] **Announcement banner** (optional): "Demo Cup, live" in Settings.
- [ ] **Theme.** Both devices set to the theme you open with (light), and the System selector in the footer checked. The dark
      theme switch is a live moment.
- [ ] **Phone.** Authenticator app has the Player A entry; phone on a hotspot (not the venue Wi-Fi), brightness up, auto-lock off.
      Phone browser is signed out so the sign-in is live.
- [ ] **Laptop.** Zoom 100%, notifications off, one browser window per account (three profiles), tabs pre-opened in the order of
      section 3, the stub harness and the backup video on the desktop (section 5).

### Warm-up (avoids a Vercel cold start in front of the audience)
Cold starts add "a few hundred milliseconds" on Vercel (`docs/DEPLOY_VERCEL.md` section 7) and the first request also opens a
new database connection. Cheap insurance, 10 and 2 minutes before:
```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" <URL>/api/health; done
curl -s <URL>/api/event; curl -s <URL>/api/announcement
```
Then load every page of section 3 once while signed in as Player A (this also warms the lazy page chunks and the API function for
the category, leaderboard and admin routers). Do the same signed in as Admin for `/admin` and Settings. Keep one request every
few minutes going until you start (a browser tab on `/leaderboard` polls every 10 s on its own).

### Final minute
- [ ] `curl <URL>/api/health` is `status: ok`, `db: up`, `indexes: ok`.
- [ ] Player A and B are signed in on their devices except the phone sign-in you will do live.
- [ ] Backup video file opens; stub harness server is running on `127.0.0.1` (section 5).

## 3. The script, with timings

Total 11:45 with Segment L, 10:30 without it. Times are the clock on the slide timer, not a promise to the second.
"Say" lines are meant to be paraphrased, one or two sentences each.

### 0:00 to 0:45 - Pitch and architecture (slide 1 to 3, or `<URL>/demo`)
- **Show:** slide with the architecture picture (hosted mode: browser, Vercel CDN, one serverless function, Atlas, Cognito).
- **Say:** "CTF Arena is a cloud-hosted capture-the-flag platform. Two sides: the Arena, which is the competition, with teams, a live
  leaderboard and scheduled events; and the Range, which is practice, six categories of simulated, browser-playable flags. Four
  cloud services carry it: Cognito for identity and MFA, MongoDB Atlas for data, Docker with Nginx for scaling, Vercel for hosting."
- **Cloud service shown:** all four (`README.md`, The four cloud services).

### 0:45 to 2:00 - Sign-in with MFA on the phone (IAM + MFA)
- **Do:** on the phone, open `<URL>/login`, sign in as Player A with the password, then enter the 6-digit code from the
  authenticator app. Show the laptop mirror or a second camera on the phone screen.
- **Say:** "No password is stored by us. Cognito does sign-up, e-mail verification, the password policy and the TOTP code. Our backend
  only verifies the signed token and reads the group from it."
- **Show on phone:** the Home page, the dark theme switch (moon icon in the header), the Range hub. This is the **device support**
  moment: 44 px touch targets, no sideways scrolling (`docs/DEVICE_COMPATIBILITY.md`).
- **Wow 1 (dark theme):** tap the switch on the phone, then on the laptop. Say: "Both themes were audited for contrast, 0 text
  offenders under 4.5:1 across 66 shell scenes and 417 play screens in dark" (`docs/PROGRESS.md`, Dark theme row).
- **Cloud service shown:** IAM + MFA.

### 2:00 to 2:30 - Roles
- **Do:** on Player A, type `<URL>/admin`. It redirects to Home. Open the admin window, `<URL>/admin`, show Overview.
- **Say:** "Role comes only from the verified Cognito group. The server returns 403 on every `/api/admin` route for a player; the
  redirect is a convenience."
- **Cloud service shown:** IAM roles.

### 2:30 to 3:15 - The Range hub and first-run guidance
- **Do:** `<URL>/range`. Point at the six cards and the "Capture your first flag" checklist. Open `<URL>/skills` for ten seconds.
- **Say:** "Every flag is derived per team, so a flag or a walkthrough copied from another team does not work. The Skills page maps
  each flag to OWASP Top 10, MITRE ATT&CK and NICE categories; those are our judgement and we say so on the page"
  (`docs/SKILLS_MAP.md`, honesty notes).
- **Numbers on screen:** 98 flags and 11,735 points across the six categories (sum of the category tables in `README.md`).

### 3:15 to 5:00 - Wow 2: Arena Terminal and its story
- **Do:** `<URL>/terminal/easy` as Player A (Team Red). Show the prompt `guest@arena:~$`, run `ls`, `cat` a file, then
  `mail` (the welcome message) and `motd`. Use the `Hints` button once to show the hint ladder. Hints cost points (5 percent of the code's points for the first tier by default, price shown and confirmed first, deducted when the code is captured), so expect a small deduction on the demo team. Capture the first code with
  `[OWNER: the two or three commands for easy code 1]`.
- **Do next:** after the correct code the page prints "You have new mail". Run `mail` again: a new message reacts to the code,
  and `/var/log/novi.log` has a line about it. Say the three modes are one plot: the intern's laptop, the NovaCorp server
  room, the Vault ([`docs/ARENA_TERMINAL.md`](ARENA_TERMINAL.md) section 18).
- **Say:** "Nothing real is executed. The shell is an interpreter over a virtual file system, and the story is a pure function of
  the team's seed and its progress, so it needs no new database state and any replica builds the same bytes."
- **Show:** one fair-play detail only if asked: typing `ai-verify` is a trap for automated assistants and is only recorded for
  an admin to review (`docs/FAIR_PLAY.md`). Do **not** type it live.

### 5:00 to 6:30 - Wow 3: Crackme time-travel debugger and Patch Bay
- **Do:** `<URL>/reversing/h1` (hard track). Show the disassembly, then the flow graph that follows the program counter.
  Step forward with `S`, step **back** with `B`, drag the slider to an earlier step. Show "What changed" and "What decided it"
  with its "Go to that step" button.
- **Do next:** open the Patch Bay tab (hard and insane cabinets only). Flip one `JNZ` to `JZ` and press the check. Say the result
  is `passed`/`total` out of 6 hidden inputs and the real serial must still be accepted.
- **Say:** "The machine is a made-up stack machine, deterministic, so the past is rebuilt rather than stored. The server runs its own
  copy of the machine on your answer. The Patch Bay gives a cosmetic badge and no points, so the category maximum, 1905, cannot
  move" (`docs/CRACKME_ARCADE.md`).
- If time is short, show only the step-back and skip the patch.

### 6:30 to 7:15 - Wow 4: OSINT board
- **Do:** `<URL>/osint/easy`. Search once, open "Pin to board" on two items, switch to the Case board tab, draw one link between
  two pins with a relation type. Mention the board is shared by the team: show it appear on Player B's side only if B is in Team Red;
  otherwise skip that line.
- **Say:** "The world is fully fictional and generated per team: invented people, town, company and network. The final question
  stays locked until the board has held the hidden chain once. The server tells you only a coarse level, `started` or `close`, never
  an exact count, because an exact count let a tester recover the chain by group testing. We measured that in the security
  review" (`docs/SECURITY_REVIEW_2.md` finding 3).

### 7:15 to 8:00 - Wow 5: Forensics timeline and packet viewer
- **Do:** `<URL>/forensics/medium` (or the admin preview if the track is locked). In the packet table click one packet: the layer
  tree opens, a field highlights its bytes, then "Follow stream" (CLIENT > and SERVER < segments). Type a display filter such as
  `dns && ip.addr == <an address you see>`. Then pin two items to the timeline board and show the "Contradiction found" marker if
  the pair you pinned has one (the generated clue is in the VPN session lines and the `GET /time` pairs, `docs/FORENSICS_DESK.md`).
- **Say:** "The log has 1,500 lines and the capture 2,400 packets on the first two cases, generated from the team seed and served by
  page, so a page costs the same however large the artefact is."

### 8:00 to 8:30 - Wow 6: Cipher Lab workbench
- **Do:** with the **admin preview** (every tool unlocked) or a prepared player: `<URL>/cipherlab`, open a level, open the
  workbench, chain `From Base64`, `From Hex`, `Caesar shift back`, show the output after each step, press "Magic".
- **Say:** "Chained recipes like in CyberChef, but gated: a tool only unlocks after the level that teaches it, and Magic suggests,
  it never decodes for you" (`docs/CIPHER_LAB.md`).

### 8:30 to 9:15 - Teams and the live leaderboard (second device)
- **Do:** on Player B (Team Blue), capture one flag you prepared (one Cipher Lab level or a Challenges flag). On Player A's laptop
  `<URL>/leaderboard`: the row moves within 10 seconds and Team Red is highlighted; show the score-over-time chart.
- **Say:** "The leaderboard polls every 10 seconds and each backend instance caches the ranking for 5 seconds, so a burst of players
  costs the database one aggregation per instance" (`docs/QUERY_PERFORMANCE.md`).
- **Cloud service shown:** DBaaS.

### 9:15 to 10:15 - Wow 7: event mode, countdown and frozen scoreboard
- **Do:** point at the bar under the header: "Demo Cup - live - ends in ...". At the freeze time (demo minute 9 as scheduled; if it
  has not arrived, in the admin window move the freeze time earlier and save: moving it earlier freezes at the new time) Player A's
  Leaderboard shows "Scoreboard frozen at HH:MM". Player B captures a second flag. Player A's board does **not** change and shows
  its own live score privately; the admin's board shows live standings.
- **Say:** "The phase is derived on every request from three timestamps, with no timers, so every replica and every serverless
  invocation agrees. A frozen player view never leaks live data: the feed, profiles and solve counts are cut at the freeze as
  well. We found that leak in our second review and fixed it" (`docs/EVENT_MODE.md`, `docs/SECURITY_REVIEW_2.md` findings 1 and 2).
- **Optional:** show `curl -s <URL>/api/event` in a terminal: `phase`, `serverTime`.

### Segment L (optional, 10:15 to 11:30) - Docker, scaling and the load test, local mode
Hosted Vercel cannot run Docker challenges (`DOCKER_ENABLED=false`, the Start button is disabled with a clear message,
`docs/DEPLOY_VERCEL.md` section 7). The brief's Docker and scaling items are shown on the laptop stack, `http://localhost`,
or from the recorded clip (section 5) if Docker is not ready. Steps (from `docs/DEMO_AND_REPORT.md` section 2 and
`deploy/loadtest/README.md`):
1. Footer "Served by": refresh three times, the replica id changes between the three backend replicas.
2. `docker compose up -d --scale backend=5`, wait about 15 s (Nginx re-resolves the service every 10 s), refresh: new ids appear.
3. Show the load-test table (laptop numbers, `docs/DEMO_AND_REPORT.md` section 5): 1,893 req/s at 1 replica, 3,016 at 3,
   3,626 at 5; p95 43.9, 45.2, 45.4 ms. Say they are indicative: the load generator ran on the same laptop and the CPU runs out first.
   `[RESULT]` hosted-site result: fill in from `docs/LOADTEST.md` if it exists when you present.
4. Start the Cookie Monster instance, `docker ps` shows the labelled container with limits; Admin kills it, `docker ps` shows it gone.
- **Say:** "Replicas are stateless: rate limits, sessions and counters live in MongoDB, and ports are claimed by a unique index."

### 11:30 to 12:00 - Close (summary slide)
- **Show:** the final slide: four cloud services, three phases, the test and audit numbers (section 7 of `docs/REPORT.md`).
- **Say:** "Built in three phases by three people, then extended with six categories, event mode, a learning layer, dark theme and
  a device pass. Honest limits: the real-login and real-device checks are still open, and the load test ran on a laptop."
- **Clear the event** in Admin Settings (Clear, then Save) after the presentation.

### Tool unlocks (so the rehearsal does not surprise you)
- Cipher Lab: the workbench (`pipeline` tool) opens when level h3 is solved; the admin preview has every tool unlocked
  (`docs/CIPHER_LAB.md`).
- Crackme: inside a track a cabinet opens when the one before it is solved; the first cabinet of every track is open; Patch Bay is on
  the hard and insane cabinets (`docs/CRACKME_ARCADE.md`).
- Terminal: story mail beyond the welcome message appears when a code is solved (`docs/ARENA_TERMINAL.md` section 18).
- OSINT final question and Forensics whodunit stay locked until the other questions are solved; do not try them live.

## 4. Wow-moment cheat sheet (what to say if you only have 20 seconds each)

| Moment | One-line claim | Proof on screen | Doc |
|--------|----------------|-----------------|-----|
| Terminal story | the mail and log react to your captures, with no new state | `mail` before and after a code | `docs/ARENA_TERMINAL.md` s18 |
| Time-travel debugger | step back through a deterministic machine | slider, `B` key, "What decided it" | `docs/CRACKME_ARCADE.md` |
| Patch Bay | edit a program so hidden inputs pass; no points | `passed`/`total` result | `docs/CRACKME_ARCADE.md` |
| OSINT board | evidence graph, final question gated by the chain | pins and links, coarse `started` level | `docs/OSINT_TRAIL.md` s3b |
| Forensics | packet layers, follow stream, filter, timeline contradictions | detail pane with byte highlight | `docs/FORENSICS_DESK.md` |
| Cipher workbench | chain decoders and see each step | step outputs | `docs/CIPHER_LAB.md` |
| Event mode | derived phase, frozen board, 423 refusals | banner, "Scoreboard frozen at" | `docs/EVENT_MODE.md` |
| Dark theme | tokens, no flash, audited contrast | toggle on phone and laptop | `docs/THEMING.md` |
| Devices | 44 px targets, zero sideways scroll down to 160 CSS px | phone in hand | `docs/DEVICE_COMPATIBILITY.md` |

## 5. Backup plan

### Decision rule
- If a live step fails twice, say one sentence ("the hosted function is cold, here is the same step from the recording") and switch.
  Do not debug on stage.
- Switch order: (1) retry in a second tab or the other account, (2) the stub harness (offline fallback), (3) the backup video.

### Offline fallback: the stub harness (`docs/harness`)
The harness serves the real frontend with stubbed sign-in and stubbed API responses, so it needs no network, no Cognito, no Atlas and no
Vercel (`docs/harness/vite.config.js` header comment). Pages render with stub data, so use it to show screens and tools, not a
real capture. Start it before the demo, from the repository root (needs the frontend dependencies installed):
```bash
cd docs/harness
PORT=5480 node ../../frontend/node_modules/vite/bin/vite.js --config vite.config.js
```
Open `http://127.0.0.1:5480/`. Add `?as=admin` to act as the admin, `?as=player` (default) as a player, `?as=mfa` or `?as=mfa-setup` for
the MFA screens (`docs/harness/stubAuth.jsx`). What works and what does not:

| Works with the stub | Does not work with the stub |
|---------------------|-----------------------------|
| Range hub, six overview pages, play screens of every category, hints, debugger, packet viewer, timeline, workbench, dark theme, layout on phone sizes | real sign-in and TOTP, real captures and points, the live leaderboard moving, the event phases (the stub answers for the pages, check the page you need), Atlas data |

Which pages the stub data fills with content (the packet table and the Crackme listing render empty in some stub states,
`docs/PERFORMANCE.md` table note) is [CHECK]: open each page you plan to show offline during the rehearsal and note the ones that look empty.
A production-build variant with the Vercel headers is `docs/harness/perfserver.cjs` (`DIST=<dir> PORT=5491 node perfserver.cjs`).

Also offline-safe: `<URL>/demo` (the "Demo playoff") is a scripted, client-side simulation of one full match between two teams: sign-in,
instance start, solve, leaderboard, replicas. It makes no network calls (`frontend/src/demo/demoScript.js` header). Use it as the
fallback for the architecture and the Docker story if the live stack is down.

Local full stack as a second fallback: `docker compose up -d --build` with the local database overlay
(`docs/SETUP.md` section 6b) gives `http://localhost` with seeded data, and `npm run seed && npm run seed:demo` for demo teams.

### Backup video: 3 minutes, shot list
Record it before the day, at 1080p, with the real hosted site if it works (it will not exist until the first deploy), else the local stack.
Voice-over recorded separately. Keep each shot short.

| Time | Shot | Voice-over (one sentence) |
|------|------|---------------------------|
| 0:00 to 0:15 | title, then the architecture picture | what it is and the four cloud services |
| 0:15 to 0:40 | phone: password, 6-digit code, Home, dark theme toggle | MFA through Cognito, device support |
| 0:40 to 0:55 | player redirected from `/admin`; admin overview | roles from the verified token |
| 0:55 to 1:25 | Arena Terminal: `ls`, `cat`, capture, "new mail", `mail` | the reactive story |
| 1:25 to 1:50 | Crackme: step back, "What decided it", Patch Bay result | time-travel and Patch Bay |
| 1:50 to 2:05 | OSINT board: pin and link | the evidence board |
| 2:05 to 2:20 | Forensics: packet detail, follow stream, timeline marker | packet viewer and timeline |
| 2:20 to 2:30 | Cipher Lab workbench chain | recipe workbench |
| 2:30 to 2:50 | leaderboard moving, then the frozen board and banner | live standings, event mode |
| 2:50 to 3:00 | local stack: footer replica ids, `--scale backend=5`, `docker ps`, kill | scaling and Docker (local mode) |

## 6. What could go wrong

| Risk | Likelihood | Symptom | Prevention | If it happens |
|------|-----------|---------|------------|----------------|
| Vercel cold start | medium | first page or API call takes a second or more | warm-up loop and page load pass (section 2) | refresh once; say "cold function, warm now" |
| Missing environment variable on Vercel | low if smoke-tested | API answers 503 `SERVICE_UNAVAILABLE` | `docs/RELEASE_CHECKLIST.md` smoke test | switch to the local stack or harness |
| Atlas network access blocks the function | low | 503 and function log lists the failure | Network Access allows the Vercel range (`docs/DEPLOY_VERCEL.md` s3) | local stack with the local database overlay |
| `indexes: missing` | medium until `db:indexes` is run | unique constraints absent, health shows `missing` | run `npm run db:indexes`, check health | rehearse after it flips to `ok` (up to 5 minutes) |
| Cognito callback URL not set for the Vercel URL | medium on first deploy | sign-in works locally, fails hosted | `docs/DEPLOY_VERCEL.md` s4: exact URLs | use the harness for the sign-in screens, video for the real one |
| TOTP code rejected (phone clock drift) | low | "code mismatch" | phone on automatic time, code entered in the first half of its 30 s | wait for the next code; second account as spare |
| Phone loses network | medium | stuck on sign-in | hotspot tested, Player A already signed in on the laptop as a spare | continue on the laptop, show the phone from the video |
| Event configured but start/end wrong | medium | submits answer 423 `EVENT_NOT_STARTED` or `EVENT_ENDED` | check the bar and `/api/event` before starting | Admin Settings, move the times, saves apply on the next request |
| Freeze time passed already | medium | board is frozen from the start | schedule the freeze for demo minute 9 | move `freezeAt` later: it un-freezes at once (`docs/EVENT_MODE.md`) |
| Terminal rate limit 429 `SLOW_DOWN` | low | "Easy there, speed typist" | type, do not paste scripts; 300 ms between commands | wait a second |
| Locked track or cabinet | medium | 403 `STAGE_LOCKED` or locked tile | rehearse the exact path (section 3 unlock notes) | admin preview |
| Seed missing for a category | medium | category shows nothing open | check `/range` first | run `npm run seed:<category>`; or skip the segment |
| Leaderboard does not move | low | board stuck | 10 s poll, 5 s cache per instance | wait 15 s; check the freeze state first |
| Docker Desktop not running (Segment L) | medium | `docker compose` fails | start it 10 minutes before | play the clip |
| Replica ids look the same | low | only one replica | wait 15 s after scaling; scale from 3 to 5 not from 1 | `docker compose ps`, probe loop from `deploy/loadtest/README.md` |
| Real-login or real-device bug nobody has seen | unknown | anything | agents tested with stubbed sign-in and emulated devices only (`docs/PROGRESS.md` known limits); rehearse the full flow on the real phone at least once | fall back as above; say so honestly |
| Hosted deploy does not exist yet | certain until P4-05 | no `<URL>` | owner action P4-05, `docs/TASKS.md` | present from the local stack plus harness |

## 7. After the demo
- [ ] Admin Settings: clear the event (Clear, Save), clear the announcement.
- [ ] Remove the demo teams from the real database if you created extra ones (Admin, Teams).
- [ ] Note any bug you saw in `docs/FIXLOG.md` (owner or fixer agent).

## 8. Rehearsal log (fill in)
| Date | Run | Total time | What failed | Fixed? |
|------|-----|------------|-------------|--------|
| | 1 | | | |
| | 2 | | | |

## 9. Which brief success criterion each step covers (`docs/PROJECT_BRIEF.md` section 7)

| Criterion | Where in the script |
|-----------|---------------------|
| Log in on a phone with the authenticator code | 0:45 |
| Start a challenge, open its URL, solve, submit, score appears | Segment L (Docker, local); on the hosted site the terminal capture at 3:15 covers solve, submit, score |
| Leaderboard updates for a second team on another device | 8:30 |
| Footer shows `Served by <replica>` and changes | Segment L; on Vercel the header shows the function host name (`docs/DEPLOY_VERCEL.md` s7) |
| Load test, then `--scale backend=5` | Segment L |
| Admin kills a running instance and the container disappears | Segment L |
| Site opens from a public URL | `<URL>` after the first deploy (open owner action) |
