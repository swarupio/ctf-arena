// Access-control (IDOR / BOLA) tests with two real teams on the in-memory database: every object a player can
// reach must belong to the caller's own team, and the answer for somebody else's object is 403/404, never data.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import { dockerService } from '../../src/services/dockerService.js';
import { behaviour, models } from './helpers/fakeDb.js';
import {
  HIDDEN_FLAG, call, flagOf, getApp, seedWorld, terminalFlagOf, verify, world,
} from './helpers/harness.js';

// These tests drive the whole app; stay robust when the full suite runs in parallel on a busy machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

vi.mock('../../src/config/cognito.js', async () => (await import('./helpers/harness.js')).cognitoModule());
vi.mock('../../src/terminal/shell.js', async () => (await import('./helpers/harness.js')).shellModule());
vi.mock('../../src/services/dockerService.js', async () => (await import('./helpers/fakeDb.js')).fakeDockerModule());
vi.mock('../../src/models/User.js', async () => (await import('./helpers/fakeDb.js')).modelModule('User'));
vi.mock('../../src/models/Team.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Team'));
vi.mock('../../src/models/Challenge.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Challenge'));
vi.mock('../../src/models/Instance.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Instance'));
vi.mock('../../src/models/Solve.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Solve'));
vi.mock('../../src/models/Submission.js', async () => (await import('./helpers/fakeDb.js')).modelModule('Submission'));
vi.mock('../../src/models/ReplicaStat.js', async () => (await import('./helpers/fakeDb.js')).modelModule('ReplicaStat'));
vi.mock('../../src/models/AttemptCounter.js', async () => (await import('./helpers/fakeDb.js')).modelModule('AttemptCounter'));
vi.mock('../../src/models/CheatSignal.js', async () => (await import('./helpers/fakeDb.js')).modelModule('CheatSignal'));
vi.mock('../../src/models/TaintedFlag.js', async () => (await import('./helpers/fakeDb.js')).modelModule('TaintedFlag'));
vi.mock('../../src/models/TerminalActivity.js', async () => (await import('./helpers/fakeDb.js')).modelModule('TerminalActivity'));

beforeAll(async () => { await getApp(); });
afterAll(() => replicaCounter.stop());
beforeEach(() => {
  seedWorld();
  verify.mockClear();
  vi.clearAllMocks();
  behaviour.interleave = false;
});

// Parallel tests: queries yield to the event loop, so concurrent requests overlap between a check and its write.
const overlapping = async (work) => {
  behaviour.interleave = true;
  try { return await work(); } finally { behaviour.interleave = false; }
};

const userRow = (key) => models.User.docs.get(world.users[key]._id);
const teamRow = (key) => models.Team.docs.get(world.teams[key]._id);
const start = (token, challengeKey) => call('post', `/api/challenges/${world.challenges[challengeKey]._id}/instance`, token);
const submit = (token, challengeKey, flag) => call('post', `/api/challenges/${world.challenges[challengeKey]._id}/submit`, token, { flag });
const solvesOf = (teamKey) => models.Solve.all().filter((solve) => solve.teamId === world.teams[teamKey]._id);

