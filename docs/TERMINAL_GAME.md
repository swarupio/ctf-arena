# Arena Terminal (terminal game) - design and contract

A terminal-style CTF mode for Mini CTF Arena, inspired by Unix-terminal club CTFs
(prompt `guest@arena:~$`, status "● ONLINE · GUEST"). Players type Unix commands to explore a **virtual** filesystem
and find hidden **codes** (flags). Three modes: **easy**, **medium**, **hard**. Every code is worth points on
the normal leaderboard.

This file is the contract between the people (and agents) building it. Change it in the same PR as the code.

## 1. Hard rules for this feature

1. **Nothing real is executed.** The shell is a JavaScript interpreter over an in-memory virtual filesystem (VFS).
   No `child_process`, no `fs` access to the host, no network, no `eval`/`new Function`, no dynamic `import()`.
2. **Server decides everything.** The VFS, the puzzles and the flags live on the server only. The browser sends a
   command line and receives text. Flags never appear in any bundle, API summary or log line.
3. **Stateless replicas.** Each `exec` request carries everything it needs (`mode`, `cwd`, `command`). No in-memory
   sessions. Progress lives in MongoDB (`Solve`). Output must be **deterministic**: all 3 replicas must print the
   same bytes for the same input (use the seeded generator in `backend/src/terminal/gen.js`, never `Math.random()` or
   `Date.now()` in puzzle data or command output; `date` prints a fixed in-universe date).
4. **Per-team flags.** Flag for code `n` of a mode is the normal dynamic flag
   `dynamicFlag({ secret: FLAG_SECRET, slug: 'terminal-<mode>-<n>', teamId, challengeId })` so a flag copied from
   another team never works. Content files only contain tokens like `{{flag:2}}`; the engine fills them per request.
5. **Bounded work.** Every command line has a work budget, output cap, depth caps and safe regex handling (section 6).
6. Do not weaken auth: players need a team (flags are per team); admins may explore read-only with a preview flag set.
7. No new runtime dependencies (use `node:zlib`, `node:crypto` only).

## 2. Files and owners

| Path | Owner | Notes |
|---|---|---|
| `docs/TERMINAL_GAME.md` | lead | this contract |
| `backend/src/terminal/vfs.js` | lead (constructors) + engine agent (traversal helpers appended) | constructor shapes are frozen |
| `backend/src/terminal/gen.js` | lead | seeded random helpers |
| `backend/src/terminal/shell.js`, `parser.js`, `commands/*.js`, `limits.js` | engine agent | `execute`, `complete` |
| `backend/src/terminal/extras.js` | extras agent | fun commands, merged into the engine registry |
| `backend/src/terminal/modes/easy.js` | easy agent | |
| `backend/src/terminal/modes/medium.js` | medium agent | |
| `backend/src/terminal/modes/hard.js` | hard agent | |
| `backend/src/terminal/modes/index.js` | lead | registry (`MODES`, `getMode`) |
| `backend/src/routes/terminal.js`, model/flag/admin/seed changes, API + schema docs | api agent | |
| `frontend/src/terminal/*`, `frontend/src/pages/Terminal*.jsx`, `frontend/src/api/terminal.js`, route + nav + challenge list promo | frontend agent | |
| `backend/tests/terminal/*.test.js` | whoever owns the code under test | |

## 3. Mode definition (`backend/src/terminal/modes/<mode>.js`, default export)

```js
export default {
  mode: 'easy',                       // 'easy' | 'medium' | 'hard' (also the file name)
  title: "Intern's Laptop",           // shown on the mode card and window title
  tagline: 'Your first day. Learn to look around.',
  difficulty: 'easy',                 // same as mode, used for Challenge.difficulty
  lore: ['line 1', 'line 2', ...],    // boot text typed by the client (plain text, <= 14 lines)
  user: 'guest', host: 'arena',        // prompt is  guest@arena:<cwd>$
  home: '/home/guest',                // starting directory
  fs: dir({ ... }),                   // root node, built with the constructors in vfs.js
  motd: 'text printed by `motd` and at login',
  codes: [                            // one entry per hidden code, n = 1..N in order
    { n: 1, title: 'Welcome aboard', points: 40, hints: ['nudge', 'bigger nudge', 'nearly the answer'] },
  ],
  sudoers: [{ cmd: 'cat', pathPrefix: '/var/secure/' }],  // optional; commands guest may run with `sudo`
  processes: 'PID  USER  ...\n...',   // optional; printed by `ps` / `ps aux`
  extraCommands: {},                  // optional per-mode static outputs: { crontab: '...', last: '...', who: '...' }
};
```

