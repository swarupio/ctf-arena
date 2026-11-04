import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import Challenge from '../../src/models/Challenge.js';
import Solve from '../../src/models/Solve.js';
import Submission from '../../src/models/Submission.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { expectedFlagFor } from '../../src/services/flagService.js';
import { recordSolve } from '../../src/services/scoringService.js';
import { ADMIN_PREVIEW_TEAM, UNAVAILABLE_FLAG } from '../../src/services/terminalService.js';
import { MODE_NAMES, MODES, getMode } from '../../src/terminal/modes/index.js';
import { complete, execute } from '../../src/terminal/shell.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn(), findById: vi.fn(), create: vi.fn(), findOneAndUpdate: vi.fn(), deleteOne: vi.fn() },
}));
vi.mock('../../src/models/Instance.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn() }, ACTIVE_STATUSES: ['starting', 'running', 'stopping'],
}));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn(), exists: vi.fn() } }));
vi.mock('../../src/models/Submission.js', () => ({ default: { create: vi.fn(), countDocuments: vi.fn() } }));
vi.mock('../../src/services/scoringService.js', () => ({ recordSolve: vi.fn() }));
vi.mock('../../src/services/instanceService.js', () => ({
  instanceService: {
    start: vi.fn(), stop: vi.fn(), extend: vi.fn(), stopTeamChallenge: vi.fn(), stopChallengeInstances: vi.fn(),
  },
  serializeInstance: (i) => ({ id: String(i._id) }),
}));
// The shell engine is written and tested separately; here it is a spy.
vi.mock('../../src/terminal/shell.js', () => ({ execute: vi.fn(), complete: vi.fn() }));

const oid = (n) => String(n).padStart(24, '0');
const secret = env.FLAG_SECRET;
const TEAM_A = oid(2);
const TEAM_B = oid(4);
const baseId = { easy: 1000, medium: 2000, hard: 3000 };
const capital = (text) => text[0].toUpperCase() + text.slice(1);

const seededDocs = (name) => MODES[name].codes.map((code) => ({
  _id: oid(baseId[name] + code.n), slug: `terminal-${name}-${code.n}`, title: `Terminal ${capital(name)} #${code.n}`,
  category: 'terminal', type: 'terminal', difficulty: name, points: code.points, visible: true, solveCount: 0,
  terminal: { mode: name, code: code.n },
}));

const users = {
  player: { _id: oid(1), teamId: TEAM_A },
  player2: { _id: oid(3), teamId: TEAM_B },
  admin: { _id: oid(9), teamId: null },
};
let teams;
let challenges;
let solves;

const doc = (name, n) => challenges.find((c) => c.terminal.mode === name && c.terminal.code === n);
const flagOf = (name, n, teamId = TEAM_A) => expectedFlagFor(doc(name, n), { secret, teamId });
const definitionCode = (name, n) => MODES[name].codes.find((code) => code.n === n);
const solveOf = (name, n, extra = {}) => ({ teamId: TEAM_A, challengeId: doc(name, n)._id, points: definitionCode(name, n).points, firstBlood: false, ...extra });

const matchesFilter = (row, filter) => row.type === filter.type
  && (filter['terminal.mode'] === undefined || row.terminal.mode === filter['terminal.mode'])
  && (filter.visible === undefined || row.visible === filter.visible);