describe('teams', () => {
  it('lets each player read only their own team; the invite code goes to members only', async () => {
    const alice = await call('get', '/api/teams/me', 'alice');
    expect(alice.status).toBe(200);
    expect(alice.body).toMatchObject({ id: world.teams.A._id, name: 'Team Alpha', inviteCode: 'ALPHA2' });
    expect(alice.body.members.map((member) => member.displayName).sort()).toEqual(['alice', 'alice2']);
    const bob = await call('get', '/api/teams/me', 'bob');
    expect(bob.body).toMatchObject({ id: world.teams.B._id, inviteCode: 'BRAVE3' });
    expect(JSON.stringify(bob.body)).not.toContain('ALPHA2');
    const carol = await call('get', '/api/teams/me', 'carol');
    expect(carol.status).toBe(404);
    expect(carol.body.error.code).toBe('NO_TEAM');
    expect(JSON.stringify(carol.body)).not.toMatch(/ALPHA2|BRAVE3|CHARL4/);
    expect((await call('get', '/api/teams/me', 'admin')).status).toBe(403);
  });

  it('has no endpoint that addresses another team by id', async () => {
    const other = world.teams.B._id;
    const attempts = [
      ['get', `/api/teams/${other}`], ['get', `/api/teams/${other}/members`], ['delete', `/api/teams/${other}`],
      ['patch', `/api/teams/${other}`], ['put', `/api/teams/${other}`], ['post', `/api/teams/${other}/leave`],
      ['post', `/api/teams/${other}/kick`], ['get', `/api/admin/teams/${other}`], ['patch', `/api/admin/teams/${other}/ban`],
    ];
    for (const [method, path] of attempts) {
      const response = await call(method, path, 'alice', method === 'get' || method === 'delete' ? undefined : { banned: true });
      expect([403, 404], `${method} ${path}`).toContain(response.status);
    }
    expect(teamRow('B').banned).toBe(false);
    expect(teamRow('B').memberIds).toEqual([world.users.bob._id]);
  });

  it('refuses mass assignment through the body of every team and profile mutation', async () => {
    const before = JSON.stringify([...models.User.all(), ...models.Team.all()]);
    const attempts = [
      ['patch', '/api/me', 'alice', { displayName: 'Valid Name', role: 'admin' }],
      ['patch', '/api/me', 'alice', { displayName: 'Valid Name', teamId: world.teams.B._id }],
      ['patch', '/api/me', 'alice', { displayName: 'Valid Name', cognitoSub: 'bob' }],
      ['patch', '/api/me', 'alice', { displayName: 'Valid Name', email: 'x@y.z' }],
      ['post', '/api/teams', 'carol', { name: 'Team Delta', captainId: world.users.bob._id }],
      ['post', '/api/teams', 'carol', { name: 'Team Delta', memberIds: [world.users.bob._id] }],
      ['post', '/api/teams', 'carol', { name: 'Team Delta', inviteCode: 'ZZZZZZ' }],
      ['post', '/api/teams', 'carol', { name: 'Team Delta', banned: false }],
      ['post', '/api/teams/join', 'carol', { inviteCode: 'BRAVE3', teamId: world.teams.A._id }],
      ['post', '/api/teams/me/leave', 'alice', { teamId: world.teams.B._id }],
      ['patch', `/api/admin/teams/${world.teams.B._id}/ban`, 'admin', { banned: true, name: 'owned' }],
    ];
    for (const [method, path, token, body] of attempts) {
      const response = await call(method, path, token, body);
      expect(response.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(JSON.stringify([...models.User.all(), ...models.Team.all()])).toBe(before);
  });

  it('leave affects only the caller and the caller\'s own team', async () => {
    expect((await call('post', '/api/teams/me/leave', 'alice2')).status).toBe(204);
    expect(teamRow('A').memberIds).toEqual([world.users.alice._id]);
    expect(teamRow('B').memberIds).toEqual([world.users.bob._id]);
    expect(userRow('alice2').teamId).toBeNull();
    expect(userRow('bob').teamId).toBe(world.teams.B._id);
  });

  it('joins only with a valid invite code and never reveals which teams exist', async () => {
    const wrong = await call('post', '/api/teams/join', 'carol', { inviteCode: 'ZZZZZZ' });
    expect(wrong.status).toBe(404);
    expect(userRow('carol').teamId).toBeNull();
    const right = await call('post', '/api/teams/join', 'carol', { inviteCode: 'BRAVE3' });
    expect(right.status).toBe(200);
    expect(teamRow('B').memberIds).toContain(world.users.carol._id);
    // An existing member cannot hop to another team with a second code.
    expect((await call('post', '/api/teams/join', 'carol', { inviteCode: 'ALPHA2' })).status).toBe(409);
    expect(teamRow('A').memberIds).not.toContain(world.users.carol._id);
  });

  it('keeps a banned team banned: its members can neither leave nor start over with a new team', async () => {
    expect((await call('patch', `/api/admin/teams/${world.teams.C._id}/ban`, 'admin', { banned: true })).status).toBe(200);
    const leave = await call('post', '/api/teams/me/leave', 'dave');
    expect(leave.status).toBe(403);
    expect(leave.body.error.code).toBe('TEAM_BANNED');
    expect(userRow('dave').teamId).toBe(world.teams.C._id);
    expect(teamRow('C')).toBeTruthy();
    const fresh = await call('post', '/api/teams', 'dave', { name: 'Fresh Start' });
    expect(fresh.status).toBe(409);
    expect(models.Team.all().some((team) => team.name === 'Fresh Start')).toBe(false);
    // Unbanning restores the normal rules.
    await call('patch', `/api/admin/teams/${world.teams.C._id}/ban`, 'admin', { banned: false });
    expect((await call('post', '/api/teams/me/leave', 'dave')).status).toBe(204);
  });
});

describe('instances', () => {
  it('lets a team see, extend and stop only its own instances', async () => {
    const mine = await start('alice', 'docker1');
    const theirs = await start('bob', 'docker2');
    expect([mine.status, theirs.status]).toEqual([201, 201]);

    const aliceList = (await call('get', '/api/instances', 'alice')).body;
    const bobList = (await call('get', '/api/instances', 'bob')).body;
    expect(aliceList.map((item) => item.id)).toEqual([mine.body.id]);
    expect(bobList.map((item) => item.id)).toEqual([theirs.body.id]);

    for (const [method, path] of [
      ['delete', `/api/instances/${mine.body.id}`], ['post', `/api/instances/${mine.body.id}/extend`],
    ]) {
      const response = await call(method, path, 'bob');
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
    const row = models.Instance.docs.get(mine.body.id);
    expect(row.status).toBe('running');
    expect(row.extended).toBe(false);
    expect(dockerService.stopInstance).not.toHaveBeenCalled();

    // A teammate shares the instance; the owner team can extend once and stop.
    expect((await call('post', `/api/instances/${mine.body.id}/extend`, 'alice2')).status).toBe(200);
    expect((await call('post', `/api/instances/${mine.body.id}/extend`, 'alice')).status).toBe(409);
    expect((await call('delete', `/api/instances/${mine.body.id}`, 'alice2')).status).toBe(204);
    expect(models.Instance.docs.get(mine.body.id).status).toBe('stopped');
    expect(models.Instance.docs.get(theirs.body.id).status).toBe('running');
  });

  it('does not show another team\'s instance on the challenge page', async () => {
    await start('alice', 'docker1');
    const detail = (await call('get', `/api/challenges/${world.challenges.docker1._id}`, 'bob')).body;
    expect(detail.hasInstance).toBe(false);
    expect(detail.myInstance).toBeNull();
    const own = (await call('get', `/api/challenges/${world.challenges.docker1._id}`, 'alice')).body;
    expect(own.hasInstance).toBe(true);
  });

  it('needs a team and a player role; malformed or foreign ids are 404', async () => {
    expect((await call('get', '/api/instances', 'carol')).body.error.code).toBe('NO_TEAM');
    expect((await start('carol', 'docker1')).body.error.code).toBe('NO_TEAM');
    expect((await start('eve', 'docker1')).status).toBe(404);
    expect((await call('delete', '/api/instances/not-an-id', 'alice')).status).toBe(404);
    expect((await call('delete', `/api/instances/${'0'.repeat(24)}`, 'alice')).status).toBe(404);
    expect((await call('get', '/api/instances', 'admin')).status).toBe(403);
  });

  it('only admins can force-kill, and they can kill any team\'s instance', async () => {
    const theirs = await start('bob', 'docker2');
    expect((await call('post', `/api/admin/instances/${theirs.body.id}/kill`, 'alice')).status).toBe(403);
    expect(models.Instance.docs.get(theirs.body.id).status).toBe('running');
    expect((await call('post', `/api/admin/instances/${theirs.body.id}/kill`, 'admin')).status).toBe(204);
    expect(models.Instance.docs.get(theirs.body.id).status).toBe('stopped');
  });

  it('never lets a team exceed the instance limit, also under parallel starts', async () => {
    const keys = ['docker1', 'docker2', 'docker3', 'docker4', 'docker5'];
    const results = await overlapping(() => Promise.all(keys.map((key) => start('alice', key))));
    const alive = models.Instance.all().filter((row) => row.teamId === world.teams.A._id && ['starting', 'running'].includes(row.status));
    // In a perfectly simultaneous burst every start may see the others and back off; the limit is never exceeded.
    expect(alive.length).toBeLessThanOrEqual(env.MAX_INSTANCES_PER_TEAM);
    expect(results.filter((response) => response.status === 201).length).toBe(alive.length);
    for (const response of results.filter((item) => item.status !== 201)) { expect(response.body.error.code).toBe('INSTANCE_LIMIT'); }
    // The ports of refused starts are free again.
    expect(new Set(alive.map((row) => row.port)).size).toBe(alive.length);
    const retry = await start('alice', 'docker1');
    expect([201, 409]).toContain(retry.status);
    if (alive.length < env.MAX_INSTANCES_PER_TEAM) { expect(retry.status).toBe(201); }
  });

  it('turns a double click on the same challenge into exactly one instance', async () => {
    const results = await overlapping(() => Promise.all([start('bob', 'docker3'), start('bob', 'docker3'), start('bob', 'docker3')]));
    expect(results.filter((response) => response.status === 201)).toHaveLength(1);
    expect(results.filter((response) => response.status === 409).map((response) => response.body.error.code)).toEqual(
      ['ALREADY_RUNNING', 'ALREADY_RUNNING'],
    );
  });
});

describe('flag submission', () => {
  it('judges every flag against the caller\'s own team only', async () => {
    const aliceFlag = flagOf(world.challenges.docker2, 'A');
    const bobFlag = flagOf(world.challenges.docker2, 'B');
    expect(aliceFlag).not.toBe(bobFlag);
    expect((await submit('bob', 'docker2', aliceFlag)).body.correct).toBe(false);
    expect((await submit('alice', 'docker2', bobFlag)).body.correct).toBe(false);
    expect(solvesOf('A').some((solve) => solve.challengeId === world.challenges.docker2._id)).toBe(false);
    const ok = await submit('alice', 'docker2', aliceFlag);
    expect(ok.body).toMatchObject({ correct: true, pointsAwarded: 110, firstBlood: true });
    expect(solvesOf('A').filter((solve) => solve.challengeId === world.challenges.docker2._id)).toHaveLength(1);
    expect(solvesOf('B').some((solve) => solve.challengeId === world.challenges.docker2._id)).toBe(false);
    // Solving again is a conflict, not a second award.
    expect((await submit('alice2', 'docker2', aliceFlag)).status).toBe(409);
  });

  it('accepts no flag for a hidden challenge, not even the right one', async () => {
    const response = await call('post', `/api/challenges/${world.challenges.hidden._id}/submit`, 'alice', { flag: HIDDEN_FLAG });
    expect(response.status).toBe(404);
    expect(solvesOf('A').some((solve) => solve.challengeId === world.challenges.hidden._id)).toBe(false);
  });

  it('refuses admins, team-less players and banned teams before judging anything', async () => {
    const flag = flagOf(world.challenges.docker2, 'A');
    expect((await submit('admin', 'docker2', flag)).status).toBe(403);
    expect((await submit('carol', 'docker2', flag)).body.error.code).toBe('NO_TEAM');
    expect((await submit('eve', 'docker2', flag)).body.error.code).toBe('NO_TEAM');
    await call('patch', `/api/admin/teams/${world.teams.A._id}/ban`, 'admin', { banned: true });
    const banned = await submit('alice', 'docker2', flag);
    expect(banned.status).toBe(403);
    expect(banned.body.error.code).toBe('TEAM_BANNED');
    expect((await start('alice', 'docker1')).body.error.code).toBe('TEAM_BANNED');
    expect(models.Submission.all().filter((row) => row.teamId === world.teams.A._id)).toHaveLength(0);
  });

  it('stops after 5 attempts per minute per team and challenge, even for the right flag', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await submit('alice', 'docker2', `CTF{wrong_${attempt}_value}`)).status).toBe(200);
    }
    const blocked = await submit('alice2', 'docker2', flagOf(world.challenges.docker2, 'A'));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(solvesOf('A').some((solve) => solve.challengeId === world.challenges.docker2._id)).toBe(false);
    // Another team and another challenge are unaffected.
    expect((await submit('bob', 'docker2', 'CTF{wrong_value}')).status).toBe(200);
    expect((await submit('alice', 'docker3', 'CTF{wrong_value}')).status).toBe(200);
  });

  it('answers at most 5 attempts of a parallel burst, so a burst cannot test more than 5 guesses per minute', async () => {
    const burst = await overlapping(() => Promise.all(Array.from({ length: 14 }, (_, index) => submit('alice', 'docker3', `CTF{burst_guess_${index}}`))));
    expect(burst.filter((response) => response.status === 200).length).toBeLessThanOrEqual(5);
    expect(burst.filter((response) => response.status === 429).length).toBeGreaterThanOrEqual(9);
    for (const response of burst.filter((item) => item.status === 429)) { expect(response.body.error.code).toBe('RATE_LIMITED'); }
  });
});

