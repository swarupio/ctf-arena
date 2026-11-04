// Scripted, client-side simulation of one full CTF game for the "Demo playoff" page.
// No network calls and no real secrets: every flag below is an obviously fake demo value.
// STEPS is the story; stateAt(index) folds the step effects into the state shown by the UI.

export const NODES = ['browser', 'cognito', 'nginx', 'backend1', 'backend2', 'backend3', 'mongo', 'docker'];

export const TEAMS = [
  { id: 'alpha', name: 'Demo Alpha' },
  { id: 'beta', name: 'Demo Beta' },
];

export const CHALLENGES = {
  'sanity-check': { title: 'Sanity Check', points: 25, type: 'static' },
  'caesar-says': { title: 'Caesar Says', points: 75, type: 'static' },
  'cookie-monster': { title: 'Cookie Monster', points: 100, type: 'docker' },
  'robots-rule': { title: 'Robots Rule', points: 100, type: 'docker' },
  'login-bypass': { title: 'Login Bypass', points: 200, type: 'docker' },
};

// Mirrors the real platform defaults (.env.example and dockerService.createInstance).
export const LIMITS = {
  memoryMb: 128,
  cpu: 0.25,
  pids: 64,
  ttlMinutes: 30,
  maxPerTeam: 2,
  capDrop: 'ALL',
  noNewPrivileges: true,
  readOnlyRoot: true,
};

// Same rule as backend/src/services/scoringService.js: first blood adds floor(10%).
const FIRST_BLOOD_RATE = 0.1;
const MAX_LISTED_INSTANCES = 8;

const DOCKER_FLAGS = '--memory 128m --cpus 0.25 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges --read-only';

