# Forensics Desk

A detective game: four case files (tracks) the player investigates in the browser. Every track has four evidence
questions and a final "whodunit" that combines them. Code: `backend/src/forensics/*`, `services/forensicsService.js`,
`routes/forensics.js`, `scripts/seedForensics.js`; frontend `pages/Forensics*.jsx`, `components/forensics/*`,
`src/forensics/*` (pure helpers). Endpoints: `docs/API_SPEC.md` "Forensics Desk".

**Owner-only:** section 6 describes how each stage is solved. Do not paste it into a player-facing place.

## 1. Tracks, stages and points

Points are fixed per stage (no first-blood bonus, no time bonus). The maximum is a constant
(`FORENSICS_MAX_POINTS` in `forensics/tracks.js`) and a test proves a team can never exceed it.

| Track | Case | Artefacts | Stages (points) | Max |
|-------|------|-----------|-----------------|-----|
| `easy` | Log Detective: "The Midnight Login" | server log (1500 lines) | 1 attacker IP (20), 2 first victim (20), 3 breach time (30), 4 stolen file (30), 5 whodunit (60) | 160 |
| `medium` | Packet Hunt: "Operation Quiet Beacon" | packet capture (2400 packets) | 1 infected host (40), 2 C2 domain (50), 3 beacon interval (60), 4 codename in the exfil (70), 5 whodunit (130) | 350 |
| `hard` | Artefact Lab: "The Photographer's Alibi" | hex file, metadata table, pixel grid, disk | 1 appended passphrase (80), 2 metadata handle (90), 3 LSB key (110), 4 deleted token (120), 5 whodunit (200) | 600 |
| `insane` | The Long Night | noisy log (5000 lines), capture (4000 packets), pixel grids (4), disk | 1 back-door account (150), 2 attacker's beacon interval (170), 3 deleted-file token (190), 4 key of the right picture (210), 5 whodunit (480) | 1200 |

Whole desk: 20 stages, **2310 points**. Difficulty rises through the data, not only the points:

- **easy**: little background noise, the attacker's guesses are bunched together, hints on every question.
- **medium**: hints on every question, but decoys: a benign periodic poller, look-alike DNS lookups, TLS noise.
- **hard**: no hints. Encoded values (base64 trailer, hex user comment), a channel/bit-order puzzle in the pixels, several
  deleted notes with look-alike tokens (the newest deleted one is right).
- **insane**: no hints, 3x the noise, several look-alike actors: a scanner that never gets in, a slow brute-forcer, a
  brute-forcer that never succeeds, an innocent VPN login, an admin who also creates users, a bigger legitimate
  download, a second beacon on another interval, four pictures of which one carries a key. The stages chain: the log
  names the attacker (never asked directly), the capture is read through that address, the capture names the file the
  implant was told to steal, the disk note for that file points to one picture. Nothing answers a question alone.

## 2. Mechanics (fun, stateless)

- **Case file cover page**: a briefing per track (`briefing[]`).
- **Evidence board**: one card per evidence question; a card shows its confirmed answer once the stage is solved, `???`
  before. Built from `evidence[]` (solved stages only).
- **Suspect board**: 8 generated suspects (name, role, four facts). Each fact is the answer of one stage, so a fact is
  `null` ("???") until that stage is solved. The culprit matches all four clues; half of the decoys match three of four,
  the rest zero to two, so no single clue identifies anyone. The browser highlights facts that match confirmed evidence.
- **Whodunit**: final stage, locked (server side, 403 `STAGE_LOCKED`) until the four others are solved, with a stricter
  attempt budget. The answer is the culprit's full name.
- **Playful feedback**: wrong and right messages are picked from small pools by a hash of the answer text (stateless).
- **Cosmetic timer badge**: a stopwatch kept in `localStorage`, with a rank badge when the case is closed. It never
  reaches the server and never changes the score.

## 3. Per-team generation (stateless, serverless safe)

- `seed = HMAC-SHA256(FLAG_SECRET, "forensics:<teamId>:<trackId>")` (`forensics/core.js`). Admins use the fixed id
  `admin-preview`, which no team has. Nothing generated is ever stored or cached between requests.