describe('terminal game', () => {
  it('scopes progress, flags and solves to the caller\'s team', async () => {
    const own = terminalFlagOf('easy', 1, 'A');
    expect((await call('post', '/api/terminal/easy/submit', 'alice', { flag: own })).body).toMatchObject({ correct: true, solved: 1 });
    const aliceProgress = (await call('get', '/api/terminal/easy/progress', 'alice')).body;
    const bobProgress = (await call('get', '/api/terminal/easy/progress', 'bob')).body;
    expect(aliceProgress.solved.map((code) => code.n)).toEqual([1]);
    expect(bobProgress.solved).toEqual([]);
    // Bob replaying Alice's flag (or the other way round) is just a wrong flag.
    const replay = await call('post', '/api/terminal/easy/submit', 'bob', { flag: own });
    expect(replay.body).toMatchObject({ correct: false, pointsAwarded: 0 });
    const reverse = await call('post', '/api/terminal/easy/submit', 'alice', { flag: terminalFlagOf('easy', 2, 'B') });
    expect(reverse.body.correct).toBe(false);
    const terminalSolves = (team) => solvesOf(team).filter((solve) => world.terminal.easy.some((challenge) => challenge._id === solve.challengeId));
    expect(terminalSolves('A')).toHaveLength(1);
    expect(terminalSolves('B')).toHaveLength(0);
    // A flag of another MODE does not cross over either.
    expect((await call('post', '/api/terminal/medium/submit', 'alice', { flag: own })).body.correct).toBe(false);
  });

  it('derives the flags printed by exec from the caller\'s team, whatever the request says', async () => {
    const asAlice = await call('post', '/api/terminal/easy/exec', 'alice', { command: 'cat flag', cwd: '/home/../../etc' });
    expect(asAlice.body.output).toContain(terminalFlagOf('easy', 1, 'A'));
    expect(asAlice.body.output).not.toContain(terminalFlagOf('easy', 1, 'B'));
    for (const extra of [{ team: world.teams.B._id }, { teamId: world.teams.B._id }, { userId: world.users.bob._id }, { flagFor: 'B' }]) {
      const response = await call('post', '/api/terminal/easy/exec', 'alice', { command: 'cat flag', ...extra });
      expect(response.status).toBe(400);
    }
  });

  it('needs a team for exec/submit, honours bans, and keeps read-only views open', async () => {
    expect((await call('post', '/api/terminal/easy/exec', 'carol', { command: 'ls' })).body.error.code).toBe('NO_TEAM');
    expect((await call('post', '/api/terminal/easy/submit', 'eve', { flag: 'CTF{x}' })).body.error.code).toBe('NO_TEAM');
    expect((await call('get', '/api/terminal/easy/progress', 'carol')).body.solved).toEqual([]);
    await call('patch', `/api/admin/teams/${world.teams.A._id}/ban`, 'admin', { banned: true });
    expect((await call('post', '/api/terminal/easy/exec', 'alice', { command: 'ls' })).body.error.code).toBe('TEAM_BANNED');
    expect((await call('post', '/api/terminal/easy/submit', 'alice', { flag: terminalFlagOf('easy', 1, 'A') })).body.error.code).toBe('TEAM_BANNED');
    expect((await call('get', '/api/terminal/modes', 'alice')).status).toBe(200);
  });

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'EASY', 'easy%00', '..', 'easy/../hard', 'a'.repeat(300)])(
    'answers the odd mode name %j with 404 for every terminal route', async (mode) => {
      const name = encodeURIComponent(mode);
      for (const [method, suffix, body] of [
        ['get', 'progress'], ['post', 'exec', { command: 'ls' }], ['post', 'complete', { partial: 'l' }], ['post', 'submit', { flag: 'CTF{x}' }],
      ]) {
        const response = await call(method, `/api/terminal/${name}/${suffix}`, 'alice', body);
        expect(response.status, `${method} ${mode}/${suffix}`).toBe(404);
      }
    },
  );

  // SEC-05 (closed): submitFlag() recounts after its own insert, like routes/challenges.js, so a parallel burst gets at most 10 answers.
  it('answers at most 10 attempts of a parallel burst', async () => {
    const burst = await overlapping(() => Promise.all(Array.from({ length: 25 }, (_, index) => call('post', '/api/terminal/hard/submit', 'bob', { flag: `CTF{burst_${index}_value}` }))));
    expect(burst.filter((response) => response.status === 200).length).toBeLessThanOrEqual(10);
  });

  it('stops after 10 attempts per minute per team and mode', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await call('post', '/api/terminal/hard/submit', 'bob', { flag: `CTF{wrong_${attempt}_value}` })).status).toBe(200);
    }
    const blocked = await call('post', '/api/terminal/hard/submit', 'bob', { flag: terminalFlagOf('hard', 1, 'B') });
    expect(blocked.status).toBe(429);
    expect((await call('post', '/api/terminal/hard/submit', 'alice', { flag: 'CTF{wrong_value}' })).status).toBe(200);
  });
});

