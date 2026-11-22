# First-run onboarding

Client-side only. No backend change. Code: `frontend/src/onboarding/`, styles in `onboarding.css`, tests in `frontend/tests/onboarding.test.js`.
Progress is read from the existing overview endpoints (the same GETs and cache as The Range hub). Local state only decides
whether a card is shown; it is never trusted for anything else.

## What shows when

| Where | Who | What |
|-------|-----|------|
| `/range` | signed-in player | "Capture your first flag" checklist: six steps, meter "N of 6 first flags", "What is a flag?" disclosure |
| `/range` | admin | one-line "Preview mode" note (admins have no team and cannot capture flags) |
| `/` (Home) | player, zero captured flags, not dismissed, all six categories loaded without error | "New here? Capture your first flag in under 5 minutes" card with the three-idea strip, a primary button, and Dismiss |
| `/` (Home) | admin, signed-out, anyone with a captured flag, anyone who dismissed | nothing (and no overview requests are made) |

Step status: Captured (any captured flag in that category), Open, Not available yet (category failed to load, is unseeded or
has nothing open; a failed one gets a Retry button), Loading. One bad category never blocks the others. When all six are
captured the checklist says "Range cleared" and links to the Challenges board. The welcome card is hidden while any category
fails, because we cannot tell the player is new.

## Storage

localStorage key `ctf.onboarding.v1:<email lowercased>` holds `{"welcomeDismissed": true}`. Corrupt JSON, wrong types or
blocked storage read as "not dismissed". Nothing is stored for signed-out users.

## Which level each step points at

`pickFirstLevel` in `firstLevels.js`: the first open level of the easiest track (by difficulty word, then order).

| Step | Link | Source |
|------|------|--------|
| Arena Terminal | `/terminal/easy` (Guest Shell) | first mode with codes left |
| Cipher Lab | `/cipherlab/<level id>` | first level with status `open` |
| Web Exploit Lab | `/weblab/<slug>` | first lab not solved, not locked, available |
| Forensics Desk | `/forensics/<case id>` | first seeded case with stages left (stages are not in the overview) |
| Crackme Arcade | `/reversing/<level id>` | first level with status `open` |
| OSINT Trail | `/osint/<case id>` | first seeded case with questions left |

The welcome card recommends Arena Terminal (`RECOMMENDED_FIRST`): its easy mode is a guest shell that explains how to submit.
Flag format is deliberately not shown: real flags use a public prefix, so the copy only says they are short secret strings
specific to your team.

## Changing it

- Order, objectives, minutes or the recommended start: edit `FIRST_STEPS` and `RECOMMENDED_FIRST` in `firstLevels.js`.
- A new category: add it to `games/registry.js`, add a `FIRST_STEPS` entry and a case in `pickFirstLevel`.
- To reset a browser: delete the key above.
