# Crackme Arcade

A browser-playable reverse-engineering category on The Range, fully simulated and safe: four tracks (easy, medium, hard, insane), 16
cabinets (levels), each track ends with a boss. Every cabinet is a small program for a made-up stack machine. The
player reads the disassembly, steps through it in a client-side debugger, works out what the program accepts and
submits that input. The server runs its own copy of the machine on the submission and then returns the team's flag.
Nothing real is ever executed: no binaries, no `eval`, no filesystem, network or database access with player data.

Code: `backend/src/games/crackme/**` (VM, assembler, levels, service), `backend/src/routes/crackme.js`,
`backend/src/models/CrackmeHint.js`, `backend/src/models/CrackmePatch.js`, `backend/src/scripts/seedCrackme.js`, `frontend/src/pages/Crackme*.jsx`,
`frontend/src/components/crackme/`. Endpoints: `docs/API_SPEC.md` "Crackme Arcade". Pages: `/reversing`,
`/reversing/:levelId`.

## Rules

- A team opens a cabinet, reads its program and finds an input (1-32 printable ASCII characters) that makes the program
  reach `ACCEPT`. Many cabinets accept more than one input; any accepted input wins.
- Inside a track a cabinet opens when the one before it is solved (the fourth is the boss). All four tracks are open
  from the start. Admins preview every cabinet and cannot submit.
- A correct input records a team solve (unique `teamId + challengeId`, duplicate-safe), pays the fixed points and
  returns the team's dynamic flag `CTF{crackme_<id>_<12 hex>}` (`flagService`, `HMAC(FLAG_SECRET, teamId:challengeId)`).
  The flag is never sent before the solve. The same flag is also accepted by `POST /api/challenges/:id/submit` (the
  `reversing` type is dynamic, like `weblab`).
- Easy, medium and hard cabinets have hints, opened one at a time in order, priced as a percent of the level's points and deducted when the level is captured (`docs/HINTS.md`), and logged for admins (`CrackmeHint`). The
  Insane track has no hints.

## Per-team variation, statelessness

`Rng(secret, teamId, levelId)` expands `HMAC(FLAG_SECRET, "crackme:<teamId>:<levelId>")` into a byte stream. The
program text a team sees is generated from it on every request: passwords, XOR keys, rotation counts, hash
multipliers and moduli, serial weights, key schedules, seeds, decoy strings and the encryption key of packed code.
Nothing is stored, replicas agree, and two teams never share a program or an accepted input. Admins preview with the
fixed id `admin-preview`.

## The machine (ISA reference)

`backend/src/games/crackme/vm.js` is a pure module with no imports. The browser debugger uses a byte-identical copy
(`frontend/src/components/crackme/vm.js`); a backend test fails if the two files differ and replays every level on
both interpreters step by step. **When you change `vm.js`, copy it over the frontend file.**

Values are unsigned 32-bit integers that wrap. A program is a list of at most 256 instructions
(`["PUSH", 65]`, `["ADD"]`), run from address 0. Data memory has 64 cells (addresses 0-63, initially 0). The operand of
instruction `i` is also the code cell `256 + i`, which `LOAD` can read and `STORE` can overwrite: that is how the
self-modifying and self-decrypting cabinets work. Any other address is a `BAD_ADDRESS` fault. The stack holds at most
64 values.

| Instruction | Effect |
|-------------|--------|
| `PUSH n` | Push `n`. |
| `POP` / `DUP` / `SWAP` | Discard, duplicate or swap the top values. |
| `ADD` `SUB` `MUL` | `b = pop, a = pop`, push `a + b`, `a - b`, `a * b` (32-bit wrap). |
| `MOD` | `b = pop, a = pop`, push `a mod b` (`b = 0` is a fault). |
| `XOR` | `b = pop, a = pop`, push `a xor b`. |
| `ROL` | `n = pop, a = pop`, push `a` rotated left by `n mod 32` bits. |
| `CMP` | `b = pop, a = pop`, push `0` if equal, otherwise `1`. |
| `JMP n` | Jump to address `n`. |
| `JZ n` / `JNZ n` | `v = pop`; jump to `n` if `v` is 0 / not 0. |
| `LOAD` | `a = pop`, push the cell at address `a`. |
| `STORE` | `a = pop` (address), `v = pop`, write `v` to the cell at `a`. |
| `INPUT` | Push the next input character code, or 0 once the input is used up. |
| `DBG` | Push 1 when a debugger is attached, otherwise 0. |
| `ACCEPT` / `REJECT` / `HALT` | Stop. Only `ACCEPT` accepts; `HALT` counts as rejected. |

