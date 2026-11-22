# Forensics Desk

A detective category on The Range: four case files (tracks) the player investigates in the browser. Every track has four evidence
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
  returns it only in the response that records the solve and in the case view of a solved stage. The flag is a scoring-row artefact: nothing accepts it as an answer, so the UI does not show it.
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

## Packet viewer tools

The capture viewer (`PacketTable.jsx`, styles in `components/forensics/packets.css`) works only on the packets the player already
loaded. Pure helpers live in `frontend/src/forensics/` (tests: `frontend/tests/packetTools.test.js`, `packetFidelity.test.js`,
`backend/tests/forensics/packetFidelity.test.js`). Stages, answers, points and the whodunit are untouched.

Two generator details support the viewer (`backend/src/forensics/packets.js`), both without any new random draw:
- Every packet carries `sm` and `dm`, simulated MAC addresses. `macFor(ip)` is a pure hash of the IP address (`02:xx:xx:xx:xx:xx`,
  locally administered), so one host has one MAC in every packet. They are never part of an answer. Outside addresses get their
  own simulated MAC too (a real capture would show the gateway's MAC for off-link hosts; the viewer does not model that).
- The planted DNS response goes back to the port the query came from (it used a fixed port before), so query and response share one
  conversation key. Noise DNS responses are unpaired background and keep their random ports.

- **Detail pane** (`packetLayers.js`, `packetHeaders.js`): layered tree Frame, Ethernet, IP, TCP/UDP/ICMP, then DNS, HTTP, TLS or raw
  data. Ethernet shows destination, source and type. Arrow keys move, Right/Left open/close, Enter or Space selects. Selecting any
  field highlights its bytes in a frame view (hex + ASCII). The header bytes (Ethernet 14, IPv4 20, TCP 20 / UDP 8 / ICMP 8) are
  SYNTHESISED from the packet fields: addresses, MACs, ports, protocol, lengths, TCP flags and sequence number follow the packet;
  time to live, window, acknowledgment, identification and ICMP code are placeholders (labelled "placeholder"); checksums are zero and
  labelled "not computed". IP total length and UDP length use the recorded frame length minus 42 as the payload size, so the
  recorded length of a TCP packet does not count the extra 12 TCP header bytes. The frame view shows the headers (tinted), then the
  captured payload.
- **Follow stream** (`packetStream.js`): all loaded packets with the same transport family and endpoints. Client = SYN sender, else
  first sender in capture order. Client segments are left-aligned and labelled `CLIENT >`, server segments right-aligned and labelled
  `SERVER <`. ASCII/Hex toggle, Copy stream. **Order: capture | time**: capture order (packet number) is the default; "time" sorts by
  the time stamp. A neutral note says time stamps can disagree with capture order; nothing is flagged and each segment shows both its
  packet number and its time. Previous/Next in stream always follow capture order. Cap: 4096 payload bytes and 500 packets, then a
  "[Truncated]" marker. Payloads are stored clipped at 96 bytes per packet.
- **Display filter** (`packetFilter.js`, parsed without eval or player regex, 200 characters, 60 tokens):
  `ip.addr|ip.src|ip.dst == x`, `eth.addr|eth.src|eth.dst == 02:aa:bb:cc:dd:ee`, `tcp.port|udp.port|port == n`, `frame.len > n`,
  `proto == dns`, `info|payload|frame contains "text"`;
  bare protocol words `dns http tls tcp udp icmp ntp`; `&&`/`and`, `||`/`or`, `!`/`not`, parentheses; a bare word searches all
  columns. Errors name the problem (missing value, unknown field, unterminated quote, `&` instead of `&&`). The result count shows
  next to the box; the list stays virtualised.
- **Quick actions**: Copy value, Filter on this value (ANDs onto the current filter), Previous/Next in stream.
- **Small screens** (under 900 px): list and detail are separate panes with a "Back to packet list" button; 44 px targets.

## Timeline board and interviews (player aids)

**Timeline board (client only).** Players pin log lines and packets from the viewers onto a vertical timeline (drag, or
Up/Down buttons). State lives in `localStorage` (`forensics-timeline:<email>:<case>`), nothing is sent to the server.
`frontend/src/forensics/timeline.js` checks pairs of PINNED items only (VPN login vs session open/close, log clock going
backwards, DNS answer before its question, reply stamped before its request, FIN before SYN, capture order) and shows a
"Contradiction found" marker plus the cosmetic "Contradiction hunter" badge. Generated clue (does not change any answer, stage
or point): `logPlan` adds two VPN session trios (one consistent, one where the SSH login precedes the VPN "session opened") and
`packetPlan` adds two `GET /time` request/reply pairs (one consistent, one with the reply stamped 0.2 s before the request).
They are drawn last from the seeded rng, use users[4]/users[5] and gateway traffic, and never involve an answer.

**Interviews (optional aid).** `GET /api/forensics/tracks/:track/interviews` lists questions (one per SOLVED evidence stage,
at most 3) and the suspects; `POST` with `{ suspectId, questionId }` (strict) returns `{ suspectId, questionId, answer: 'yes'|'no',
statement }`. Stateless, derived from the team seed (`forensics/interviews.js`). Suspects do not always tell the truth.
A *false denial* is "no" while the board fact of that stage equals the evidence value. The culprit matches every clue and
denies every question. Each decoy (a non-culprit matching at least one clue) tells exactly ONE lie: a false "no" on one clue
it matches; elsewhere it tells the truth. A suspect whose value differs says "no" truthfully. Guarantees (tested over 500 seeds
per track): with two or more solved stages the culprit is the unique suspect with two or more false denials (decoys have at
most one), and with every question asked exactly one suspect has the most false denials. Innocents never have two.
**Lie assignment** (`lieStagesFor`, pure, no new rng draws): decoys and stages form a bipartite graph (edge = the decoy matches
that clue). A maximum matching (Kuhn augmenting paths, ties broken by a SHA-256 of the team seed) gives as many stages as
possible a decoy that lies on them, so one answer rarely singles out the culprit; leftover decoys lie on their least-loaded
eligible stage. A "no" uses one statement pool whether true or false, so the wording gives nothing away. Residual risk
(SEC-8): after exactly ONE solved stage the culprit is the only false denier in about 0.4% (easy, medium) to 0.5% (hard,
insane) of team and stage pairs (12000 sampled per track), because no matching decoy exists for that clue or there are fewer
decoys than clues to cover; the matching is already maximal there, so zero is not reachable. Puzzle data (stage answers,
points, culprit, suspect board) is unchanged; verified by before/after snapshots of 300 teams per track.
A question for an unsolved stage is 404. Rate limit: 20/min and 120/h per team and case (`consumeAttempt`, key
`forensics:<team>:<track>:interview:<i>`). Admins read the whole preview world: no team, no rate limit, no score. The submit
logic and the unique-culprit guarantee are untouched.