Points (use these): easy **4 codes x 40**, medium **5 codes x 90**, hard **6 codes x 180**.
`codes[].title` is only shown to a team after it solved that code (until then the UI shows `???`).

## 4. Virtual filesystem

Constructors live in `backend/src/terminal/vfs.js` (shapes are stable):

```js
dir(children, { mode = 0o755, owner = 'guest', group = 'guest', mtime })
file(content, { mode = 0o644, owner, group, mtime })       // text; may contain {{...}} tokens
binary(base64, { mode, owner, group, mtime })               // raw bytes (for `file`, `xxd`, `strings`, `base64`)
link(targetPath, { owner, mtime })                          // symlink (absolute or relative target)
vault(plainText, passphrase, { mode, owner, group, mtime }) // `cat` shows ARENAVAULT1 + hex blob; `vault open <file> <pass>` prints plainText
```

`mtime` is an ISO string (default `2024-03-14T09:26:53Z`). The engine renders `ls -l`, `stat`, `find -mtime/-newer`
from these. Mode bits and owner are enforced for `guest`: reading a file without the read bit prints
`cat: <path>: Permission denied`; entering a dir without the execute bit fails the same way.

### Flag tokens inside `file()` content

`{{flag:N}}` is replaced by the team's flag for code N (when the file is read). Filters chain with `|`:

| Filter | Effect |
|---|---|
| `b64` | base64 of the string |
| `hex` | lowercase hex of the bytes |
| `rot13` | rot13 |
| `rev` | reverse |
| `upper` / `lower` | case |
| `slice:a-b` | substring from index a to b (end exclusive) |
| `gzb64` | gzip then base64 (single line) |
| `xor:KEY` | XOR with ASCII key then hex |

Examples: `{{flag:2|rot13}}`, `{{flag:3|rev|b64}}`, three fragments `{{flag:5|slice:0-10}}`, `{{flag:5|slice:10-20}}`,
`{{flag:5|slice:20-99}}`. Unknown tokens print literally. A flag appears **only** through tokens (never hard-coded).
Decoys: put fake lookalikes such as `CTF{this_is_not_it}` or `CTF{nice_try}` freely. They never validate.

### Seeded generation

`backend/src/terminal/gen.js` exports `rng(seed)`, `int(r, min, max)`, `pick(r, arr)`, `hex(r, n)`, `ip(r)`,
`timestamp(r, baseIso, spreadMinutes)`, `repeatLines(count, makeLine)`. Use it for noise (logs, junk files). Never `Math.random`.

## 5. Engine API (`backend/src/terminal/shell.js`)

```js
export async function execute(line, ctx) -> { output: string, cwd: string, exit: number, effect?: string }
export function complete(partial, ctx)   -> string[]        // path / command completions for Tab
```

`ctx` = `{ mode, cwd, flag(n) -> string, progress() -> Promise<{ solved: number[] }>, user?, host? }` where `mode` is
the full mode definition object. `output` has no trailing newline problems: it is exactly what to print (may be empty).
`effect` is an optional client hint: `'clear'` (clear the screen), `'matrix'` (rain animation), `'reboot'`,
`'confetti'`. Unknown effects are ignored. `submit` is **not** an engine command: the client handles `submit <flag>`
by calling the submit endpoint.

Parsing: whitespace separated words, single quotes (literal), double quotes (with `$VAR` and `$(cmd)` expansion),
backslash escapes, `~`, `$HOME $USER $PWD $HOSTNAME $SHELL $?`, globs (`*`, `?`, `[a-z]`) against the VFS (cap 200 matches),
operators `|`, `&&`, `||`, `;`, redirects `>` and `>>` to files under `/tmp` (an in-memory overlay that lives only for
that one command line, so `echo hi > /tmp/a; cat /tmp/a` works), `2>/dev/null`, `$(...)` (depth <= 3).
Unsupported syntax must produce a bash-like error, never a crash.

