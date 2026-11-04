// The per-team seed (docs/TERMINAL_GAME.md section 16) as seen from the HTTP API: what the engine receives and
// what the browser must never see. The shell is a spy around the real engine, so exec responses are real output.
import { createHmac } from 'node:crypto';
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
import { recordSolve } from '../../src/services/scoringService.js';
import { ADMIN_PREVIEW_TEAM, buildContext, terminalSeed } from '../../src/services/terminalService.js';
import { MODE_NAMES, MODES } from '../../src/terminal/modes/index.js';
import { seedValue } from '../../src/terminal/seed.js';
import { complete, execute } from '../../src/terminal/shell.js';
import { dir, file } from '../../src/terminal/vfs.js';

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
// A spy that still runs the real engine (re-armed in beforeEach, which resets every mock).
vi.mock('../../src/terminal/shell.js', () => ({ execute: vi.fn(), complete: vi.fn() }));
const realShell = await vi.importActual('../../src/terminal/shell.js');

const oid = (n) => String(n).padStart(24, '0');
const TEAM_A = oid(2);
const TEAM_B = oid(4);
const baseId = { easy: 1000, medium: 2000, hard: 3000 };
const users = {
  player: { _id: oid(1), teamId: TEAM_A },
  player2: { _id: oid(3), teamId: TEAM_B },
  admin: { _id: oid(9), teamId: null },
};
const expectedSeed = (teamId, mode) => createHmac('sha256', env.FLAG_SECRET).update(`terminal-seed:${teamId}:${mode}`).digest('hex');
const SUBJECT_TEAM = { player: TEAM_A, player2: TEAM_B, admin: ADMIN_PREVIEW_TEAM };
const everySeed = () => Object.values(SUBJECT_TEAM).flatMap((teamId) => MODE_NAMES.map((mode) => expectedSeed(teamId, mode)));

let challenges;
const api = (method, path, sub = 'player', body) => {
  const call = request(app)[method](`/api${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};
const lastCtx = () => execute.mock.calls.at(-1)[1];

beforeEach(() => {
  vi.resetAllMocks();
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  const teams = { [TEAM_A]: { _id: TEAM_A, name: 'Alpha', banned: false }, [TEAM_B]: { _id: TEAM_B, name: 'Bravo', banned: false } };
  challenges = MODE_NAMES.flatMap((name) => MODES[name].codes.map((code) => ({
    _id: oid(baseId[name] + code.n), slug: `terminal-${name}-${code.n}`, title: `Terminal ${name} #${code.n}`,
    category: 'terminal', type: 'terminal', difficulty: name, points: code.points, visible: true, solveCount: 0,
    terminal: { mode: name, code: code.n },
  })));
  User.findOne.mockImplementation(async ({ cognitoSub }) => users[cognitoSub] ?? null);
  Team.findById.mockImplementation(async (id) => teams[String(id)] ?? null);
  Challenge.find.mockImplementation((filter) => ({
    lean: async () => challenges.filter((row) => row.type === filter.type
      && (filter['terminal.mode'] === undefined || row.terminal.mode === filter['terminal.mode'])
      && (filter.visible === undefined || row.visible === filter.visible)),
  }));
  Solve.find.mockImplementation(() => ({ lean: async () => [] }));
  Submission.countDocuments.mockResolvedValue(0);
  Submission.create.mockResolvedValue({});
  recordSolve.mockResolvedValue(null);
  execute.mockImplementation(realShell.execute);
  complete.mockImplementation(realShell.complete);
});

describe('terminalSeed and buildContext', () => {
  it('is HMAC-SHA256(FLAG_SECRET, "terminal-seed:<team>:<mode>") as hex', () => {
    expect(terminalSeed(TEAM_A, 'easy')).toBe(expectedSeed(TEAM_A, 'easy'));
    expect(terminalSeed(TEAM_A, 'easy')).toMatch(/^[0-9a-f]{64}$/);
    expect(terminalSeed(TEAM_A, 'easy')).toBe(terminalSeed(TEAM_A, 'easy'));
  });

  it('puts the seed in the ctx for a team, with the admin preview id for admins', () => {
    const definition = MODES.hard;
    expect(buildContext({ definition, cwd: '/', challenges: [], team: { _id: TEAM_B } }).seed).toBe(expectedSeed(TEAM_B, 'hard'));
    expect(buildContext({ definition, cwd: '/', challenges: [], team: null }).seed).toBe(expectedSeed(ADMIN_PREVIEW_TEAM, 'hard'));
  });

  it('differs for every team and mode combination', () => {
    expect(new Set(everySeed()).size).toBe(9);
  });
});

