# Work queue (polish wave)

Single task board for the Phase 4 polish wave. Maintained by the work coordinator; the project lead launches agents.
Source of truth for decisions and owner actions is `docs/PROGRESS.md`. Last updated: 2026-11-22 (first run).

Status values: running, queued, blocked, waiting-for-report, done. Briefs live in the coordinator scratchpad
(`...\scratchpad\briefs\`); the lead copies them into agent prompts.

## Board

| ID | Title | Owner | Status | Depends on | Files area | Acceptance check |
|----|-------|-------|--------|-----------|-----------|------------------|
| DK-A | Dark theme phase A: tokens, toggle, colour audit, migration map | dark-A agent | outputs ready (THEMING.md with map, color-audit.json); agent may still be finishing | none | `frontend/src/styles.css`, `overview.css`, `frontend/src/theme/*`, `frontend/public/theme-init.js`, `docs/THEMING.md`, `docs/harness/color-audit.json` | THEMING.md has "Colour migration map"; flag `DARK_THEME_ENABLED=false` in config.js and theme-init.js; theme parity + flag-sync tests pass |
| DK-B1 | Dark B1: pages css, layout/auth/fairplay/admin css, banners, demo/panels.css + pages/Demo.css (36 literals, 64 var-risk) | dark-B1 agent | READY TO LAUNCH (darkB1.md) | DK-A final | see brief; files disjoint | 0 raw literals except documented keep list; var-risk fixed; light screenshots identical |
| DK-B2 | Dark B2: cipherlab + crackme + weblab css (95 literals, 21 var-risk) | dark-B2 agent | READY TO LAUNCH (darkB2.md) | DK-A final | see brief; files disjoint | 0 raw literals except documented keep list; var-risk fixed; light screenshots identical |
| DK-B3 | Dark B3: forensics + osint css (56 literals, 22 var-risk) | dark-B3 agent | READY TO LAUNCH (darkB3.md) | DK-A final | see brief; files disjoint | 0 raw literals except documented keep list; var-risk fixed; light screenshots identical |
| DK-B4 | Dark B4: terminal, StepTerminal, hints, onboarding, skills, event banners (107 literals, 26 var-risk) | dark-B4 agent | READY TO LAUNCH (darkB4.md) | DK-A final | see brief; files disjoint | 0 raw literals except documented keep list; var-risk fixed; light screenshots identical |
| DK-B5 | Dark B5: JS/JSX literals (mostly keep list) + demo HopTrail/ArchitectureDiagram css (94 literals, 1 var-risk) | dark-B5 agent | READY TO LAUNCH (darkB5.md) | DK-A final | see brief; files disjoint | 0 raw literals except documented keep list; var-risk fixed; light screenshots identical |
| DK-C | Dark C: both-theme verification, contrast audit, flip flag | dark-C agent | queued (darkC.md) | DK-B1..B5 reports | all frontend css, `theme/config.js`, `public/theme-init.js`, `docs/THEMING.md`, `docs/PROGRESS.md` | contrast audit clean; toggle verified; flag flipped in both files |
| DB-LD | Debrief loader and mounts | debrief agent | done (12 tests, 102 of 102 content; final verification pending) | none | `frontend/src/debrief/*`, mounts in six play screens + ChallengeDetail, `docs/DEBRIEF.md` | frontend tests, `CHECK_DEBRIEF_COMPLETE=1` passes, browser check; final full verification pending |
| DV-FU | Device follow-up: Crackme memory cells, terminal input, short landscape, tooltips, hover wording, 200% zoom, layout harness | device agent | done (see LO-1..LO-4) | none | `frontend/src/terminal/terminal.css`, `components/crackme/*`, `components/Info.*`, `docs/DEVICE_COMPATIBILITY.md`, `docs/harness/*` | 0 targets under 44 px on touch profiles, 0 overflow incl. 568x320 and 200% zoom |
| FX | Standing fixer | fixer | running | none | any file, log in `docs/FIXLOG.md` (must re-read before edit) | all checks green each round |
| QO | Query optimiser | query agent | running | none | `backend/src/services/*`, `backend/src/models/*` indexes, `docs/QUERY_PERFORMANCE.md` | query counts documented, backend suite green |
| SEC | Backend security review (event, board, patch, interviews, story) | sec reviewer | done (8 findings, triaged below) | none | read-only | n/a |
| SF | Security fix agent: findings SEC-1..SEC-7, writes docs/SECURITY_REVIEW_2.md | security-fix agent | running | SEC | backend: socialService, social routes, routes/challenges, osint board service/routes/board.js, terminalService, adminSettings, leaderboardService + route; frontend: ChallengeList, ChallengeDetail, OSINT BoardTab, useBoard | each finding has a regression test; backend suite green |
| SEC-8 | Interviews reveal the culprit after one solved stage: made deduction-only (decoys each tell one lie; culprit unique after 2+ stages; single-stage ambiguity residual 0.4 to 0.5% per track) | interviews agent | done (owner may revert) | none | forensics interviews | puzzle data snapshot identical, 74 forensics tests |
| DOC-2 | Docs index: README must link THEMING.md, FIXLOG.md, QUERY_PERFORMANCE.md, PERFORMANCE.md, RELEASE_CHECKLIST.md, SECURITY_REVIEW_2.md, WORKQUEUE.md | docs agent (new, tiny) | queued, after DK-A, FX, QO, PERF, CI, SF finish | those agents | README.md | links resolve (final.md link check) |
| QA | Frontend QA review of new panels | qa reviewer | waiting-for-report | none | read-only | report triaged here |
| CI | CI + Vercel readiness | ci agent | running | none | `.github/`, `vercel.json`, `api/`, `docs/RELEASE_CHECKLIST.md` | checklist complete |
| DOC | Docs consolidation (API_SPEC 103 routes verified, schema, README, TASKS P4-27..31 ticked) | docs agent | done | none | docs/* | docs match code |
| PERF | Frontend performance | perf agent | running | none | `frontend/vite.config.js`, `App.jsx` lazy routes, `docs/PERFORMANCE.md` | before/after sizes recorded |
| LO-1 | Zoom floor: below ~200 CSS px effective width (360 px phone at 200% = 180 px; Galaxy S9+ at 200% = 160 px) 14 of 41 page states scroll sideways 10-50 px (Crackme, Forensics, OSINT play screens, leaderboard table, team invite code, admin settings). Below WCAG 320 px reflow floor | fixer | queued, severity low, only after its current rounds | none | crackme/forensics/osint css, Leaderboard.css, Team.css, admin.css | 0 overflow at 200 CSS px on those pages (harness) |
| LO-2 | Terminal short-landscape page overflow at 568x320: could not be reproduced by device agent, likely fixed | verifier (FIN) | cannot reproduce; verify once in FIN | none | terminal.css | no page overflow at 568x320 in harness |
| LO-3 | Forensics packet files still say "Click a row" and "Filter on this value" (title) without touch wording; tiny copy fix | fixer | queued, severity low | none | components/forensics/Packet*.jsx, packets.css area | input-neutral wording, tests green |
| LO-4 | Real iOS/Android device testing | owner | open | none | n/a | issues reported |
| FIN | Final verification | verifier | queued (final.md) | everything above except owner items | read-mostly, edits `docs/PROGRESS.md` | all green, smoke list handed to owner |
| OW-1 | Run `npm run db:indexes` on Atlas | owner | open | QO (final index list) | n/a | indexes + `osintboards`, `crackmepatches` exist |
| OW-2 | Admin click-through, Forgot password, real phone test | owner | open | none | n/a | no issues reported |
| OW-3 | Review diff and commit per area (170+ files) | owner | open | FIN | git | clean commits |
| OW-4 | Decide: event gating on practice categories | owner | open | none | `backend` event guard | decision recorded in PROGRESS.md |
| OW-5 | Decide: admin type filter `game`, terminal rate limit, `registrationOpen`, Vercel rate limits | owner | open | none | n/a | decision recorded |
| OW-6 | Check least-certain skill mappings T1622, T1048 | owner | open | none | `frontend/src/skills` | confirmed or edited |
| OW-7 | Vercel deploy (P4-05), repair terminal scores, seeds (P4-24/26), push main | owner | open | FIN | n/a | see TASKS.md P4-26 |

## Collision map

Who may edit what right now. "Read-only" agents never edit.

| File group | Allowed editor now | Everyone else |
|-----------|--------------------|---------------|
| `frontend/src/styles.css`, `overview.css`, `theme/*`, `public/theme-init.js`, `docs/THEMING.md`, `docs/harness/color-audit.json` | DK-A (then DK-C) | fixer: copy/lint only, never colours; B1..B5 never |
| `frontend/src/debrief/*`, play-screen mounts, `docs/DEBRIEF.md` | DB-LD | others: do not touch the mount lines |
| `terminal/terminal.css`, `components/crackme/*`, `Info.*`, `docs/DEVICE_COMPATIBILITY.md`, `docs/harness/*` (except color-audit.json) | DV-FU | B2 (crackme) and B4 (terminal) wait for DV-FU |
| `backend/src/services/*`, models, `docs/QUERY_PERFORMANCE.md` | QO | fixer: report instead of edit unless trivial lint |
| `.github/`, `vercel.json`, `api/`, `docs/RELEASE_CHECKLIST.md` | CI | |
| `frontend/vite.config.js`, `App.jsx`, `docs/PERFORMANCE.md` | PERF | B1 must not edit App.jsx |
| `docs/API_SPEC.md`, `DATABASE_SCHEMA.md`, README, SETUP | DOC | QO and fixer send changes to DOC via notes, no direct edits |
| `docs/FIXLOG.md` | FX | |
| `docs/PROGRESS.md` | lead / FIN / DK-C at the end | others: append only via the lead |
| `docs/WORKQUEUE.md`, briefs | coordinator | |
| backend socialService, social routes, routes/challenges, osint board files, terminalService, adminSettings, leaderboardService + route, ChallengeList/ChallengeDetail, OSINT BoardTab/useBoard, docs/SECURITY_REVIEW_2.md | SF | B-groups: ChallengeList/Detail and BoardTab are JSX; dark B2/B3/B5 touch colours only and must re-read before editing; fixer and QO: mtime check, avoid these files |

Pairs that must NOT run at the same time:
0. SF with QO on the same backend files (mtime coordination); SF with FIN.
1. DV-FU and DB-LD are done, so B2 and B4 are no longer blocked by them (re-read files first).
2. (reserved)
3. DK-B1..B5 with DK-A (shared tokens must be final).
4. DK-B groups with each other are safe: file groups are disjoint. B5 owns JS/JSX literals plus demo HopTrail.css and ArchitectureDiagram.css.
5. DK-C with any B group; DK-C with FX colour edits.
6. FIN with any agent that edits code. Run it last.
7. DOC with QO until QO reports (schema and index docs).
8. Fixer vs any area agent: fixer must re-read file and check mtime before every edit and skip files modified in the last 10 minutes.

Note: the device follow-up edited styles.css, terminal.css, crackme.css, weblab.css, Demo.css, HopTrail.css, StepTerminal.css and added components/Info.jsx. Dark phase B agents must re-read those files (they just changed); the files fall into B1/B2/B3/B4 by family.

## Triage log

SEC report (backend security review), all owned by SF unless stated:
| # | Severity | Finding | Owner |
|---|----------|---------|-------|
| SEC-1 | medium-high | Activity feed and public profiles leak live activity while the scoreboard is frozen | SF (socialService, social routes) |
| SEC-2 | medium | /api/challenges solveCount is live while frozen | SF (routes/challenges, ChallengeList/Detail) |
| SEC-3 | medium | OSINT board progress.found is an exact-count oracle (chain brute-forceable, easy ~72 saves) | SF (board service/routes, board.js, BoardTab/useBoard) |
| SEC-4 | low-medium | Terminal submit: parallel burst lets a correct flag through past the rate limit | SF (terminalService); owner-visible trade-off OW-5 |
| SEC-5 | low | assertSubmissionsOpen fails open | SF (adminSettings) |
| SEC-6 | low | Solves recorded after endsAt | SF |
| SEC-7 | low | Banned team board readOnly flag | SF |
| SEC-8 | info | Interviews reveal culprit after one solved stage | resolved (deduction-only interviews) |
Collision: SF and QO both edit backend services; both told to coordinate via mtime checks. Leaderboard/feed queries touched by SF must be re-checked by QO for query counts. Pending: QA review report.