Limits (enforced by the same code on both sides): 20 000 steps for the server verdict (`timeout` beyond that, never
accepted; hard cap 100 000 for any caller), a 64-value stack (`STACK_OVERFLOW`), 256 instructions, 64 input
characters. A running-off-the-end pc or a bad jump is a `PC_RANGE` fault. A malformed program is a fault and never
throws. The VM has no output instruction, so there is nothing that can grow without bound.

**Debugger flag.** The browser debugger runs with `DBG = 1` (a checkbox, "Hide debugger", switches it to 0). The server
verdict always runs with `DBG = 0`. Anti-debug cabinets exploit that on purpose: with a debugger attached they accept a
decoy, or silently compute a different hash. This is the one place where the local run differs from the server run, and
it is documented in the debugger UI.

## Tracks, levels and points

Points are fixed. There is **no first-blood bonus**: `scoringService.hasFirstBloodBonus` is an allowlist (`static`,
`docker`) and `reversing` is not on it (tested). Points come from the level definition, never from the Challenge row.

| Track | Cabinets | Points | Max |
|-------|----------|--------|-----|
| Easy, Coin Slot Corner (hints) | e1 Pong Plus 20, e2 Snake Byte 25, e3 Galaga Gate 30, e4 Boss: Dr. Pixel 60 | 20 + 25 + 30 + 60 | 135 |
| Medium, High Score Alley (hints) | m1 Tetris Lock 40, m2 Pac-Maze 50, m3 Frogger Key 60, m4 Boss: Chip Hacker 120 | 40 + 50 + 60 + 120 | 270 |
| Hard, Attract Mode Basement (hints) | h1 Fortress Serial 80, h2 Anti-Debug Alley 100, h3 Tape Loop 120, h4 Boss: The Warden 200 | 80 + 100 + 120 + 200 | 500 |
| Insane, Warehouse of Lost ROMs (no hints) | i1 Self-Modifying Cabinet 150, i2 Two-Face Cabinet 200, i3 Ghost in the Machine 250, i4 Final Boss: MEGA-ROM 400 | 150 + 200 + 250 + 400 | 1000 |

Maximum for the whole category: **1905 points** (16 cabinets). The Challenge model has no `insane` difficulty, so insane
rows are stored as `hard`; `category` is `pwn` (there is no reversing category). Rows are created by
`npm run seed:crackme` (slug `crackme-<id>`, `type: 'reversing'`).

## Time-travel debugger

Frontend only (`components/crackme/timeline.js`, `TimeTravel.jsx`, `Debugger.jsx`); the VM is deterministic, so the past is
rebuilt, not stored. A timeline keeps a full machine copy every 128 steps (at most `maxSteps / 128 + 1`, hard safety cap 800)
and replays forward from the nearest copy, so memory respects the VM step cap. Features: Step back / Step forward and a
slider over the executed steps (replaying the past never touches the live machine; Run continues from the furthest step),
a "What changed" panel (PC, last CMP flag, input pointer, stack removed/added, memory and code cells, branch taken or not),
"What decided it" after the program stops (the last conditional branch and the CMP feeding it, highlighted in the listing,
with a "Go to that step" button), and up to 8 pinned "watch" cells (data cells 0-63 or code cells 256+n; tap a memory cell or
type an address; changes are stated in words). Keys when no text box is focused: S step forward, B step back, R run/pause,
E run to end, X reset, W focus the watch box (shown on the buttons and in the page text, `aria-keyshortcuts` set).

