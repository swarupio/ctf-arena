# Vocabulary and voice

One set of words for the UI, README and docs. Source: `docs/CTF_DESIGN_RESEARCH.md` sections 6 and 7. Internal
identifiers (the `game` challenge type, `GAMES` registry export, `backend/src/games/`, `/api/...` paths, file and
component names, CSS classes) are not user-visible and keep their names.

Product name: **CTF Arena** (never "Mini CTF Arena" in the UI).
Tagline: **Train on the Range. Compete in the Arena.**

## Terms

| Concept | Use | Do not use |
|---------|-----|------------|
| Hub of the six categories | **The Range** (route `/range`, nav label "Range"; `/games` redirects) | Games, game hub |
| Docker challenge board | **Challenges** (`/challenges`) | |
| The six categories | Arena Terminal, Cipher Lab, Web Exploit Lab, Forensics Desk, Crackme Arcade, OSINT Trail | game, mini-game |
| Generic word for one of them | **category** (UI, filters), "range module" in technical docs | game |
| Competition side | **Arena** (leaderboard, events, demo match) | |
| Universal unit of progress | **flag** ("3 of 8 flags captured") | code, stage, question as a count label |
| One puzzle in a series | **level** | |
| A set of levels, or a case | **track** (case files keep "case") | |
| Cross-category curated route | **path** (reserved, not built yet) | |
| Solve state | **Captured** / **Open** / **Locked** (screen-reader text may say "solved") | Solved as a label |
| Score | **Points** ("pts") | XP |
| Cosmetic title | **Rank** (never changes points or standings) | XP, level up |
| First solver | **First blood** | |
| Team ranking | **Standings**; page title "Leaderboard" | |
| Scripted demo | **match** (two teams, one run) | game |
| Notice to everyone | **Announcement** | |

## Voice

- Calm, professional, a little competitive. Second person, present tense, short sentences.
- Explain jargon once ("a flag is the secret string that proves you solved it"), name real techniques.
- Say that all targets are simulated and authorised. No real company or person names in scenarios.
- Empty and error states are helpful and dry ("No flags captured yet. Try the first Cipher Lab level.").
- Avoid: "game", "mini-game", "level up!", "hacker" as a sneer, job or certification promises, military cosplay.
- Never put flags or flag hashes in any copy (AGENTS.md hard rule 3).

## Skills map

Page `/skills` (nav label "Skills"). Say "flags that teach a skill", "aligned with" or "related to" a framework, and "Skills I have
shown". Never "certified", "covers the exam" or a job promise. Details: `docs/SKILLS_MAP.md`.
