# Cipher Lab

A browser-playable cryptography puzzle game: four tracks (easy, medium, hard, insane), 15 levels, a decoder toolbox that
unlocks as levels are cleared. Code: `backend/src/games/cipherlab/**`, `backend/src/routes/cipherlab.js`,
`frontend/src/pages/CipherLab*.jsx`, `frontend/src/components/cipherlab/`. Endpoints: `docs/API_SPEC.md` "Cipher Lab".

## Rules

- A team opens a level, reads the intercepted ciphertext (plus public parameters) and types the plaintext.
- Inside a track a level opens when the one before it is solved (the last level of every track is its boss).
  All four tracks are open from the start.
- Answers ignore case, spaces and punctuation (`normalizeAnswer` keeps A-Z and 0-9). The hard RSA level wants a number.
- A correct answer records a team solve (unique `teamId + challengeId`), pays the fixed points and returns the team's
  dynamic flag `CTF{cipherlab_<id>_<12 hex>}` through `flagService` (`HMAC(FLAG_SECRET, teamId:challengeId)`).
- The Insane track gives no hints.

## Per-team variation, statelessness

`Rng(secret, teamId, levelId)` expands `HMAC(FLAG_SECRET, "cipherlab:<teamId>:<levelId>")` into a byte stream. Plaintext
sentences, keys, shifts, rail counts, primes, salts, substitution alphabets and even the layer order of the Insane
chains come from it. Nothing is stored: every request recomputes the puzzle, so replicas agree and two teams never
share a ciphertext or an answer. Admins preview with the fixed id `admin-preview`, which no team has.

## Security properties

- The server sends ciphertext, public parameters and (opened) hints. Never the plaintext, the key or the flag, except
  that a correct answer returns that team's own flag. Hints may only reveal part of an answer (one boss hint names the
  first word). The hash-lookup level lists its 40 suspect words by design; the answer is one of them.
- Answers are compared as SHA-256 digests with `timingSafeEqual`.
- Attempts: 8 per team per level per minute through the Mongo-backed `consumeAttempt` limiter (`cipherlab:<team>:<level>`),
  counted for every attempt. Locked levels answer 403 before the limiter. Every attempt is stored in `Submission`
  (hash only).
- Fair play: a wrong answer calls `integrityService.checkSubmittedFlag`, so a pasted honeypot or canary flag leaves a
  signal, exactly like the other submit routes. Pacing rules are terminal-specific and not used here.
- Points come from the level definition, not from the Challenge row, so editing a row cannot raise the maximum.

## Points and maximums

No first-blood bonus: `scoringService.hasFirstBloodBonus(challenge)` is false for `type: 'game'`.

| Track | Level | Cipher | Points |
|-------|-------|--------|-------:|
| Easy (Rookie Desk) | e1 Caesar's Coffee Order | Caesar | 10 |
| | e2 Mirror, Mirror | Atbash | 10 |
| | e3 Wrapped Twice | hex inside Base64 | 20 |
| | e4 Boss: The Doorman | Caesar + reverse | 40 |
| | **Track max** | | **80** |
| Medium (Field Agent) | m1 The Keyed Note | Vigenere with crib | 60 |
| | m2 XOR Marks the Spot | repeating-key XOR with crib | 70 |
| | m3 Zig-Zag Fence | rail fence | 70 |
| | m4 Boss: The Scrambler | substitution, frequency analysis | 130 |
| | **Track max** | | **330** |
| Hard (Cipher Master) | h1 Tiny Primes, Big Secrets | RSA with tiny primes | 120 |
| | h2 The Salted Password | salted SHA-256 lookup | 130 |
| | h3 Keyed and Hexed | Vigenere in hex, crib | 150 |
| | h4 Boss: The Onion | Caesar, rail fence, hex, Base64 | 250 |
| | **Track max** | | **650** |
| Insane (Black Chamber, no hints) | i1 Triple Wrap | random 3-layer chain | 200 |
| | i2 The Keyed Fence | Vigenere, rail, hex, Base64 | 300 |
| | i3 Boss: The Black Chamber | Vigenere, rail, reverse, Base64, hex | 500 |
| | **Track max** | | **1000** |
| | **Game max** | | **2060** |

`tests/cipherlab/api.test.js` solves everything repeatedly and in parallel and asserts the total is exactly 2060.

## Fun mechanics (all derived from MongoDB, none kept in memory)

- **Story**: each track has a briefing; each level has a short briefing; playful messages on right and wrong answers.
- **Toolbox**: ten client-side tools (shift slider, frequency chart, codec bench, Vigenere, XOR, rail fence,
  substitution mapper, RSA workbench, hash lab, pipeline). A tool unlocks when its level is solved (`TOOLS.unlockedBy`
  in `levels.js`); the server reports `unlocked` in `/overview`.
- **Streak**: consecutive correct answers (each level once), counted from the newest `Submission` rows.
- **Speed-run badge** (cosmetic): for a fully solved track, the span between its first and last `Solve.solvedAt`.
  Gold, silver, bronze thresholds per track (easy 10/20/40 min, medium 20/40/90, hard 30/60/120, insane 45/90/180).
- **Hints**: free, optional, one at a time, logged in `cipherhints` (`CipherHint`, unique per team/level/index) and
  readable by admins at `GET /api/cipherlab/admin/hints`.

## Operations

```bash
cd backend
npm run seed:cipherlab     # 15 Challenge rows (type game, category crypto), idempotent, keeps solveCount and visible
```

Rows are keyed by slug `cipherlab-<level id>`. Hiding a row (`visible: false`) switches that level off and relaxes the
ladder. The Insane track is stored with difficulty `hard` (the model has no `insane`). The generic
`/api/challenges` list shows these rows too, but the game is only playable through `/api/cipherlab`; the generic submit
route rejects them (no stored flag). The admin challenge editor does not yet accept `type: game`; edit points or
visibility in MongoDB until that schema is extended.
