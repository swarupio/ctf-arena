# Hints

One shared hint panel, `HintLadder` (`frontend/src/hints/`), is used on the play screens of Cipher Lab, Crackme, OSINT, Web Exploit Lab and Forensics. Terminal has its own compact Hints control (see below).

## What the player sees
- Hints open one at a time, in order: **Nudge**, **Approach**, **Walkthrough-lite**, labelled by position (1 hint = Nudge; 2 = Nudge, Approach; 3 or more = first Nudge, last Walkthrough-lite). Hint texts are the existing ones, untouched.
- Button: `Open hint 2 of 3 (Approach)`. The last tier (Walkthrough-lite) asks for an inline confirmation first (no modal).
- Opened hints stay visible. Header shows `Hints used: N`; the same line appears in the solved result of Cipher Lab, Crackme, OSINT, Forensics and Web Exploit Lab (from the opened hints the client already has).
- Cost line: `Free: no points deducted`.
- A polite live region announces each opened hint; buttons are 44 px; everything is keyboard operable; focus moves to the newly opened hint.
- Tracks that disallow hints (OSINT/Crackme/Cipher Lab insane, Forensics hard and insane) show "No hints on this track". A Web lab with no hints shows "No hints here".
- Admins preview only: Cipher Lab shows every hint with no button; OSINT and Crackme show locked tiers and no button. Nothing is logged for admins.

## Behaviour and storage per category
| Category | Endpoint | Where opens are stored |
|---|---|---|
| Cipher Lab | `POST /cipherlab/levels/:id/hints` | server, `cipherhints` (logged for admins) |
| Crackme | `POST /crackme/levels/:id/hints` | server, `crackmehints` |
| OSINT | `POST /osint/cases/:track/questions/:n/hints` | server, `osinthints` |
| Web Exploit Lab | `GET /weblab/labs/:slug/hints/:level` | not tracked by the server; opened count in browser localStorage |
| Forensics | none (`stage.hint` is in the case view) | not tracked by the server; opened count in browser localStorage |
| Terminal | in-shell `hint [n]` command | `Hints` / `Next hint` buttons under the log (`frontend/src/terminal/HintBar.jsx`), no new endpoint |

Browser storage: key `ctf.hints.v1:<email>` holds `{ "<scope>": count }` (scopes `weblab:<slug>`, `forensics:<track>:<n>`). Corrupt JSON, wrong types, `__proto__` keys and out-of-range counts read as "nothing opened"; at most 400 scopes are kept. Web lab hints are re-fetched in order on load. No new collections or endpoints were added.

## Where the cost lives
`frontend/src/hints/config.js`, `HINT_COSTS` (one number per category, points per opened hint). All are `0` and nothing is deducted anywhere; the owner has not chosen a cost.

## Adding a cost later without breaking point totals
1. Do not change `points`, `maxPoints` or any documented total. Charge hints as a separate negative ledger entry (the existing adjustment mechanism with a reason like `hint`), not by lowering level points, so totals stay stable and the cost can be switched off.
2. Charge on the server inside the open-hint endpoints of Cipher Lab, Crackme and OSINT, with the same cost table on the backend (the client constant only controls the text). Use an atomic, idempotent write (unique index on team + hint) so repeated opens never charge twice and replicas stay stateless.
3. For Web Exploit Lab and Forensics the server would first have to record opens (new endpoint or collection); that is why they stay free until the cost decision is made.
4. Then set the number in `config.js` and the backend table in the same change, update `docs/API_SPEC.md`, and keep scores from going below zero.

## Not done
Terminal keeps its in-shell `hint [n]` command and adds buttons that type and run that same command through the normal exec path, so pacing, logging and fair-play signals are unchanged. The tier count is read from the reply (`[hint 2/3 for code 4] ...`); `Hints used: N` counts distinct code+tier pairs opened in this browser session (typed or clicked), is not stored, and is hidden for admins. The cost line comes from `hints/config.js`. If the reply cannot be parsed only the plain `Hints` button is offered. Answer forms were left as they are.
