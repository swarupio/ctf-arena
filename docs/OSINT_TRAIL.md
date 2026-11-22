# OSINT Trail

An open-source-intelligence investigation category played entirely inside a **fully fictional, generated world**: invented
people, an invented town, a pretend company and social network. Four cases (tracks), each with a story, four or five
questions and a final "who / where" question that stays locked until the others are solved. Code:
`backend/src/osint/*` (world, plots, cases, sources), `services/osintService.js`, `routes/osint.js`,
`models/OsintHint.js`, `scripts/seedOsint.js`; frontend `pages/Osint*.jsx`, `components/osint/*`, `src/osint/helpers.js`
(pure helpers), `src/api/osint.js`. Endpoints: `docs/API_SPEC.md` "OSINT Trail".

**Owner-only:** section 6 describes how each question is solved. Do not paste it into a player-facing place.

## 1. Cases, questions and points

Points are fixed per question (no first-blood bonus, no time bonus). Each maximum is a constant
(`TRACKS[id].maxPoints`, total `OSINT_MAX_POINTS` in `osint/cases.js`); the service takes the points from the definition,
never from the database row, and tests prove a team can never exceed the maximum. `osint` is **not** in the
`scoringService.hasFirstBloodBonus` allowlist (tested).

| Case | Title | Questions (points) | Max | Hints |
|------|-------|--------------------|-----|-------|
| `easy` | Ledger at Low Tide | 1 handle to person (20), 2 evening check-in place (25), 3 domain of the person (25), 4 domain creation date (30), final: who has the ledger (50) | 150 | 2 per question, free |
| `medium` | The Leaked Route Plan | 1 work e-mail (40), 2 domain carrying the verification code (50), 3 map cell of a photo (50), 4 who tagged them (60), final: who created the leaked document (100) | 300 | 1-2 per question (not the final), free |
| `hard` | Tidewatch | 1 person missing from the archived staff page (70), 2 other domain on the same IP (80), 3 local time of the last photo (90), 4 landmark at the street-sign corner (100), 5 decoded codeword (110), final: where at dawn (200) | 650 | none |
| `insane` | Nightjar | 1 person behind the alias (120), 2 IP of the mirror after the CNAME chain (140), 3 true UTC time of the photo (160), 4 true landmark (180), 5 companion at that place and instant (200), final: the drop point on the map (400) | 1200 | none |

Whole category: 22 questions, **2300 points**. Difficulty rises through the data:

- **easy**: one handle, one time zone (UTC), no look-alike data except a few colleagues' posts, hints on every question.
- **medium**: hidden e-mail with a pattern to infer, near-miss verification codes, photos of other days, a document with
  the same title style; free hints (fewer clues given).
- **hard**: a town time zone other than UTC, archived page diffs with a red herring (a new hire, a title change), shared
  hosting (same A record, not same SPF text), a camera that writes UTC, a GPS-stripped photo to be geolocated from a
  street sign, a base64 dead drop, and a "walk N blocks" instruction with a cancelled older plan.
- **insane**: every answer needs three sources; time zone traps (account creation vs. domain creation in other offsets,
  look-alike domains one wall clock or a few minutes off, a poster claiming a local time that contradicts the GPS
  timestamp, a companion shown in another zone), a CNAME chain with look-alike nodes and a stale mirror from another
  account, and two pastes whose clock faces order them the wrong way round.

## 2. The generated world (all fictional)