## 6. Limits (enforced by the engine, covered by tests)

- Command line <= 300 chars; pipeline <= 8 stages; `$()` depth <= 3; `xargs` depth <= 2.
- Work budget per command line (count file reads / lines / tree nodes visited, e.g. 250k units). Exceeding it prints
  `bash: resource limit exceeded` and exit 137.
- Output <= 16 KB (truncate with `... (output truncated)`); single line <= 2000 chars in output.
- Regex (`grep -E/-P`-like, `sed s///`, `find -regex` if any): pattern <= 64 chars; reject nested quantifiers,
  backreferences and lookarounds with `grep: unsupported pattern`; `-F`/default basic patterns are escaped literals
  plus `.` `*` `^` `$` `[...]`. Never pass user text to `new RegExp` without these checks.
- `find` / `grep -r` / `tree` stop after the work budget. Glob expansion capped at 200 matches.
- No command reads host data. `date` is fixed to `Thu Mar 14 09:30:00 UTC 2024` + budgetless.

## 7. Command set (engine agent implements, content agents may rely on all of these)

Core: `help`, `man <cmd>`, `clear`, `history` (prints `history is kept in your browser, use the up arrow`),
`whoami`, `id`, `hostname`, `uname [-a]`, `date`, `pwd`, `cd [dir|-|~]`, `echo [-n] [-e]`, `env`, `true`, `false`, `exit`
(prints `logout` hint, no effect), `motd`, `hint [n]`, `status`/`codes`.
Files: `ls [-a -l -h -R -1 -t -r -S -d]` (colors via ANSI), `cat [-n]`, `tac`, `head/tail [-n N] [-c N]`, `less`/`more`
(aliases of cat), `nl`, `wc [-l -w -c]`, `file`, `stat`, `tree [-a -L N]`, `find [path] [-name -iname -type f|d|l
-size +N|-N[ckMG] -perm -user -mtime -newer -maxdepth -mindepth -empty -regex? -print]` (no `-exec`/`-delete`),
`du [-sh]`, `ln`/`cp`/`mv`/`rm`/`mkdir`/`touch` -> `Read-only file system` except under `/tmp`.
Text: `grep [-i -v -n -c -r -R -l -L -w -x -E -F -o -A -B -C -h -H]`, `sort [-r -n -u -k -t]`, `uniq [-c -d -u]`,
`cut [-d -f -c]`, `tr [-d -s] set1 set2` (ranges, classes `[:upper:]`), `rev`, `sed` (only `s/a/b/[g]`, `-n 'Np'`,
`'N,Md'`, `-e`), `awk` (only `-F`, `'{print $N ...}'`, `'/regex/'`, `NR==N`, `END{print NR}` simple forms), `diff a b`
(normal format), `comm` optional, `paste` optional, `column -t` optional, `xargs cmd` (re-enters the engine, depth cap).
Encoding/binary: `base64 [-d]`, `xxd [-p -r -l -s]`, `hexdump -C`, `od -c` optional, `strings [-n N]`, `gzip -d`/`gunzip`/`zcat`
(node:zlib), `md5sum`, `sha1sum`, `sha256sum`, `rot13` is NOT a command (use `tr`), `factor` optional.
System-ish (static, from the mode definition): `ps [aux]`, `crontab -l`, `last`, `who`, `w`, `uptime`, `df -h`,
`ss`/`netstat` -> `command not available in this sandbox`, `ping`/`curl`/`wget`/`ssh`/`nc` -> network disabled message.
`sudo`: only commands listed in `mode.sudoers` (cmd + pathPrefix) run as root (can read root-only files); otherwise
`guest is not in the sudoers file. This incident will be reported.` `sudo -l` lists the allowed commands.
`vault open <file> <passphrase>`: compares with the vault passphrase in constant time; prints the plaintext
(tokens filled) or `vault: wrong passphrase`.
Everything else: `bash: <cmd>: command not found` (exit 127) plus, for near misses, a short `Did you mean 'ls'?`.

`hint [n]`: uses `ctx.progress()`; picks the lowest unsolved code and prints hint tier `n` (default 1, max
`hints.length`) as `[hint 2/3 for code 4] ...`; with everything solved prints a congratulation. `status`/`codes`:
`Codes found: 2/5` and a list (`[x] 1  <title>`, `[ ] 2  ???`).

