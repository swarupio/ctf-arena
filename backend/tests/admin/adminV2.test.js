// Admin API v2 (docs/API_SPEC.md "Admin API v2"): guards, validation, happy paths and audit entries with mocked models.
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import { replicaCounter } from '../../src/middleware/requestCounter.js';
import {
  chain, instanceMock, models, oid, resetModels,
} from './harness.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', async () => (await import('./harness.js')).mockModel('User'));
vi.mock('../../src/models/Team.js', async () => (await import('./harness.js')).mockModel('Team'));
vi.mock('../../src/models/Challenge.js', async () => (await import('./harness.js')).mockModel('Challenge'));
vi.mock('../../src/models/Instance.js', async () => (await import('./harness.js')).mockModel('Instance', { ACTIVE_STATUSES: ['starting', 'running', 'stopping'] }));
vi.mock('../../src/models/Solve.js', async () => (await import('./harness.js')).mockModel('Solve'));
vi.mock('../../src/models/Submission.js', async () => (await import('./harness.js')).mockModel('Submission'));
vi.mock('../../src/models/ReplicaStat.js', async () => (await import('./harness.js')).mockModel('ReplicaStat'));
vi.mock('../../src/models/CheatSignal.js', async () => (await import('./harness.js')).mockModel('CheatSignal'));
vi.mock('../../src/models/TaintedFlag.js', async () => (await import('./harness.js')).mockModel('TaintedFlag'));
vi.mock('../../src/models/TerminalActivity.js', async () => (await import('./harness.js')).mockModel('TerminalActivity'));
vi.mock('../../src/models/AttemptCounter.js', async () => (await import('./harness.js')).mockModel('AttemptCounter'));
vi.mock('../../src/models/AuditLog.js', async () => (await import('./harness.js')).mockModel('AuditLog'));
vi.mock('../../src/models/AppSetting.js', async () => (await import('./harness.js')).mockModel('AppSetting', { ANNOUNCEMENT_LEVELS: ['info', 'warning', 'critical'] }));
vi.mock('../../src/services/instanceService.js', async () => (await import('./harness.js')).instanceModule());

const ACTOR = oid(900);
const api = (method, path, { as = 'admin', body } = {}) => {
  let call = request(app)[method](`/api${path}`);
  if (as) { call = call.set('Authorization', `Bearer ${as}`); }
  return body === undefined ? call : call.send(body);
};
const auditEntries = () => models.AuditLog.create.mock.calls.map(([entry]) => entry);
const lastAudit = () => auditEntries().at(-1);
const noSecrets = (value) => {
  const text = JSON.stringify(value);
  for (const word of ['flagHash', 'flagSalt', 'submittedHash', 'containerId', 'cognitoSub']) { expect(text).not.toContain(word); }
};

beforeAll(() => {
  // The audit log and settings guard skip themselves without a database connection in tests; pretend to be connected.
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
});
afterAll(() => {
  delete mongoose.connection.readyState;
  replicaCounter.stop();
});

beforeEach(() => {
  vi.clearAllMocks();
  resetModels();
  delete process.env.DOCKER_ENABLED;
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  // The admin's own user row (audit actor, score adjustments).
  models.User.findOne.mockImplementation(() => chain({ _id: ACTOR }));
});

// ---- guards -------------------------------------------------------------------------------------------------------
const V2_ROUTES = [
  ['get', '/admin/stats/overview'], ['get', '/admin/stats/timeseries'],
  ['get', '/admin/users'], ['get', `/admin/users/${oid(1)}`], ['patch', `/admin/users/${oid(1)}/ban`, { banned: true }],
  ['post', `/admin/users/${oid(1)}/remove-from-team`, {}], ['post', `/admin/users/${oid(1)}/reset-terminal`, { confirm: true }],
  ['get', `/admin/teams/${oid(1)}`], ['patch', `/admin/teams/${oid(1)}`, { name: 'Renamed' }],
  ['delete', `/admin/teams/${oid(1)}?confirm=true`], ['delete', `/admin/teams/${oid(1)}/members/${oid(2)}`],
  ['post', `/admin/teams/${oid(1)}/invite-code/regenerate`, {}],
  ['post', `/admin/teams/${oid(1)}/score-adjustments`, { points: 5, reason: 'bonus' }],
  ['get', '/admin/challenges/export'], ['post', '/admin/challenges/import', { challenges: [{}] }],
  ['patch', `/admin/challenges/${oid(1)}/visibility`, { visible: false }], ['post', `/admin/challenges/${oid(1)}/duplicate`, {}],
  ['get', `/admin/challenges/${oid(1)}/stats`], ['post', `/admin/challenges/${oid(1)}/reset-solves`, { confirm: true }],
  ['get', '/admin/solves'], ['delete', `/admin/solves/${oid(1)}`], ['get', '/admin/submissions'], ['get', '/admin/audit'],
  ['get', '/admin/integrity/summary'], ['get', '/admin/integrity/users'], ['post', `/admin/integrity/${oid(1)}/resolve`, { note: 'checked' }],
  ['get', '/admin/settings'], ['put', '/admin/settings', { submissionsFrozen: true }],
  ['get', '/admin/export/users.csv'], ['get', '/admin/export/teams.csv'], ['get', '/admin/export/submissions.csv'],
  ['get', '/admin/export/leaderboard.csv'],
];

describe('guards', () => {
  it.each(V2_ROUTES)('%s %s: 401 without a token, 403 for players, and no data is touched', async (method, path, body) => {
    const send = (as) => api(method, path, { as, body });
    await send(null).expect(401);
    const { body: error } = await send('player').expect(403);
    expect(error.error.code).toBe('FORBIDDEN');
    for (const model of Object.values(models)) {
      for (const [name, fn] of Object.entries(model)) {
        if (!['updateOne'].includes(name) || model !== models.ReplicaStat) { expect(fn, name).not.toHaveBeenCalled(); }
      }
    }
  });

  it('GET /api/announcement is public and tiny', async () => {
    models.AppSetting.findOne.mockImplementation(() => chain({ announcement: { text: 'CTF starts at 18:00', level: 'warning' }, submissionsFrozen: true, registrationOpen: false, updatedAt: new Date(), updatedBy: 'x@y.z' }));
    const { body } = await api('get', '/announcement', { as: null }).expect(200);
    expect(body).toEqual({ announcement: { text: 'CTF starts at 18:00', level: 'warning' }, registrationOpen: false, submissionsFrozen: true });
  });

  it('GET /api/announcement falls back to defaults when nothing was saved', async () => {
    const { body } = await api('get', '/announcement', { as: null }).expect(200);
    expect(body).toEqual({ announcement: { text: '', level: 'info' }, registrationOpen: true, submissionsFrozen: false });
  });
});