export const STEPS = [
  {
    id: 'alpha-signin',
    phase: 'Sign in',
    title: 'Alpha signs in: password, then TOTP code',
    narration: 'Cognito checks the password and then a 6-digit TOTP code from an authenticator app, so a stolen password alone is not enough. '
      + 'The backend only verifies the signed token against Cognito public keys and keeps no session, which lets any replica serve this player.',
    minute: 0,
    actor: 'Alpha',
    duration: 6500,
    servedBy: 'backend1',
    flow: [['browser', 'cognito'], ['browser', 'nginx'], ['nginx', 'backend1'], ['backend1', 'cognito'], ['backend1', 'mongo']],
    screen: {
      title: 'Sign in',
      rows: [
        { label: 'Email', value: 'alice@demo.example' },
        { label: 'Password', value: '********' },
        { label: 'MFA code', value: '6-digit TOTP', mono: true },
        { label: 'Signed in as', value: 'alice (player)' },
      ],
      badge: { kind: 'ok', text: 'MFA verified' },
    },
    log: [
      { kind: 'req', text: 'cognito InitiateAuth -> challenge SOFTWARE_TOKEN_MFA' },
      { kind: 'ok', text: 'cognito RespondToAuthChallenge: TOTP code accepted, ID and access tokens issued' },
      { kind: 'req', text: 'GET /api/auth/me -> 200 (served by backend1)' },
      { kind: 'ok', text: 'backend1 verified the JWT signature with cached Cognito JWKS, no session stored' },
      { kind: 'db', text: 'mongo upsert users {cognitoSub} role=player' },
    ],
    effects: [],
  },
  {
    id: 'alpha-team',
    phase: 'Team',
    title: 'Alpha creates a team and gets an invite code',
    narration: 'The server, not the browser, creates the random 6-character invite code and saves the team in MongoDB, with Alice as captain. '
      + 'Role and team are always decided on the server, never trusted from the client.',
    minute: 1,
    actor: 'Alpha',
    duration: 4500,
    servedBy: 'backend2',
    flow: [['browser', 'nginx'], ['nginx', 'backend2'], ['backend2', 'mongo']],
    screen: {
      title: 'Create team',
      rows: [
        { label: 'Team name', value: 'Demo Alpha' },
        { label: 'Invite code', value: 'K7QM4D', mono: true },
        { label: 'Members', value: '1 / 3' },
      ],
      badge: { kind: 'ok', text: 'Team created' },
    },
    log: [
      { kind: 'req', text: 'POST /api/teams -> 201 (served by backend2)' },
      { kind: 'db', text: 'mongo insert teams {name: "Demo Alpha", inviteCode, captainId, memberIds: [alice]}' },
      { kind: 'db', text: 'unique index on teams.inviteCode: a collision would be retried with a new code' },
    ],
    effects: [],
  },
  {
    id: 'alpha-mate-joins',
    phase: 'Team',
    title: 'A teammate joins with the invite code',
    narration: 'Joining is one atomic MongoDB update that only succeeds while the team has fewer than 3 members. '
      + 'Two people joining at the same moment, even on different replicas, can never overfill a team.',
    minute: 1,
    actor: 'Alpha',
    duration: 4500,
    servedBy: 'backend3',
    flow: [['browser', 'nginx'], ['nginx', 'backend3'], ['backend3', 'mongo']],
    screen: {
      title: 'Join a team',
      rows: [
        { label: 'Invite code', value: 'K7QM4D', mono: true },
        { label: 'New member', value: 'bob@demo.example' },
        { label: 'Members', value: '2 / 3' },
      ],
      badge: { kind: 'ok', text: 'Joined Demo Alpha' },
    },
    log: [
      { kind: 'req', text: 'POST /api/teams/join -> 200 (served by backend3)' },
      { kind: 'db', text: 'mongo findOneAndUpdate teams {inviteCode, "memberIds.2": {$exists: false}} $push memberIds' },
      { kind: 'ok', text: 'team size check and insert were one atomic operation: 2 of 3 seats used' },
    ],
    effects: [],
  },
  {
    id: 'beta-signin-team',
    phase: 'Team',
    title: 'Beta signs in (MFA) and creates a team',
    narration: 'Beta passes the same password and TOTP check and creates Demo Beta. '
      + 'Both teams now play at the same time, kept apart by team id checks on the server.',
    minute: 2,
    actor: 'Beta',
    duration: 5500,
    servedBy: 'backend1',
    flow: [['browser', 'cognito'], ['browser', 'nginx'], ['nginx', 'backend1'], ['backend1', 'cognito'], ['backend1', 'mongo']],
    screen: {
      title: 'Create team',
      rows: [
        { label: 'Email', value: 'carol@demo.example' },
        { label: 'MFA', value: 'TOTP accepted' },
        { label: 'Team name', value: 'Demo Beta' },
        { label: 'Invite code', value: 'T4WX9N', mono: true },
      ],
      badge: { kind: 'ok', text: 'Team created' },
    },
    log: [
      { kind: 'req', text: 'cognito RespondToAuthChallenge: TOTP code accepted, tokens issued' },
      { kind: 'req', text: 'GET /api/auth/me -> 200 (served by backend1)' },
      { kind: 'req', text: 'POST /api/teams -> 201 (served by backend1)' },
      { kind: 'db', text: 'mongo insert teams {name: "Demo Beta", inviteCode, captainId, memberIds: [carol]}' },
    ],
    effects: [],
  },
  {
    id: 'browse-challenges',
    phase: 'Play',
    title: 'Both teams open the challenge list',
    narration: 'The API sends titles, points and type but never a flag or a flag hash, so there is nothing to steal from the browser network tab. '
      + 'Flags are only ever compared on the server.',
    minute: 3,
    actor: 'Alpha',
    duration: 5000,
    servedBy: 'backend2',
    flow: [['browser', 'nginx'], ['nginx', 'backend2'], ['backend2', 'mongo']],
    screen: {
      title: 'Challenges',
      rows: [
        { label: 'Sanity Check', value: '25 pts - static' },
        { label: 'Caesar Says', value: '75 pts - static' },
        { label: 'Cookie Monster', value: '100 pts - docker' },
        { label: 'Robots Rule', value: '100 pts - docker' },
        { label: 'Login Bypass', value: '200 pts - docker' },
      ],
      badge: { kind: 'info', text: 'No flags in the response' },
    },
    log: [
      { kind: 'req', text: 'GET /api/challenges -> 200 (served by backend2)' },
      { kind: 'db', text: 'mongo find challenges {visible: true} projection excludes flagHash and flagSalt' },
      { kind: 'ok', text: 'response: 5 challenges, 0 flag fields' },
    ],
    effects: [],
  },
  {
    id: 'alpha-sanity',
    phase: 'Play',
    title: 'Alpha solves Sanity Check: first blood',
    narration: 'The server salts, hashes and compares the flag, and the first team to solve a challenge earns a 10% first-blood bonus. '
      + 'Sanity Check is worth 25, so Alpha gets 25 + floor(2.5) = 27 points.',
    minute: 3,
    actor: 'Alpha',
    duration: 5500,
    servedBy: 'backend3',
    flow: [['browser', 'nginx'], ['nginx', 'backend3'], ['backend3', 'mongo']],
    screen: {
      title: 'Sanity Check',
      rows: [
        { label: 'Submitted', value: 'CTF{demo_sanity_flag}', mono: true },
        { label: 'Base points', value: '25' },
        { label: 'First blood bonus', value: '+2' },
        { label: 'Awarded', value: '27' },
      ],
      badge: { kind: 'ok', text: 'Correct! +27 (first blood)' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/sanity-check/submit -> 200 correct (served by backend3)' },
      { kind: 'db', text: 'mongo insert solves {team, challenge} unique index (teamId, challengeId)' },
      { kind: 'db', text: 'mongo findOneAndUpdate challenges $inc solveCount -> 1, so this is first blood' },
      { kind: 'ok', text: 'solve recorded: 25 + 2 first blood = 27 points for Demo Alpha' },
    ],
    effects: [{ type: 'score', team: 'alpha', challenge: 'sanity-check', firstBlood: true }],
  },
  {
    id: 'alpha-start-cookie',
    phase: 'Play',
    title: 'Alpha starts Cookie Monster in a private box',
    narration: 'The server claims a free port through a MongoDB unique partial index, so two replicas can never hand out the same port. '
      + 'The container starts with hard limits (128 MB, 0.25 CPU, 64 processes, no capabilities) and a flag derived from the team id, so it is unique per team.',
    minute: 4,
    actor: 'Alpha',
    duration: 6500,
    servedBy: 'backend1',
    flow: [['browser', 'nginx'], ['nginx', 'backend1'], ['backend1', 'mongo'], ['backend1', 'docker']],
    screen: {
      title: 'Cookie Monster - instance',
      rows: [
        { label: 'Status', value: 'running' },
        { label: 'Address', value: 'arena.example:30012', mono: true },
        { label: 'Time left', value: '30 min' },
        { label: 'Limits', value: '128 MB / 0.25 CPU / 64 pids' },
      ],
      badge: { kind: 'ok', text: 'Container running' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/cookie-monster/instance -> 201 (served by backend1)' },
      { kind: 'db', text: 'mongo insert instances {port: 30012} unique partial index on port (active instances only)' },
      { kind: 'docker', text: `docker create ctf/cookie-monster ${DOCKER_FLAGS}` },
      { kind: 'docker', text: 'docker start ctf-cookie-monster-alpha labels ctf.team ctf.challenge ctf.ttl_minutes=30' },
      { kind: 'ok', text: 'flag = HMAC-SHA256(secret, teamId:challengeId), injected as env FLAG, never sent to the player' },
    ],
    effects: [{ type: 'start', id: 'inst-01', team: 'alpha', challenge: 'cookie-monster', port: 30012 }],
  },
  {
    id: 'alpha-start-robots',
    phase: 'Play',
    title: 'Alpha also opens Robots Rule (2 of 2 slots)',
    narration: 'A team may run at most 2 containers at once, counted in MongoDB, so no team can swamp the host. '
      + 'Alpha peeks at Robots Rule and then forgets about it, which the reaper will clean up later.',
    minute: 4,
    actor: 'Alpha',
    duration: 4500,
    servedBy: 'backend2',
    flow: [['browser', 'nginx'], ['nginx', 'backend2'], ['backend2', 'mongo'], ['backend2', 'docker']],
    screen: {
      title: 'Robots Rule - instance',
      rows: [
        { label: 'Address', value: 'arena.example:30047', mono: true },
        { label: 'Running containers', value: '2 / 2' },
        { label: 'A third start', value: 'refused with 409' },
      ],
      badge: { kind: 'info', text: 'Slot limit reached' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/robots-rule/instance -> 201 (served by backend2)' },
      { kind: 'db', text: 'mongo count instances {team: alpha, active} = 1, below MAX_INSTANCES_PER_TEAM (2)' },
      { kind: 'db', text: 'mongo insert instances {port: 30047} unique partial index on port' },
      { kind: 'docker', text: `docker create ctf/robots-rule ${DOCKER_FLAGS}` },
    ],
    effects: [{ type: 'start', id: 'inst-02', team: 'alpha', challenge: 'robots-rule', port: 30047 }],
  },
  {
    id: 'beta-start-boxes',
    phase: 'Play',
    title: 'Beta starts Robots Rule and Cookie Monster',
    narration: 'Beta gets its own two containers on different ports, isolated from Alpha even for the same challenge. '
      + 'Its flags differ from Alpha because each one is an HMAC of that team id and challenge id.',
    minute: 5,
    actor: 'Beta',
    duration: 6000,
    servedBy: 'backend3',
    flow: [['browser', 'nginx'], ['nginx', 'backend3'], ['backend3', 'mongo'], ['backend3', 'docker']],
    screen: {
      title: 'My instances',
      rows: [
        { label: 'Robots Rule', value: 'arena.example:30031', mono: true },
        { label: 'Cookie Monster', value: 'arena.example:30044', mono: true },
        { label: 'Limits per box', value: '128 MB / 0.25 CPU / 64 pids' },
      ],
      badge: { kind: 'ok', text: '2 containers running' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/robots-rule/instance -> 201 (served by backend3)' },
      { kind: 'req', text: 'POST /api/challenges/cookie-monster/instance -> 201 (served by backend3)' },
      { kind: 'db', text: 'mongo insert instances {port: 30031} and {port: 30044}, no clash with 30012 and 30047' },
      { kind: 'docker', text: 'docker create ctf/robots-rule and ctf/cookie-monster with the same limits, --cap-drop ALL, no-new-privileges' },
    ],
    effects: [
      { type: 'start', id: 'inst-03', team: 'beta', challenge: 'robots-rule', port: 30031 },
      { type: 'start', id: 'inst-04', team: 'beta', challenge: 'cookie-monster', port: 30044 },
    ],
  },
  {
    id: 'alpha-wrong-flag',
    phase: 'Play',
    title: 'Alpha submits a wrong flag',
    narration: 'A wrong flag is rejected and recorded, and the reply says nothing about how close the guess was. '
      + 'Every attempt is stored in MongoDB, which later feeds the rate limit.',
    minute: 6,
    actor: 'Alpha',
    duration: 4500,
    servedBy: 'backend1',
    flow: [['browser', 'nginx'], ['nginx', 'backend1'], ['backend1', 'mongo']],
    screen: {
      title: 'Cookie Monster',
      rows: [
        { label: 'Submitted', value: 'CTF{cookie_monster_000000000000}', mono: true },
        { label: 'Attempts this minute', value: '1 / 5' },
        { label: 'Points', value: '+0' },
      ],
      badge: { kind: 'bad', text: 'Incorrect flag. Keep trying!' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/cookie-monster/submit -> 200 {correct: false} (served by backend1)' },
      { kind: 'db', text: 'mongo insert submissions {team: alpha, challenge: cookie-monster, correct: false}' },
      { kind: 'warn', text: 'wrong flag from Demo Alpha: 1 attempt in the last 60 s' },
    ],
    effects: [],
  },
  {
    id: 'alpha-cookie-solve',
    phase: 'Play',
    title: 'Alpha submits the real flag: +110 first blood',
    narration: 'The server recomputes the flag for the Alpha team, it matches, and Alpha is first to solve Cookie Monster: 100 + 10 first blood = 110. '
      + 'Solving also removes the container at once so the resources are freed.',
    minute: 8,
    actor: 'Alpha',
    duration: 6000,
    servedBy: 'backend2',
    flow: [['browser', 'nginx'], ['nginx', 'backend2'], ['backend2', 'mongo'], ['backend2', 'docker']],
    screen: {
      title: 'Cookie Monster',
      rows: [
        { label: 'Submitted', value: 'CTF{cookie_monster_9f3a1c7e2b40}', mono: true },
        { label: 'Base points', value: '100' },
        { label: 'First blood bonus', value: '+10' },
        { label: 'Team total', value: '137' },
      ],
      badge: { kind: 'ok', text: 'First blood! +110' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/cookie-monster/submit -> 200 correct (served by backend2)' },
      { kind: 'db', text: 'mongo findOneAndUpdate challenges $inc solveCount -> 1, first blood' },
      { kind: 'ok', text: '100 + 10 first blood = 110, Demo Alpha now has 137 points' },
      { kind: 'docker', text: 'docker rm -f ctf-cookie-monster-alpha (stopped automatically after the solve)' },
    ],
    effects: [
      { type: 'score', team: 'alpha', challenge: 'cookie-monster', firstBlood: true },
      { type: 'stop', id: 'inst-01', reason: 'solved' },
    ],
  },
  {
    id: 'beta-robots-solve',
    phase: 'Play',
    title: 'Beta solves Robots Rule: first blood',
    narration: 'Beta finds the hint in its own container and submits the right flag, becoming first to solve Robots Rule: 100 + 10 = 110. '
      + 'That flag works only for Beta, and the container is removed straight after.',
    minute: 10,
    actor: 'Beta',
    duration: 5500,
    servedBy: 'backend1',
    flow: [['browser', 'nginx'], ['nginx', 'backend1'], ['backend1', 'mongo'], ['backend1', 'docker']],
    screen: {
      title: 'Robots Rule',
      rows: [
        { label: 'Submitted', value: 'CTF{robots_rule_5b2e90d4a6c1}', mono: true },
        { label: 'Base points', value: '100' },
        { label: 'First blood bonus', value: '+10' },
        { label: 'Team total', value: '110' },
      ],
      badge: { kind: 'ok', text: 'First blood! +110' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/robots-rule/submit -> 200 correct (served by backend1)' },
      { kind: 'db', text: 'mongo findOneAndUpdate challenges $inc solveCount -> 1, first blood' },
      { kind: 'ok', text: '100 + 10 first blood = 110, Demo Beta now has 110 points' },
      { kind: 'docker', text: 'docker rm -f ctf-robots-rule-beta (stopped automatically after the solve)' },
    ],
    effects: [
      { type: 'score', team: 'beta', challenge: 'robots-rule', firstBlood: true },
      { type: 'stop', id: 'inst-03', reason: 'solved' },
    ],
  },
  {
    id: 'alpha-start-login',
    phase: 'Play',
    title: 'Alpha starts Login Bypass on another replica',
    narration: 'The previous Alpha request went to backend2 and this one lands on backend3, yet it works because nothing lives in replica memory: the token, team and instance count all come from MongoDB. '
      + 'Alpha can start it because the solved Cookie Monster box freed a slot.',
    minute: 12,
    actor: 'Alpha',
    duration: 6500,
    servedBy: 'backend3',
    flow: [['browser', 'nginx'], ['nginx', 'backend3'], ['backend3', 'mongo'], ['backend3', 'docker']],
    screen: {
      title: 'Login Bypass - instance',
      rows: [
        { label: 'Status', value: 'running' },
        { label: 'Address', value: 'arena.example:30058', mono: true },
        { label: 'Answered by', value: 'backend3 (previous: backend2)' },
        { label: 'Running containers', value: '2 / 2' },
      ],
      badge: { kind: 'ok', text: 'Container running' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/login-bypass/instance -> 201 (served by backend3)' },
      { kind: 'db', text: 'mongo count instances {team: alpha, active} = 1 (Cookie Monster box already stopped)' },
      { kind: 'db', text: 'mongo insert instances {port: 30058} unique partial index on port' },
      { kind: 'docker', text: `docker create ctf/login-bypass ${DOCKER_FLAGS}` },
    ],
    effects: [{ type: 'start', id: 'inst-05', team: 'alpha', challenge: 'login-bypass', port: 30058 }],
  },
  {
    id: 'beta-easy-solves',
    phase: 'Play',
    title: 'Beta grabs Sanity Check and Caesar Says',
    narration: 'Sanity Check was already solved by Alpha, so Beta gets only the plain 25 points. '
      + 'Nobody has solved Caesar Says yet, so Beta earns first blood there: 75 + 7 = 82.',
    minute: 14,
    actor: 'Beta',
    duration: 6000,
    servedBy: 'backend2',
    flow: [['browser', 'nginx'], ['nginx', 'backend2'], ['backend2', 'mongo']],
    screen: {
      title: 'Two static challenges',
      rows: [
        { label: 'Sanity Check', value: '+25 (no bonus, Alpha was first)' },
        { label: 'Caesar Says', value: '+82 (75 + 7 first blood)' },
        { label: 'Team total', value: '217' },
      ],
      badge: { kind: 'ok', text: '+107 in total' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/sanity-check/submit -> 200 correct (served by backend2)' },
      { kind: 'db', text: 'mongo findOneAndUpdate challenges $inc solveCount -> 2, no first blood: 25 points' },
      { kind: 'req', text: 'POST /api/challenges/caesar-says/submit -> 200 correct (served by backend2)' },
      { kind: 'db', text: 'mongo findOneAndUpdate challenges $inc solveCount -> 1, first blood: 75 + 7 = 82 points' },
      { kind: 'ok', text: 'Demo Beta now has 217 points and leads Demo Alpha (137)' },
    ],
    effects: [
      { type: 'score', team: 'beta', challenge: 'sanity-check', firstBlood: false },
      { type: 'score', team: 'beta', challenge: 'caesar-says', firstBlood: true },
    ],
  },
  {
    id: 'alpha-login-solve',
    phase: 'Play',
    title: 'Alpha solves Login Bypass: first blood +20',
    narration: 'Alpha solves the hardest challenge and earns 200 + 20 first blood = 220, which takes back the lead. '
      + 'The Login Bypass container is stopped automatically, freeing one of the two slots.',
    minute: 18,
    actor: 'Alpha',
    duration: 6500,
    servedBy: 'backend1',
    flow: [['browser', 'nginx'], ['nginx', 'backend1'], ['backend1', 'mongo'], ['backend1', 'docker']],
    screen: {
      title: 'Login Bypass',
      rows: [
        { label: 'Submitted', value: 'CTF{login_bypass_e7a30c915d28}', mono: true },
        { label: 'Base points', value: '200' },
        { label: 'First blood bonus', value: '+20' },
        { label: 'Team total', value: '357' },
      ],
      badge: { kind: 'ok', text: 'First blood! +220' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/login-bypass/submit -> 200 correct (served by backend1)' },
      { kind: 'db', text: 'mongo findOneAndUpdate challenges $inc solveCount -> 1, first blood' },
      { kind: 'ok', text: '200 + 20 first blood = 220, Demo Alpha now has 357 points and retakes the lead' },
      { kind: 'docker', text: 'docker rm -f ctf-login-bypass-alpha (stopped automatically after the solve)' },
    ],
    effects: [
      { type: 'score', team: 'alpha', challenge: 'login-bypass', firstBlood: true },
      { type: 'stop', id: 'inst-05', reason: 'solved' },
    ],
  },
  {
    id: 'beta-cross-flag',
    phase: 'Defence',
    title: 'Beta reuses a flag copied from Alpha: rejected',
    narration: 'Trailing, Beta submits the flag Alpha used for Cookie Monster, which leaked in a chat. '
      + 'It fails because the flag Beta needs is a different HMAC of its own team id and the challenge, so copied flags are worthless.',
    minute: 20,
    actor: 'Beta',
    duration: 5500,
    servedBy: 'backend2',
    flow: [['browser', 'nginx'], ['nginx', 'backend2'], ['backend2', 'mongo']],
    screen: {
      title: 'Cookie Monster',
      rows: [
        { label: 'Submitted', value: 'CTF{cookie_monster_9f3a1c7e2b40}', mono: true },
        { label: 'Source of the flag', value: 'copied from Demo Alpha' },
        { label: 'Attempts this minute', value: '1 / 5' },
      ],
      badge: { kind: 'bad', text: 'Incorrect: flags are per team' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/cookie-monster/submit -> 200 {correct: false} (served by backend2)' },
      { kind: 'warn', text: 'HMAC(secret, betaTeamId:challengeId) does not match the submitted flag' },
      { kind: 'db', text: 'mongo insert submissions {team: beta, challenge: cookie-monster, correct: false}' },
    ],
    effects: [],
  },
  {
    id: 'beta-rate-limit',
    phase: 'Defence',
    title: 'Beta guesses fast and hits the rate limit',
    narration: 'After 5 attempts in a minute for one challenge the server answers 429 Too Many Requests, which blocks brute-forcing. '
      + 'The count is a MongoDB query over recent submissions, so it holds even when guesses are spread over several replicas.',
    minute: 21,
    actor: 'Beta',
    duration: 6000,
    servedBy: 'backend3',
    flow: [['browser', 'nginx'], ['nginx', 'backend1'], ['nginx', 'backend2'], ['nginx', 'backend3'], ['backend3', 'mongo']],
    screen: {
      title: 'Cookie Monster',
      rows: [
        { label: 'Quick guesses', value: '4 more, on 3 different replicas' },
        { label: 'Attempts this minute', value: '5 / 5' },
        { label: 'Next submit', value: '429 RATE_LIMITED', mono: true },
      ],
      badge: { kind: 'bad', text: 'Too many attempts. Wait a minute.' },
    },
    log: [
      { kind: 'req', text: 'POST /api/challenges/cookie-monster/submit x4 -> 200 {correct: false} (backend1, backend2, backend3, backend1)' },
      { kind: 'db', text: 'mongo count submissions {team: beta, challenge: cookie-monster, last 60 s} = 5' },
      { kind: 'req', text: 'POST /api/challenges/cookie-monster/submit -> 429 (served by backend3)' },
      { kind: 'err', text: '429 RATE_LIMITED 5 attempts/min/team/challenge' },
    ],
    effects: [],
  },
  {
    id: 'replica-failover',
    phase: 'Defence',
    title: 'A backend replica crashes, nobody notices',
    narration: 'backend2 is stopped mid-game, like a crash or a redeploy. '
      + 'Nginx sends the next request to backend1, which answers from the same MongoDB data, so nobody is logged out and no container is lost.',
    minute: 23,
    actor: 'System',
    duration: 6000,
    servedBy: 'backend1',
    flow: [['browser', 'nginx'], ['nginx', 'backend1'], ['backend1', 'mongo']],
    screen: {
      title: 'Alpha refreshes My instances',
      rows: [
        { label: 'Replicas up', value: 'backend1, backend3' },
        { label: 'Session', value: 'still valid' },
        { label: 'Running', value: 'Robots Rule :30047', mono: true },
      ],
      badge: { kind: 'ok', text: 'No data lost' },
    },
    log: [
      { kind: 'warn', text: 'docker stop backend2 (simulated crash)' },
      { kind: 'req', text: 'nginx upstream backend2 failed, retried on backend1' },
      { kind: 'req', text: 'GET /api/instances -> 200 (served by backend1)' },
      { kind: 'db', text: 'mongo find instances {team: alpha, active} -> 1 running box, data unchanged' },
      { kind: 'ok', text: 'docker compose restarted backend2, GET /api/health OK, back in rotation' },
    ],
    effects: [],
  },
  {
    id: 'admin-kill',
    phase: 'Defence',
    title: 'Admin kills an abusive container',
    narration: 'The dashboard shows the Cookie Monster box of Beta pinned at its CPU quota by a brute-force script. '
      + 'Only a token with the Cognito admin role passes requireRole, and the kill removes the container immediately.',
    minute: 26,
    actor: 'Admin',
    duration: 6500,
    servedBy: 'backend3',
    flow: [['browser', 'nginx'], ['nginx', 'backend3'], ['backend3', 'cognito'], ['backend3', 'mongo'], ['backend3', 'docker']],
    screen: {
      title: 'Admin dashboard: instances',
      rows: [
        { label: 'Instance', value: 'Cookie Monster (Demo Beta) :30044', mono: true },
        { label: 'CPU', value: 'capped at 0.25 core, 100% used' },
        { label: 'Traffic', value: 'about 4000 requests/min from one client' },
        { label: 'Action', value: 'Kill' },
      ],
      badge: { kind: 'info', text: 'Killed by admin' },
    },
    log: [
      { kind: 'req', text: 'POST /api/admin/instances/inst-04/kill -> 204 (served by backend3)' },
      { kind: 'ok', text: 'JWT role claim = admin, requireRole("admin") passed' },
      { kind: 'db', text: 'mongo findOneAndUpdate instances {_id, active} status=killed' },
      { kind: 'docker', text: 'docker rm -f ctf-cookie-monster-beta (CPU held at quota, memory 41 MB of 128 MB)' },
    ],
    effects: [{ type: 'stop', id: 'inst-04', reason: 'killed' }],
  },
  {
    id: 'reaper-expiry',
    phase: 'Defence',
    title: 'The reaper removes an expired container',
    narration: 'Containers live for 30 minutes at most. '
      + 'Every 60 seconds the reaper claims expired instances atomically in MongoDB and removes their containers, so the Robots Rule box that Alpha forgot disappears and port 30047 is free.',
    minute: 34,
    actor: 'System',
    duration: 6000,
    servedBy: null,
    flow: [['backend3', 'mongo'], ['backend3', 'docker']],
    screen: {
      title: 'Alpha: My instances',
      rows: [
        { label: 'Robots Rule', value: 'expired after 30 min', mono: true },
        { label: 'Started', value: 'minute 4' },
        { label: 'Port 30047', value: 'free again' },
      ],
      badge: { kind: 'info', text: 'Expired and removed' },
    },
    log: [
      { kind: 'db', text: 'reaper tick (every 60 s): mongo find instances {active, expiresAt <= now} -> 1 instance' },
      { kind: 'db', text: 'mongo findOneAndUpdate instances {_id, active} status=expired, atomic claim, no double stop' },
      { kind: 'docker', text: 'docker rm -f ctf-robots-rule-alpha (TTL 30 min reached)' },
      { kind: 'ok', text: 'port 30047 released, no running containers left' },
    ],
    effects: [{ type: 'stop', id: 'inst-02', reason: 'expired' }],
  },
  {
    id: 'final-board',
    phase: 'Result',
    title: 'Final leaderboard: Demo Alpha wins',
    narration: 'The leaderboard is computed from the solves stored in MongoDB, not from anything kept in a replica or the browser. '
      + 'Demo Alpha wins 357 to 217, helped by first blood on three challenges.',
    minute: 35,
    actor: 'System',
    duration: 6500,
    servedBy: 'backend2',
    flow: [['browser', 'nginx'], ['nginx', 'backend2'], ['backend2', 'mongo']],
    screen: {
      title: 'Leaderboard',
      rows: [
        { label: '1. Demo Alpha', value: '357 pts - 3 solves' },
        { label: '2. Demo Beta', value: '217 pts - 3 solves' },
      ],
      badge: { kind: 'ok', text: 'Demo Alpha wins' },
    },
    log: [
      { kind: 'req', text: 'GET /api/leaderboard -> 200 (served by backend2)' },
      { kind: 'db', text: 'mongo aggregate solves group by team, sum(points), sort by points desc then earliest solve' },
      { kind: 'ok', text: '1. Demo Alpha 357 | 2. Demo Beta 217' },
    ],
    effects: [],
  },
  {
    id: 'what-it-proved',
    phase: 'Result',
    title: 'What this demo proved',
    narration: 'One game showed the main guarantees: MFA sign-in, stateless replicas, per-team flags, isolated containers and shared rate limits. '
      + 'All state lives in MongoDB or Cognito, so a replica can be added or lost without changing the outcome.',
    minute: 35,
    actor: 'System',
    duration: 6500,
    servedBy: null,
    flow: [
      ['browser', 'cognito'], ['browser', 'nginx'],
      ['nginx', 'backend1'], ['nginx', 'backend2'], ['nginx', 'backend3'],
      ['backend1', 'mongo'], ['backend2', 'mongo'], ['backend3', 'mongo'],
    ],
    screen: {
      title: 'Demo complete',
      rows: [
        { label: 'MFA', value: 'password + TOTP at every sign-in' },
        { label: 'Stateless replicas', value: 'backend2 crashed, play continued' },
        { label: 'Per-team flags', value: 'HMAC(teamId, challengeId)' },
        { label: 'Isolation', value: '128 MB, 0.25 CPU, 64 pids, no caps' },
        { label: 'Rate limit', value: '5 attempts/min across replicas' },
      ],
      badge: { kind: 'ok', text: '5 guarantees shown' },
    },
    log: [
      { kind: 'ok', text: 'MFA enforced by Cognito at every sign-in' },
      { kind: 'ok', text: 'replicas stayed stateless: every decision came from MongoDB' },
      { kind: 'ok', text: 'flags are per team and never sent to players' },
      { kind: 'ok', text: 'containers were capped and always cleaned up (solve, admin kill, TTL reaper)' },
      { kind: 'ok', text: 'rate limit held across replicas because attempts are counted in MongoDB' },
    ],
    effects: [],
  },
];

export const TOTAL = STEPS.length;

function pointsFor(slug, firstBlood) {
  const base = CHALLENGES[slug].points;
  return base + (firstBlood ? Math.floor(base * FIRST_BLOOD_RATE) : 0);
}

function trimInstances(list) {
  const kept = [...list];
  while (kept.length > MAX_LISTED_INSTANCES) {
    const stoppedAt = kept.findIndex((instance) => instance.status !== 'running');
    kept.splice(stoppedAt === -1 ? 0 : stoppedAt, 1);
  }
  return kept;
}

// Pure: folds the effects of STEPS[0..index] into the state shown by the page.
// index -1 (or anything below) means "before the start"; anything past the end is clamped.
export function stateAt(index) {
  const last = Number.isFinite(index) ? Math.max(-1, Math.min(Math.trunc(index), STEPS.length - 1)) : -1;
  const teams = new Map(TEAMS.map((team) => [team.id, {
    id: team.id, name: team.name, score: 0, solveCount: 0, solves: [], delta: 0, banned: false, lastSolveAt: Infinity,
  }]));
  const instances = [];
  const lines = [];

  for (let i = 0; i <= last; i += 1) {
    const step = STEPS[i];
    for (const line of step.log) {
      lines.push({ stepIndex: i, minute: step.minute, kind: line.kind, text: line.text });
    }
    for (const effect of step.effects) {
      if (effect.type === 'score') {
        const team = teams.get(effect.team);
        if (!team || !CHALLENGES[effect.challenge] || team.solves.includes(effect.challenge)) { continue; }
        const points = pointsFor(effect.challenge, effect.firstBlood);
        team.score += points;
        team.solveCount += 1;
        team.solves.push(effect.challenge);
        team.lastSolveAt = i;
        if (i === last) { team.delta += points; }
      } else if (effect.type === 'start') {
        instances.push({
          id: effect.id,
          team: effect.team,
          challenge: effect.challenge,
          title: CHALLENGES[effect.challenge].title,
          port: effect.port,
          startedMinute: step.minute,
          minutesLeft: LIMITS.ttlMinutes,
          status: 'running',
          limits: { memoryMb: LIMITS.memoryMb, cpu: LIMITS.cpu, pids: LIMITS.pids },
        });
      } else if (effect.type === 'stop') {
        const instance = instances.find((item) => item.id === effect.id);
        if (instance && instance.status === 'running') { instance.status = effect.reason; }
      } else if (effect.type === 'ban') {
        const team = teams.get(effect.team);
        if (team) { team.banned = true; }
      }
    }
  }

  const minute = last >= 0 ? STEPS[last].minute : 0;
  for (const instance of instances) {
    instance.minutesLeft = instance.status === 'running'
      ? Math.max(0, LIMITS.ttlMinutes - (minute - instance.startedMinute))
      : 0;
  }

  const order = TEAMS.map((team) => team.id);
  const ranked = [...teams.values()]
    .sort((a, b) => (b.score - a.score)
      || (a.lastSolveAt === b.lastSolveAt ? 0 : (a.lastSolveAt < b.lastSolveAt ? -1 : 1))
      || (order.indexOf(a.id) - order.indexOf(b.id)))
    .map(({ lastSolveAt, ...team }, position) => ({ ...team, solves: [...team.solves], rank: position + 1 }));

  const step = last >= 0 ? STEPS[last] : null;
  return {
    index: last,
    minute,
    step,
    teams: ranked,
    instances: trimInstances(instances),
    lines,
    activeEdges: step ? step.flow.map((edge) => [...edge]) : [],
    servedBy: step ? step.servedBy : null,
  };
}