## Reading tools (cross-references, flow graph, data, navigation)

Frontend only, client side, built from the listing and VM description the player already has (`components/crackme/analysis.js`,
`AnalysisView.jsx`, `analysis.css`; tests in `frontend/tests/crackmeAnalysis.test.js`). No backend, program, answer, hint or Patch Bay change.
The analysis reads the program as the viewed machine holds it, so self-decrypting code is analysed again once it has been rewritten, and
the graph follows the time-travel slider.

- **Cross-references.** Every block start gets a gutter line with its label and `xrefs from 003, 024` (a loop-back is marked with an arrow). Each
  `JMP`/`JZ`/`JNZ` shows a link to its target. A target outside the listing (packed code before it decrypts) is stated, not followed.
- **Labels are neutral.** `entry`, `loc_035` (the decimal address, as in the listing) and `exit A`, `exit B`, ... for blocks that end in
  `ACCEPT`, `REJECT` or `HALT`, lettered in address order. Labels never say which exit is the winning one or whether a branch is a check; a test
  rejects words such as accept, reject, win, fail or good in a label. The instruction itself is still shown in the listing.
- **Flow graph.** SVG, deterministic layout (layers by longest path from the entry, columns by address, one right-hand lane per distant target), no
  library. The executing block is highlighted and kept in view while stepping or travelling back. Blocks are keyboard focusable (Enter or Space
  shows the block in the listing); a collapsible text list gives every block and its successors. Code no jump reaches has a dotted outline.
- **Data panel.** Distinct `PUSH` constants (decimal, hex, character, where used), plus strings of 3 or more printable characters from three
  places: consecutive `PUSH` operands, literal `PUSH value, PUSH cell, STORE` writes, and the memory of the viewed step. Characters compared one at
  a time (`INPUT`, `PUSH c`, `CMP`) are deliberately not joined into a string.
- **Navigation.** Go to address (decimal, `0x` hex or a label), Back and Forward through your own jumps, Jump to current PC, and Find instruction
  by mnemonic (or its start), operand value (decimal, hex or `'A'`) or label, with a match count and Next/Prev (Enter, Shift+Enter).
- **Phones.** Under 900 px the graph and the data panel become two tabs, the controls are 44 px tall, and the graph and tables scroll inside their own box.

## Patch Bay (bonus mode, hard and insane cabinets h1-h4, i1-i4)

The player edits up to 20 instructions of THEIR team's program and submits the edits. Rules shown in the UI: make the
cabinet accept every one of 6 hidden test inputs and still accept the team's real serial.

- Whitelist (`backend/src/games/crackme/patch.js`, byte-identical browser copy in `frontend/src/components/crackme/`):
  `JNZ` to `JZ` or `POP`, `JZ` to `JNZ` or `POP`, `CMP` to `SUB` or `XOR`. Only the opcode changes (a flipped branch keeps its
  target; `POP` drops it). Everything is stack neutral. Terminals (`ACCEPT`/`REJECT`/`HALT`), `JMP`, `PUSH` etc. are not patchable.
- The server rebuilds the program from the team seed, applies the edits and runs it with no debugger and the 20 000 step cap.
  Hidden inputs come from `Rng(secret, teamId, '<level>-patch')` (6 inputs of mixed shape and length up to 32, all rejected by
  the original program, never the real serial). They are never sent; the reply has only `passed`/`total`/`serialOk`.
- Valid = all 6 pass and the real serial is still accepted. Reward: a cosmetic badge (collection `crackmepatches`, unique
  `teamId + levelId`, inserted atomically with `$setOnInsert`). No points, no flag, no Solve, no Submission, so the 1905 maximum
  is unchanged. Players may debug their patched program locally ("Show my patched program in the debugger").
- Attempts: 8 per team per level per minute through `consumeAttempt` (`crackme-patch:<team>:<level>`), counted after the
  structural checks (which cost nothing and run no VM). Locked cabinets 403, easy/medium 404 `NO_PATCH_BAY`, admins 403
  (preview only), submissions freeze applies.