// ---- stats --------------------------------------------------------------------------------------------------------
describe('stats overview', () => {
  const day = new Date().toISOString().slice(0, 10);
  const arrange = () => {
    models.User.countDocuments.mockImplementation(async (filter) => (filter?.banned ? 1 : 10));
    models.Team.countDocuments.mockImplementation(async (filter) => (filter?.banned ? 0 : 4));
    models.Solve.countDocuments.mockResolvedValue(6);
    models.Submission.countDocuments.mockImplementation(async (filter) => (filter?.correct === false ? 5 : 20));
    models.User.aggregate.mockResolvedValue([{ _id: day, count: 3 }]);
    models.Submission.aggregate.mockImplementation(async (pipeline) => (typeof pipeline.find((stage) => stage.$group).$group._id === 'object'
      ? [{ _id: day, count: 8, wrong: 5 }]
      : [{ _id: oid(11), submissions: 10, wrong: 8 }, { _id: oid(12), submissions: 4, wrong: 1 }]));
    models.Solve.aggregate.mockImplementation(async (pipeline) => {
      const key = pipeline.find((stage) => stage.$group)?.$group._id;
      if (typeof key === 'object') { return [{ _id: day, count: 2 }]; }
      if (key === '$challengeId') { return [{ _id: oid(11), solves: 1 }, { _id: oid(12), solves: 3 }]; }
      return [{ _id: oid(1), score: 300, solves: 3 }];
    });
    models.Team.find.mockImplementation(() => chain([{ _id: oid(1), name: 'Alpha', banned: false }]));
    models.Challenge.find.mockImplementation((filter) => chain(filter?.type === 'terminal'
      ? [
        { _id: oid(21), visible: true, terminal: { mode: 'easy', code: 1 } },
        { _id: oid(22), visible: true, terminal: { mode: 'easy', code: 2 } },
      ]
      : [
        { _id: oid(11), slug: 'hard-one', title: 'Hard', points: 300, difficulty: 'hard', category: 'web', visible: true },
        { _id: oid(12), slug: 'easy-one', title: 'Easy', points: 50, difficulty: 'easy', category: 'misc', visible: true },
        { _id: oid(21), slug: 'terminal-easy-1', title: 'T1', points: 10, difficulty: 'easy', category: 'terminal', visible: true },
      ]));
    models.Solve.find.mockImplementation(() => chain([
      { teamId: oid(1), challengeId: oid(21), points: 10 }, { teamId: oid(1), challengeId: oid(22), points: 20 },
      { teamId: oid(2), challengeId: oid(21), points: 10 },
    ]));
    models.Instance.countDocuments.mockResolvedValue(2);
  };

  it('returns totals, a gap-free daily series, top teams, difficulty, wrong rates, terminal stats and instances', async () => {
    arrange();
    const { body } = await api('get', '/admin/stats/overview?days=3').expect(200);
    expect(body.totals).toEqual({
      users: 10, teams: 4, solves: 6, submissions: 20, wrongRate: 0.25, bannedUsers: 1, bannedTeams: 0, activeInstances: 2,
    });
    expect(body.series).toHaveLength(3);
    expect(body.series.at(-1)).toEqual({ date: day, signups: 3, submissions: 8, wrongSubmissions: 5, solves: 2 });
    expect(body.series[0]).toEqual({ date: expect.any(String), signups: 0, submissions: 0, wrongSubmissions: 0, solves: 0 });
    expect(body.topTeams).toEqual([{ id: oid(1), name: 'Alpha', banned: false, score: 300, solves: 3 }]);
    expect(body.challenges.hardest[0]).toMatchObject({ slug: 'hard-one', solves: 1, solveRate: 0.25 });
    expect(body.challenges.easiest[0]).toMatchObject({ slug: 'easy-one', solves: 3, solveRate: 0.75 });
    expect(body.challenges.hardest.map((row) => row.slug)).not.toContain('terminal-easy-1');
    expect(body.challenges.wrongRates[0]).toMatchObject({ slug: 'hard-one', submissions: 10, wrongSubmissions: 8, wrongRate: 0.8 });
    expect(body.terminal.modes).toEqual([
      { mode: 'easy', codes: 2, teamsPlaying: 2, completions: 1, averageScore: 20, maxScore: 30 },
    ]);
    expect(body.instances).toEqual({ dockerEnabled: true, active: 2 });
    noSecrets(body);
  });

  it('reports 0 active instances without querying when Docker is disabled', async () => {
    arrange();
    process.env.DOCKER_ENABLED = 'false';
    const { body } = await api('get', '/admin/stats/overview').expect(200);
    expect(body.instances).toEqual({ dockerEnabled: false, active: 0 });
    expect(body.totals.activeInstances).toBe(0);
    expect(models.Instance.countDocuments).not.toHaveBeenCalled();
  });

  it('works on an empty platform', async () => {
    const { body } = await api('get', '/admin/stats/overview').expect(200);
    expect(body.totals.wrongRate).toBe(0);
    expect(body.series).toHaveLength(14);
    expect(body.terminal.modes).toEqual([]);
  });

  it('serves the series alone and validates days', async () => {
    const { body } = await api('get', '/admin/stats/timeseries?days=7').expect(200);
    expect(body.days).toBe(7);
    expect(body.series).toHaveLength(7);
    for (const bad of ['0', '91', 'x', '7&evil=1']) { await api('get', `/admin/stats/timeseries?days=${bad}`).expect(400); }
  });
});

