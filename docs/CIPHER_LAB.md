# Cipher Lab

A browser-playable cryptography puzzle category on The Range: four tracks (easy, medium, hard, insane), 15 levels, a decoder toolbox that
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
sentences, keys, shifts, rail counts, primes, salts and substitution alphabets come from it. The layer order of
the Insane chains is fixed (i2 and i3 always use the order in the table; i1 uses one of three fixed wrappings);
only the shifts, keys and rail counts vary. Nothing is stored: every request recomputes the puzzle, so replicas agree and two teams never
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
- Points come from the level definition in code (`levels.js`), not from the Challenge row, so editing a row in MongoDB
  cannot change or raise them. To change points, edit `levels.js` and update the maximums below.

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
| Insane (Black Chamber, no hints) | i1 Triple Wrap | one message, 3 or 4 layers (Caesar/Atbash/reverse, hex, Base64) | 200 |
| | i2 The Keyed Fence | Vigenere, rail, hex, Base64 | 300 |
| | i3 Boss: The Black Chamber | Vigenere, rail, reverse, Base64, hex | 500 |
| | **Track max** | | **1000** |
| | **Category max** | | **2060** |

`tests/cipherlab/api.test.js` solves everything repeatedly and in parallel and asserts the total is exactly 2060.

## Fun mechanics (all derived from MongoDB, none kept in memory)

- **Story**: each track has a briefing; each level has a short briefing; playful messages on right and wrong answers.
- **Toolbox**: ten client-side tools (shift slider, frequency chart, codec bench, Vigenere, XOR, rail fence,
  substitution mapper, RSA workbench, hash lab, pipeline). A tool unlocks when its level is solved (`TOOLS.unlockedBy`
  in `levels.js`; the pipeline opens with h3, before the h4 boss that recommends it); the server reports `unlocked` in
  `/overview`. Admin preview has every tool unlocked.
- **Recipe workbench** (the `pipeline` tool, `components/cipherlab/Workbench.jsx`, pure functions in
  `frontend/src/cipherlab/ops.js`): client-side only, no effect on puzzles, points or answers. The input is the shared
  Working text. The player chains steps (add, remove, move up/down with buttons, per-step parameters), sees the output
  after every step, copies it or feeds it back with "Use as input" (which drops the steps already applied). A failing
  step shows its own error and later steps are skipped. Analysis helpers (not chainable): letter frequency chart and
  index of coincidence (gated by `frequency`), and "Magic" suggestions (heuristic hints about what the text looks like;
  never decodes, never searches for a flag). Limits: input 20000 characters, 12 steps, 100000 characters of output per
  step, single-byte XOR ranks all 256 keys on the first 4096 bytes and shows the top 5.
  An operation is offered (and run) only when its toolbox tool is unlocked, plus `pipeline` itself:

  | Operations | Needs tool |
  |---|---|
  | From/To Base64, From/To Hex, Reverse | `codec` |
  | Caesar shift back, ROT13, ROT47, Atbash | `shift` |
  | Rail fence decode | `rail` |
  | Vigenere decode | `vigenere` |
  | XOR with key, single-byte XOR brute force | `xor` |
  | From/To Binary, From/To Base32, URL decode, Morse decode, A1Z26 decode (no matching tool) | `pipeline` |
  | Letter frequency chart, index of coincidence | `frequency` |
  | Magic | `pipeline` |

  Tests: `frontend/tests/cipherOps.test.js`.
- **Streak**: consecutive correct answers (each level once), counted from the newest `Submission` rows. Attempts on a
  level after its team solve are ignored. A wrong answer returns streak 0 and the page says the streak was lost.
- **Speed-run badge** (cosmetic): for a fully solved track, the span between its first and last `Solve.solvedAt`.
  Gold, silver, bronze thresholds per track (easy 10/20/40 min, medium 20/40/90, hard 30/60/120, insane 45/90/180).
- **Hints**: optional, one at a time, priced as a percent of the level's points and deducted when the level is captured (`docs/HINTS.md`), logged in `cipherhints` (`CipherHint`, unique per team/level/index) and
  readable by admins at `GET /api/cipherlab/admin/hints`. Admins previewing a level see every hint and
  `POST /levels/:id/hints` returns them all without writing a `CipherHint` row; admins still cannot answer.

## Operations

```bash
cd backend
npm run seed:cipherlab     # 15 Challenge rows (type game, category crypto), idempotent, keeps solveCount and visible
```

Rows are keyed by slug `cipherlab-<level id>`. Hiding a row (`visible: false`) switches that level off and relaxes the
ladder. The Insane track is stored with difficulty `hard` (the model has no `insane`). The generic
`/api/challenges` list shows these rows too, but the category is only playable through `/api/cipherlab`; the generic submit
route rejects them (no stored flag). The admin challenge editor does not yet accept `type: game`; edit visibility in MongoDB until that schema is
extended (points live in `levels.js`, not in the row).
