# Fixer log

Running record of fixes by the standing fixer. Nothing here is committed.

## Round 1
- Baseline: frontend tests 491/0, backend lint clean, frontend build clean, backend suite one half 875 pass; other half 1778 pass, 2 failed in `tests/vercel.test.js`.
- `tests/vercel.test.js` timeout (flake). Root cause: the first test cold-imports the whole app (`api/index.js`) and took 19.2 s under load against the 20 s `testTimeout`. Passes alone. Fix: that test gets a 60 s timeout. Files: `backend/tests/vercel.test.js`.
- Lint warning `useMemo` missing `emphasised` in Leaderboard. Fix: `emphasised` is a `useCallback([focused, myTeamId])` and is the memo dependency. Files: `frontend/src/pages/Leaderboard.jsx`.
- Lint warning `useMemo` missing `confirmTotp` in AuthContext. Fix: `acceptSignIn` and `confirmTotp` are `useCallback`s (they only use stable setters and `auth`), both added to the memo deps; behaviour unchanged. Files: `frontend/src/auth/AuthContext.jsx`.
- Admin chart duplicate React keys for repeated tick values. Fix: key is `index-value`. Files: `frontend/src/components/admin/SvgCharts.jsx`.
- Admin challenge type showed raw `game`. Fix: `typeLabel()` maps `game` to "Range level" in the filter, table badge, detail badge and form select; option values stay `game`. Files: `frontend/src/pages/admin/Challenges.jsx`.
- Vocabulary: level status label "Solved" is now "Captured" (Cipher Lab and Crackme). Files: `frontend/src/components/cipherlab/helpers.js`, `frontend/src/components/crackme/helpers.js`. No test asserted the old label.
- Dead CSS: removed unused `.wl-hints ol` rule. Files: `frontend/src/components/weblab/weblab.css`.
- Docs: `docs/FAIR_PLAY.md` now says the `index.html` TODO(dev) comment is deliberate bait.
- Not touched for the coordinator's reassigned items (narrow zoom overflow, terminal landscape, touch wording, cross-engine checks): no edits were made for those.

## Error handling
- No error boundary: a bad API field could blank the whole app. Fix: reusable `ErrorBoundary` (role=alert, no stack, "Try again", "Back to The Range"); every lazy page in `App.jsx` is wrapped by a route-aware boundary that resets on navigation, plus a top-level boundary in `main.jsx`. Failed lazy chunks after a deploy offer "Reload the page" (`isChunkLoadError`). Files: `frontend/src/components/{ErrorBoundary.jsx,ErrorBoundary.css,errorKind.js}`, `App.jsx`, `main.jsx`.
- `apiRequest` threw a raw SyntaxError on a non-JSON 502/504. Fix: `parseApiResponse` returns a normal error with `status`, `code: 'BAD_RESPONSE'` and a friendly message; JSON success and JSON errors are unchanged. Network failures still reject with the fetch error (callers already map TypeError). Files: `frontend/src/api/{response.js,client.js}`.
- Two pollers hit `/api/event`. Fix: one reference-counted shared store (pauses while the tab is hidden, refreshes on return); `useEventClock` keeps its API; the debrief reads the store's last response when it is recent. Files: `frontend/src/event/{store.js,useEventClock.js}`, `frontend/src/debrief/useEventEnded.js`.
- Admin Settings: saving one form wiped unsaved edits in the other. Fix: each draft resets only when its own slice changes (stable serialised key). Files: `frontend/src/admin/draftSync.js`, `pages/admin/Settings.jsx`, `components/admin/EventPanel.jsx`.
- Skills page: `aria-controls` pointed at missing elements (detail region now always rendered, `hidden` when closed); 36 per-row progressbars replaced by aria-hidden bars with visible text and one progressbar per framework; the printable portfolio shows "Progress incomplete: N categories failed to load" and disables Print until every category loads. Files: `frontend/src/pages/Skills.jsx`, `skills/{coverage.js,skills.css}`.
- Hints: a transient error while restoring could erase stored hint progress. Fix: only a definitive 4xx lowers the stored count, nothing is written after unmount, and opening a hint never lowers it. Files: `frontend/src/hints/{restore.js,hooks.js}`.
- Challenge links: instance and attachment URLs now go through `safeLink` (http(s) and relative only). Files: `frontend/src/api/safeUrl.js`, `pages/ChallengeDetail.jsx`.

## Frontend QA round
- Group C (per-user storage, vocabulary, keyboard, live regions):
- Browser storage was shared between accounts in one browser. Fix: terminal mail read marks and command counts, terminal command history and the Forensics case clock are keyed by the lowercased email (like the timeline and onboarding keys); signed out means no key and no persistence; old un-scoped keys are ignored (not migrated). Files: `frontend/src/storage/userScope.js`, `terminal/{mail,history,hooks}.js`, `terminal/TerminalWindow.jsx`, `forensics/caseHelpers.js`, `components/forensics/CaseTimer.jsx`, `pages/{TerminalPlay,ForensicsCase}.jsx`.
- Vocabulary: "ALREADY SOLVED" is "ALREADY CAPTURED", "solved in N commands" is "captured in N commands", player-facing counts say flags (terminal HUD, summary line, mode cards), and "Your team already captured this level/cabinet". The shell's own command output is unchanged.
- Crackme analysis tabs: arrows now move focus with selection, Home and End work, and tab roles exist only where the tab bar is visible (under 900 px); wider, both panels are plain sections.
- Crackme debugger: single-key shortcuts have a visible "Keyboard shortcuts: on/off" toggle (remembered per user); `aria-keyshortcuts` and key hints are present only while on. Files: `components/crackme/{shortcuts.js,Debugger.jsx,TimeTravel.jsx}`.
- Crackme patch bay: the previous result and error are cleared whenever the edit set changes.
- Cipher Lab A1Z26 decode: slash split is linear (20000 spaces in under 50 ms); results unchanged. Files: `frontend/src/cipherlab/ops.js`.
- Live regions: the Recipe workbench big output is no longer live; one debounced (600 ms) status line reports "Recipe ran: N steps, output M characters" or the first error; the Crackme scrubber announces only "Step N of M", at most every 500 ms. Files: `frontend/src/a11y/timed.js`, `components/cipherlab/Workbench.jsx`, `components/crackme/TimeTravel.jsx`.
- Forensics case: a failed reload after a correct answer keeps the case and shows "Answer saved. Reloading the case failed" with Retry (was: whole case replaced by an error). Files: `pages/ForensicsCase.jsx`, `forensics/caseHelpers.js`.
- Tests: `frontend/tests/qaGroupC.test.js` plus updated `forensics`, `terminal` and `terminalStory` tests.