// ---- users --------------------------------------------------------------------------------------------------------
describe('users', () => {
  const user = (n, extra = {}) => ({ _id: oid(n), displayName: `User ${n}`, email: `u${n}@example.com`, role: 'player', banned: false, teamId: oid(50), createdAt: new Date('2026-11-01T10:00:00Z'), ...extra });

  it('lists with the paging envelope, search and filters (regex-escaped)', async () => {
    models.User.find.mockImplementation(() => chain([user(1), user(2, { teamId: null, banned: true })]));
    models.User.countDocuments.mockResolvedValue(42);
    models.Team.find.mockImplementation(() => chain([{ _id: oid(50), name: 'Alpha' }]));
    const { body } = await api('get', '/admin/users?page=2&limit=2&q=a.b(&banned=false&role=player&hasTeam=true&sort=displayName').expect(200);
    expect(body).toMatchObject({ page: 2, limit: 2, total: 42 });
    expect(body.items[0]).toEqual({
      id: oid(1), displayName: 'User 1', email: 'u1@example.com', role: 'player', banned: false,
      team: { id: oid(50), name: 'Alpha' }, createdAt: '2026-11-01T10:00:00.000Z',
    });
    expect(body.items[1].team).toBeNull();
    const [filter] = models.User.find.mock.calls[0];
    expect(filter.$or[0].displayName.source).toBe('a\\.b\\(');
    expect(filter).toMatchObject({ role: 'player', banned: { $ne: true }, teamId: { $ne: null } });
    noSecrets(body);
  });

  it.each(['limit=101', 'page=0', 'sort=cognitoSub', 'role=root', 'banned=maybe', 'foo=1', 'q='])('rejects the query %s with 400', async (query) => {
    const { body } = await api('get', `/admin/users?${query}`).expect(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the detail with team, solves, submissions, terminal and integrity summary', async () => {
    models.User.findById.mockImplementation(() => chain(user(1)));
    models.Team.findById.mockImplementation(() => chain({ _id: oid(50), name: 'Alpha', banned: false }));
    models.Challenge.find.mockImplementation((filter) => chain(filter?.type === 'terminal'
      ? [{ _id: oid(21), terminal: { mode: 'easy', code: 1 } }]
      : [{ _id: oid(11), slug: 'web-1', title: 'Web 1' }]));
    models.Solve.find.mockImplementation(() => chain([{ _id: oid(70), teamId: oid(50), userId: oid(1), challengeId: oid(21), points: 10, solvedAt: new Date('2026-11-02T10:00:00Z') }]));
    models.Solve.countDocuments.mockResolvedValue(1);
    models.Submission.find.mockImplementation(() => chain([{ _id: oid(80), teamId: oid(50), userId: oid(1), challengeId: oid(11), correct: false, createdAt: new Date('2026-11-02T11:00:00Z'), submittedHash: 'abc' }]));
    models.Submission.countDocuments.mockResolvedValue(1);
    models.TerminalActivity.aggregate.mockResolvedValue([{ commands: 12, lastCommandAt: new Date('2026-11-02T12:00:00Z') }]);
    models.CheatSignal.aggregate.mockResolvedValue([{ signals: 2, events: 7, maxSeverity: 3, lastAt: new Date('2026-11-02T12:30:00Z') }]);
    const { body } = await api('get', `/admin/users/${oid(1)}`).expect(200);
    expect(body).toMatchObject({
      id: oid(1), email: 'u1@example.com', team: { id: oid(50), name: 'Alpha', banned: false }, solveCount: 1, submissionCount: 1,
      terminal: { codesSolved: 1, points: 10, solvedByMode: { easy: 1 }, commandsLast48h: 12 },
      integrity: { signals: 2, events: 7, maxSeverity: 3 },
    });
    expect(body.recentSubmissions[0]).toMatchObject({ correct: false, challenge: { slug: 'web-1' } });
    noSecrets(body);
  });

  it('404s for an unknown or malformed user id', async () => {
    await api('get', `/admin/users/${oid(1)}`).expect(404);
    await api('get', '/admin/users/not-an-id').expect(404);
  });

  it('bans and unbans a player, with an audit entry carrying before/after and the reason', async () => {
    models.User.findById.mockImplementation(() => chain({ _id: oid(1), displayName: 'User 1', role: 'player', banned: false }));
    const { body } = await api('patch', `/admin/users/${oid(1)}/ban`, { body: { banned: true, reason: 'sharing flags' } }).expect(200);
    expect(body).toEqual({ id: oid(1), displayName: 'User 1', banned: true });
    expect(models.User.updateOne).toHaveBeenCalledWith({ _id: oid(1) }, { $set: { banned: true } });
    expect(lastAudit()).toMatchObject({
      action: 'user.ban', targetType: 'user', targetId: oid(1), actorId: ACTOR, actorEmail: 'admin@example.com',
      before: { banned: false }, after: { banned: true }, note: 'sharing flags',
    });
  });

  it('refuses to ban an administrator and validates the body', async () => {
    models.User.findById.mockImplementation(() => chain({ _id: oid(1), displayName: 'Boss', role: 'admin' }));
    const { body } = await api('patch', `/admin/users/${oid(1)}/ban`, { body: { banned: true } }).expect(409);
    expect(body.error.code).toBe('CANNOT_BAN_ADMIN');
    expect(models.User.updateOne).not.toHaveBeenCalled();
    for (const bad of [{}, { banned: 'yes' }, { banned: true, role: 'admin' }]) {
      await api('patch', `/admin/users/${oid(1)}/ban`, { body: bad }).expect(400);
    }
  });

  it('removes a user from their team and hands the captaincy over', async () => {
    models.User.findById.mockImplementation(() => chain({ _id: oid(1), displayName: 'User 1', teamId: oid(50) }));
    models.Team.findById.mockImplementation(() => chain({ _id: oid(50), name: 'Alpha', memberIds: [oid(1), oid(2)], captainId: oid(1) }));
    models.Team.findOneAndUpdate.mockImplementation(() => chain({ _id: oid(50), memberIds: [oid(2)], captainId: oid(1) }));
    const { body } = await api('post', `/admin/users/${oid(1)}/remove-from-team`, { body: {} }).expect(200);
    expect(body).toMatchObject({ teamId: oid(50), userId: oid(1), remaining: 1, captainId: oid(2) });
    expect(models.Team.findOneAndUpdate).toHaveBeenCalledWith({ _id: oid(50) }, { $pull: { memberIds: oid(1) } }, { new: true });
    expect(models.Team.updateOne).toHaveBeenCalledWith({ _id: oid(50), captainId: oid(1) }, { $set: { captainId: oid(2) } });
    expect(models.User.updateOne).toHaveBeenCalledWith({ _id: oid(1), teamId: oid(50) }, { $set: { teamId: null } });
    expect(lastAudit().action).toBe('user.remove-from-team');
  });

  it('409s when the user has no team', async () => {
    models.User.findById.mockImplementation(() => chain({ _id: oid(1), teamId: null }));
    expect((await api('post', `/admin/users/${oid(1)}/remove-from-team`, { body: {} }).expect(409)).body.error.code).toBe('NOT_A_MEMBER');
  });

  it('resets terminal progress only with confirm, fixing counters and the first-blood bonus', async () => {
    await api('post', `/admin/users/${oid(1)}/reset-terminal`, { body: {} }).expect(400);
    await api('post', `/admin/users/${oid(1)}/reset-terminal`, { body: { confirm: false } }).expect(400);
    expect(models.Solve.findOneAndDelete).not.toHaveBeenCalled();

    models.User.exists.mockResolvedValue({ _id: oid(1) });
    models.Challenge.find.mockImplementation(() => chain([{ _id: oid(21) }]));
    models.Solve.find.mockImplementation(() => chain([{ _id: oid(70) }]));
    models.Solve.findOneAndDelete.mockImplementation(() => chain({ _id: oid(70), teamId: oid(50), challengeId: oid(21), points: 11, firstBlood: true }));
    models.Challenge.findOneAndUpdate.mockImplementation(() => chain({ _id: oid(21), points: 10 }));
    models.Solve.findOne.mockImplementation(() => chain({ _id: oid(71), firstBlood: false }));
    models.TerminalActivity.deleteMany.mockResolvedValue({ deletedCount: 4 });
    const { body } = await api('post', `/admin/users/${oid(1)}/reset-terminal`, { body: { confirm: true } }).expect(200);
    expect(body).toEqual({ solvesRemoved: 1, activityRemoved: 4 });
    expect(models.Challenge.findOneAndUpdate).toHaveBeenCalledWith({ _id: oid(21), solveCount: { $gt: 0 } }, { $inc: { solveCount: -1 } }, { new: true });
    expect(models.Solve.updateOne).toHaveBeenCalledWith({ _id: oid(71), firstBlood: { $ne: true } }, { $set: { firstBlood: true }, $inc: { points: 1 } });
    expect(lastAudit()).toMatchObject({ action: 'user.reset-terminal', after: { solvesRemoved: 1, activityRemoved: 4 } });
  });
});

// ---- teams --------------------------------------------------------------------------------------------------------
describe('teams', () => {
  const team = (n, extra = {}) => ({ _id: oid(n), name: `Team ${n}`, memberIds: [oid(n * 10)], banned: false, captainId: oid(n * 10), createdAt: new Date('2026-11-01T09:00:00Z'), ...extra });

  it('keeps the legacy array without query parameters and pages with them (score sortable)', async () => {
    models.Team.find.mockImplementation(() => chain([team(1), team(2), team(3, { banned: true })]));
    models.Solve.aggregate.mockResolvedValue([
      { _id: oid(1), score: 100, solves: 1, lastSolveAt: new Date('2026-11-02T10:00:00Z') },
      { _id: oid(2), score: 300, solves: 2, lastSolveAt: new Date('2026-11-02T11:00:00Z') },
    ]);
    const legacy = await api('get', '/admin/teams').expect(200);
    expect(Array.isArray(legacy.body)).toBe(true);
    const { body } = await api('get', '/admin/teams?page=1&limit=2').expect(200);
    expect(body).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(body.items.map((item) => item.name)).toEqual(['Team 2', 'Team 1']);
    expect(body.items[0]).toMatchObject({ id: oid(2), members: 1, score: 300, solves: 2, banned: false });
    const asc = await api('get', '/admin/teams?sort=name&banned=true').expect(200);
    expect(models.Team.find.mock.calls.at(-1)[0]).toEqual({ banned: true });
    expect(asc.body.items).toHaveLength(3);
    noSecrets(body);
    expect(JSON.stringify(body)).not.toContain('inviteCode');
  });

  it('returns the detail with members, score and a solve/adjustment timeline', async () => {
    models.Team.findById.mockImplementation(() => chain(team(1)));
    models.User.find.mockImplementation(() => chain([{ _id: oid(10), displayName: 'Cap', email: 'cap@example.com', banned: false }]));
    models.Solve.find.mockImplementation(() => chain([
      { _id: oid(70), teamId: oid(1), userId: oid(10), challengeId: oid(11), points: 110, firstBlood: true, solvedAt: new Date('2026-11-02T10:00:00Z') },
      { _id: oid(71), teamId: oid(1), userId: oid(900), challengeId: oid(99), points: -20, adjustment: true, reason: 'cheated hint', solvedAt: new Date('2026-11-02T11:00:00Z') },
    ]));
    models.Solve.aggregate.mockResolvedValue([{ _id: oid(1), score: 90, solves: 1 }]);
    models.Instance.countDocuments.mockResolvedValue(1);
    models.Challenge.find.mockImplementation(() => chain([{ _id: oid(11), slug: 'web-1', title: 'Web 1' }]));
    const { body } = await api('get', `/admin/teams/${oid(1)}`).expect(200);
    expect(body).toMatchObject({ id: oid(1), score: 90, solves: 1, adjustmentsTotal: -20, activeInstances: 1 });
    expect(body.members).toEqual([{ id: oid(10), displayName: 'Cap', email: 'cap@example.com', banned: false, isCaptain: true }]);
    expect(body.timeline[0]).toMatchObject({ firstBlood: true, challenge: { slug: 'web-1' } });
    expect(body.timeline[1]).toMatchObject({ adjustment: true, reason: 'cheated hint', challenge: null });
    expect(JSON.stringify(body)).not.toContain('inviteCode');
  });

  it('writes an audit entry when banning (legacy route)', async () => {
    models.Team.findOneAndUpdate.mockResolvedValue({ _id: oid(1), name: 'Team 1', banned: true });
    await api('patch', `/admin/teams/${oid(1)}/ban`, { body: { banned: true } }).expect(200);
    expect(lastAudit()).toMatchObject({ action: 'team.ban', targetType: 'team', targetId: oid(1) });
  });

  it('renames, rejecting bad names and duplicates', async () => {
    models.Team.findOneAndUpdate.mockImplementation(() => chain({ _id: oid(1), name: 'Old' }));
    const { body } = await api('patch', `/admin/teams/${oid(1)}`, { body: { name: '  New Name ' } }).expect(200);
    expect(body).toEqual({ id: oid(1), name: 'New Name' });
    expect(lastAudit()).toMatchObject({ action: 'team.rename', before: { name: 'Old' }, after: { name: 'New Name' } });
    for (const bad of [{ name: 'ab' }, { name: 'x'.repeat(25) }, {}, { name: 'okay', captainId: oid(1) }]) {
      await api('patch', `/admin/teams/${oid(1)}`, { body: bad }).expect(400);
    }
    models.Team.findOneAndUpdate.mockImplementation(() => { throw Object.assign(new Error('dup'), { code: 11000 }); });
    expect((await api('patch', `/admin/teams/${oid(1)}`, { body: { name: 'Taken' } }).expect(409)).body.error.code).toBe('CONFLICT');
  });

  it('deletes only empty teams and only with confirm=true', async () => {
    models.Team.findById.mockImplementation(() => chain(team(1, { memberIds: [oid(10)] })));
    await api('delete', `/admin/teams/${oid(1)}`).expect(400);
    await api('delete', `/admin/teams/${oid(1)}?confirm=false`).expect(400);
    expect((await api('delete', `/admin/teams/${oid(1)}?confirm=true`).expect(409)).body.error.code).toBe('TEAM_NOT_EMPTY');
    expect(models.Team.findOneAndDelete).not.toHaveBeenCalled();

    models.Team.findById.mockImplementation(() => chain(team(1, { memberIds: [] })));
    models.Solve.find.mockImplementation(() => chain([{ _id: oid(70) }]));
    models.Solve.findOneAndDelete.mockImplementation(() => chain({ _id: oid(70), teamId: oid(1), challengeId: oid(11), points: 100, firstBlood: false }));
    models.Challenge.findOneAndUpdate.mockImplementation(() => chain({ points: 100 }));
    models.Team.findOneAndDelete.mockImplementation(() => chain({ _id: oid(1) }));
    await api('delete', `/admin/teams/${oid(1)}?confirm=true`).expect(204);
    expect(instanceMock.stopTeamInstances).toHaveBeenCalledWith(oid(1));
    expect(models.Challenge.findOneAndUpdate).toHaveBeenCalledWith({ _id: oid(11), solveCount: { $gt: 0 } }, { $inc: { solveCount: -1 } }, { new: true });
    expect(lastAudit()).toMatchObject({ action: 'team.delete', before: { name: 'Team 1', solvesRemoved: 1 } });
  });

  it('removes a member and 409s for a non-member', async () => {
    models.Team.findById.mockImplementation(() => chain(team(1, { memberIds: [oid(10), oid(11)] })));
    models.User.findById.mockImplementation(() => chain({ _id: oid(11), displayName: 'Mate', teamId: oid(1) }));
    models.Team.findOneAndUpdate.mockImplementation(() => chain({ _id: oid(1), memberIds: [oid(10)], captainId: oid(10) }));
    const { body } = await api('delete', `/admin/teams/${oid(1)}/members/${oid(11)}`).expect(200);
    expect(body).toMatchObject({ teamId: oid(1), userId: oid(11), remaining: 1 });
    expect(models.Team.updateOne).not.toHaveBeenCalled();
    models.User.findById.mockImplementation(() => chain({ _id: oid(12), displayName: 'Stranger', teamId: null }));
    expect((await api('delete', `/admin/teams/${oid(1)}/members/${oid(12)}`).expect(409)).body.error.code).toBe('NOT_A_MEMBER');
  });

  it('regenerates the invite code (retrying on collision) and audits without the code', async () => {
    models.Team.findOneAndUpdate
      .mockImplementationOnce(() => { throw Object.assign(new Error('dup'), { code: 11000 }); })
      .mockImplementation(() => chain({ _id: oid(1), name: 'Team 1' }));
    const { body } = await api('post', `/admin/teams/${oid(1)}/invite-code/regenerate`, { body: {} }).expect(200);
    expect(body.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(models.Team.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(lastAudit())).not.toContain(body.inviteCode);
  });

  it('adds a signed score adjustment as a Solve-like row the leaderboard counts', async () => {
    models.Team.findById.mockImplementation(() => chain({ _id: oid(1), name: 'Team 1' }));
    models.Solve.create.mockResolvedValue({ _id: oid(77) });
    models.Solve.aggregate.mockResolvedValue([{ _id: null, score: 40 }]);
    const { body } = await api('post', `/admin/teams/${oid(1)}/score-adjustments`, { body: { points: -50, reason: 'used a shared flag' } }).expect(201);
    expect(body).toEqual({ id: oid(77), teamId: oid(1), points: -50, reason: 'used a shared flag', teamScore: 40 });
    expect(models.Solve.create).toHaveBeenCalledWith(expect.objectContaining({
      teamId: oid(1), userId: ACTOR, points: -50, adjustment: true, firstBlood: false, reason: 'used a shared flag',
    }));
    const [{ challengeId }] = models.Solve.create.mock.calls[0];
    expect(String(challengeId)).toMatch(/^[a-f\d]{24}$/);
    expect(lastAudit()).toMatchObject({ action: 'team.score-adjust', note: 'used a shared flag', after: { points: -50, teamScore: 40 } });
  });

  it.each([{ points: 0, reason: 'zero' }, { points: 1.5, reason: 'float' }, { points: 10001, reason: 'too big' }, { points: 5, reason: 'x' }, { points: 5 }, { reason: 'no points' }, { points: 5, reason: 'okay', extra: 1 }])('rejects the adjustment %j', async (bad) => {
    await api('post', `/admin/teams/${oid(1)}/score-adjustments`, { body: bad }).expect(400);
    expect(models.Solve.create).not.toHaveBeenCalled();
  });

  it('409s when the admin has no user row yet, and 404s for an unknown team', async () => {
    models.User.findOne.mockImplementation(() => chain(null));
    expect((await api('post', `/admin/teams/${oid(1)}/score-adjustments`, { body: { points: 5, reason: 'bonus' } }).expect(409)).body.error.code).toBe('ACTOR_NOT_FOUND');
    models.User.findOne.mockImplementation(() => chain({ _id: ACTOR }));
    await api('post', `/admin/teams/${oid(1)}/score-adjustments`, { body: { points: 5, reason: 'bonus' } }).expect(404);
  });
});

// ---- challenges ---------------------------------------------------------------------------------------------------
describe('challenges', () => {
  const stored = (n, extra = {}) => ({
    _id: oid(n), slug: `chal-${n}`, title: `Chal ${n}`, category: 'web', difficulty: 'easy', points: 100, description: 'd', type: 'static',
    flagHash: 'HASH', flagSalt: 'SALT', attachments: [{ name: 'a', url: '/a', _id: 'x' }], visible: true, solveCount: 2, createdAt: new Date('2026-11-01T00:00:00Z'), ...extra,
  });
  const docker = { slug: 'dock', title: 'Dock', category: 'web', difficulty: 'easy', points: 50, type: 'docker', image: 'ctf/dock', internalPort: 80 };

  it('lists legacy without parameters and paginates with filters', async () => {
    models.Challenge.find.mockImplementation(() => chain([stored(1)]));
    models.Challenge.countDocuments.mockResolvedValue(9);
    expect(Array.isArray((await api('get', '/admin/challenges').expect(200)).body)).toBe(true);
    const { body } = await api('get', '/admin/challenges?visible=false&category=web&q=chal&sort=-points&limit=5').expect(200);
    expect(body).toMatchObject({ page: 1, limit: 5, total: 9 });
    expect(body.items[0]).toMatchObject({ id: oid(1), hasFlag: true });
    expect(models.Challenge.find.mock.calls.at(-1)[0]).toMatchObject({ visible: false, category: 'web' });
    noSecrets(body);
  });

  it('exports definitions without flags, hashes or salts (and without terminal challenges)', async () => {
    models.Challenge.find.mockImplementation(() => chain([stored(1), stored(2, { type: 'docker', image: 'ctf/x', internalPort: 80, flagHash: undefined })]));
    const res = await api('get', '/admin/challenges/export').expect(200);
    expect(res.headers['content-disposition']).toContain('challenges.json');
    expect(models.Challenge.find.mock.calls.at(-1)[0]).toEqual({ type: { $ne: 'terminal' } });
    expect(res.body).toMatchObject({ version: 1 });
    expect(res.body.challenges[0]).toEqual({
      slug: 'chal-1', title: 'Chal 1', category: 'web', difficulty: 'easy', points: 100, description: 'd', type: 'static',
      attachments: [{ name: 'a', url: '/a' }], visible: true,
    });
    const text = JSON.stringify(res.body);
    for (const word of ['HASH', 'SALT', 'flag']) { expect(text).not.toContain(word); }
  });

  it('imports: dry run reports, real run creates; static without flag is hidden and listed in needsFlag; bad items are isolated', async () => {
    const items = [docker, { ...docker, slug: 'plain', type: 'static', image: undefined, internalPort: undefined }, { slug: 'Bad Slug' }, { ...docker, slug: 'term', type: 'terminal', category: 'terminal' }];
    const dry = await api('post', '/admin/challenges/import', { body: { challenges: items, dryRun: true } }).expect(200);
    expect(dry.body).toMatchObject({ dryRun: true, created: ['dock', 'plain'], needsFlag: ['plain'], skipped: [], updated: [] });
    expect(dry.body.errors.map((error) => error.index)).toEqual([2, 3]);
    expect(models.Challenge.create).not.toHaveBeenCalled();
    expect(auditEntries()).toHaveLength(0);

    const real = await api('post', '/admin/challenges/import', { body: { challenges: items } }).expect(200);
    expect(real.body.created).toEqual(['dock', 'plain']);
    expect(models.Challenge.create.mock.calls[1][0]).toMatchObject({ slug: 'plain', visible: false });
    expect(models.Challenge.create.mock.calls[1][0].flagHash).toBeUndefined();
    expect(lastAudit()).toMatchObject({ action: 'challenge.import', after: { created: 2, errors: 2 } });
  });

  it('import skips existing slugs by default and updates metadata (keeping the flag hash) in update mode', async () => {
    models.Challenge.findOne.mockImplementation(() => chain({ _id: oid(5), type: 'static', flagHash: 'HASH' }));
    const skip = await api('post', '/admin/challenges/import', { body: { challenges: [docker] } }).expect(200);
    expect(skip.body.skipped).toEqual(['dock']);
    const staticItem = { ...docker, type: 'static', image: undefined, internalPort: undefined };
    const update = await api('post', '/admin/challenges/import', { body: { challenges: [staticItem], mode: 'update' } }).expect(200);
    expect(update.body).toMatchObject({ updated: ['dock'], needsFlag: [] });
    const [, change] = models.Challenge.findOneAndUpdate.mock.calls[0];
    expect(change.$set.flagHash).toBeUndefined();
    expect(change.$unset).not.toHaveProperty('flagHash');
  });

  it.each([{}, { challenges: [] }, { challenges: [{}], mode: 'wipe' }, { challenges: [{}], extra: 1 }])('rejects the import body %j', async (bad) => {
    await api('post', '/admin/challenges/import', { body: bad }).expect(400);
  });

  it('toggles visibility with an audit entry', async () => {
    models.Challenge.findOneAndUpdate.mockImplementation(() => chain({ _id: oid(1), slug: 'chal-1', visible: true }));
    const { body } = await api('patch', `/admin/challenges/${oid(1)}/visibility`, { body: { visible: false } }).expect(200);
    expect(body).toEqual({ id: oid(1), slug: 'chal-1', visible: false });
    expect(lastAudit()).toMatchObject({ action: 'challenge.hide', before: { visible: true }, after: { visible: false } });
    await api('patch', `/admin/challenges/${oid(1)}/visibility`, { body: { visible: 'no' } }).expect(400);
    models.Challenge.findOneAndUpdate.mockImplementation(() => chain(null));
    await api('patch', `/admin/challenges/${oid(2)}/visibility`, { body: { visible: true } }).expect(404);
  });

  it('duplicates as a hidden copy, copying flag material inside the database only', async () => {
    models.Challenge.findById.mockImplementation(() => chain(stored(1)));
    models.Challenge.create.mockImplementation(async (doc) => ({ _id: oid(2), createdAt: new Date(), solveCount: 0, ...doc }));
    const { body } = await api('post', `/admin/challenges/${oid(1)}/duplicate`, { body: {} }).expect(201);
    expect(body).toMatchObject({ id: oid(2), slug: 'chal-1-copy', title: 'Chal 1 (copy)', visible: false, hasFlag: true, solveCount: 0 });
    expect(models.Challenge.create.mock.calls[0][0]).toMatchObject({ flagHash: 'HASH', flagSalt: 'SALT', visible: false });
    noSecrets(body);
    expect(lastAudit().action).toBe('challenge.duplicate');
    models.Challenge.create.mockImplementation(() => { throw Object.assign(new Error('dup'), { code: 11000 }); });
    await api('post', `/admin/challenges/${oid(1)}/duplicate`, { body: { slug: 'taken' } }).expect(409);
    await api('post', `/admin/challenges/${oid(1)}/duplicate`, { body: { slug: 'Bad Slug' } }).expect(400);
    models.Challenge.findById.mockImplementation(() => chain(stored(1, { type: 'terminal' })));
    await api('post', `/admin/challenges/${oid(1)}/duplicate`, { body: {} }).expect(400);
  });

  it('returns per-challenge submission stats', async () => {
    models.Challenge.findById.mockImplementation(() => chain({ _id: oid(1), slug: 'chal-1', title: 'Chal 1', points: 100, type: 'static' }));
    models.Submission.aggregate.mockResolvedValue([{ _id: null, submissions: 10, wrong: 7, teams: [oid(1), oid(2), oid(3)] }]);
    models.Solve.countDocuments.mockResolvedValue(2);
    models.Team.countDocuments.mockResolvedValue(8);
    models.Solve.findOne.mockImplementation(() => chain({ teamId: oid(1), solvedAt: new Date('2026-11-02T10:00:00Z') }));
    models.Team.findById.mockImplementation(() => chain({ _id: oid(1), name: 'Alpha' }));
    const { body } = await api('get', `/admin/challenges/${oid(1)}/stats`).expect(200);
    expect(body).toEqual({
      id: oid(1), slug: 'chal-1', title: 'Chal 1', type: 'static', solves: 2, solveRate: 0.25, submissions: 10, wrongSubmissions: 7,
      correctSubmissions: 3, wrongRate: 0.7, teamsAttempted: 3, firstBlood: { teamId: oid(1), teamName: 'Alpha', at: '2026-11-02T10:00:00.000Z' },
    });
    models.Challenge.findById.mockImplementation(() => chain(null));
    await api('get', `/admin/challenges/${oid(2)}/stats`).expect(404);
  });

  it('resets solves only with confirm and audits the counts', async () => {
    await api('post', `/admin/challenges/${oid(1)}/reset-solves`, { body: {} }).expect(400);
    expect(models.Solve.deleteMany).not.toHaveBeenCalled();
    models.Challenge.findById.mockImplementation(() => chain({ _id: oid(1), slug: 'chal-1', solveCount: 3 }));
    models.Solve.deleteMany.mockResolvedValue({ deletedCount: 3 });
    models.Submission.deleteMany.mockResolvedValue({ deletedCount: 12 });
    const { body } = await api('post', `/admin/challenges/${oid(1)}/reset-solves`, { body: { confirm: true, clearSubmissions: true } }).expect(200);
    expect(body).toEqual({ solvesRemoved: 3, submissionsRemoved: 12 });
    expect(models.Solve.deleteMany).toHaveBeenCalledWith({ challengeId: oid(1), adjustment: { $ne: true } });
    expect(models.Challenge.updateOne).toHaveBeenCalledWith({ _id: oid(1) }, { $set: { solveCount: 0 } });
    expect(lastAudit()).toMatchObject({ action: 'challenge.reset-solves', before: { solveCount: 3 } });
  });

  it('audits create, update (never the flag) and delete', async () => {
    models.Challenge.create.mockImplementation(async (doc) => ({ _id: oid(3), ...doc }));
    await api('post', '/admin/challenges', { body: { ...docker } }).expect(201);
    expect(lastAudit()).toMatchObject({ action: 'challenge.create', targetId: oid(3) });
    models.Challenge.findById.mockImplementation(() => chain(stored(1)));
    models.Challenge.findOneAndUpdate.mockImplementation(() => chain(stored(1, { title: 'New' })));
    await api('put', `/admin/challenges/${oid(1)}`, { body: { slug: 'chal-1', title: 'New', category: 'web', difficulty: 'easy', points: 100, type: 'static', flag: 'CTF{secret_value}' } }).expect(200);
    expect(lastAudit()).toMatchObject({ action: 'challenge.update', note: 'flag replaced' });
    expect(JSON.stringify(auditEntries())).not.toContain('CTF{secret_value}');
    noSecrets(auditEntries());
    await api('delete', `/admin/challenges/${oid(1)}`).expect(204);
    expect(lastAudit().action).toBe('challenge.delete');
  });
});

// ---- solves and submissions ---------------------------------------------------------------------------------------
describe('solves and submissions', () => {
  it('lists solves with filters, team/user/challenge names and adjustment rows', async () => {
    models.Solve.find.mockImplementation(() => chain([
      { _id: oid(70), teamId: oid(1), userId: oid(2), challengeId: oid(3), points: 110, firstBlood: true, solvedAt: new Date('2026-11-02T10:00:00Z') },
      { _id: oid(71), teamId: oid(1), userId: oid(900), challengeId: oid(99), points: -5, adjustment: true, reason: 'penalty', solvedAt: new Date('2026-11-02T11:00:00Z') },
    ]));
    models.Solve.countDocuments.mockResolvedValue(2);
    models.Team.find.mockImplementation(() => chain([{ _id: oid(1), name: 'Alpha' }]));
    models.User.find.mockImplementation(() => chain([{ _id: oid(2), displayName: 'Bob' }]));
    models.Challenge.find.mockImplementation(() => chain([{ _id: oid(3), slug: 'web-1', title: 'Web 1' }]));
    const from = '2026-11-01T00:00:00.000Z';
    const { body } = await api('get', `/admin/solves?teamId=${oid(1)}&challengeId=${oid(3)}&adjustments=exclude&from=${from}&sort=points`).expect(200);
    expect(body.total).toBe(2);
    expect(body.items[0]).toEqual({
      id: oid(70), solvedAt: '2026-11-02T10:00:00.000Z', points: 110, firstBlood: true, adjustment: false, reason: null,
      team: { id: oid(1), name: 'Alpha' }, user: { id: oid(2), displayName: 'Bob' }, challenge: { id: oid(3), slug: 'web-1', title: 'Web 1' },
    });
    expect(body.items[1]).toMatchObject({ adjustment: true, reason: 'penalty', challenge: null });
    expect(models.Solve.find.mock.calls[0][0]).toEqual({ solvedAt: { $gte: new Date(from) }, teamId: oid(1), challengeId: oid(3), adjustment: { $ne: true } });
    for (const bad of ['teamId=zzz', 'adjustments=all', 'from=not-a-date', 'sort=teamId']) { await api('get', `/admin/solves?${bad}`).expect(400); }
  });

  it('deletes a bogus solve atomically, fixes counters, returns the new score and audits', async () => {
    models.Solve.findOneAndDelete.mockImplementation(() => chain({ _id: oid(70), teamId: oid(1), challengeId: oid(3), points: 110, firstBlood: true, solvedAt: new Date('2026-11-02T10:00:00Z') }));
    models.Challenge.findOneAndUpdate.mockImplementation(() => chain({ _id: oid(3), points: 100 }));
    models.Solve.findOne.mockImplementation(() => chain(null));
    models.Solve.aggregate.mockResolvedValue([{ _id: null, score: 90 }]);
    const { body } = await api('delete', `/admin/solves/${oid(70)}?reason=bogus%20solve`).expect(200);
    expect(body).toEqual({ id: oid(70), teamId: oid(1), pointsRemoved: 110, teamScore: 90 });
    expect(models.Solve.findOneAndDelete).toHaveBeenCalledWith({ _id: oid(70) });
    expect(models.Solve.updateOne).not.toHaveBeenCalled(); // nobody left to inherit first blood
    expect(lastAudit()).toMatchObject({ action: 'solve.delete', note: 'bogus solve', before: { points: 110, firstBlood: true }, after: { teamScore: 90 } });
  });

  it('deletes a manual adjustment without touching challenge counters', async () => {
    models.Solve.findOneAndDelete.mockImplementation(() => chain({ _id: oid(71), teamId: oid(1), challengeId: oid(99), points: -5, adjustment: true }));
    models.Solve.aggregate.mockResolvedValue([]);
    const { body } = await api('delete', `/admin/solves/${oid(71)}`).expect(200);
    expect(body).toMatchObject({ pointsRemoved: -5, teamScore: 0 });
    expect(models.Challenge.findOneAndUpdate).not.toHaveBeenCalled();
    expect(lastAudit().action).toBe('solve.delete-adjustment');
  });

  it('404s for an unknown solve and validates the reason', async () => {
    await api('delete', `/admin/solves/${oid(70)}`).expect(404);
    await api('delete', `/admin/solves/${oid(70)}?reason=${'x'.repeat(201)}`).expect(400);
    await api('delete', `/admin/solves/${oid(70)}?other=1`).expect(400);
    expect(auditEntries()).toHaveLength(0);
  });

  it('lists submissions (wrong attempts) without the submitted text or its hash', async () => {
    models.Submission.find.mockImplementation(() => chain([{ _id: oid(80), teamId: oid(1), userId: oid(2), challengeId: oid(3), correct: false, createdAt: new Date('2026-11-02T11:00:00Z'), submittedHash: 'deadbeef' }]));
    models.Submission.countDocuments.mockResolvedValue(1);
    models.Team.find.mockImplementation(() => chain([{ _id: oid(1), name: 'Alpha' }]));
    const { body } = await api('get', `/admin/submissions?result=wrong&userId=${oid(2)}&to=2026-12-01T00:00:00Z`).expect(200);
    expect(body.items).toEqual([{
      id: oid(80), createdAt: '2026-11-02T11:00:00.000Z', correct: false, team: { id: oid(1), name: 'Alpha' },
      user: { id: oid(2), displayName: null }, challenge: { id: oid(3), slug: null, title: null },
    }]);
    expect(models.Submission.find.mock.calls[0][0]).toMatchObject({ correct: false, userId: oid(2), createdAt: { $lte: new Date('2026-12-01T00:00:00Z') } });
    noSecrets(body);
    await api('get', '/admin/submissions?result=maybe').expect(400);
  });
});

// ---- integrity ----------------------------------------------------------------------------------------------------
describe('integrity', () => {
  const at = (minute) => new Date(Date.UTC(2026, 10, 4, 12, minute));
  const rows = [
    { subjectKey: oid(1), userId: oid(1), kind: 'tainted-flag', detail: 'from:self', count: 1, severity: 3, firstAt: at(1), lastAt: at(5) },
    { subjectKey: oid(2), userId: oid(2), kind: 'automation-ua', detail: 'curl', count: 40, severity: 1, firstAt: at(0), lastAt: at(30) },
  ];
  const arrange = () => {
    models.CheatSignal.find.mockImplementation(() => chain(rows));
    models.User.find.mockImplementation(() => chain([{ _id: oid(1), displayName: 'Alice', teamId: null }, { _id: oid(2), displayName: 'Bob', teamId: null }]));
  };

  it('keeps the legacy list and adds a filtered, paginated review list', async () => {
    arrange();
    expect(Array.isArray((await api('get', '/admin/integrity').expect(200)).body)).toBe(true);
    const all = await api('get', '/admin/integrity/users').expect(200);
    expect(all.body).toMatchObject({ page: 1, limit: 25, total: 2 });
    expect(all.body.items.map((item) => item.displayName)).toEqual(['Bob', 'Alice']); // risk 5 (1 * min(40, 5)) vs 3
    expect(all.body.items[0].lastSignalAt).toBe(at(30).toISOString());
    const byKind = await api('get', '/admin/integrity/users?kind=tainted-flag').expect(200);
    expect(byKind.body.items.map((item) => item.displayName)).toEqual(['Alice']);
    const minRisk = await api('get', '/admin/integrity/users?minRisk=4').expect(200);
    expect(minRisk.body.items.map((item) => item.displayName)).toEqual(['Bob']);
    expect((await api('get', '/admin/integrity/users?q=ali').expect(200)).body.items).toHaveLength(1);
    const oldest = await api('get', '/admin/integrity/users?sort=lastSignalAt').expect(200);
    expect(oldest.body.items[0].displayName).toBe('Alice');
    await api('get', '/admin/integrity/users?kind=nope').expect(400);
    noSecrets(all.body);
  });

  it('summarises counts per kind', async () => {
    models.CheatSignal.aggregate.mockImplementation(async (pipeline) => (pipeline[0].$group
      ? [{ _id: 'tainted-flag', rows: 2, events: 5, lastAt: at(5) }, { _id: 'automation-ua', rows: 1, events: 40, lastAt: at(30) }]
      : [{ users: 2 }]));
    models.CheatSignal.countDocuments.mockResolvedValue(3);
    const { body } = await api('get', '/admin/integrity/summary').expect(200);
    expect(body).toMatchObject({ flaggedUsers: 2, signalRows: 3, signalEvents: 45, activeLast24h: 3, highRiskThreshold: 10 });
    expect(body.byKind).toHaveLength(6);
    expect(body.byKind.find((entry) => entry.kind === 'tainted-flag')).toMatchObject({ rows: 2, events: 5 });
    expect(body.byKind.find((entry) => entry.kind === 'terminal-canary')).toMatchObject({ rows: 0, events: 0, lastAt: null });
  });

  it('resolves with a required note: signals are deleted and the note is audited', async () => {
    await api('post', `/admin/integrity/${oid(1)}/resolve`, { body: {} }).expect(400);
    await api('post', `/admin/integrity/${oid(1)}/resolve`, { body: { note: 'ok' } }).expect(400);
    await api('post', `/admin/integrity/${oid(1)}/resolve`, { body: { note: 'no signals here' } }).expect(404);
    models.CheatSignal.find.mockImplementation(() => chain([{ kind: 'tainted-flag', severity: 3, count: 2 }, { kind: 'automation-ua', severity: 1, count: 5 }]));
    const { body } = await api('post', `/admin/integrity/${oid(1)}/resolve`, { body: { note: 'talked to the player, false positive' } }).expect(200);
    expect(body).toEqual({ userId: oid(1), resolved: { signals: 2, events: 7, kinds: { 'tainted-flag': 2, 'automation-ua': 5 } } });
    expect(models.CheatSignal.deleteMany).toHaveBeenCalledWith({ subjectKey: oid(1) });
    expect(lastAudit()).toMatchObject({ action: 'integrity.resolve', targetId: oid(1), note: 'talked to the player, false positive' });
  });

  it('audits the legacy dismiss too', async () => {
    await api('delete', `/admin/integrity/${oid(1)}`).expect(204);
    expect(lastAudit().action).toBe('integrity.dismiss');
  });
});

// ---- instances ----------------------------------------------------------------------------------------------------
describe('instances', () => {
  const instance = { _id: oid(60), teamId: oid(1), challengeId: oid(3), port: 30001, status: 'running', expiresAt: new Date('2026-11-04T12:00:00Z'), extended: false };

  it('pages with filters and reports dockerEnabled', async () => {
    models.Instance.find.mockImplementation(() => chain([instance]));
    models.Instance.countDocuments.mockResolvedValue(1);
    models.Team.find.mockImplementation(() => chain([{ _id: oid(1), name: 'Alpha' }]));
    models.Challenge.find.mockImplementation(() => chain([{ _id: oid(3), slug: 'web-1', title: 'Web 1' }]));
    const { body } = await api('get', `/admin/instances?status=all&teamId=${oid(1)}`).expect(200);
    expect(body).toMatchObject({ page: 1, total: 1, dockerEnabled: true });
    expect(body.items[0]).toMatchObject({ id: oid(60), team: { name: 'Alpha' }, challenge: { slug: 'web-1' }, url: `http://arena.test:30001` });
    expect(models.Instance.find.mock.calls[0][0]).toEqual({ teamId: oid(1) });
    noSecrets(body);
    await api('get', '/admin/instances?status=weird').expect(400);
  });

  it('kills through Docker when enabled and audits', async () => {
    instanceMock.stop.mockResolvedValue({ _id: oid(60) });
    await api('post', `/admin/instances/${oid(60)}/kill`).expect(204);
    expect(instanceMock.stop).toHaveBeenCalledWith(oid(60), { force: true });
    expect(lastAudit()).toMatchObject({ action: 'instance.kill', targetId: oid(60) });
  });

  it('only closes the record when Docker is disabled', async () => {
    process.env.DOCKER_ENABLED = 'false';
    models.Instance.findOneAndUpdate.mockResolvedValue({ _id: oid(60) });
    await api('post', `/admin/instances/${oid(60)}/kill`).expect(204);
    expect(instanceMock.stop).not.toHaveBeenCalled();
    expect(models.Instance.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('stopped');
    models.Instance.findOneAndUpdate.mockResolvedValue(null);
    await api('post', `/admin/instances/${oid(61)}/kill`).expect(404);
  });
});

// ---- settings, audit, exports -------------------------------------------------------------------------------------
describe('settings', () => {
  it('reads defaults and applies a partial update with an audit entry', async () => {
    const defaults = await api('get', '/admin/settings').expect(200);
    expect(defaults.body).toEqual({ registrationOpen: true, submissionsFrozen: false, announcement: { text: '', level: 'info' }, updatedAt: null });
    models.AppSetting.findOneAndUpdate.mockImplementation(() => chain({ registrationOpen: true, submissionsFrozen: true, announcement: { text: 'Break', level: 'warning' }, updatedAt: new Date('2026-11-04T12:00:00Z') }));
    const { body } = await api('put', '/admin/settings', { body: { submissionsFrozen: true, announcement: { text: ' Break ', level: 'warning' } } }).expect(200);
    expect(body).toMatchObject({ submissionsFrozen: true, announcement: { text: 'Break', level: 'warning' } });
    const [filter, update] = models.AppSetting.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ key: 'platform' });
    expect(update.$set).toEqual({ updatedBy: 'admin@example.com', submissionsFrozen: true, announcement: { text: 'Break', level: 'warning' } });
    expect(lastAudit()).toMatchObject({ action: 'settings.update', targetId: 'platform', after: { submissionsFrozen: true } });
  });

  it.each([{}, { submissionsFrozen: 'yes' }, { announcement: { text: 'x'.repeat(501) } }, { announcement: { text: 'a', level: 'huge' } }, { other: true }])('rejects %j', async (bad) => {
    await api('put', '/admin/settings', { body: bad }).expect(400);
    expect(models.AppSetting.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('freezes the submit routes server-side with 423', async () => {
    models.AppSetting.findOne.mockImplementation(() => chain({ submissionsFrozen: true }));
    for (const path of [`/challenges/${oid(3)}/submit`, '/terminal/easy/submit']) {
      const { body } = await api('post', path, { as: 'alice', body: { flag: 'CTF{x}' } }).expect(423);
      expect(body.error.code).toBe('SUBMISSIONS_FROZEN');
    }
    expect(models.Submission.create).not.toHaveBeenCalled();
  });
});

describe('audit log', () => {
  it('lists newest first with filters and the paging envelope', async () => {
    models.AuditLog.find.mockImplementation(() => chain([{
      _id: oid(5), createdAt: new Date('2026-11-04T12:00:00Z'), actorId: oid(900), actorEmail: 'admin@example.com', action: 'team.ban',
      targetType: 'team', targetId: oid(1), before: null, after: { banned: true }, note: '', ip: '10.0.0.1',
    }]));
    models.AuditLog.countDocuments.mockResolvedValue(1);
    const { body } = await api('get', `/admin/audit?action=team.ban&actorId=${oid(900)}&targetType=team&from=2026-11-01T00:00:00Z&q=admin`).expect(200);
    expect(body).toEqual({
      page: 1, limit: 25, total: 1,
      items: [{
        id: oid(5), createdAt: '2026-11-04T12:00:00.000Z', actor: { id: oid(900), email: 'admin@example.com' }, action: 'team.ban',
        targetType: 'team', targetId: oid(1), before: null, after: { banned: true }, note: '', ip: '10.0.0.1',
      }],
    });
    const [filter] = models.AuditLog.find.mock.calls[0];
    expect(filter).toMatchObject({ action: 'team.ban', actorId: oid(900), targetType: 'team', createdAt: { $gte: new Date('2026-11-01T00:00:00Z') } });
    await api('get', '/admin/audit?actorId=x').expect(400);
    await api('get', '/admin/audit?sort=ip').expect(400);
  });

  it('never stores secret-looking keys or long strings in summaries', async () => {
    models.Team.findOneAndUpdate.mockImplementation(() => chain({ _id: oid(1), name: 'Team 1' }));
    await api('post', `/admin/teams/${oid(1)}/score-adjustments`, { body: { points: 5, reason: 'r'.repeat(10) } }).expect(404);
    const { summarize } = await import('../../src/services/adminAudit.js');
    const out = summarize({ ok: 1, flagHash: 'x', inviteCode: 'ABCDEF', nested: { token: 't', name: 'n'.repeat(500) }, list: [1, 2] });
    expect(out.flagHash).toBeUndefined();
    expect(out.inviteCode).toBeUndefined();
    expect(out.nested.token).toBeUndefined();
    expect(out.nested.name).toHaveLength(200);
    expect(out.list).toEqual([1, 2]);
  });
});

describe('csv exports', () => {
  it('exports users with formula-injection-safe cells and an audit entry', async () => {
    models.User.find.mockImplementation(() => chain([
      { _id: oid(1), displayName: '=HYPERLINK("http://evil","x")', email: '+cmd@example.com', role: 'player', banned: false, teamId: oid(50), createdAt: new Date('2026-11-01T10:00:00Z') },
      { _id: oid(2), displayName: 'Comma, "Quote"', email: 'b@example.com', role: 'player', banned: true, teamId: null, createdAt: new Date('2026-11-01T10:00:00Z') },
    ]));
    models.Team.find.mockImplementation(() => chain([{ _id: oid(50), name: '@team' }]));
    const res = await api('get', '/admin/export/users.csv?banned=false&limit=5').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('users.csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('id,displayName,email,role,banned,teamId,teamName,createdAt');
    expect(lines[1]).toBe(`${oid(1)},"'=HYPERLINK(""http://evil"",""x"")",'+cmd@example.com,player,false,${oid(50)},'@team,2026-11-01T10:00:00.000Z`);
    expect(lines[2]).toContain('"Comma, ""Quote"""');
    expect(lastAudit()).toMatchObject({ action: 'export.users' });
    // exports ignore page/limit and read up to the cap
    expect(models.User.find).toHaveBeenCalled();
  });

  it('exports teams, submissions and the leaderboard', async () => {
    models.Team.find.mockImplementation(() => chain([{ _id: oid(1), name: 'Alpha', memberIds: [oid(10)], banned: false, createdAt: new Date('2026-11-01T09:00:00Z') }]));
    models.Solve.aggregate.mockImplementation(async (pipeline) => (pipeline.some((stage) => stage.$lookup)
      ? [{ _id: oid(1), points: 100, solves: 1, lastSolveAt: new Date('2026-11-02T10:00:00Z'), teamName: 'Alpha' }]
      : [{ _id: oid(1), score: 100, solves: 1, lastSolveAt: new Date('2026-11-02T10:00:00Z') }]));
    const teams = await api('get', '/admin/export/teams.csv').expect(200);
    expect(teams.text.trim().split('\r\n')[1]).toBe(`${oid(1)},Alpha,1,100,1,false,2026-11-01T09:00:00.000Z,2026-11-02T10:00:00.000Z`);
    models.Team.find.mockImplementation(() => chain([])); // no idle teams
    const leaderboard = await api('get', '/admin/export/leaderboard.csv').expect(200);
    expect(leaderboard.text.trim().split('\r\n')).toEqual(['rank,teamId,teamName,points,solves,lastSolveAt', `1,${oid(1)},Alpha,100,1,2026-11-02T10:00:00.000Z`]);
    models.Submission.find.mockImplementation(() => chain([{ _id: oid(80), teamId: oid(1), userId: oid(2), challengeId: oid(3), correct: true, createdAt: new Date('2026-11-02T11:00:00Z'), submittedHash: 'zzz' }]));
    const submissions = await api('get', '/admin/export/submissions.csv?result=correct').expect(200);
    expect(submissions.text).not.toContain('zzz');
    expect(submissions.text.trim().split('\r\n')[0]).toBe('id,createdAt,correct,teamId,teamName,userId,userName,challengeId,challengeSlug');
    await api('get', '/admin/export/leaderboard.csv?x=1').expect(400);
  });
});
