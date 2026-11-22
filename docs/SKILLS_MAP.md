# Skills map

Page `/skills` (public; progress only for signed-in players). It shows, per skill, how many flags teach it and how many your team has
captured, with a printable "Skills I have shown" summary. Code: `frontend/src/skills/` and `frontend/src/pages/Skills.jsx`. Client side
only: no backend or API change.

## Frameworks used (a deliberately small subset)

| Framework | Version pinned | Source |
|-----------|----------------|--------|
| OWASP Top 10 | 2021, A01 to A10 | https://owasp.org/Top10/ |
| MITRE ATT&CK (Enterprise) | technique ids and names as published | https://attack.mitre.org/ |
| NICE Framework | NIST SP 800-181 Rev. 1 (2020), category level only | https://csrc.nist.gov/pubs/sp/800/181/r1/final |
| CTF skill areas | our own plain labels (Cryptography, Reverse engineering, Digital forensics, Web exploitation, OSINT, Linux and shell, Networking) | none |

ATT&CK entries: T1078, T1110, T1110.002, T1071, T1048, T1027, T1027.002, T1027.003, T1140, T1070.004, T1136, T1083, T1548.003,
T1622, T1589, T1590, T1593, T1594, T1596. NICE categories: SP, OM, OV, PR, AN, CO, IN. Newer editions of OWASP and NICE exist or may
exist; the map pins the versions above. Wording is always "aligned with" or "related to".

## Files

- `taxonomy.js`: frameworks and skills (`id`, `framework`, `code`, `name`, optional `url`). Ids look like `owasp-a03`, `attack-t1027-003`, `nice-in`, `area-web`.
- `levelSkills.js`: `CATALOGUE`, category -> track -> level -> skills (titles included so the page works offline from the API).
- `coverage.js`: pure functions (flatten, `computeCoverage`, `filterRows`, `groupByFramework`, `levelPath`).
- `progress.js`: reads captured flags through the registry overview endpoints (plus `/forensics/tracks/:id`, `/osint/cases/:id`,
  `/terminal/:mode/progress` for cases or modes with captured flags, and `/challenges`). One failing category never blanks the page.
- `tests/skills.test.js`: taxonomy integrity, every mapped id and title against the backend definitions, coverage, filters, loaders.

## Mapping rules

1. One entry per flag (Terminal code, Cipher Lab level, Web lab, Forensics stage, Crackme level, OSINT question, static/Docker challenge).
2. 1 to 3 skills per flag, only what the flag exercises. A flag we cannot judge gets just its plain skill area.
3. When three tags do not fit, the NICE category is dropped first.
4. ATT&CK entries describe adversary technique; a level relates to it as something to recognise, investigate or decode, not as attack training.
5. NICE is category level only: no work roles, tasks or skill statements.

## Adding a level's skills

Add `lv('<id>', '<title>', ...skills)` to the right track in `levelSkills.js`, using the same id and title as the definition. The test
fails if an id or title drifts, if a skill id is not in the taxonomy, or if a flag has 0 or more than 3 skills. New skill: add it to
`taxonomy.js` only if you are certain of the official name and identifier.

## Honesty notes

- Mappings are our judgement, not reviewed by OWASP, MITRE or NIST. Not a certification and not exam preparation.
- Progress is per team, because flags are captured per team.
- Skills with no flag (OWASP A06, A08, A09, A10; NICE SP, OV, CO) stay listed on purpose to show gaps.
- Dropped as not honestly matched: T1566 Phishing (no level teaches it), T1059 Command and Scripting Interpreter (our shell levels are investigative, not adversary execution), T1190 (would push most web labs past three tags).
- Left out: the `sanity-check` welcome flag teaches no skill.