describe('leaderboard, profile and identity', () => {
  it('never shows banned teams and exposes no emails or member data', async () => {
    await call('patch', `/api/admin/teams/${world.teams.B._id}/ban`, 'admin', { banned: true });
    const board = (await call('get', '/api/leaderboard', 'alice')).body;
    expect(board.map((row) => row.teamName)).not.toContain('Team Bravo');
    expect(JSON.stringify(board)).not.toMatch(/@|BRAVE3|ALPHA2|memberIds|inviteCode/);
    const timeline = (await call('get', '/api/leaderboard/timeline', 'carol')).body;
    expect(JSON.stringify(timeline)).not.toContain('Team Bravo');
  });

  it('keeps /api/me about the caller: own email, no invite code, no member list; users without a row get one', async () => {
    const alice = (await call('get', '/api/me', 'alice')).body;
    expect(alice).toMatchObject({ email: 'alice@example.com', role: 'player', team: { id: world.teams.A._id, name: 'Team Alpha' } });
    expect(JSON.stringify(alice)).not.toMatch(/ALPHA2|alice2|bob/);
    expect(models.User.all().some((user) => user.cognitoSub === 'eve')).toBe(false);
    const eve = (await call('get', '/api/me', 'eve')).body;
    expect(eve.team).toBeNull();
    expect(models.User.all().some((user) => user.cognitoSub === 'eve')).toBe(true);
  });

  it('does not let a player rename or re-role somebody else (only the caller\'s own row changes)', async () => {
    const renamed = await call('patch', '/api/me', 'alice', { displayName: 'Brand New Name' });
    expect(renamed.status).toBe(200);
    expect(userRow('alice').displayName).toBe('Brand New Name');
    expect(userRow('alice2').displayName).toBe('alice2');
    expect(userRow('bob').displayName).toBe('bob');
    expect(userRow('alice').role).toBe('player');
  });
});