ANSI: output may contain only SGR sequences (`ESC[0m`, `1`, `2`, `31`-`37`, `90`-`97`). `ls` colors dirs blue (34, bold),
links cyan (36), executables green (32); `grep` colors matches red (31;1); `tree` like `ls`. When output is piped or
redirected, no colors (like real tools).

## 8. HTTP API (api agent implements; document it in `docs/API_SPEC.md`)

All routes need `Authorization: Bearer <ID token>`; player or admin; mounted at `/api/terminal`.

| Method + path | Body | Response |
|---|---|---|
| `GET /modes` | - | `[{ mode, title, tagline, difficulty, codes, solved, points, pointsEarned, lore }]` (`solved` = my team's count; no flags, no code titles of unsolved codes) |
| `GET /:mode/progress` | - | `{ mode, total, solved: [{ n, title, points, firstBlood }], remaining }` |
| `POST /:mode/exec` | `{ command: string<=300, cwd: string<=200 }` | `{ output, cwd, exit, effect? }` (cwd normalized; invalid cwd falls back to home) |
| `POST /:mode/complete` | `{ partial: string<=200, cwd }` | `{ matches: string[] }` (<= 50) |
| `POST /:mode/submit` | `{ flag: string<=200 }` | `{ correct, code?, title?, pointsAwarded, firstBlood, message, solved, total }` |

Errors use the standard `{ error: { code, message } }`. `mode` outside easy|medium|hard -> 404 `NOT_FOUND`.
A player without a team gets `NO_TEAM` (409/403 as the existing `getTeamContext` does); a banned team gets `TEAM_BANNED`.
Admins may call `modes`, `progress`, `exec`, `complete` (preview flags) but not `submit`.
Submit rules: validate with zod `.strict()`; compare against the expected flags of **all** the mode's codes the team has
not solved yet using the same constant-time comparison as `verifyFlag`; rate limit **10 attempts / minute / team / mode**
counted in MongoDB (`Submission`); wrong attempts are stored against the mode's first code; correct -> `recordSolve`
(first blood, scoring, leaderboard exactly like other challenges). Already solved code -> `{ correct:true, alreadySolved:true,
pointsAwarded:0 }` (no error). Never echo the submitted flag or the expected flag.

## 9. Data model changes (api agent; update `docs/DATABASE_SCHEMA.md`)

`Challenge.type` gains `'terminal'`; `Challenge.category` gains `'terminal'`; new optional sub-document
`terminal: { mode: 'easy'|'medium'|'hard', code: Number }` (`_id: false`), index `{ type: 1, 'terminal.mode': 1 }`.
`verifyFlag` treats `terminal` like `docker` (dynamic per-team flag; there is no stored hash).
Terminal challenges are created by `npm run seed:terminal` (idempotent upsert keyed by slug
`terminal-<mode>-<n>`; title `Terminal <Mode> #<n>`, description generic, `visible: true`, points from the mode
definition) and are **not** creatable from the admin UI. They may be hidden/edited (points, visible) by admins.
Normal challenge list/detail summaries hide nothing server-side; the frontend filters `type === 'terminal'` out of the
card grid and shows one promo card for the terminal game instead.

## 10. Frontend (frontend agent)

Routes (inside `ProtectedRoute`): `/terminal` (mode picker) and `/terminal/:mode` (the terminal). Nav gets **Terminal**.
Look: our existing theme (header, footer, tokens) around a dark terminal window (ink background, off-white text, lime
accent, JetBrains Mono): title strip with three squares, `CTF Arena · Terminal`, status chip
`● ONLINE · <TEAM NAME>` (admins: `● ONLINE · ADMIN (preview)`), prompt `guest@arena:<cwd>$` (cwd shown with `~`).
Must have: boot sequence (typed lore + "type help to begin"), command history (up/down, kept per mode in
`localStorage`), Tab completion (commands client-side, paths via `/complete`), Ctrl+L, Ctrl+C, copy-friendly output,
client-side `clear`, `history`, `submit <flag>` (calls submit endpoint, prints a result block, big ASCII banner on
first blood), ANSI SGR rendering (parse to React nodes, never `dangerouslySetInnerHTML`), highlighted flag-looking
strings, a side HUD (codes progress with `???` until solved, points, session timer, cheat-sheet of common commands,
mode switcher), mobile layout (HUD collapses under the terminal, quick-command chips), `effect` handling
(`clear`, `matrix` canvas rain for ~4 s respecting reduced motion, `confetti` pure CSS), a11y (`role="log"` output,
labelled input, focus returns to the input on click, `prefers-reduced-motion`).
Error states: network error prints `connection lost, retrying...` style lines in the terminal, 429 and `NO_TEAM`
produce friendly terminal messages with a link to the Team page.

## 11. Puzzle design guidelines (content agents)

Progression (each code needs the commands taught before it):

- **easy** (Intern's Laptop, 4 codes): `ls`, `cd`, `pwd`, `cat`, `ls -a` hidden files, `head`/`tail`, plain `grep`. A
  `README`/`welcome` file teaches the game. At most 2 steps per code. Never needs pipes.
- **medium** (NovaCorp Server Room, 5 codes): `find` by name/size/type, `grep -r`, `wc`, `sort | uniq -c`, `cut`,
  `base64 -d`, `tr` rot13, `diff`, `ls -l` permissions, symlinks, `.bash_history`-style clues, chaining 2-4 commands
  with pipes. Mix one multi-stage code where code N's file location is revealed by code N-1's text.
- **hard** (The Vault, 6 codes): long logs (thousands of lines) needing `awk`/`sort`/`uniq -c`/`sed`, layered encodings
  (`base64 | gunzip | rev`...), `xxd`/`strings` on binary blobs, `vault open` with a passphrase found elsewhere,
  `sudo` with the allow-list, split flags assembled from 3 fragments, symlink loops/mazes, decoy flags, `md5sum`
  matching, `find -newer`/`-mtime` reasoning, `ps` clue, a final "boss" code that needs several earlier discoveries.

Rules for every mode:
1. Every code is solvable using **only** commands from section 7 and a scripted solution is a unit test (section 12).
2. At least 3 hint tiers per code; tier 3 almost gives the command.
3. Lore/flavour consistent per mode; lots of believable decoys and noise, but keep the VFS under ~3 MB total
   (generate noise with `gen.js`).
4. Flags only via `{{flag:N}}` tokens. Decoy flags look like `CTF{...}` but must never equal a real one.
5. File paths and names must not contain the word `flag` for the harder modes (use `token`, `key`, `badge`, `receipt`...)
   so `find -name '*flag*'` is not a shortcut. Easy mode may use friendly names.
6. Do not make the intended path depend on features marked optional in section 7.

## 12. Tests

- Engine: unit tests for each command group, parser, globbing, pipes, limits (budget, output cap, regex rejection),
  determinism (same input twice -> same output), permission handling, `sudo`/`vault`.
- Modes: `backend/tests/terminal/<mode>.test.js` runs a **scripted solution** for every code through `execute` with a fake
  `flag(n)` (for example `(n) => 'CTF{test_' + n + '}'`) and asserts the exact flag string appears in the output of the
  final command. It also asserts: no code is obtainable with one trivial `grep -r CTF /` (hard and medium), every
  `hints` array has >= 3 entries, no file content contains an un-tokenized real-looking flag, total VFS size cap.
- API: supertest with mocked Mongoose models (pattern from `challengeRoutes.test.js`): auth, roles, validation,
  rate limit, per-team flags, no flag leaks in any response, mode 404.
- Frontend: node:test for the pure helpers (ANSI parser, history, completion merge, prompt formatting, submit command parsing).

## 13. Extra (fun) commands contract

`backend/src/terminal/extras.js` default-exports nothing and named-exports `extraCommands`:

```js
export const extraCommands = {
  cowsay: async ({ args, stdin, ctx }) => ({ stdout: '...', exit: 0, effect: undefined }),
};
```

Handlers are pure text generators: they never touch the VFS or the host, are deterministic (no randomness without
`gen.js` seeded from the arguments), return ASCII only (ANSI SGR allowed), and cap their own output. The engine merges
`extraCommands` into its registry (core commands win on name clashes) and lists them in `help` under "extras".
`stdin` is the piped text or `null`. `ctx` is the engine ctx from section 5 (`ctx.flag` must **not** be used by extras).

## 14. As built: engine clarifications (these override sections 5 to 7 where they differ)

- **`complete(partial, ctx)`**: `partial` is the whole line before the cursor. The first word, or a word after `| ; && ||`,
  completes command names; everything else completes paths (`cd` offers directories only). Matches are full, shell-escaped
  replacements for the last word (directories end in `/`, spaces are backslash-escaped, an open quote is preserved), at most
  50. The frontend sends the line before the caret (last 190 chars) and strips the escaping before merging.
- **Output**: exactly one trailing newline is stripped (a bare `echo` returns `''`). Non-SGR escape sequences become `^[`,
  other control characters are removed. Colours are on for tty-like output; `ctx.color === false` turns them off (tests).
  `grep` never splits a `CTF{...}` token with colour codes.
- **Static per-mode output**: `mode.extraCommands[name]` is printed for any command the core does not know (flag tokens
  rendered) and also drives `crontab -l`, `last`, `who`, `w`, `uptime`, `df`, `free`. `ps` prints `mode.processes`.
  Optional `mode.env` (object) adds environment variables (tokens rendered).
- **sudo**: every denial prints the contract sentence. `pathPrefix` is matched after path normalisation (so `..` escapes are
  denied); a symlink inside the prefix may still point elsewhere (a puzzle may use that).
- **Resource limit**: replaces all earlier output with `bash: resource limit exceeded` (exit 137). Work budget 250,000 units
  (open file = 1 + 1/KiB, 1 per 4 lines, 1 per VFS node, 50 per xargs batch or for iteration, 1 per 4 awk statements). Data between
  pipeline stages is capped at 4 MiB; gzip output at 4 MiB. Glob expansion stops at 200, brace expansion at 100 words.
- **Regex rules** (`backend/src/terminal/regex.js`): patterns over 64 chars, backreferences, lookarounds and nested quantifiers
  are rejected with `grep: unsupported pattern` (at most 12 unbounded repeats; delimited idioms like `([0-9]+\.){3}` are
  allowed with lines clipped to 4096 chars; alternation under an unbounded repeat must be prefix-free literals).
- **Shell syntax**: `for` and `if` work; `while`, `case`, functions, here-docs, `&` and process substitution print a bash-style
  error. No scripts or `./file` execution (`Exec format error`). Variables, `/tmp` and `OLDPWD` live for one command line.
- **Not implemented**: `find -exec/-delete/-printf`, `sort -R`, sed blocks/hold space/`-f`, awk user functions/getline/system.
- **Debug**: setting `ARENA_TERMINAL_DEBUG` makes internal errors throw instead of printing `internal error`.
- Test helpers: `backend/tests/terminal/_helpers.js` (`makeTestCtx`, `run`, `out`, `stripAnsi`, `sampleFs`).

## 15. Fair play

Honeypots, tainted flags, pacing (`SLOW_DOWN` 429), cadence and velocity signals and the admin review list are described in
`docs/FAIR_PLAY.md`. Exec requests closer than 300 ms apart are refused, and more than 50 per minute are refused and recorded.

## 16. Per-team puzzle variation and AI bait

Goal: a shared walkthrough (a friend's list of commands, or an AI answer found online) must stop working, because the
values a puzzle depends on differ for every team. Flags are already per team (section 1.4); this extends it to the puzzle data.

**Seed.** `ctx.seed` is a hex string = `HMAC-SHA256(FLAG_SECRET, 'terminal-seed:' + teamId + ':' + mode)` (admins use the fixed
preview team id). When `ctx.seed` is missing (unit tests, stubs) the engine uses the constant `'arena-default-seed'`.

**Seed tokens** (rendered wherever flag tokens are: file content, vault passphrase and vault plaintext, `mode.env`,
`mode.extraCommands`, `mode.processes`):

```
{{seed:KIND}}          same as {{seed:KIND:1}}
{{seed:KIND:SLOT}}     SLOT is a small integer; the same KIND+SLOT always gives the same value for a team and mode
```

| KIND | Value |
|---|---|
| `word` | one of 256 fixed lowercase words (list in `backend/src/terminal/seedwords.js`) |
| `pass` | `<word>-<word>-<4 digits>` |
| `ip` | `198.51.100.N` or `203.0.113.N`, N in 2..250 (documentation ranges) |
| `num4` | 4 digits, 1000..9999 |
| `hex8` | 8 lowercase hex chars |
| `user` | one of 64 first names |

Value = derived from `HMAC-SHA256(seed, KIND + ':' + SLOT)` (first 6 bytes). Seed tokens accept the same filters as flag
tokens (`|b64`, `|hex`, `|rot13`, `|rev`, `|upper`, `|lower`, `|slice:a-b`, `|xor:KEY`, `|gzb64`) plus two new ones:
`|wide` (UTF-16LE: every char followed by a NUL byte, for `strings`/`xxd` puzzles) and `|md5` (md5 hex of the string).
New token `{{md5file:/abs/path}}` = md5 hex of the rendered bytes of that VFS file (the referenced file must not itself contain
`md5file` tokens; unknown path prints 32 zeros). Vault passphrases may contain seed tokens: the engine renders the passphrase
with the same ctx before comparing, and `vault open` prints the rendered plaintext.

As built (`seed.js`, `seedwords.js`, token renderer in `vfs.js`):
- `seedValue(seed, kind, slot)` returns `null` for an unknown kind (the renderer then prints the token literally). Bytes of
  `HMAC-SHA256(seed, kind:slot)`: `word` = `WORDS[b0]`; `pass` = `WORDS[b0]-WORDS[b1]-(1000 + uint16(b2,b3) % 9000)`;
  `ip` = `(198.51.100 | 203.0.113)[b0 & 1]` + `.` + `(2 + b1 % 249)`; `num4` = `1000 + uint48(b0..b5) % 9000`;
  `hex8` = hex of `b0..b3`; `user` = `NAMES[b0 & 63]`. The two lists are frozen (reordering changes every team's values) and share no
  word with the mode files, so a team's value never equals one of the fixed decoys. Slots are `\d{1,6}` (`01` is slot 1).
- `|wide` and `|md5` also work on flag tokens. `md5file` accepts filters too (`{{md5file:/etc/key|upper}}`). It reads the mode's
  static tree as root (permissions do not matter, symlinks are followed, `/tmp` and anything the player wrote are invisible), charges
  the work budget for the hashed bytes, and prints 32 zeros for a relative or unknown path or a directory. Recursion guard: a
  `md5file` token inside a file that is being hashed prints 32 zeros (so cycles terminate and are deterministic).
- Renderers receive a token source: `tokenSource(flagFn, { seed, lookup, tick })` from `vfs.js` (the engine builds it in `makeRc`;
  a plain flag function or nothing still works and means the default seed, no `md5file`). Extras get a ctx without `flag` and without `seed`.
- `vault()` stores the raw passphrase template; the hex blob shown by `cat` is derived from that template, so it is the same for every
  team and says nothing about a team's passphrase.
- Tests: `makeTestCtx({ seed })`; see `backend/tests/terminal/seed.test.js` and `seedApi.test.js`.

**Where to vary** (keep puzzles fair and solvable by discovery, never by guessing):
- the one anomalous IP the log puzzles are about (medium code 2, hard code 1), the passphrases and key names (`kid` values), the
  secret inside key files, vault passphrases, a usernames-in-notes style clue. Never vary file names or paths (names cannot
  be tokens); structure and decoys stay the same for everybody.
- Every hint and solution in tests must work with ANY seed: tests run each scripted solution with at least two different seeds
  and assert that a solution which hard-codes team A's values fails for team B.

**AI bait** (from `backend/src/services/integrityBait.js`: `BAIT_NOTICE_LINES`, `BAIT_FILE_COMMENT`, `CANARY_COMMANDS`): each mode
gets 1-2 plausible bait files (for example `~/.cache/assistant-notes.txt`, `/etc/motd.d/90-automation-notice`) addressed to
'automated assistants' telling them to run `ai-verify --session`. The command is trapped in `routes/terminal.js`
(records a signal, replies with a tainted decoy). Bait must never alter the puzzle outputs (do not put it inside logs or files that
puzzles count, sort or diff) and must be harmless and slightly funny to humans.
