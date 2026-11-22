# Debrief

A short, plain-text explanation of what a level taught, shown after the team captured it. Client side only: no API, no database.
Vocabulary rules: `docs/VOCABULARY.md`. Research behind it: `docs/CTF_DESIGN_RESEARCH.md` (recommendation 13).

## Where things live
| Path | What |
|---|---|
| `frontend/src/debrief/content/terminal-challenges-cipherlab.js` | Terminal, Challenges, Cipher Lab |
| `frontend/src/debrief/content/weblab-forensics.js` | Web Exploit Lab, Forensics |
| `frontend/src/debrief/content/crackme-osint.js` | Crackme, OSINT |
| `frontend/src/debrief/entries.js` | loads the three files; `getDebrief(key)`, `hasDebrief(key)`, `keyById`, `skillsOfLevel` |
| `frontend/src/debrief/validate.js` | `validateEntry` (schema) and `entryLeaks` (content safety), both pure |
| `frontend/src/debrief/Debrief.jsx` | the component `<Debrief levelKey captured eventEnded hintsUsed />` |
| `frontend/src/debrief/TerminalDebriefs.jsx` | one debrief per Terminal code of a mode |
| `frontend/src/debrief/useEventEnded.js` | one shared, cached read of `GET /api/event` (60 s) |
| `frontend/tests/debrief.test.js` | tests over every entry |

## Schema
Each content file exports `default` = an object keyed by the level keys of `frontend/src/skills/levelSkills.js`
(`category:track:level`, for example `cipherlab:easy:e1`, `weblab:easy:sqli-login`, `challenges:docker:cookie-monster`).

| Field | Type | Limit | Meaning |
|---|---|---|---|
| `what` | string | 20-220 chars | what the level asked, generic, no team-specific values |
| `how` | string | 60-600 | the technique and why it works |
| `defend` | string | 40-400 | how a defender prevents or detects it, industry oriented |
| `tools` | string[] | 0-5 items, each 1-40 chars | real tool or technique names |
| `next` | string | 0-160 | what to practise next, never an answer |

Unknown fields, leading/trailing whitespace and wrong types are errors. Plain text only: it is rendered as text, never as HTML or markdown.

## Visibility
| Viewer | Shown when | Label |
|---|---|---|
| Player | the team captured the level | Debrief: what you just learned |
| Player or signed-in visitor | the event phase is `ended` (flag or not) | Write-up |
| Admin | always | Debrief (preview) |

It is collapsed by default (button with `aria-expanded`), renders nothing when the level has no entry, and shows the level skills as chips linking to
`/skills`, plus "Hints used: N" after a capture when the screen knows it. A failed or missing `/api/event` never unlocks write-ups.
Print: the body is always expanded.

Mounted on: Cipher Lab level, Crackme level, Forensics question, OSINT question (not while locked), Web Exploit Lab level, Terminal
(list under the terminal, one per code), Challenge detail (static and Docker).

## Add or edit an entry
1. Find the key in `frontend/src/skills/levelSkills.js` (the Skills map page shows every flag).
2. Add or edit it in the content file of that category group.
3. `cd frontend && npm test` (schema, leak and orphan checks run on every entry).

## Content-safety rules (enforced by `entryLeaks`)
- No flag patterns (`CTF{`), no long token-like strings (24+ characters of `A-Za-z0-9+/=_-` that contain a digit or are one unbroken word).
- No email addresses; no URLs that look team specific (`team`, `squad`, `player`, `?user=`, `token=`, `key=`, `flag=`).
- Do not say the word the vocabulary file bans (`game`, `games`, `gaming`).
- Never give the answer of a level: describe the technique, not the team-specific value. `next` points to what to practise, not to a solution.

## Completeness check
Missing entries do not fail the normal test run (the coverage line reports "N of 102"). To require one entry per mapped level:

```bash
cd frontend && CHECK_DEBRIEF_COMPLETE=1 npm test
```
