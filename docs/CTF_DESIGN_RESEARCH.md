# CTF design research: making CTF Arena exciting, coherent and credible

Status: research note (no code changed). Date of research: 2026-11-22.
Method: web searches and a few page fetches on public sources, plus a read of this repo (README, `docs/PROJECT_BRIEF.md`,
`frontend/src/games/registry.js`, the nav in `frontend/src/layout/Layout.jsx`, `docs/ACHIEVEMENTS.md`, doc titles).
Convention: **[S#]** points to the source list. Anything marked **(Opinion)** is my judgement, not a finding. Where a
search returned nothing, I say so instead of filling the gap from memory.

## 1. Summary

- CTF platforms split into three families: **event boards** (CTFd, picoCTF during the contest, Google CTF, CSAW),
  **always-on learning platforms** (TryHackMe, HTB Academy, PortSwigger, pwn.college, OverTheWire) and **ranked
  competitive ladders** (HTB Seasons, TryHackMe Leagues). CTF Arena today is a Jeopardy-style board plus six
  interactive practice categories, so it is a hybrid of the first two. It has no event/season layer yet. [S1][S2][S3][S6][S7]
- The mechanics with the best documentation are: dynamic scoring (CTFd), paid hints (CTFd), first blood (HTB, TryHackMe
  leagues), streaks with freezes (TryHackMe), weekly promotion/relegation leagues (TryHackMe), seasonal resets (HTB),
  belts/ordered curricula (pwn.college), learning paths (PortSwigger, TryHackMe) and per-team flags (picoCTF research,
  GZCTF, rCTF). [S1][S4][S5][S8][S9][S12][S15][S16]
- Evidence that gamification helps is positive but thin: studies mostly report self-reported engagement and motivation, not
  controlled learning outcomes. Do not claim more than that in the report. [S17]
- Employers and educators recognise **NICE** work-role/skill tagging (NCL, NIST competition catalog), **MITRE ATT&CK** and
  **OWASP** vocabulary (HTB business offering). No standard OWASP-to-CTF mapping exists; we would build our own. [S18]
- You already have much of the engagement layer (badges, streaks, first blood, hints in two games, fair-play page, freeze
  flag). The biggest gaps are: a **coherent vocabulary and one hub**, **hint costs surfaced consistently**, **a
  skills/framework tag per level**, **an event mode (countdown, scheduled freeze)**, **a weekly/seasonal ladder**, and
  **a first-run onboarding path**.

## 2. Sources (URL per claim)

| ID | URL | What it supports (and what it does not) |
|----|-----|------------------------------------------|
| S1 | https://docs.ctfd.io/docs/custom-challenges/dynamic-value | CTFd dynamic scoring: parabolic decay, parameters initial / decay (solves to reach minimum) / minimum; formula `((min-initial)/decay^2)*solves^2 + initial`, rounded up, floored at minimum. Hidden teams do not affect scoring. |
| S2 | https://github.com/CTFd/CTFd/blob/master/CHANGELOG.md and https://blog.ctfd.io/ctfd-3-8-0/ | CTFd also offers linear and logarithmic decay; 3.8 folded dynamic scoring into the standard challenge type. Hints must be unlocked (timestamped). Hint unlock during freeze was a fixed bug. |
| S3 | https://docs.ctfd.io/docs/challenges/hints | Hints can be free or cost points; unlocking subtracts the cost; players cannot unlock without enough points; docs suggest an intro "gimme" challenge so players can earn points to spend. |
| S4 | https://help.tryhackme.com/en/articles/10517530-tryhackme-leagues | TryHackMe Leagues: 7 tiers (Bronze to Diamond), weekly Monday-to-Monday UTC, 2 rooms to qualify, ~30 players in low tiers and 10-20 higher, promotion and demotion by rank, top-3 bonus points, first completer bonus, league badge, 2-week inactivity grace. |
| S5 | https://help.tryhackme.com/en/articles/7843540-streaks-streak-freezes-and-dodging-the-reset-button | Streak = consecutive days answering a question; badges at 7 and 30 days; streak freezes (earned by milestones) auto-protect a missed day; 24 h to recover; occasional repair. |
| S6 | https://www.hackthebox.com/blog/htb-seasons-announcement and https://www.hackthebox.com/blog/htb-season-10-underground | HTB Seasons: time-limited (about 13 weeks), weekly Machine releases Easy to Insane, points reset to zero each season, first-blood bonus per flag. |
| S7 | https://help.hackthebox.com/en/articles/5185158-introduction-to-htb-labs and https://www.hackthebox.com/blog/xp-points | HTB defines first blood as the first solver of a newly released Machine/Challenge; only Active content scores; a unified XP system (Machines, Challenges, Academy) was announced 2026-04 (details not read). |
| S8 | https://www.picoctf.com/pdfs/FINAL_CISSE_paper.pdf (search snippet only; the PDF could not be fetched) and https://picoctf.com/research.html | picoCTF goals: authentic, fun, interactive introduction to security; younger audience; learning guides; "on-ramp" challenges in almost every category; gives participants the tools needed. |
| S9 | https://www.usenix.org/system/files/conference/3gse15/3gse15-burket.pdf | picoCTF 2014 study: about 0.8% of submissions to auto-generated problems were copied flags, 14% of teams submitted at least one, mostly same-school teams; 68% of sharers later solved on their own. Per-team generated instances are the countermeasure. |
| S10 | https://www.cmu.edu/news/stories/archives/2024/june/cmus-picoctf-seeks-to-make-cybersecurity-education-more-accessible | picoCTF grew from a yearly contest into a year-round educational platform. |
| S11 | https://www.enisa.europa.eu/sites/default/files/publications/ENISA%20Report%20-%20CTF%20Events.pdf , https://ctfd.io/whats-a-ctf/ , https://ctf-wiki.org/en/introduction/mode/ | Format definitions: Jeopardy (independent challenges by category; most common and easiest to run), attack-defense (own "gamebox", attack others and patch own), king-of-the-hill (hold a target longest). Search results did not describe Google CTF or CSAW formats; I make no claim about them beyond NIST tagging CSAW with NICE areas (S18). Claim that DEF CON finals added KotH in 2025 came from one secondary blog: unverified. |
| S12 | https://pwn.college/dojos and https://static.pwn.college | pwn.college organises content into "dojos" taken in order, with belts (white, yellow, then higher; sources disagree on exact belt count). |
| S13 | https://portswigger.net/web-security/learning-path and https://portswigger.net/blog/new-learning-paths-from-the-web-security-academy | PortSwigger offers topic pages with labs ordered easy to hard and guided learning paths created because beginners did not know where to start. Official OverTheWire pages were not retrieved; Bandit-first-then-Natas/Krypton progression comes from secondary guides (e.g. https://hackerdna.com/blog/guia-overthewire-wargames). |
| S14 | https://www.hackthebox.com/blog/cyber-apocalypse-2024-event-recap , https://www.hackthebox.com/events/cyber-apocalypse-2025 , https://tryhackme.com/downtime | HTB's Cyber Apocalypse uses a new narrative theme every year (2022 chase, 2023 "The Cursed Mission", 2024 "Hacker Royale", 2025 "Tales from Eldoria"); TryHackMe "Downtime" is a team-based defensive CTF framed as a game studio under attack. "Battlegrounds" is an HTB product name (a private-tournament / team product), not a TryHackMe one. |
| S15 | https://cloud.google.com/blog/topics/threat-intelligence/announcing-tenth-flare-on-challenge and https://cloud.google.com/blog/topics/threat-intelligence/announcing-eleventh-annual-flare-on-challenge/ | Flare-On: annual single-player reverse-engineering contest, about six weeks, 10-13 escalating challenges, recognition rather than fixed cash, past challenges and solutions stay available. First edition 2014: 7,140 participants, 226 finishers. |
| S16 | https://rctf.osec.io/providers/flags and https://www.mintlify.com/GZTimeWalker/GZCTF/concepts/challenges | Per-team dynamic flags; rCTF can accept another team's flag but mark the solve as cheated (detect rather than block); GZCTF dynamic attachments/containers to prevent sharing. Community threads note people just share solution steps (forum, anecdotal). |
| S17 | https://orca.cardiff.ac.uk/id/eprint/166211/ , https://link.springer.com/article/10.1007/s10758-024-09769-8 , https://trepo.tuni.fi/handle/10024/231567 | Open-ended and story-based CTFs received positive feedback, including from non-cyber students; reviews find engagement/motivation/satisfaction are the usual metrics and strong outcome evidence is limited. I did not read results of the Tampere thesis. |
| S18 | https://www.nist.gov/itl/applied-cybersecurity/nice/community/community-coordinating-council/cybersecurity-skills-0 , https://www.nist.gov/document/guide-cybersecurity-competitors , https://arxiv.org/html/2501.11685v1 , https://ar5iv.labs.arxiv.org/html/2101.01421 , https://hackthebox.com/business/business-ctf , https://uscybergames.com/news/utilizing-attack-and-ctfs-for-learning-cyber | NIST catalogs competitions with NICE categories; NCL ties challenges to NICE skill statements; research maps CTF content to CWE/ATT&CK/OWASP Mobile Top 10/NICE; HTB advertises ATT&CK and NICE mapping; US Cyber Games suggests listing ATT&CK TTPs in challenges. No published OWASP Top 10 to CTF mapping found. |
| S19 | https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-without-color.html | WCAG 1.4.1 (Level A): colour must not be the only way to convey information. The terminal and difficulty-colour implications are my extrapolation (Opinion). |
| S20 | https://undercodetesting.com/tryhackmes-leaderboard-crisis-when-gamification-undermines-cybersecurity-credibility-video/ | Third-party, unverified claim that league farming (delaying submissions to join weak leagues) happened. Cited only as a risk to design against; not confirmed by TryHackMe. |

| S21 | https://www.gameanalytics.com/blog/mid-core-success-part-1-core-loops , https://www.gameanalytics.com/blog/how-to-perfect-your-games-core-loop , https://unity.com/glossary/core-game-loop , https://gdevelop.io/blog/casual-game-loops | Core loop = the most repeated action cycle; meta loops sit around it on longer timescales (seasonal quests, cosmetics); short repeated sessions build habit; one guide says casual loops should take under 30 s; "dual loop" lets players stop after one loop or continue. No source gave a canonical 10-minute or weekly retention benchmark. |
| S22 | https://www.vice.com/en/article/how-to-make-a-good-hacking-game-when-the-reality-is-massively-dull , https://pcgamer.com/hacknet-is-a-hacking-game-with-real-hacking , https://store.steampowered.com/app/365450/Hacknet/ | Hacknet: simulated Unix-like OS with a real-feeling terminal plus a graphical layer; teaches some real commands; design priority is the sensation of hacking over literal accuracy. Uplink, Zachtronics titles and Papers, Please were NOT retrieved: mentions below are general knowledge (Opinion). |
| S23 | https://emshort.blog/2019/06/06/return-of-the-obra-dinn-lucas-pope/ , https://www.pcgamer.com/everything-changed-between-return-of-the-obra-dinns-demo-and-launch , https://www.gamedeveloper.com/design/for-lucas-pope-i-return-of-the-obra-dinn-i-was-a-bunch-of-appealing-design-problems | Obra Dinn: deduction game that confirms correct fates in batches of three, avoiding per-guess trial and error; critics note verification can leak information. Mixed source quality (reviews, blogs). |
| S24 | https://www.gameanalytics.com/blog/squeezing-more-juice-out-of-your-game-design , https://arxiv.org/pdf/2011.09201 , https://molbv.github.io/blog/2025-06-24-juice-polish.html | "Juice": amplifying feedback relative to input (GDC 2012 "Juice it or lose it"); short shake (about 0.1-0.3 s), restraint with particles, varied synchronised sound; effects should echo the core gameplay. Mostly developer blogs. |
| S25 | https://roomescapeartist.com/2019/10/24/escape-room-hint-systems/ , https://brycecovert.github.io/adventure-game-designer-handbook/docs/faq.html , https://faculty.washington.edu/weicaics/paper/papers/HaoHZC2022.pdf | Escape-room and adventure design: graduated hints (3-5 levels), hint frequency as a diagnostic (a puzzle needing a hint half the time is broken), do not raise difficulty by adding tedium; one study found 68.3% of players used hints when stuck and built stuck detection. Practitioner opinion plus one paper. |
| S26 | https://snyk.io/articles/ctf/ctf-tools/ , https://ctf101.org/faq/recommended-software/ , https://hackerdna.com/blog/outils-ctf | Tools players actually reach for by category: Burp Suite (web), CyberChef incl. Magic operation (crypto/encoding), Autopsy / Wireshark / binwalk / volatility (forensics), Ghidra / GDB (reversing), any hex editor. These are recommendation lists, not usage surveys. |

Not covered by any source I could retrieve: Google CTF design, CSAW internals, DEF CON CTF scoring details, mobile UX studies
of CTF platforms, PortSwigger's own page text beyond search snippets. Those parts of the brief are answered from
general knowledge and flagged as Opinion below.

## 3. Platform comparison

| Platform | Model | Unit names | Scoring / mechanics (sourced) | Retention / social | Credibility signal | Lesson for us |
|----------|-------|-----------|-------------------------------|--------------------|--------------------|---------------|
| CTFd (engine behind many events) [S1][S2][S3] | Event Jeopardy board | Challenges, categories | Dynamic decay (parabolic/linear/log), free or paid hints, freeze, hidden teams | Team boards | De facto standard for organisers | Our scoring and hints should be explainable in CTFd terms |
| TryHackMe [S4][S5] | Always-on learning | Rooms, paths, leagues, streaks | Points per room, first-completer bonus, weekly leagues with promotion/relegation | Daily streak + freezes, badges | Browser labs, approachable | Streak freezes and weekly leagues are the proven retention loop |
| Hack The Box [S6][S7] | Machines/challenges + seasons + Academy | Labs, Machines, Seasons, Academy, Battlegrounds | Seasonal reset, first blood, difficulty Easy to Insane, unified XP | Season ladder, prizes | Pro/employer brand, ATT&CK/NICE mapping (business) | Seasons give a reason to return; first blood needs a visible stamp |
| picoCTF [S8][S9][S10] | Annual contest turned year-round | Problems, "on-ramp" | Storyline, learning guides, auto-generated per-team problems | School teams | Run by a university; research-backed | Best model for beginners and for anti-sharing design |
| pwn.college [S12] | Curriculum | Dojos, belts | Ordered modules, belts | Course/community dojos | Academic (ASU) | Belts are a ready-made, credible rank metaphor |
| PortSwigger Web Security Academy [S13] | Learning labs | Topics, labs, learning paths | Labs ordered easy to hard, guided paths | Progress dashboard | Made by the Burp Suite vendor | Guided paths beat a flat list for newcomers |
| OverTheWire [S13] | Wargames | Wargames (Bandit, Natas...), levels | Each level's password unlocks the next | Community | Old-school respect | "Wargame" and "level" are credible words with gamers and pros |
| Flare-On [S15] | Annual solo contest | Challenges | Escalating 10-13 challenges, finisher recognition | Hall of fame, public solutions | Industry malware analysts | Prestige can be recognition, not money; keep old levels as practice |
| HTB Cyber Apocalypse [S14] | Themed team event | Challenges | New story each year | Huge team event | Narrative framing | One narrative skin per event is cheap and memorable |

## 4. What the evidence says, by topic

**Engagement.** Common elements across the sources: an on-ramp for beginners (picoCTF), ordered difficulty (PortSwigger,
OverTheWire, Flare-On), visible rank/progress (HTB, TryHackMe, pwn.college) and a recurring reason to return (streaks,
weekly leagues, seasons, annual events). Studies of story-based and open-ended CTFs report good engagement. [S4][S5][S6][S8][S12][S13][S15][S17]

**Mechanics that are documented.**
- Dynamic scoring: points drop as more teams solve. CTFd gives the formula, so ours can be equivalent and tested. [S1]
- Hints: cost points, require enough points, and the docs recommend a free early challenge to fund them. [S3]
- First blood: HTB and TryHackMe both give a bonus to the first solver. [S4][S6][S7]
- Streaks and freezes: freeze avoids punishing one missed day; earned, not bought. [S5]
- Leagues: small cohorts (about 30 or fewer), weekly, promotion/relegation, inactivity grace; also a reported abuse pattern (S20, unverified). [S4][S20]
- Formats: attack-defense and king-of-the-hill need per-team infrastructure and are far less common than Jeopardy. [S11]
  **(Opinion)** For a small project on Vercel with local-only Docker, a Jeopardy board plus a short "king of the hill" style
  mini-event (hold a top rank for a window) is as far as it is wise to go.
- Narrative: HTB re-themes its flagship event yearly; a Cardiff study found story-based CTFs well received. [S14][S17]
- Write-up culture: Flare-On publishes past challenges and solutions; HTB Academy pairs machines with write-ups. [S7][S15]
  This repo already has a "no shared solutions" fair-play stance (`docs/FAIR_PLAY.md`), so write-ups should be released
  **after** an event or per-level cool-off.

**UX conventions (Opinion, from general knowledge of these platforms; no source retrieved).** Challenge cards with
category chip, difficulty, points and solve count; category filters; locked/solved states; team scoreboard with chart;
dashboard with progress per path; terminal/monospace aesthetic; onboarding "first flag" challenge. Accessibility: do not use
colour alone for difficulty or solved state (WCAG 1.4.1, S19), keep contrast at the 3:1 minimum for UI components,
provide keyboard navigation for terminal-like widgets, and test on a phone since the project brief already requires phone
login with an authenticator.

**Fair play and safety.** Per-team flags are the standard countermeasure but players share steps anyway (S16 forum).
Detecting and flagging is common (rCTF, S16). picoCTF measured low copy rates (S9), so a calm tone is justified.
Educational safety: all exploitation in this repo is against simulated or sandboxed targets (the hard rules and
`docs/SECURITY.md`); state that explicitly in the UI ("authorised practice targets only").

**Industry relevance.** Tag each level with NICE work role/skill, an OWASP category (web) and, where honest, an ATT&CK
technique. NIST and NCL do this for competitions; HTB does it for business CTFs. [S18] Be careful: do not imply
certification equivalence. **(Opinion)** A "skills map" page is a much stronger report/demo artefact than more levels.

## 5. Recommendations for this project (prioritised)

Effort S = under a day, M = a few days, L = a week or more. Owner scopes follow `AGENTS.md` section 8: an edit outside a
phase owner's files needs a heads-up. Nothing below has been implemented.

| # | Recommendation | Effort | Impact | Files / areas touched | Risks |
|---|----------------|--------|--------|-----------------------|-------|
| 1 | **Rename "Games" and adopt one vocabulary** (section 6): nav label, `/games` route (keep a redirect), page title, README table, docs wording. | S | High (coherence, owner request) | `frontend/src/layout/Layout.jsx`, `frontend/src/App.jsx`, `frontend/src/pages/Games.jsx`, `Games.css`, `frontend/src/games/registry.js` (comment and file name optional), `Home.jsx`, `README.md`, docs | Broken bookmarks (add redirect); tests referencing "Games" text |
| 2 | **First-run onboarding path**: a guided "first flag" in each category plus a 3-step checklist on the hub (join team, capture first flag, pick a track). picoCTF on-ramps and the CTFd "gimme" advice back this. [S3][S8] | M | High | `Home.jsx`, hub page, profile; no scoring change | Over-guiding experienced players: make it dismissible |
| 3 | **Unify hints into one economy**: same rules in every category (cost shown before unlock, cannot go below zero, logged), like CTFd. `HintPanel.jsx` already exists in cipherlab and crackme. [S3] | M | High | `frontend/src/components/*/HintPanel.jsx`, game services, `scoringService`, `docs/` (contract change needs docs update) | Scoring rules are Engine-owner territory; hints that reduce points must not break leaderboard totals |
| 4 | **Skills map per level**: add `skills` tags (NICE skill area, OWASP/ATT&CK where truthful) to level metadata and a public "Skills" page showing coverage per user/team. [S18] | M | High for employers/educators and the report | level data in `backend/src/games/*`, `forensics`, `osint`, `terminal`; new read-only endpoint; Profile page; `docs/API_SPEC.md` | Inaccurate mappings undermine credibility; start with 1-2 tags per level and cite the framework version |
| 5 | **Event mode**: scheduled start/end, visible countdown, automatic scoreboard freeze (today there is a manual `submissionsFrozen` flag and banner). Matches CTFd freeze and the brief's "could have". [S2] | M | High for live demos | settings model, announcement route, `Leaderboard.jsx`, banner component, `docs/DATABASE_SCHEMA.md` | Must stay stateless across replicas: store times in MongoDB, compute on the server |
| 6 | **Weekly ladder (small leagues) or a seasonal reset** with promotion and demotion, cosmetic rewards only. [S4][S6] | L | High retention | new service + model, leaderboard and profile pages | League farming (S20 reports it); require activity thresholds and cap bonuses; scope creep |
| 7 | **Streak freeze**: you already have streaks (3 and 7 day badges); add one earned freeze so a missed day does not reset. [S5] | S | Medium-high | `achievementService.js` streak logic, profile UI, `docs/ACHIEVEMENTS.md` | Keep streaks purely cosmetic (the doc says they never affect points) |
| 8 | **First-blood stamp and "hall of firsts"** shown on cards, leaderboard and profile (first blood badge exists; surface it). [S4][S7] | S | Medium-high | challenge and game cards, `Leaderboard.jsx`, `Profile.jsx` | Solo or tiny player base makes it meaningless; show "unclaimed" instead |
| 9 | **Dynamic scoring (if not already for static challenges)** using the CTFd formula and tests, with a visible "worth N now" on cards. [S1] | M | Medium | `scoringService`, challenge card, tests | Changing points retroactively; Engine-owner file; document the formula |
| 10 | **Learning paths on top of the six categories**: ordered "Tracks" mixing levels (for example "Web basics: Cookie lab, then Weblab level 2") with a progress bar, in the style of PortSwigger and pwn.college belts. [S12][S13] | M | High | hub page, `registry.js` (add `tracks` metadata), profile | Duplication with existing per-game tracks: define a track as the universal term (section 6) |
| 11 | **Belt or rank ladder with credible names** (for example Recruit, Analyst, Operator, Specialist, Elite) based on solved points, cosmetic and shown on profile and team. [S12] (names are Opinion) | S-M | Medium | `achievementService.js`, Profile, Team | Do not let it conflict with the leaderboard rank; label it "rank title" |
| 12 | **Narrative skin per event** (a one-paragraph briefing, a recurring fictional organisation shared by OSINT/Forensics cases) rather than six separate stories. [S14][S17] | S-M | Medium (memorability) | case copy in `backend/src/forensics`, `osint`, `terminal`, banner | Lore drift; keep a one-page world bible in `docs/` |
| 13 | **Post-solve debrief and delayed write-ups**: after capture, show "what you just did", a real-world analogue and links to OWASP/MITRE pages; publish full solutions only after cool-off or event end. [S7][S15] | M | High educational value | level result views in each game, `docs/FAIR_PLAY.md` | Spoilers vs fair play; cool-off logic per level |
| 14 | **Accessibility and mobile pass**: do not rely on colour for difficulty or solved state; add icons/text; keyboard-operable terminal; phone layout check of hub and leaderboard. [S19] | M | Medium-high | CSS in `frontend/src/components/*`, `Games.css`, Leaderboard, Terminal pages | Terminal widgets are the hard part; test with a screen reader |
| 15 | **Fair-play surface**: show a short "rules of the range" panel, per-team flags stay, add detect-and-flag logging for shared flags (accept, mark, review) instead of loud blocking. [S9][S16] | S-M | Medium | `adminSolves.js`, Fair play admin section, `FairPlay.jsx` | False positives within a team; keep it a review queue, not auto-ban |

**(Opinion) suggested order:** 1, 8, 7, 2, 14, 3, 10, 4, 13, 5, 11, 9, 12, 15, 6. Rationale: cheap coherence and retention wins
first, then the structures that make the platform defensible to an educator, then the optional competitive layer.

## 6. Naming

The owner dislikes "Games". The goal is a hub name that points at the CTF identity (flags, ranges, operations), reads as
credible to professionals and still sounds like a place to play.

### 6.1 Candidates for the hub

| Candidate | Why it works | Why it might not | Credibility / fun |
|-----------|--------------|------------------|-------------------|
| **The Range** (route `/range`) | "Cyber range" is a standard industry term for a training environment; also evokes a shooting range, so gamers get "practice and score". Short, fits a nav bar. | A cyber range usually means network simulation, so purists may expect VMs. | High / medium-high |
| **Wargames** (`/wargames`) | OverTheWire established the word for level-by-level hacking practice; gamers recognise it from the 1983 film and the genre. [S13] | OverTheWire's wargames are one linear series; "war" tone may feel aggressive for a school audience. | High / high |
| **Field Ops** (`/ops`) | Fits the mission voice (operations, briefings); distinct from competitors. | Less recognisable as "practice"; could sound like a corporate product. | Medium / medium |

**Recommendation: "The Range".** Reasons: it is the most credible for employers and educators, it needs no explanation to
gamers, and it pairs naturally with the existing brand ("CTF Arena": the Arena is the competition, the Range is where you
train). This is an opinion; my fallback is "Wargames" if the owner wants a more playful voice. Keep `/games` as a redirect to
the new route and keep the existing six category names, which already read well.

### 6.2 Vocabulary table (recommended)

| Concept | Term to use | Notes |
|---------|-------------|-------|
| Hub | **The Range** | Nav label "Range"; page title "The Range" |
| Docker challenge board | **Challenges** (nav) | Keep; this is the CTFd-standard word and what the README already says. Possible later subtitle "Live targets" |
| Arena Terminal | **Arena Terminal** | Subtitle: shell puzzles |
| Cipher Lab | **Cipher Lab** | Subtitle: cryptography |
| Web Exploit Lab | **Web Exploit Lab** | Subtitle: web vulnerabilities (map to OWASP) |
| Forensics Desk | **Forensics Desk** | Subtitle: case files |
| Crackme Arcade | **Crackme Arcade** | Subtitle: reverse engineering |
| OSINT Trail | **OSINT Trail** | Subtitle: open-source intelligence |
| Category (generic word) | **Discipline** in prose, "category" in filters | Discipline sounds professional; category stays in UI filters for CTF familiarity |
| One puzzle / stage / code / question | **Flag** (user-facing: "3 of 8 flags") | Today these are "levels", "stages", "codes" and "questions"; one word makes progress counts comparable. Keep game-specific detail as a subtitle |
| A level (ordered step in a series) | **Level** | OverTheWire-compatible, understood by gamers |
| A set of levels / a case | **Track** | Already used in code (`tracks`); case files remain "case" in titles |
| Cross-category curated route | **Path** | Reserved for recommendation 10 (TryHackMe/PortSwigger use "path"); avoids mixing with track |
| Solved | **Captured** (label) with check icon and the word "Solved" in screen-reader text | Pair icon with text; do not rely on colour [S19] |
| Unsolved | **Open** | Fits "flag still in play" |
| Locked | **Locked** | |
| Points | **Points** (abbreviation "pts") | Avoid introducing "XP" next to points; HTB moved to XP for a different purpose [S7] |
| First solver | **First blood** | Industry term [S6][S7] |
| Hint | **Hint** (shows "-N pts" before unlock) | [S3] |
| Team ranking | **Standings** (leaderboard page title "Leaderboard") | |
| Rank title | **Rank** | Cosmetic title from recommendation 11 |
| Practice vs event | **Training** vs **Event** | Needed once event mode exists |
| Competition space | **Arena** | Brand word: the live competitive side (event, ladder, scoreboard). Not used for categories, so "Arena Terminal" should be read as the category's name only; consider the subtitle "Terminal" in prose |
| One attempt at an event or timed run | **Run** (timed track) / **Match** (team head-to-head, only if a duel mode is ever built) | Do not call a normal solve a "match" |
| A timed stage of an event | **Round** | Only inside Events (for example a staged release schedule) |
| Weekly competitive cohort | **League** | If recommendation 6 is built [S4] |
| Time-boxed competitive period with reset | **Season** | If recommendation 6 is built [S6]; cosmetic rewards only |
| Cosmetic progression number | **Rank** (title) and **Rank points** | Never named XP; never changes Points or Standings |
| Achievement | **Badge** | Already in code (`achievementService.js`) |
| Consecutive-day activity | **Streak** (with **Freeze**) | [S5] |
| Briefing text before a track | **Briefing**; after solving: **Debrief** | Recommendation 13 |
| Player-visible story container | **Operation** (an event or season's storyline) | Optional narrative layer, recommendation 12 [S14] |
| Notification | **Alert** (UI toasts/banners), **Announcement** (admin banner) | Existing `AnnouncementBanner` stays "Announcement" |
| Team | **Team** | Keep; do not rename to squad/guild |

**Rule of thumb (Opinion):** a word is allowed if a security professional would not wince and a gamer would not yawn.
Avoid "Games", "mini-game", "level up!" exclamations in serious contexts, and avoid military cosplay that might feel
inappropriate for school users.

## 7. Branding voice

- **Positioning line (Opinion):** a CTF platform where every flag teaches a real skill.
- **Tagline candidates:** "Capture the flag. Keep the skill." / "Train on the Range. Compete in the Arena." / "Hack safe. Learn real."
  Recommended: **"Train on the Range. Compete in the Arena."** because it ties the two names together and states the
  product's two modes.
- **Tone:** confident, concise, a little wry. Second person, present tense, short sentences. Terminal-style microcopy
  is welcome (`[ Not logged in ]` in the header already does this), but never at the cost of clarity.
- **Do:** explain jargon once ("a flag is the secret string that proves you solved it"), name real techniques (cookie
  tampering, SQL injection, Vigenere) and link to OWASP/MITRE pages in debriefs, celebrate first blood and streaks
  without shaming a miss, and say clearly that all targets are simulated and authorised.
- **Don't:** use real company or person names in scenarios, use "hacker" as a sneer, promise job outcomes or certification
  equivalence, or leak flags/hashes in any copy (hard rule 3 in `AGENTS.md`).
- **Error and empty states:** helpful and dry ("No flags captured yet. Try the first Cipher Lab level.").
- **Visual cues (Opinion):** keep the pixel/terminal look the app already has; add icon plus text for every status
  colour (accessibility, S19); use one accent colour for "flag" moments (first blood, capture) so they stand out.

## 8. Caveats

- Several sources are vendor blogs or help pages (HTB, TryHackMe, CTFd); they describe intended behaviour, not outcomes.
- The TryHackMe leaderboard-abuse claim (S20) and the DEF CON 2025 KotH claim come from low-quality secondary sources and are
  not verified.
- I could not retrieve the picoCTF CISSE paper body, official OverTheWire pages, or PortSwigger page text; those rows lean on
  search summaries.
- Platform rules change (HTB announced a new XP system in 2026-04); recheck before quoting numbers in the final report.

---

# Part II: the whole game pattern (scope extension)

Evidence note: for game-industry references (Uplink, Zachtronics, Papers, Please, ARGs, roguelikes, ranked ladders,
battle passes) I retrieved little or nothing. Statements about them are **(Opinion / general knowledge)**. For Hacknet, Obra Dinn,
juice, escape rooms and loops I cite what I found [S21-S25]. Findings about our own code come from reading
`frontend/src/**` on 2026-11-22; I did not run the app.

## 9. Core loop, meta loop and the timescales

Sourced: a core loop is the most repeated action cycle; meta systems wrap it on longer timescales; short repeat sessions build
habit; a "dual loop" lets people stop after one loop or continue [S21]. Hacknet shows that a convincing terminal plus a
graphical layer can carry a whole game on the feel of hacking [S22]. Obra Dinn confirms deductions in batches rather than
per guess, which stops brute-forcing while keeping tension [S23]. Escape-room practice treats hint frequency as a
diagnostic of puzzle quality [S25].

| Timescale | What the player does | Feedback they get | What pulls them back | What CTF Arena has today | Gap (Opinion) |
|-----------|----------------------|-------------------|----------------------|--------------------------|---------------|
| **30 seconds** (one micro-action) | Run a command, decode a string, send a request, step the debugger, open a record, submit an answer | Instant output, error/hint text, correct/incorrect with a tone that teaches | Curiosity: "what does this reveal?" | Strong: terminal HUD, decoder toolbox, request replay with diff, debugger with time travel, per-answer feedback | Wrong-answer feedback varies per game; unify tone and rate-limit messages |
| **10 minutes** (one flag / level) | Investigate, hypothesise, capture a flag | Points, solve count, first-blood banner, confetti (reduced-motion safe, `CelebrationHost.jsx`), badge toast | Next level is visible and slightly harder; a track progress bar | Track cards with progress, badges, celebration host | No "next up" suggestion after a capture; no debrief (rec 13); no visible cross-game difficulty curve |
| **Session** (30-60 min) | Finish a track or case, rank up, climb standings | Track completion, standings movement, activity ticker | A visible "almost done" state, a team to play with | Team page, `ActivityTicker.jsx`, leaderboard poll every 10 s | No session summary ("3 flags, +120 pts, rank 14 to 11") |
| **Weekly** (meta loop) | Return for a daily or weekly goal | Streak, league/season standing, new content | Streak with freeze, weekly cohort, release schedule, daily spotlight | Daily spotlight, streak badges (3 and 7 days, `docs/ACHIEVEMENTS.md`) | No freeze, no weekly cohort, no release schedule or season [S4][S5][S6] |
| **Seasonal / event** | Compete in a time-boxed event | Countdown, freeze, finale, results page | Prestige, hall of fame, narrative | Manual `submissionsFrozen` flag, announcement banner | No scheduled event mode, no results or replay page |

How the named references map (all Opinion unless cited):
- **HackTheBox:** loop = pick machine, enumerate, exploit, flag; meta = ranks, seasons, first blood [S6][S7].
- **TryHackMe:** loop = read a task, answer a question, get an instant tick; meta = streak, badges, weekly leagues [S4][S5].
- **picoCTF:** loop = on-ramp problem, hint, flag; meta = yearly storyline contest turned year-round [S8][S10].
- **Hacknet / Uplink:** loop = discover a target, run tools, steal or fix data, earn money to upgrade; meta = a storyline
  that unlocks missions. Hacknet is sourced for the terminal-as-core point [S22]; the economy loop for both is general knowledge.
- **Zachtronics titles and Papers, Please:** loop = learn a rule set, apply it to a stream of cases, get graded; meta =
  escalating rules and consequence-driven story (general knowledge).
- **Return of the Obra Dinn:** deduction with batched confirmation [S23].
- **Escape rooms and ARGs:** time-boxed shared story, hints on request, a gamemaster [S25]; ARG design is not sourced here.
- **Roguelikes and ranked ladders:** short runs with permanent meta progress; ranked ladders reset by season (general
  knowledge; HTB Seasons and TryHackMe Leagues are the sourced CTF analogues [S4][S6]).
- **Battle pass / season design:** not sourced. Opinion: copy the cadence (a fixed season, visible tiers) but not the
  monetisation or fear-of-missing-out pressure; this is an educational product.

## 10. Progression and economy

**Sourced facts.** Hint cost and funding via a free gimme challenge [S3]; dynamic decay formula [S1]; league sizes and
promotion rules [S4]; streak freeze rules [S5]; seasonal point reset [S6]; belts and ordered curricula [S12]; learning paths
[S13]; graduated hints, hint-frequency diagnostic, and the warning against tedium as difficulty [S25]; per-team instances and
the low observed copy rate [S9].

| Topic | Convention (source) | Current state in CTF Arena | Recommendation (Opinion) |
|-------|---------------------|----------------------------|--------------------------|
| Score vs progression | Points decide standings; XP/rank/belts are separate and cosmetic (HTB, TryHackMe, pwn.college) [S6][S12] | Points drive leaderboard; badges never change points (`docs/ACHIEVEMENTS.md`) | Keep the separation; add a cosmetic Rank title (rec 11) |
| Currency vs points | CTFd hints cost points, so there is one currency [S3] | Hints are free in OSINT per `OsintCase.jsx`; other games vary | One policy per mode: Training = free graduated hints; Event = hints cost points. Show the cost before the click |
| Hint ladder | Graduated 3-5 levels [S25] | Weblab has numbered hint levels (`HintList`, `getHint(slug, level)`); others vary | Standardise to 3 levels: nudge, direction, near-answer |
| Unlock gating | Ordered series (OverTheWire, pwn.college) vs open boards (CTFd) [S12][S13] | Tracks are per game; flat list in the hub | Keep boards open, add optional guided Paths (rec 10); gate only capstones (for example the final accusation after evidence) |
| Difficulty curve | Easy to hard inside a topic [S13]; escalating Flare-On [S15] | Difficulty labels per track | Check each track's first level is solvable in under 5 minutes without hints; use hint-usage rate as the curve metric [S25] |
| First 5 minutes | On-ramp challenge in almost every category [S8] | Demo page `/demo`, no guided first flag | Rec 2: one guaranteed first flag on the hub and per game |
| Stuck players ("rubber-banding") | Escape rooms nudge; some systems detect a stuck state [S25] | Hints on request only | Offer a hint prompt after N minutes without progress (opt-in, never an automatic reveal); never make levels easier for strong players |
| Anti-grind | Daily caps and diminishing returns are common in live games (general knowledge) | Not needed for fixed-value flags | Keep points fixed per flag; no repeatable grindable content; first blood is one-time |
| Fairness solo vs team | HTB/TryHackMe leagues are individual; Jeopardy events are team-based [S4][S11] | Teams up to 3; solves record `userId` and `teamId`; leaderboard by team | Add an individual practice ladder so solo players are visible; keep team size capped (already 3) for events |
| Anti-abuse of ladders | Reported league farming (unverified) [S20] | n/a | If leagues are added, require a minimum activity threshold and cap bonuses |

## 11. Presentation

Sourced: juice is amplified feedback with restraint, short shake, varied synced sound, effects that echo the core mechanic
[S24]; WCAG 1.4.1 forbids colour as the only signal [S19]; Hacknet favours feel over literal realism [S22].
Everything about typography, HUD and art direction below is **Opinion** (no sourced study retrieved).

| Element | Recommended pattern | Our current state (file) |
|---------|---------------------|--------------------------|
| **HUD** | Persistent slim bar: points, team, rank, streak, event countdown; collapses on mobile | Terminal has `TerminalHud.jsx`; global header shows the email only (`Layout.jsx`); no global points or streak chip |
| **Challenge / level cards** | Category chip and icon, difficulty (icon plus word), points ("worth N now"), solved state (icon plus word), solve count, estimated time, skills tags | Cards exist (`TrackCard.jsx` per game, `ChallengeList.jsx`); skills tags and time estimate absent |
| **Scoreboard** | Top N, your team pinned, score-over-time chart, freeze indicator, division filter | Chart and highlight exist (`Leaderboard.jsx`); freeze indicator is a banner only |
| **Toasts / alerts** | Polite live region, dismissible, stack limit, no focus steal, reduced-motion respected | `CelebrationHost.jsx` has `role="status" aria-live="polite"` and reduced-motion handling; admin has `Toasts.jsx`; no shared player toast system |
| **First-blood moment** | Distinct banner plus a permanent stamp on the card | Celebration event for first blood (`arena:celebrate`); a stamp on cards is not confirmed in the files I read |
| **Solve animation (juice)** | 300-600 ms flash or confetti on capture, one short sound (default off), floating "+pts" [S24] | CSS confetti banner for 5 s (`Social.css`); `Confetti.jsx` and `MatrixRain.jsx` in the terminal; no floating points, no sound |
| **Sound and haptics policy** | Off by default, one toggle in profile, never required to understand state, no autoplay on load, no haptics unless the user opts in (Opinion) | No audio code found in the files I grepped |
| **Narrative framing** | Briefing before, debrief after, one shared fictional world [S14][S17] | Per-game flavour text and case titles; no shared world |
| **Art direction and type** | Dark, high-contrast monospace for tool panels; a readable proportional sans for prose and cards; accent colour reserved for flags and first blood; avoid permanent neon glow and Matrix cliches on serious pages so it still reads as a professional tool | Pixel art (`PixelArt.jsx`), fonts in `frontend/public/fonts`, terminal styles; consistency across the six games not verified |
| **Dark / light** | Respect `prefers-color-scheme`; offer a toggle | No `prefers-color-scheme` rule or theme switch found in CSS under `frontend/src` |
| **Colour-blind safety** | Difficulty and status use icon plus text plus colour; avoid red/green-only pairs [S19] | Not verified; difficulty colours in `Games.css` and `challengeHelpers.js` should be audited |
| **Mobile** | Single-column hub, sticky submit bar, tools as tabs not side by side, hex/packet views scroll horizontally | 32 `@media` rules in pages/components CSS; tool-heavy views (debugger, hex, packets) are likely tight on phones, unverified |
| **Motion** | `prefers-reduced-motion` honoured everywhere | 14 matches in CSS; confetti is guarded |

## 12. How our six categories are played elsewhere, and what we have

Tool expectations come from recommendation lists, not usage surveys [S26]. Our column is from reading
`frontend/src/components/**` and `pages/**`.

| Category | Established interaction pattern (source) | Tools players expect (source) | What CTF Arena already has | What it lacks (Opinion) |
|----------|------------------------------------------|-------------------------------|----------------------------|-------------------------|
| **Terminal wargames** (Arena Terminal) | Level-by-level shell puzzle where each level's secret unlocks the next (OverTheWire) [S13]; Hacknet-style simulated OS [S22] | Real shell: `ls cat grep find`, history, tab completion, man pages | Fake Unix box with `grep/sed/awk/find` on a linear-time engine, man pages (`backend/src/terminal/commands/manual.js`), ANSI rendering, HUD, MatrixRain, three modes | Confirm tab completion and history (not checked); a `hint` or tutorial command; replay of a run; a statement of which pipes and redirects work |
| **Crypto labs** (Cipher Lab) | Ciphertext in, flag out; unknown cipher identification via a bench with chained operations (CyberChef, Magic) [S26] | CyberChef-style recipe bench, frequency analysis, dcode-like helpers [S26] | `Toolbox.jsx`, `tools.jsx`, `decoders.js` with 7 decoders: base64, hex, reverse, atbash, caesar, rail fence, vigenere | No chained recipe with live output, no XOR or single-byte brute force, no frequency chart or index of coincidence, no "Magic"-style suggestion; modern crypto (RSA/AES misuse) not evident |
| **Web labs** (Web Exploit Lab) | Intercept, modify, replay requests against a vulnerable app; PortSwigger labs ordered easy to hard [S13] | Burp Suite (Repeater, Proxy) or DevTools [S26] | `RequestInspector.jsx`, replay `HistoryList`, `DiffView` (response diff), `CurlBox` (copy as curl), `TargetFrame.jsx` simulated sites, `BountyBadge`, hint levels | No Intruder-style payload list, no cookie/JWT decoder panel (confirm in `InspectorTools.jsx`), no OWASP category label on the lab card, no write-up unlock |
| **DFIR / forensics case files** (Forensics Desk) | Case with artefacts, timeline reconstruction, answering questions (Autopsy, Wireshark workflows) [S26] | Hex editor, packet viewer, log search, disk browser, metadata/EXIF, timeline | `HexEditor.jsx`, `DiskViewer.jsx`, `PacketTable.jsx`, `LogViewer.jsx` with `VirtualList.jsx`, `MetadataTable.jsx`, `PixelGrid.jsx`, `TimelineBoard.jsx`, `Interviews.jsx`, `CaseTimer.jsx`, `Board.jsx` | Packet detail pane (protocol tree, follow stream), log filter queries not confirmed, entropy or carving view, evidence export; ATT&CK tags per stage |
| **Reversing / crackmes** (Crackme Arcade) | Read disassembly, set breakpoints, step, patch (Ghidra, GDB) [S26] | Disassembly listing, registers and memory, breakpoints, patching, reference sheet | `Listing.jsx`, `Debugger.jsx`, `Panels.jsx`, `PatchBay.jsx` and `patchEditor.js`, `TimeTravel.jsx` and `timeline.js` (reverse stepping, a standout), `IsaReference.jsx`, a custom `vm.js` | Symbol and xref navigation, string search, pseudo-code option for beginners, a bridge to real tools (a downloadable binary level for Ghidra) |
| **OSINT investigations** (OSINT Trail) | Questions answered from public-like sources, link analysis, geolocation, timeline (opinion, not sourced) | Pinboard or link graph, map, archive search, WHOIS lookups, EXIF, note-taking | Tabs: Social Feed, Web Archive, Registry/WHOIS, Map, Photos, Notes, `BoardTab.jsx` with `useBoard.js` (pinboard), `SearchBox.jsx`, questions with fixed points and optional hints | Link graph with auto-edges, a source-confidence rating, an ethics banner ("fictional town, no real people") on every case, a timeline across sources |

Cross-cutting: the six games each have bespoke tool UIs and similar hint and answer widgets (`HintPanel.jsx`,
`AnswerForm.jsx`, `SubmitForm.jsx`, `StagePanel.jsx`, `Questions.jsx`). **(Opinion)** Extract one shared "capture panel"
(answer box, hint ladder, feedback, progress) so rules and wording stay consistent. That is a refactor in the Engine
owner's area, effort M.

## 13. Live-event and operations patterns

Sourced: freeze, hidden teams, hints under freeze and dynamic scoring behaviour in CTFd [S1][S2][S3]; per-team flags and
detection (flag shared but marked) [S9][S16]; publishing past challenges and solutions (Flare-On) [S15]; annual themed
events [S14]. Everything else here is **Opinion** drawn from how organisers typically run events (no source retrieved).

| Pattern | What good looks like | CTF Arena today |
|---------|---------------------|-----------------|
| Event mode | Start/end timestamps stored server-side, countdown, auto-freeze, post-event unfreeze and results page | Manual flags `registrationOpen` and `submissionsFrozen` via Settings; frozen mode applied across games (recent commit) |
| Scoreboard freeze | Public board freezes N minutes before the end; admins see live; players still see their own team | Freeze exists as a switch; no staged freeze or admin-live view stated |
| Announcements | Banner plus an announcements feed with timestamps | Single banner text (`AnnouncementBanner.jsx`, `GET /api/announcement`) |
| Release schedule | Timed unlocks (drip), "new" badge | Not present |
| Admin tooling | Live submissions stream, instance kill, challenge toggle, audit log, exports, fair-play queue | Strong: Overview, Users, Teams, Challenges, Integrity, Instances, Audit, Settings, Exports (`frontend/src/pages/admin/*`) |
| Telemetry | Solve times, attempts per flag, hint usage, drop-off per level | Admin `Activity.jsx` exists; per-level funnel and hint usage not confirmed |
| Anti-cheat | Per-team flags, rate limits, shared-flag detection and review, clear rules [S9][S16] | Per-team dynamic flags, rate limiting, `FairPlay.jsx`, Integrity admin page |
| Post-event | Write-ups after the event, replay of the score chart, certificates | Score-over-time chart only; no replay or write-up section |
| Operations safety | Kill switch for containers, TTLs, resource limits | Docker limits, TTL, reaper, `DOCKER_ENABLED` (hard rule 5) |

## 14. Production details

All **Opinion** unless noted.

- **Content pipeline.** Each level is data plus a solver. The repo already has solver files under `backend/tests/*/solvers.js`
  (crackme, osint) that prove levels are solvable; extend that practice to every category and run it in CI, so a content
  change cannot ship an unsolvable level. Add a content checklist: story, learning goal, skill tags, difficulty, hint
  ladder (3 levels), debrief text, safety check, solver test.
- **Balancing and playtesting.** Use the escape-room rule: if a level needs a hint more than about half the time, revise it
  rather than keep it as "hard" [S25]. Playtest first levels with a non-technical person and time the first flag against a
  5-minute target.
- **Analytics (privacy-safe).** Collect per level: attempts, time to first attempt, time to solve, hint opens, drop-off and
  wrong-answer clusters. Use the pseudonymous user ids already in the database; no third-party trackers, no IP or full
  email in analytics tables, aggregate before display, document retention, and put a plain-language notice on the
  Fair-play or a Privacy page. Do not keep raw wrong flags longer than needed (they can resemble real flags).
- **Localisation.** No i18n layer exists (no locale framework found). Keep strings in the UI for now, avoid
  string concatenation for counts ("3 of 8 flags") so extraction is easy later, and use `Intl` for dates. Low priority
  for a single-cohort project.
- **Performance budgets.** Targets: first load under about 200 KB gzipped JS for the hub, route-level code splitting for
  heavy tool UIs (debugger, hex, packets, map), virtualised lists for large logs (already `VirtualList.jsx`), leaderboard
  poll every 10 s with backoff when the tab is hidden, and a serverless cold-start check on Vercel.
- **Legal and ethical statements.** Put a visible "authorised practice only" notice on the Range and on every case:
  targets are simulated, people and organisations are fictional, nothing here is permission to test real systems, and flags
  are never real credentials. Add a short code of conduct (no flag sharing during events, report bugs responsibly) linking to
  `FairPlay.jsx`. If you reference MITRE ATT&CK or OWASP, credit them and note they are third-party frameworks. Do not claim
  accreditation.

## 15. Gap analysis

Status is yes / partial / no, with the main path as evidence. Effort S/M/L.

| # | Industry-standard element | Present? | Recommended change | Effort |
|---|---------------------------|----------|--------------------|--------|
| 1 | Single coherent vocabulary and hub name | partial: "Games" in `frontend/src/layout/Layout.jsx`, `frontend/src/pages/Games.jsx`, `frontend/src/games/registry.js`; units called levels, codes, stages, questions | Adopt the section 6 vocabulary; rename the hub to The Range; "flag" as the universal unit label | S |
| 2 | Guided first-flag onboarding | partial: `frontend/src/pages/Demo.jsx` only | Dismissible 3-step checklist and one guaranteed easy first flag per game [S8] | M |
| 3 | Unified hint ladder with visible cost | partial: separate `components/cipherlab/HintPanel.jsx`, `components/crackme/HintPanel.jsx`, weblab `HintList`, free hints in OSINT | Shared hint component; 3 levels; cost policy per Training/Event [S3][S25] | M |
| 4 | Skills / framework mapping (NICE, OWASP, ATT&CK) | no | `skills` tags per level and a Skills page; credit the frameworks [S18] | M |
| 5 | Scheduled event mode with countdown and auto-freeze | partial: manual flag in Settings, `components/AnnouncementBanner.jsx` | Server-side start/end, countdown component, freeze with admin-live view [S2] | M |
| 6 | Weekly cohort / seasonal ladder | no | Cosmetic league or season with activity thresholds [S4][S6] | L |
| 7 | Streak freeze | partial: streak badges in `backend/src/services/achievementService.js`, no freeze | Earned freeze; keep cosmetic [S5] | S |
| 8 | First-blood stamp on cards and hall of firsts | partial: celebration event and badge exist; card stamp unconfirmed | Persistent stamp and an "unclaimed" state | S |
| 9 | Dynamic scoring with visible current value | partial/unknown: first-blood bonus exists; decay not confirmed | CTFd-equivalent formula with tests; show "worth N now" [S1] | M |
| 10 | Cross-category learning paths | no (tracks are per game; hub is a list in `Games.jsx`) | Path model on top of `registry.js` with progress bars [S12][S13] | M |
| 11 | Session summary and "next up" after a capture | no | End-of-session card and next-level suggestion | S-M |
| 12 | Post-solve debrief with real-world link | no | Short debrief per level; delayed full write-ups | M |
| 13 | Shared capture panel (answer, hint, feedback) | partial: five similar components (`AnswerForm`, `SubmitForm`, `StagePanel`, `Questions`) | Extract one component with standard wording | M |
| 14 | Crypto bench with chained operations and Magic | partial: `components/cipherlab/Toolbox.jsx` with 7 single decoders (`decoders.js`) | Recipe pipeline, XOR brute force, frequency chart, "suggest" button [S26] | M-L |
| 15 | Web lab payload tooling (Intruder-like, JWT/cookie decoder) | partial: `components/weblab/RequestInspector.jsx`, replay, diff, curl | Cookie/JWT decoder and a payload-list runner (only against the simulated target) | M |
| 16 | Packet and log analysis depth | partial: `components/forensics/PacketTable.jsx`, `LogViewer.jsx` | Packet detail tree and follow stream; log filter syntax | M |
| 17 | Disassembly navigation (xrefs, strings) | partial: `components/crackme/Listing.jsx`, `Debugger.jsx`, `TimeTravel.jsx` | String search and cross-references | M |
| 18 | OSINT link graph and source confidence | partial: `components/osint/BoardTab.jsx` pinboard | Auto-edges and confidence tags | M |
| 19 | Global HUD (points, rank, streak, countdown) | no (terminal-only `terminal/TerminalHud.jsx`) | Header chip row; hide on small screens | S-M |
| 20 | Dark/light theme and colour-blind audit | no theme switch found; audit not done | Honour `prefers-color-scheme`; icons plus text for difficulty and status [S19] | M |
| 21 | Sound and haptics policy | no | Default off, one toggle, one capture sound [S24] | S |
| 22 | Mobile pass on tool-heavy pages | partial: 32 `@media` rules | Tabbed tool layout; test hex, packet and debugger views on phones | M |
| 23 | Release schedule / drip content | no | Optional `releaseAt` per level and a "New" badge | M |
| 24 | Post-event results, replay and write-ups | partial: score chart in `pages/Leaderboard.jsx` | Results page, chart replay, write-up unlock | M |
| 25 | Privacy-safe level analytics (funnel, hint usage) | partial/unknown: admin `pages/admin/Activity.jsx` | Aggregated per-level metrics with documented retention | M |
| 26 | Solver-in-CI for all categories | partial: solvers for crackme and osint under `backend/tests` | A solver test for every category | M |
| 27 | Visible safety/ethics statement on every case | partial: `pages/FairPlay.jsx` | One banner component used by all six games | S |
| 28 | Shared fictional world and briefings | no | One-page world bible, briefings on tracks [S14][S17] | S-M |

### The ten biggest gaps (Opinion, by impact on "exciting, coherent, credible")
1. No single vocabulary, and a hub still called "Games" (row 1).
2. No guided first-flag onboarding (row 2).
3. Hints are inconsistent across games and costs are not surfaced (row 3).
4. No skills/framework mapping for employers and educators (row 4).
5. No scheduled event mode with countdown and auto-freeze (row 5).
6. No post-solve debrief or session summary, so the learning moment is missing (rows 11, 12).
7. No weekly or seasonal meta loop and no streak freeze (rows 6, 7).
8. The crypto bench is a set of single decoders, not a chained CyberChef-style workbench (row 14).
9. No global HUD, and no theme, colour-blind or sound policy (rows 19-21).
10. Tool-depth gaps in forensics and reversing (packet detail, xrefs, strings) and no shared capture panel (rows 13, 16, 17).