- Solvable for every team: the test solver (`tests/crackme/solvers.js` `patchSolution`) turns every check that jumps to
  REJECT/HALT into `POP` (keygen cabinets also flip the dash test) in at most 18 edits, verified for 1500 seeds per cabinet.

## Security properties

- The server sends the program (that is the puzzle), VM limits and opened hints. Never an accepted input, a key table
  outside the program, or a flag, except that a correct submission returns that team's own flag. Hints reveal at most
  the first character of an accepted input.
- The verdict is the server running the team's own program on the submitted input. Nothing the browser computed is
  trusted. The input is validated by `zod` (1-32 printable ASCII characters, strict body).
- Attempts: 8 per team per level per minute through the Mongo-backed `consumeAttempt` limiter (`crackme:<team>:<level>`),
  counted for every attempt. Locked levels answer 403 before the limiter. Every attempt is stored in `Submission`
  (hash only).
- Fair play: a wrong input calls `integrityService.checkSubmittedFlag`, so a pasted honeypot flag leaves a signal.
- The VM source is tested for the absence of `eval`, `Function`, `import`, `process`, `fetch` and `node:` references.

## Tests

`backend/tests/crackme/`: `vm.test.js` (instructions, limits, faults, malformed programs, purity), `puzzles.test.js`
(every level solved by an independent solver in `solvers.js` that only reads the public program, for 12 teams;
determinism; per-team variation; anti-debug decoys; no leakage; backend and browser interpreters agree),
`api.test.js` (access, locks, right and wrong input, double submit and parallel bursts, rate limit, hints, maximum points,
flag wiring, no leakage), `seed.test.js`. Frontend: `frontend/tests/crackme.test.js` (pure helpers and the browser VM).

## Owner-only solutions

Not linked from the UI; do not paste into public places. Per-team values differ, so these are the methods, not answers.

- **e1** the PUSH before each CMP is a character code. **e2** the character is `t xor key` (both PUSH operands visible).
  **e3** three fixed letters, two free ones, last letter is `65 + (sum of the five mod 26)`. **e4** the table at
  memory 10.. holds `char xor key_i`; `key_{i+1} = (key_i * M + A) mod 256`.
- **m1** group one: sum mod 97 equals a constant (first letter fixed); group two: XOR of the four letters equals a
  constant; a hyphen in between. **m2** `hash = (hash * m + c) mod p` over four characters equals a constant: try all
  10 000 PINs. **m3** `char = ror(t xor key, rot)` per position. **m4** per step `acc' = rol(acc xor c, r) + a` is
  compared with a constant, so `c = ror(acc' - a, r) xor acc`, starting from the first PUSH.
- **h1** each group is a weighted sum mod a prime; group three starts with group one's first letter plus a constant.
  Search each group (26^4). **h2** `DBG` jumps to a decoy path; use Hide debugger or read the real path: key stream
  `key' = (key * M + A) mod 251`, `c = t xor key`. **h3** ten digits; weights alternate 1 and 3 (weighted sum mod 11),
  plain digit sum mod 7, digits 1-2 fixed, digit 6 = digit 3 + 3 (1-based), and the loop rejects a missing digit, so exactly ten digits are needed: brute-force the free digits. **h4** keygen:
  `NAME-SERIAL`, name of the compared length, `h = rol(c xor h, r) + a` from the seed, serial = `h mod 100000`.
- **i1** the start-up code STOREs computed constants into the PUSH placeholders before they run; run to the first
  INPUT in the debugger and read the patched listing, then undo `rol(c xor key, r)`. **i2** operands of the body are
  XORed with a key and a start-up loop decrypts them with LOAD/XOR/STORE; hide the debugger, run to the first INPUT,
  read the decrypted constants. **i3** the hash seed is `S + DBG * D` (use Hide debugger or add the delta; the generator redraws `D` until the debugger run really differs): choose
  four letters with `hash mod 7 = k`, then each of the last four letters is `65 + ((hash * m_j + a_j) mod 26)`.
  **i4** packed keygen like h4 behind the i2 trick.