const api = (method, path, sub = 'player', body) => {
  const call = request(app)[method](`/api${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};

// Nothing but the team's own flags inside exec output may carry a flag: used on every other response.
// The boot text (`lore`) may mention the format ("submit CTF{...}"), so it is skipped by the plain `CTF{` check;
// it is still covered by the exact-flag and flag-shape checks below.
function expectNoFlags(body) {
  const text = JSON.stringify(body);
  expect(JSON.stringify(body, (key, value) => (key === 'lore' ? undefined : value))).not.toContain('CTF{');
  expect(text).not.toMatch(/CTF\{[a-z0-9_]+_[0-9a-f]{12}\}/);
  for (const challenge of challenges) {
    for (const teamId of [TEAM_A, TEAM_B, ADMIN_PREVIEW_TEAM]) {
      expect(text).not.toContain(expectedFlagFor(challenge, { secret, teamId }));
    }
  }
  expect(text).not.toContain('flagHash');
}

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  teams = { [TEAM_A]: { _id: TEAM_A, name: 'Alpha', banned: false }, [TEAM_B]: { _id: TEAM_B, name: 'Bravo', banned: false } };
  challenges = MODE_NAMES.flatMap(seededDocs);
  solves = [];
  User.findOne.mockImplementation(async ({ cognitoSub }) => users[cognitoSub] ?? null);
  Team.findById.mockImplementation(async (id) => teams[String(id)] ?? null);
  Challenge.find.mockImplementation((filter) => ({ lean: async () => challenges.filter((row) => matchesFilter(row, filter)) }));
  Solve.find.mockImplementation((filter) => ({
    lean: async () => {
      const ids = filter.challengeId.$in.map(String);
      return solves.filter((row) => String(row.teamId) === String(filter.teamId) && ids.includes(String(row.challengeId)));
    },
  }));
  Submission.countDocuments.mockResolvedValue(0);
  Submission.create.mockResolvedValue({});
  execute.mockImplementation(async (line, ctx) => ({ output: `ran: ${line}`, cwd: ctx.cwd, exit: 0 }));
  complete.mockReturnValue([]);
  recordSolve.mockImplementation(async ({ challenge }) => ({ points: challenge.points, firstBlood: false, score: challenge.points }));
});

describe('the registry the API is built on', () => {
  it('has the three modes with consecutively numbered codes', () => {
    expect(MODE_NAMES).toEqual(['easy', 'medium', 'hard']);
    for (const name of MODE_NAMES) {
      const mode = getMode(name);
      expect(mode.mode).toBe(name);
      expect(mode.codes.map((code) => code.n)).toEqual(mode.codes.map((_, index) => index + 1));
    }
    expect(getMode('nightmare')).toBeNull();
    expect(getMode('__proto__')).toBeNull();
  });
});

describe('authentication, roles and the mode parameter', () => {
  const routes = [
    ['get', '/terminal/modes'],
    ['get', '/terminal/easy/progress'],
    ['post', '/terminal/easy/exec', { command: 'ls', cwd: '/' }],
    ['post', '/terminal/easy/complete', { partial: 'l', cwd: '/' }],
    ['post', '/terminal/easy/submit', { flag: 'x' }],
  ];

  it.each(routes)('%s %s requires a token (401) before anything is read', async (method, path, body) => {
    const call = request(app)[method](`/api${path}`);
    const { body: error } = await (body ? call.send(body) : call).expect(401);
    expect(error.error.code).toBe('UNAUTHENTICATED');
    expect(Challenge.find).not.toHaveBeenCalled();
    expect(User.findOne).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets admins use modes, progress, exec and complete but not submit', async () => {
    await api('get', '/terminal/modes', 'admin').expect(200);
    await api('get', '/terminal/easy/progress', 'admin').expect(200);
    await api('post', '/terminal/easy/exec', 'admin', { command: 'ls', cwd: '/' }).expect(200);
    await api('post', '/terminal/easy/complete', 'admin', { partial: 'l', cwd: '/' }).expect(200);
    const { body } = await api('post', '/terminal/easy/submit', 'admin', { flag: 'x' }).expect(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(Submission.create).not.toHaveBeenCalled();
    expect(recordSolve).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for any mode other than easy, medium or hard', async () => {
    for (const mode of ['nightmare', 'EASY', '__proto__', 'constructor', 'easy%20']) {
      const { body } = await api('get', `/terminal/${mode}/progress`).expect(404);
      expect(body.error.code).toBe('NOT_FOUND');
      await api('post', `/terminal/${mode}/exec`, 'player', { command: 'ls', cwd: '/' }).expect(404);
      await api('post', `/terminal/${mode}/complete`, 'player', { partial: 'l', cwd: '/' }).expect(404);
      await api('post', `/terminal/${mode}/submit`, 'player', { flag: 'x' }).expect(404);
    }
    // The mode is checked before the body, so an invalid body on an unknown mode is still 404.
    await api('post', '/terminal/nightmare/exec', 'player', { nope: true }).expect(404);
    expect(execute).not.toHaveBeenCalled();
    expect(Challenge.find).not.toHaveBeenCalled();
  });
});

describe('teams', () => {
  it('gives players without a team NO_TEAM on exec, complete and submit, but lets them read modes and progress', async () => {
    users.player = { _id: oid(1), teamId: null };
    try {
      for (const [path, body] of [['exec', { command: 'ls', cwd: '/' }], ['complete', { partial: 'l', cwd: '/' }], ['submit', { flag: 'x' }]]) {
        const { body: error } = await api('post', `/terminal/easy/${path}`, 'player', body).expect(404);
        expect(error.error.code).toBe('NO_TEAM');
      }
      expect(execute).not.toHaveBeenCalled();
      expect(Submission.create).not.toHaveBeenCalled();
      const modes = await api('get', '/terminal/modes').expect(200);
      expect(modes.body.every((mode) => mode.solved === 0 && mode.pointsEarned === 0)).toBe(true);
      const progress = await api('get', '/terminal/easy/progress').expect(200);
      expect(progress.body).toMatchObject({ mode: 'easy', solved: [], remaining: progress.body.total });
      User.findOne.mockResolvedValue(null); // no user record at all
      await api('post', '/terminal/easy/exec', 'player', { command: 'ls', cwd: '/' }).expect(404);
    } finally {
      users.player = { _id: oid(1), teamId: TEAM_A };
    }
  });

  it('blocks banned teams from exec, complete and submit with TEAM_BANNED', async () => {
    teams[TEAM_A].banned = true;
    for (const [path, body] of [['exec', { command: 'ls', cwd: '/' }], ['complete', { partial: 'l', cwd: '/' }], ['submit', { flag: 'x' }]]) {
      const { body: error } = await api('post', `/terminal/easy/${path}`, 'player', body).expect(403);
      expect(error.error.code).toBe('TEAM_BANNED');
    }
    expect(execute).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(Submission.create).not.toHaveBeenCalled();
    await api('get', '/terminal/modes').expect(200);
  });
});

describe('POST /terminal/:mode/exec', () => {
  it('runs the command through the engine with the mode, cwd, flag(n) and progress() and returns its result', async () => {
    execute.mockResolvedValue({ output: 'hello\n', cwd: '/home/guest/docs', exit: 3, effect: 'confetti' });
    const { body } = await api('post', '/terminal/easy/exec', 'player', { command: 'cat welcome.txt', cwd: '/home/guest' }).expect(200);
    expect(body).toEqual({ output: 'hello\n', cwd: '/home/guest/docs', exit: 3, effect: 'confetti' });
    expect(execute).toHaveBeenCalledTimes(1);
    const [line, ctx] = execute.mock.calls[0];
    expect(line).toBe('cat welcome.txt');
    expect(Object.keys(ctx).sort()).toEqual(['cwd', 'flag', 'mode', 'progress', 'seed']);
    expect(ctx.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.mode).toBe(MODES.easy);
    expect(ctx.cwd).toBe('/home/guest');
    expect(typeof ctx.flag(1)).toBe('string');
    expect(ctx.flag(1)).not.toBeInstanceOf(Promise);
    expect(ctx.progress()).toBeInstanceOf(Promise);
  });

  it('omits the effect when there is none and drops unknown effects', async () => {
    const { body } = await api('post', '/terminal/easy/exec', 'player', { command: 'ls' }).expect(200);
    expect(body).toEqual({ output: 'ran: ls', cwd: MODES.easy.home, exit: 0 });
    execute.mockResolvedValue({ output: 'x', cwd: '/', exit: 0, effect: 'rm -rf' });
    expect((await api('post', '/terminal/easy/exec', 'player', { command: 'x' })).body).not.toHaveProperty('effect');
    execute.mockResolvedValue({ output: 'x', cwd: '/', exit: 0, effect: 'matrix' });
    expect((await api('post', '/terminal/easy/exec', 'player', { command: 'x' })).body.effect).toBe('matrix');
  });

  it('normalizes the cwd and falls back to the mode home for anything else', async () => {
    const { home } = MODES.medium;
    const cases = [
      ['/var/log/', '/var/log'], ['/a//b/./c', '/a/b/c'], ['/home/../etc', '/etc'], ['/..', '/'], ['/', '/'],
      ['relative/dir', home], ['', home], ['/bad\u0000path', home], ['/bad\npath', home], [undefined, home],
    ];
    for (const [cwd, expected] of cases) {
      execute.mockClear();
      await api('post', '/terminal/medium/exec', 'player', cwd === undefined ? { command: 'pwd' } : { command: 'pwd', cwd }).expect(200);
      expect(execute.mock.calls[0][1].cwd, `cwd ${JSON.stringify(cwd)}`).toBe(expected);
    }
  });

  it('never returns a cwd that is not an absolute plain path', async () => {
    execute.mockResolvedValue({ output: '', cwd: 'nope', exit: 0 });
    expect((await api('post', '/terminal/easy/exec', 'player', { command: 'x', cwd: '/' })).body.cwd).toBe(MODES.easy.home);
    execute.mockResolvedValue({ output: undefined, cwd: '/tmp//', exit: 'x' });
    expect((await api('post', '/terminal/easy/exec', 'player', { command: 'x', cwd: '/' })).body).toEqual({ output: '', cwd: '/tmp', exit: 0 });
  });

  it('validates the body strictly', async () => {
    const bad = [
      {}, { cwd: '/' }, { command: 5, cwd: '/' }, { command: 'ls', cwd: 5 }, { command: 'ls', cwd: ['/'] },
      { command: 'x'.repeat(301), cwd: '/' }, { command: 'ls', cwd: `/${'a'.repeat(200)}` },
      { command: 'ls', cwd: '/', extra: 1 }, { command: 'ls', cwd: '/', flag: 'x' },
    ];
    for (const body of bad) {
      const { body: error } = await api('post', '/terminal/easy/exec', 'player', body).expect(400);
      expect(error.error.code).toBe('VALIDATION_ERROR');
    }
    await api('post', '/terminal/easy/exec', 'player').expect(400);
    expect(execute).not.toHaveBeenCalled();
    // The limits themselves are allowed, and an empty command line is a normal Enter key press.
    await api('post', '/terminal/easy/exec', 'player', { command: 'x'.repeat(300), cwd: `/${'a'.repeat(199)}` }).expect(200);
    await api('post', '/terminal/easy/exec', 'player', { command: '', cwd: '/' }).expect(200);
  });

  it('derives flags per team: stable for one team, different for another, and a preview set for admins', async () => {
    const seen = [];
    execute.mockImplementation(async (line, ctx) => {
      seen.push({ line, one: ctx.flag(1), two: ctx.flag(2), unknown: ctx.flag(99), text: ctx.flag('2') });
      return { output: ctx.flag(1), cwd: ctx.cwd, exit: 0 };
    });
    const first = await api('post', '/terminal/easy/exec', 'player', { command: 'a', cwd: '/' }).expect(200);
    await api('post', '/terminal/easy/exec', 'player2', { command: 'b', cwd: '/' }).expect(200);
    await api('post', '/terminal/easy/exec', 'player', { command: 'c', cwd: '/' }).expect(200);
    await api('post', '/terminal/easy/exec', 'admin', { command: 'd', cwd: '/' }).expect(200);
    const [a, b, again, admin] = seen;
    expect(a.one).toBe(flagOf('easy', 1, TEAM_A));
    expect(a.two).toBe(flagOf('easy', 2, TEAM_A));
    expect(a.text).toBe(a.two);
    expect(b.one).toBe(flagOf('easy', 1, TEAM_B));
    expect(b.one).not.toBe(a.one);
    expect(b.two).not.toBe(a.two);
    expect(again).toMatchObject({ one: a.one, two: a.two });
    expect(admin.one).toBe(flagOf('easy', 1, ADMIN_PREVIEW_TEAM));
    expect(admin.one).not.toBe(a.one);
    expect(admin.one).not.toBe(b.one);
    expect(a.one).toMatch(/^CTF\{terminal_easy_1_[0-9a-f]{12}\}$/);
    // A code without a visible challenge prints a placeholder that is nobody's flag.
    expect(a.unknown).toBe(UNAVAILABLE_FLAG);
    expect([a.one, a.two, b.one, b.two, admin.one, admin.two]).not.toContain(UNAVAILABLE_FLAG);
    // Exec output may show the team's own flag, which is the game.
    expect(first.body.output).toBe(a.one);
    // Admins need no team: no user lookup happened for them.
    expect(User.findOne.mock.calls.map(([query]) => query.cognitoSub)).toEqual(['player', 'player2', 'player']);
  });

  it('reads the challenge rows once and the solves only when progress() is called', async () => {
    solves = [solveOf('easy', 2)];
    await api('post', '/terminal/easy/exec', 'player', { command: 'ls', cwd: '/' }).expect(200);
    expect(Challenge.find).toHaveBeenCalledTimes(1);
    expect(Challenge.find).toHaveBeenCalledWith({ type: 'terminal', 'terminal.mode': 'easy', visible: true });
    expect(Solve.find).not.toHaveBeenCalled();

    const progress = [];
    execute.mockImplementation(async (line, ctx) => {
      progress.push(await ctx.progress(), await ctx.progress());
      return { output: '', cwd: ctx.cwd, exit: 0 };
    });
    await api('post', '/terminal/easy/exec', 'player', { command: 'status', cwd: '/' }).expect(200);
    expect(progress).toEqual([{ solved: [2] }, { solved: [2] }]);
    expect(Solve.find).toHaveBeenCalledTimes(1); // memoized within the request
    expect(Solve.find.mock.calls[0][0].teamId).toBe(TEAM_A);

    progress.length = 0;
    Solve.find.mockClear();
    await api('post', '/terminal/easy/exec', 'admin', { command: 'status', cwd: '/' }).expect(200);
    expect(progress).toEqual([{ solved: [] }, { solved: [] }]);
    expect(Solve.find).not.toHaveBeenCalled();
  });

  it('answers 503 TERMINAL_NOT_SEEDED when the mode has no challenge rows, and ignores hidden codes', async () => {
    challenges = challenges.filter((row) => row.terminal.mode !== 'easy');
    const { body } = await api('post', '/terminal/easy/exec', 'player', { command: 'ls', cwd: '/' }).expect(503);
    expect(body).toEqual({ error: { code: 'TERMINAL_NOT_SEEDED', message: 'Run npm run seed:terminal.' } });
    expect(execute).not.toHaveBeenCalled();
    await api('post', '/terminal/medium/exec', 'player', { command: 'ls', cwd: '/' }).expect(200);

    doc('medium', 2).visible = false;
    let two;
    execute.mockImplementation(async (line, ctx) => { two = ctx.flag(2); return { output: '', cwd: ctx.cwd, exit: 0 }; });
    await api('post', '/terminal/medium/exec', 'player', { command: 'x', cwd: '/' }).expect(200);
    expect(two).toBe(UNAVAILABLE_FLAG);
  });

  it('does not turn an engine crash into a leaking response', async () => {
    execute.mockRejectedValue(new Error('boom: CTF{internal} at /srv/secret'));
    const { body } = await api('post', '/terminal/easy/exec', 'player', { command: 'ls', cwd: '/' }).expect(500);
    expect(body).toEqual({ error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } });
  });
});

describe('POST /terminal/:mode/complete', () => {
  it('passes partial and cwd to the engine, caps the list at 50 strings and reads no challenge rows', async () => {
    complete.mockReturnValue([...Array.from({ length: 70 }, (_, i) => `file${i}`), 5, null]);
    const { body } = await api('post', '/terminal/hard/complete', 'player', { partial: 'ca', cwd: '/srv/' }).expect(200);
    expect(body.matches).toHaveLength(50);
    expect(body.matches[0]).toBe('file0');
    const [partial, ctx] = complete.mock.calls[0];
    expect(partial).toBe('ca');
    expect(ctx.cwd).toBe('/srv');
    expect(ctx.mode).toBe(MODES.hard);
    expect(Challenge.find).not.toHaveBeenCalled();
    expectNoFlags(body);
    complete.mockReturnValue(undefined);
    expect((await api('post', '/terminal/hard/complete', 'player', { partial: '', cwd: '/' }).expect(200)).body).toEqual({ matches: [] });
  });

  it('never hands the engine a real flag', async () => {
    complete.mockImplementation((partial, ctx) => [String(ctx.flag(1))]);
    const { body } = await api('post', '/terminal/easy/complete', 'player', { partial: 'x', cwd: '/' }).expect(200);
    expect(body.matches).toEqual([UNAVAILABLE_FLAG]);
  });

  it('validates the body strictly', async () => {
    for (const body of [{}, { partial: 'x'.repeat(201), cwd: '/' }, { partial: 5, cwd: '/' }, { partial: 'l', cwd: 7 }, { partial: 'l', cwd: '/', x: 1 }]) {
      await api('post', '/terminal/easy/complete', 'player', body).expect(400);
    }
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('GET /terminal/modes', () => {
  it('lists the three modes with my team\'s counts and no unsolved titles or flags', async () => {
    solves = [
      solveOf('easy', 1, { points: 44, firstBlood: true }), solveOf('easy', 2), solveOf('medium', 1),
      { ...solveOf('easy', 3), teamId: TEAM_B }, // another team's solve is not mine
    ];
    const { body } = await api('get', '/terminal/modes').expect(200);
    expect(body.map((mode) => mode.mode)).toEqual(['easy', 'medium', 'hard']);
    for (const name of MODE_NAMES) {
      const entry = body.find((mode) => mode.mode === name);
      const definition = MODES[name];
      expect(Object.keys(entry).sort()).toEqual(['codes', 'difficulty', 'lore', 'mode', 'pointsEarned', 'points', 'solved', 'tagline', 'title'].sort());
      expect(entry).toMatchObject({
        title: definition.title, tagline: definition.tagline, difficulty: definition.difficulty, lore: definition.lore,
        codes: definition.codes.length, points: definition.codes.reduce((sum, code) => sum + code.points, 0),
      });
    }
    const easy = body[0];
    expect(easy.solved).toBe(2);
    expect(easy.pointsEarned).toBe(44 + definitionCode('easy', 2).points);
    expect(body[1]).toMatchObject({ solved: 1, pointsEarned: definitionCode('medium', 1).points });
    expect(body[2]).toMatchObject({ solved: 0, pointsEarned: 0 });
    // Code titles (only meaningful once solved) are not part of this response at all.
    const withoutCardText = JSON.stringify(body.map(({ lore, title, tagline, ...rest }) => rest));
    for (const name of MODE_NAMES) {
      for (const code of MODES[name].codes) { expect(withoutCardText).not.toContain(code.title); }
    }
    expectNoFlags(body);
    expect(Challenge.find).toHaveBeenCalledTimes(1);
    expect(Solve.find).toHaveBeenCalledTimes(1);
  });

  it('uses the stored points, skips hidden codes, and still lists a mode that is not seeded', async () => {
    doc('easy', 1).points = 7;
    doc('easy', 2).visible = false;
    challenges = challenges.filter((row) => row.terminal.mode !== 'hard');
    const { body } = await api('get', '/terminal/modes').expect(200);
    const easy = body.find((mode) => mode.mode === 'easy');
    expect(easy.codes).toBe(MODES.easy.codes.length - 1);
    expect(easy.points).toBe(MODES.easy.codes.reduce((sum, code) => sum + code.points, 0) - definitionCode('easy', 1).points - definitionCode('easy', 2).points + 7);
    const hard = body.find((mode) => mode.mode === 'hard');
    expect(hard).toMatchObject({ codes: MODES.hard.codes.length, solved: 0, pointsEarned: 0 });
  });

  it('works for admins (no team, solved 0)', async () => {
    const { body } = await api('get', '/terminal/modes', 'admin').expect(200);
    expect(body).toHaveLength(3);
    expect(body.every((mode) => mode.solved === 0)).toBe(true);
    expect(Solve.find).not.toHaveBeenCalled();
  });
});

describe('GET /terminal/:mode/progress', () => {
  it('lists solved codes with titles from the definition, earned points and first blood', async () => {
    solves = [solveOf('easy', 2), solveOf('easy', 1, { points: 44, firstBlood: true }), { ...solveOf('easy', 3), teamId: TEAM_B }];
    const { body } = await api('get', '/terminal/easy/progress').expect(200);
    const total = MODES.easy.codes.length;
    expect(body).toEqual({
      mode: 'easy', total, remaining: total - 2,
      solved: [
        { n: 1, title: definitionCode('easy', 1).title, points: 44, firstBlood: true },
        { n: 2, title: definitionCode('easy', 2).title, points: definitionCode('easy', 2).points, firstBlood: false },
      ],
    });
    const text = JSON.stringify(body.solved);
    for (const code of MODES.easy.codes.filter((c) => c.n > 2)) { expect(text).not.toContain(code.title); }
    expectNoFlags(body);
  });

  it('is empty for a team without solves and for an admin, and 503 when not seeded', async () => {
    expect((await api('get', '/terminal/medium/progress').expect(200)).body).toMatchObject({ solved: [], remaining: MODES.medium.codes.length });
    expect((await api('get', '/terminal/medium/progress', 'admin').expect(200)).body.solved).toEqual([]);
    challenges = [];
    const { body } = await api('get', '/terminal/medium/progress').expect(503);
    expect(body.error.code).toBe('TERMINAL_NOT_SEEDED');
  });
});

describe('POST /terminal/:mode/submit', () => {
  const submit = (flag, sub = 'player', mode = 'easy') => api('post', `/terminal/${mode}/submit`, sub, { flag });

  it('accepts the team\'s own flag for any code of the mode and records the solve like a normal challenge', async () => {
    const total = MODES.easy.codes.length;
    const { body } = await submit(flagOf('easy', 2)).expect(200);
    expect(body).toEqual({
      correct: true, code: 2, title: definitionCode('easy', 2).title, pointsAwarded: definitionCode('easy', 2).points,
      firstBlood: false, message: 'Correct flag!', solved: 1, total,
    });
    expect(recordSolve).toHaveBeenCalledWith({ challenge: doc('easy', 2), teamId: TEAM_A, userId: users.player._id });
    const saved = Submission.create.mock.calls[0][0];
    expect(saved).toMatchObject({ teamId: TEAM_A, userId: users.player._id, challengeId: doc('easy', 2)._id, correct: true });
    expect(saved.submittedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(saved)).not.toContain(flagOf('easy', 2));
    expectNoFlags(body);
  });

  it('trims the flag and reports first blood from recordSolve', async () => {
    recordSolve.mockResolvedValue({ points: 44, firstBlood: true, score: 44 });
    const { body } = await submit(`  ${flagOf('easy', 1)}  `).expect(200);
    expect(body).toMatchObject({ correct: true, code: 1, pointsAwarded: 44, firstBlood: true, message: 'First blood! Correct flag.' });
  });

  it('counts codes that were solved before: solved goes up by one', async () => {
    solves = [solveOf('easy', 1), solveOf('easy', 3)];
    const { body } = await submit(flagOf('easy', 4)).expect(200);
    expect(body).toMatchObject({ correct: true, code: 4, solved: 3 });
  });

  it('answers a wrong flag with 200, no code or title, and stores it against the mode\'s first code', async () => {
    const wrong = 'CTF{wrong_guess_xyz}';
    const { body } = await submit(wrong).expect(200);
    expect(body).toEqual({
      correct: false, pointsAwarded: 0, firstBlood: false, message: 'Incorrect flag. Keep digging!', solved: 0, total: MODES.easy.codes.length,
    });
    expect(Submission.create.mock.calls[0][0]).toMatchObject({ challengeId: doc('easy', 1)._id, correct: false, teamId: TEAM_A });
    expect(JSON.stringify(Submission.create.mock.calls[0][0])).not.toContain('wrong_guess_xyz');
    expect(JSON.stringify(body)).not.toContain('wrong_guess_xyz');
    expect(recordSolve).not.toHaveBeenCalled();
    expectNoFlags(body);
  });

  it('rejects another team\'s flag, an admin preview flag, a flag of another mode and unrelated decoys', async () => {
    for (const wrong of [
      flagOf('easy', 1, TEAM_B), flagOf('easy', 1, ADMIN_PREVIEW_TEAM), flagOf('medium', 1, TEAM_A),
      flagOf('hard', 2, TEAM_A), 'CTF{this_is_not_it}', 'CTF{nice_try}', UNAVAILABLE_FLAG,
    ]) {
      const { body } = await submit(wrong).expect(200);
      expect(body.correct).toBe(false);
    }
    expect(recordSolve).not.toHaveBeenCalled();
  });

  it('answers a code the team already solved with alreadySolved and no points, and does not record again', async () => {
    solves = [solveOf('easy', 1)];
    const { body } = await submit(flagOf('easy', 1)).expect(200);
    expect(body).toEqual({
      correct: true, alreadySolved: true, code: 1, title: definitionCode('easy', 1).title, pointsAwarded: 0, firstBlood: false,
      message: 'Your team already found this code.', solved: 1, total: MODES.easy.codes.length,
    });
    expect(recordSolve).not.toHaveBeenCalled();
    expectNoFlags(body);
  });

  it('turns the losing side of a double click into alreadySolved', async () => {
    recordSolve.mockResolvedValue(null);
    const { body } = await submit(flagOf('easy', 3)).expect(200);
    expect(body).toMatchObject({ correct: true, alreadySolved: true, code: 3, pointsAwarded: 0, solved: 1 });
  });

  it('rate limits at 10 attempts per minute per team per mode (the 11th gets 429)', async () => {
    let attempts = 0;
    Submission.create.mockImplementation(async () => { attempts += 1; });
    Submission.countDocuments.mockImplementation(async () => attempts);
    for (let i = 1; i <= 10; i += 1) {
      await submit(`CTF{guess_${i}}`).expect(200);
    }
    const { body } = await submit(flagOf('easy', 1)).expect(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(attempts).toBe(10);
    expect(recordSolve).not.toHaveBeenCalled(); // not even a correct flag gets through while limited

    const filter = Submission.countDocuments.mock.calls[0][0];
    expect(filter.teamId).toBe(TEAM_A);
    expect(filter.challengeId.$in).toEqual(MODES.easy.codes.map((code) => doc('easy', code.n)._id));
    const age = Date.now() - filter.createdAt.$gte.getTime();
    expect(age).toBeGreaterThanOrEqual(59_000);
    expect(age).toBeLessThanOrEqual(61_000);
  });

  it('does not rate limit by anything but team and mode', async () => {
    Submission.countDocuments.mockImplementation(async (filter) => (String(filter.teamId) === TEAM_A ? 10 : 0));
    await submit('x').expect(429);
    await submit('x', 'player2').expect(200);
    Submission.countDocuments.mockImplementation(async (filter) => (filter.challengeId.$in.includes(doc('easy', 1)._id) ? 10 : 0));
    await submit('x', 'player', 'easy').expect(429);
    await submit('x', 'player', 'medium').expect(200);
  });

  it('validates the body strictly', async () => {
    for (const body of [{}, { flag: '' }, { flag: '   ' }, { flag: 'x'.repeat(201) }, { flag: 5 }, { flag: 'x', extra: 1 }, { flag: ['x'] }]) {
      const { body: error } = await api('post', '/terminal/easy/submit', 'player', body).expect(400);
      expect(error.error.code).toBe('VALIDATION_ERROR');
    }
    await api('post', '/terminal/easy/submit', 'player').expect(400);
    expect(Submission.create).not.toHaveBeenCalled();
    expect(recordSolve).not.toHaveBeenCalled();
    await submit('x'.repeat(200)).expect(200);
  });

  it('answers 503 when the mode is not seeded and records nothing', async () => {
    challenges = [];
    const { body } = await submit('x').expect(503);
    expect(body.error.code).toBe('TERMINAL_NOT_SEEDED');
    expect(Submission.create).not.toHaveBeenCalled();
  });

  it('does not accept a hidden code', async () => {
    doc('easy', 2).visible = false;
    const { body } = await submit(flagOf('easy', 2)).expect(200);
    expect(body).toMatchObject({ correct: false, total: MODES.easy.codes.length - 1 });
    expect(recordSolve).not.toHaveBeenCalled();
  });
});

describe('no response leaks a flag', () => {
  it('keeps flags, hashes and the submitted flag out of every non-exec response', async () => {
    solves = [solveOf('easy', 1)];
    recordSolve.mockResolvedValue({ points: 40, firstBlood: true, score: 40 });
    const responses = [
      await api('get', '/terminal/modes'),
      await api('get', '/terminal/modes', 'admin'),
      await api('get', '/terminal/easy/progress'),
      await api('get', '/terminal/easy/progress', 'admin'),
      await api('post', '/terminal/easy/complete', 'player', { partial: 'c', cwd: '/' }),
      await api('post', '/terminal/easy/submit', 'player', { flag: flagOf('easy', 2) }),
      await api('post', '/terminal/easy/submit', 'player', { flag: flagOf('easy', 1) }),
      await api('post', '/terminal/easy/submit', 'player', { flag: 'CTF{not_it}' }),
      await api('post', '/terminal/easy/submit', 'admin', { flag: 'CTF{not_it}' }),
      await api('post', '/terminal/easy/submit', 'player', { nope: 'CTF{not_it}' }),
      await api('post', '/terminal/nightmare/submit', 'player', { flag: flagOf('easy', 2) }),
    ];
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 403, 400, 404]);
    for (const response of responses) { expectNoFlags(response.body); }
  });
});