`osint/world.js` builds, per `(FLAG_SECRET, teamId, caseId)` and with the seeded PRNG of `terminal/gen.js` (one labelled
stream per section, so adding a field never moves the others):
a cast of 10-14 characters (names from syllables; two are alias accounts in insane), a social feed (posts with
timestamps that carry the poster's UTC offset, place tags, tags of people, photos), a company website with a staff page,
archived copy and a leaked-docs archive, a fake registry (WHOIS and DNS records), a map of an invented town (5 x 5 street
grid, 12-16 landmarks, 8 x 8 lettered grid, survey bounds for GPS), a paste site and EXIF-like metadata on photos.
Photos are procedural vector scenes (`osint/scenes.js`): a landmark silhouette, sky by time of day, people, and optionally
a street sign; the API sends shapes and the browser draws them as SVG elements, never markup.

Fiction guard (tested over many teams): hosts only end in `.example`, `.invalid` or `.test`; IP addresses only in
`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`; phone numbers only `555-01xx`; no URLs; nothing is fetched from the
internet. Names are random syllable combinations, so any resemblance to a real person or company is a coincidence.

Cost per request: the world is a constant-size corpus (at most about 130 posts, 16 photos, 14 domains) built in a few
milliseconds and paged out; nothing is stored or cached in the process (Vercel-safe: no Docker, no state across requests).

## 3. Mechanics

- **Investigation desk** (frontend): tabs Social Feed (feed and profiles), Web Archive (company site, leaked docs, paste
  site), Registry/WHOIS (records, DNS finder), Map (SVG, click or arrow keys to pick a point, GPS converter, landmark table),
  Photos (scene, alt text, metadata table) and Notes; a **Search** box above them calls
  `GET /osint/cases/:track/search` (bounded: at most 20 results per page, snippets under 200 characters).
- **Notes** is a client-side evidence notebook with "Pin to board" on every item; it is stored in `localStorage`
  (`osint-notes:<track>`, at most 100 items of 400 characters) and never reaches the server. A decoder (base64, hex, ROT13)
  is part of it.
- **Final question**: locked (403 `STAGE_LOCKED`) until every other question of the case is solved.
- **Answer matching** (`osint/cases.js`): names (case, accents, "Last, First", honorifics), landmarks (case, "the"),
  domains (scheme, `www.`, path), e-mail, IPs, ISO dates (also "14 March 2031"), `HH:MM` times, grid cells (`C4`, `c-4`)
  and map points (`x,y`, accepted inside 70 map units by collapsing the submission onto the true point). Normalised values
  are hashed (SHA-256) and compared with `timingSafeEqual`.
- **Attempt limits** (MongoDB-backed `consumeAttempt`, per team and question): 8 per minute and 40 per hour; the final
  question 3 per minute and 8 per hour. Every attempt is stored as a `Submission` (hash only).
- **Flags**: each question is a `challenges` row (`osint-<track>-<n>`); the per-team dynamic flag
  (`expectedFlagFor`) is returned only when the solve is recorded (and shown again on the solved question). A pasted decoy
  flag as an answer raises the usual integrity signal and is simply wrong.
- **Hints** (easy, medium): `POST .../questions/:n/hints` opens the next hint for free, one row per
  `(team, question, index)` in `osinthints`, listed for admins at `GET /osint/admin/hints`.

## 3b. Case board (red-string pinboard)

Each team has one shared **case board** per case (tab "Case board"). Players pin evidence (posts, profiles, pages, documents,
domains, photos, pastes, map places) and draw links between pins with a relation type. The **final question stays locked**
(403 `BOARD_LOCKED`) until the other questions are solved **and** the board has held the hidden chain once. The unlock is sticky
(`unlocked` is never cleared). Existing questions, points and solvability are unchanged.

- **Evidence ids**: `<source>:<id>` with source in feed, cast, pages, docs, registry (domain name), photos, pastes, map (landmark id).
  Every id exists in the team's own world; invented ids are refused (400 `BAD_EVIDENCE`). Labels are built from public fields only.
- **Relations**: `posted`, `at`, `owns`, `mentions`, `linked` (labels and help texts are sent to the browser).
  A link is an unordered pair plus a relation.
- **Hidden chain** (`chain` returned by each plot next to `pub` and `ans`, never sent out): M links, easy 4, medium 5, hard 5, insane 6.
  Only evidence ids and relation types are compared. Board responses (GET and every autosave) give a coarse
  `progress: { level, total }` and one generic nudge, never an exact count and never which links are missing. Levels: `complete`
  (sticky unlock), `close` (found >= total - 1), `started` (found * 2 >= total, i.e. at least half) and `none`. `started` starts at
  half, not at one link, so none -> started is not a "does this set contain any chain link" test. The exact `{ found, total }`
  of the SAVED board is only returned by the explicit `POST /osint/cases/:track/board/check` (3 a minute, 10 an hour per team and
  case; read-only, never unlocks). Why: an exact count after every save let an attacker who knows the evidence (but not the chain)
  recover the chain by group testing (about 75 saves for the easy case, measured in `docs/SECURITY_REVIEW_2.md`).
- **Caps** (anti-guessing): at most 40 pins and at most **2 x M links** (`LINKS_PER_REQUIRED` in `osint/board.js`); over-cap boards are
  refused with 422 `BOARD_LIMIT` and nothing is stored. Links must join pinned items, no self links, no duplicates. Saves are budgeted
  per team and case (30 a minute, 200 an hour, MongoDB-backed). `tests/osint/solvers.js` re-derives every chain from public data only.
- **Concurrency**: whole-board replacement guarded by `version`. One atomic `findOneAndUpdate({ teamId, track, version }, { $set, $inc: { version: 1 } }, { upsert: version === 0 })`;
  a stale version meets the unique `(teamId, track)` index (or matches nothing) and answers 409 `BOARD_CONFLICT`. The browser keeps its
  edits as operations, reloads on 409 and replays them on the teammate's board; it also polls every 20 s.
- **Admins** (and players without a team) see an empty read-only board of the preview world and cannot save (PUT is player-only);
  a banned team's board is read-only too. Edits are saved as you work (debounced); the page also sends pending edits when it is left,
  warns before closing with unsaved edits, and shows "Not saved yet, retrying" or "Could not reach the server, retrying" instead of
  claiming success when a save or the reload after a teammate's conflict fails.
  Saves respect the submissions freeze.
- **UI**: drag a pin (pointer events, works by touch), or focus it and use arrow keys (Shift = 50 units), Enter to select for linking,
  Delete to remove. A "Draw a link" form with selects and a link list give a fully keyboard and screen-reader path. The board scrolls
  sideways inside its own region on small screens (390 px).
- Code: `osint/evidence.js`, `osint/board.js`, `services/osintBoardService.js`, `models/OsintBoard.js`; frontend
  `components/osint/BoardTab.jsx`, `useBoard.js`, `src/osint/board.js`.

**Owner-only chains.** easy: suspect and lead both posted in the depot chat (paste), the lead posted the evening post, which was at the
tagged place. medium: creator and last editor of Q3 Route Plan, last editor linked to the code domain, last editor's untagged photo post
and its GPS landmark. hard: person linked to the blog, blog linked to the same-IP domain, the sign photo post, its corner landmark,
the reminder paste mentioning that post. insane: alias linked to the same-instant domain, registrant owns it, alias posted the mirror
note that mentions the domain, alias photo post at the true (GPS) landmark.

## 4. Seeding and playing

```bash
cd backend
npm run seed:osint        # 22 rows, idempotent (keeps solveCount and visible)
npm run dev               # then open /osint in the frontend
```

Admins see a fixed preview world (team id `admin-preview`) and cannot answer.

## 5. Security notes

- Server decides correctness; the browser never receives an answer, a flag or a flag hash before the solve. `confirmed`
  and `flag` appear only on solved questions of the caller's team (tests assert this for all four cases).
- Answer spaces such as "which of 12 people" are small, which is why the limits are per question and the final one is
  stricter. A wrong answer is a plain 200 `correct: false`.
- Every query, param and body is validated with `zod` (`.strict()`); unknown cases and sources are 404.
- Scene colours and polygons are validated again in the browser before drawing.

## 6. Owner-only: how each case is solved

All answers are derivable from what the API serves (`tests/osint/solvers.js` re-solves them independently).

**easy.** (1) Staff page entry with `social == @handle`. (2) The target's only post on the given evening carries the place tag
(other days have other places). (3) WHOIS registrant name equals the person (other domains belong to colleagues or a privacy
service). (4) `created` of that domain. (5) Paste chat: the speaker of "i have the ledger", handle to name via staff page.

**medium.** (1) Staff page shows everybody's `first.last@domain` except the target; the route-change memo confirms it.
(2) The profile bio shows `Site code: vf-xxxxx`; exactly one domain publishes `site-verify=<code>` (one has a near-miss code).
(3) The target's photo post of the given day has no place tag; GPS tags to the map (survey bounds) give the cell. (4) The post
on the given day with a photo that tags the target; poster handle to name. (5) The document "Q3 Route Plan": `author` is the
creator (user name `first.last` to person via e-mail), `lastModifiedBy` is the target.

**hard.** (1) Names on the archived staff copy that are missing from the current one (a new hire and a title change are
decoys). (2) Profile bio links the blog; its A record IP; the one other domain with the same A value (a neighbour on the same
/24 and a domain whose SPF text mentions the IP are decoys). (3) Latest photo post: `DateTimeOriginal` is UTC (offset
`+00:00`, comment says so); add the town offset from the Map tab; the post time is 20-45 minutes later. (4) The only photo with
a street sign and no GPS: sign `Row / Column street`, intersection from the map, nearest landmark. (5) The dead drop has three
base64 lines; one decodes to `codeword: <word>`. (6) `reminder.txt` (not `old-plan.txt`): from the sign corner walk `k` streets
east and `m` streets south, nearest landmark of that intersection.

**insane.** (1) The alias' `Joined` instant equals the `created` instant of exactly one domain (convert both offsets; one domain
has the same wall clock, one is minutes off); registrant is the person. (2) The mirror host named in the alias' paste
(`files.<domain>`): follow CNAME `edge.<host>` to `node-3.<host>` to its A record (stale `edge-old` and other nodes are decoys).
(3) The alias' photo post claims a local time; EXIF `GPSDateStamp/GPSTimeStamp` is the real UTC moment, not
`DateTimeOriginal` nor the post time. (4) GPS to map to the nearest landmark (the post's place tag is a decoy). (5) A post at
that landmark within 15 minutes of the GPS instant, compared by instant (look-alikes: same clock face in another zone, other
place at the same instant, same place five hours earlier). (6) Of the alias' two pastes the newer **by instant** (the other looks
newer by clock face) says "midpoint between the photo spot and <landmark>": photo spot is the landmark of question 4; answer is
the rounded midpoint of both landmark coordinates (within 70 units).