describe('the ctx handed to execute and complete', () => {
  it('carries a seed that differs between two teams and between modes, and is stable for a team', async () => {
    const seeds = {};
    for (const sub of ['player', 'player2']) {
      for (const mode of MODE_NAMES) {
        await api('post', `/terminal/${mode}/exec`, sub, { command: 'pwd' }).expect(200);
        seeds[`${sub}:${mode}`] = lastCtx().seed;
        expect(lastCtx().seed).toBe(expectedSeed(SUBJECT_TEAM[sub], mode));
      }
    }
    for (const mode of MODE_NAMES) expect(seeds[`player:${mode}`]).not.toBe(seeds[`player2:${mode}`]);
    for (const sub of ['player', 'player2']) {
      expect(new Set(MODE_NAMES.map((mode) => seeds[`${sub}:${mode}`])).size).toBe(3);
    }
    // stable: the same team and mode, asked again (another replica would compute the same)
    await api('post', '/terminal/medium/exec', 'player', { command: 'ls' }).expect(200);
    expect(lastCtx().seed).toBe(seeds['player:medium']);
    await api('post', '/terminal/medium/exec', 'player', { command: 'ls /' }).expect(200);
    expect(lastCtx().seed).toBe(seeds['player:medium']);
  });

  it('gives admins the seed of the fixed preview team, which no real team shares', async () => {
    await api('post', '/terminal/easy/exec', 'admin', { command: 'pwd' }).expect(200);
    expect(lastCtx().seed).toBe(expectedSeed(ADMIN_PREVIEW_TEAM, 'easy'));
    expect(lastCtx().seed).not.toBe(expectedSeed(TEAM_A, 'easy'));
    expect(lastCtx().seed).not.toBe(expectedSeed(TEAM_B, 'easy'));
  });

  it('gives completion the same seed as exec', async () => {
    await api('post', '/terminal/hard/complete', 'player2', { partial: 'ls /h', cwd: '/' }).expect(200);
    expect(complete.mock.calls.at(-1)[1].seed).toBe(expectedSeed(TEAM_B, 'hard'));
    await api('post', '/terminal/hard/complete', 'admin', { partial: 'ls /h', cwd: '/' }).expect(200);
    expect(complete.mock.calls.at(-1)[1].seed).toBe(expectedSeed(ADMIN_PREVIEW_TEAM, 'hard'));
  });

  it('feeds the real engine: a seed token prints this team value, and another value for the other team', async () => {
    // A custom tree under the real mode definition (modes may or may not use seed tokens yet).
    const tree = dir({ home: dir({ guest: dir({ 'n.txt': file('pw={{seed:pass}} ip={{seed:ip}}\n') }) }) }, { owner: 'root', group: 'root' });
    const printed = async (teamId, mode) => {
      const definition = { ...MODES[mode], fs: tree };
      const ctx = buildContext({ definition, cwd: '/home/guest', challenges: [], team: teamId ? { _id: teamId } : null });
      return (await realShell.execute('cat n.txt', ctx)).output;
    };
    const wanted = (teamId, mode) => `pw=${seedValue(expectedSeed(teamId, mode), 'pass')} ip=${seedValue(expectedSeed(teamId, mode), 'ip')}`;
    expect(await printed(TEAM_A, 'easy')).toBe(wanted(TEAM_A, 'easy'));
    expect(await printed(TEAM_A, 'easy')).toBe(wanted(TEAM_A, 'easy'));
    expect(await printed(TEAM_B, 'easy')).toBe(wanted(TEAM_B, 'easy'));
    expect(await printed(TEAM_A, 'hard')).toBe(wanted(TEAM_A, 'hard'));
    expect(await printed(null, 'easy')).toBe(wanted(ADMIN_PREVIEW_TEAM, 'easy'));
    expect(new Set([await printed(TEAM_A, 'easy'), await printed(TEAM_B, 'easy'), await printed(TEAM_A, 'hard'), await printed(null, 'easy')]).size).toBe(4);
  });
});

describe('the seed never leaves the server', () => {
  const COMMANDS = ['env', 'printenv', 'set', 'export -p', 'echo $SEED $FLAG_SECRET', 'cat /proc/self/environ', 'history', 'pwd', 'help', 'status', 'hint', 'ls -laR /'];

  it('does not appear in any response body of any endpoint, success or error', async () => {
    const seeds = everySeed();
    const bodies = [];
    const keep = (response) => bodies.push(response.text, JSON.stringify(response.body), JSON.stringify(response.headers));

    for (const sub of ['player', 'player2', 'admin']) {
      keep(await api('get', '/terminal/modes', sub));
      for (const mode of MODE_NAMES) {
        keep(await api('get', `/terminal/${mode}/progress`, sub));
        for (const command of COMMANDS) {
          keep(await api('post', `/terminal/${mode}/exec`, sub, { command, cwd: '/' }));
        }
        keep(await api('post', `/terminal/${mode}/complete`, sub, { partial: 'cat /e', cwd: '/' }));
        keep(await api('post', `/terminal/${mode}/submit`, sub, { flag: 'CTF{not_it}' }));
        keep(await api('post', `/terminal/${mode}/exec`, sub, { command: 'x'.repeat(400) })); // 400 validation error
        keep(await api('post', `/terminal/${mode}/exec`, sub, { command: 'pwd', extra: 1 })); // strict body
      }
    }
    keep(await api('get', '/terminal/nightmare/progress')); // 404
    keep(await request(app).post('/api/terminal/easy/exec').send({ command: 'pwd' })); // 401

    expect(bodies.length).toBeGreaterThan(200);
    for (const text of bodies) {
      expect(text).not.toContain('terminal-seed');
      for (const seed of seeds) expect(text).not.toContain(seed);
      // not even a slice of it long enough to identify the seed
      for (const seed of seeds) expect(text).not.toContain(seed.slice(0, 24));
    }
  });

  it('does not appear in the exec output of the real engine even when asked directly', async () => {
    for (const mode of MODE_NAMES) {
      for (const command of COMMANDS) {
        const { body } = await api('post', `/terminal/${mode}/exec`, 'player', { command, cwd: '/' });
        const seed = expectedSeed(TEAM_A, mode);
        expect(JSON.stringify(body)).not.toContain(seed.slice(0, 24));
      }
    }
  });
});