- `buildScenario(seed)` draws every secret value (IPs, accounts, files, domains, codename, handle, keys, interval...) in a
  fixed order from the seeded generator of `terminal/gen.js`. Adding a field never moves earlier ones.
- Content is **random access**: log line `i` and packet slot `i` are pure functions of `(seed, i)`; planned events are a
  small map (about 150 entries) of line/slot index to text. A page therefore costs O(page size) and no array of the
  whole artefact is built. Pages: 500 log lines, 250 packets, 1024 file bytes, 8 disk clusters; images are 32x32 or
  40x40 pixels; the disk has at most 40 entries. Measured responses stay under about 110 KB (tests enforce it).
- Replicas are interchangeable: the same inputs give the same bytes on every replica. No in-memory state is used, which
  is what Vercel serverless needs.

## 4. Answers, flags, scoring, rate limit

- The API sends only generated evidence, prompts, formats and (for easy and medium) hints. Answers are computed on the
  server per request and compared with `timingSafeEqual` over SHA-256 digests (`safeEqualText`). Both sides pass
  through the same normalisation (`normalizeAnswer`: trim, lower case, collapse spaces; `time` takes `HH:MM:SS`; `int`
  accepts "45" or "45 seconds").
- Each stage is one `challenges` row (`type: forensics`, slug `forensics-<track>-<n>`). The per-team flag is
  `expectedFlagFor(row)`, i.e. `CTF{forensics_<track>_<n>_<12 hex of HMAC(FLAG_SECRET, teamId:challengeId)>}`. The server
  returns it only in the response that records the solve and in the case view of a solved stage.
- Solves go through `recordSolve` (unique `(teamId, challengeId)` index: double clicks and replicas race safely).
  `scoringService.hasFirstBloodBonus(challenge)` is false for type `forensics`, so `firstBlood` is always false. The
  stage points come from the code definition, not the stored row, so editing a row cannot raise the maximum.
- Attempt limits use the Mongo-backed `attemptLimiter` (`attemptcounters`, TTL), per team and stage: 8/min and 40/h;
  whodunit 3/min and 8/h. Wrong answers are stored as `Submission` hashes only.
- Admins can read artefacts but get 403 on answers. Hiding a row (`visible: false`) switches that stage off.

## 5. Running it

```bash
cd backend && npm run seed:forensics   # idempotent: creates or updates the 20 rows, keeps solveCount and visible
npm test                               # tests/forensics/*
cd ../frontend && npm test && npm run build
```

Routes: `/forensics` (case folders) and `/forensics/:track` (case page), lazy-loaded, behind login.

## 6. Solution approach (owner only)

Every stage is derivable from the public artefacts; `tests/forensics/helpers.js` solves all of them that way.

- **easy**: attacker = the address with many `Failed password` lines that later has an `Accepted password`; victim and
  time are in that first `Accepted` line; the stolen file is the `GET /download?file=...` with status 200 and a huge byte
  count from that address.
- **medium**: the host sending `POST /beacon` at a fixed rhythm (filter `proto == http && info contains "beacon"`); the
  C2 domain is the DNS lookup of that host just before the first beacon (and the `Host:` header); the interval is the
  difference of two consecutive beacon timestamps; follow the stream to port 9001 on the drop server, join the payloads,
  base64-decode, read `CODENAME:`.
- **hard**: hex editor, last `ff d9` marker, base64 trailer `passphrase: ...`; metadata `UserComment` is hex of
  `handle: ...`; the LSB message sits in one channel (red, green or blue) with a bit order; try the 3x2 combinations,
  the right one reads `KEY=...`; the deleted note with the latest modification time holds the token.
- **insane**: attacker = the address with many failures that finally succeeds (not the scanner, not the never-succeeding
  brute-forcer, not the VPN user). The back door is the `useradd` run through `sudo` by the compromised account after
  the breach (not the admin's earlier one). In the capture keep only beacons to the attacker's address and measure
  their interval. The tasking reply (`X-Task`, base64) names the file; the deleted entry with that name (minus its first
  letter) holds `TOKEN=` and `IMG=img-N`; only picture N carries `KEY=...` (others read `VOID=...`).
- **whodunit** (all tracks): the one suspect whose four facts all equal the four confirmed answers.
