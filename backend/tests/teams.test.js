import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import { installTeamStore } from './helpers/teamStore.js';

vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../src/models/User.js', () => ({ default: {
  init: vi.fn(), findOne: vi.fn(), find: vi.fn(), findOneAndUpdate: vi.fn(), db: { transaction: vi.fn() },
} }));
vi.mock('../src/models/Team.js', () => ({ default: {
  init: vi.fn(), create: vi.fn(), findOne: vi.fn(), findById: vi.fn(), findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(), deleteOne: vi.fn(),
} }));

let store;
let verify;
beforeEach(() => {
  vi.resetAllMocks();
  store = installTeamStore(User, Team);
  verify = vi.fn().mockImplementation(async (sub) => ({
    sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'],
  }));
  getCognitoVerifier.mockReturnValue({ verify });
});

function api(method, path, sub = 'alice', body) {
  const call = request(app)[method](`/api${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
}
const create = (sub = 'alice', name = 'Team Alpha') => api('post', '/teams', sub, { name });
const join = (sub, inviteCode = 'ABCDEF') => api('post', '/teams/join', sub, { inviteCode });
const leave = (sub) => api('post', '/teams/me/leave', sub);
const setup = (count = 1) => {
  const members = ['alice', 'bob', 'carol'].slice(0, count).map((sub) => store.addUser(sub));
  return { members, team: store.addTeam(members) };
};

describe('team creation and joining', () => {
  it('creates a trimmed team with the player as captain and first member', async () => {
    const response = await create('alice', '  Team Alpha  ').expect(201);
    const team = store.teams.get(response.body.id);
    const user = [...store.users.values()][0];
    expect(response.body).toEqual({
      id: team._id, name: 'Team Alpha', inviteCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/),
      members: [{ id: user._id, displayName: 'alice' }], score: 0,
    });
    expect(team.captainId).toBe(user._id);
    expect(team.memberIds).toEqual([user._id]);
    expect(user.teamId).toBe(team._id);
    expect(User.init).toHaveBeenCalled();
    expect(Team.init).toHaveBeenCalled();
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: user._id, teamId: null }, { $set: { teamId: team._id } },
      expect.objectContaining({ session: expect.any(Object) }),
    );
  });

  it('returns CONFLICT for case-insensitive duplicate names without leaving an orphan', async () => {
    setup();
    const response = await create('bob', 'team alpha').expect(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(store.teams.size).toBe(1);
    expect([...store.users.values()].some((user) => user.cognitoSub === 'bob')).toBe(false);
  });

  it('returns CONFLICT when creating while already in a team', async () => {
    setup();
    expect((await create('alice', 'Other Team').expect(409)).body.error.code).toBe('CONFLICT');
    expect(store.teams.size).toBe(1);
  });

  it('retries an invite-code collision in a fresh transaction', async () => {
    Team.create.mockRejectedValueOnce(Object.assign(new Error('duplicate code'), {
      code: 11000, keyPattern: { inviteCode: 1 },
    }));
    await create().expect(201);
    expect(Team.create).toHaveBeenCalledTimes(2);
    expect(User.db.transaction).toHaveBeenCalledTimes(2);
    expect(store.teams.size).toBe(1);
    expect(store.users.size).toBe(1);
  });

  it('bounds invite-code retries and leaves no partial state on exhaustion', async () => {
    Team.create.mockRejectedValue(Object.assign(new Error('duplicate code'), {
      code: 11000, keyPattern: { inviteCode: 1 },
    }));
    expect((await create().expect(500)).body.error.code).toBe('SERVER_ERROR');
    expect(Team.create).toHaveBeenCalledTimes(5);
    expect(store.teams.size).toBe(0);
    expect(store.users.size).toBe(0);
  });

  it('joins with a valid code and updates both documents', async () => {
    const { team } = setup();
    const response = await join('bob').expect(200);
    expect(response.body.members.map((member) => member.displayName)).toEqual(['alice', 'bob']);
    const bob = [...store.users.values()].find((user) => user.cognitoSub === 'bob');
    expect(bob.teamId).toBe(team._id);
    expect(store.teams.get(team._id).memberIds).toContain(bob._id);
    expect(Team.findOneAndUpdate).toHaveBeenCalledWith({
      inviteCode: 'ABCDEF', 'memberIds.2': { $exists: false }, memberIds: { $ne: bob._id },
    }, { $push: { memberIds: bob._id } }, expect.objectContaining({ session: expect.any(Object) }));
  });

  it('returns NOT_FOUND for an unknown code and makes no membership changes', async () => {
    store.addUser('bob');
    expect((await join('bob').expect(404)).body.error.code).toBe('NOT_FOUND');
    expect([...store.users.values()][0].teamId).toBeNull();
  });

  it('returns TEAM_FULL for a three-member team', async () => {
    const { team } = setup(3);
    expect((await join('dave').expect(409)).body.error.code).toBe('TEAM_FULL');
    expect(store.teams.get(team._id).memberIds).toHaveLength(3);
  });

  it('cannot join twice or join another team while already a member', async () => {
    const { team } = setup();
    await join('bob').expect(200);
    expect((await join('bob').expect(409)).body.error.code).toBe('CONFLICT');
    expect((await join('bob', 'GHJKLM').expect(409)).body.error.code).toBe('CONFLICT');
    expect(store.teams.get(team._id).memberIds).toHaveLength(2);
  });

  it('allows only one of two simultaneous joins to claim the last seat', async () => {
    const { team } = setup(2);
    const responses = await Promise.all([join('carol'), join('dave')]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409).body.error.code).toBe('TEAM_FULL');
    expect(store.teams.get(team._id).memberIds).toHaveLength(3);
    expect([...store.users.values()].filter((user) => user.teamId === team._id)).toHaveLength(3);
  });

  it('allows only one of two simultaneous creates by the same user', async () => {
    const responses = await Promise.all([create('alice', 'Team One'), create('alice', 'Team Two')]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(store.teams.size).toBe(1);
  });

  it('retries a concurrent first-user upsert collision in a fresh transaction', async () => {
    User.findOneAndUpdate.mockRejectedValueOnce(Object.assign(new Error('duplicate user'), {
      code: 11000, keyPattern: { cognitoSub: 1 },
    }));
    await create().expect(201);
    expect(User.db.transaction).toHaveBeenCalledTimes(2);
    expect(store.users.size).toBe(1);
    expect(store.teams.size).toBe(1);
  });

  it('lets a user join only one team when requests target two different teams', async () => {
    setup();
    const owner = store.addUser('carol');
    const other = store.addTeam([owner], { name: 'Other Team', inviteCode: 'GHJKLM' });
    const responses = await Promise.all([join('bob'), join('bob', other.inviteCode)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const bob = [...store.users.values()].find((user) => user.cognitoSub === 'bob');
    expect([...store.teams.values()].filter((team) => team.memberIds.includes(bob._id))).toHaveLength(1);
  });

  it.each(['null', 'throw'])('rolls back a reserved seat when claiming the user fails: %s', async (failure) => {
    const { team } = setup();
    const update = User.findOneAndUpdate.getMockImplementation();
    User.findOneAndUpdate.mockImplementation((filter, ...args) => {
      if (filter.teamId === null) {
        if (failure === 'throw') { throw new Error('private DB details'); }
        return null;
      }
      return update(filter, ...args);
    });
    const response = await join('bob').expect(failure === 'throw' ? 500 : 409);
    expect(response.body.error.code).toBe(failure === 'throw' ? 'SERVER_ERROR' : 'CONFLICT');
    expect(store.teams.get(team._id).memberIds).toEqual(team.memberIds);
    expect(store.users.size).toBe(1);
  });

  it('rolls back team creation when the user claim fails', async () => {
    const update = User.findOneAndUpdate.getMockImplementation();
    User.findOneAndUpdate.mockImplementation((filter, ...args) => filter.teamId === null ? null : update(filter, ...args));
    await create().expect(409);
    expect(store.teams.size).toBe(0);
    expect(store.users.size).toBe(0);
  });
});

describe('reading and leaving teams', () => {
  it('returns the current team, member names, zero score and banned state', async () => {
    const { team, members } = setup(2);
    store.teams.get(team._id).banned = true;
    expect((await api('get', '/teams/me').expect(200)).body).toEqual({
      id: team._id, name: team.name, inviteCode: team.inviteCode,
      members: members.map((user) => ({ id: user._id, displayName: user.displayName })),
      score: 0, banned: true,
    });
  });

  it.each(['get', 'leave'])('returns NO_TEAM when a player has no team: %s', async (operation) => {
    store.addUser('alice');
    const response = operation === 'get' ? await api('get', '/teams/me').expect(404) : await leave('alice').expect(404);
    expect(response.body.error.code).toBe('NO_TEAM');
  });

  it('lets a regular member leave without changing the captain', async () => {
    const { team, members } = setup(2);
    await leave('bob').expect(204);
    expect(store.teams.get(team._id).memberIds).toEqual([members[0]._id]);
    expect(store.teams.get(team._id).captainId).toBe(members[0]._id);
    expect(store.users.get(members[1]._id).teamId).toBeNull();
  });

  it('makes the next member captain when the captain leaves', async () => {
    const { team, members } = setup(3);
    await leave('alice').expect(204);
    expect(store.teams.get(team._id).memberIds).toEqual([members[1]._id, members[2]._id]);
    expect(store.teams.get(team._id).captainId).toBe(members[1]._id);
    expect(store.users.get(members[0]._id).teamId).toBeNull();
  });

  it('deletes the team when its last member leaves', async () => {
    const { team, members } = setup();
    await leave('alice').expect(204);
    expect(store.teams.has(team._id)).toBe(false);
    expect(store.users.get(members[0]._id).teamId).toBeNull();
    expect((await leave('alice').expect(404)).body.error.code).toBe('NO_TEAM');
  });

  it('keeps both sides consistent when joining races with the last member leaving', async () => {
    const { team } = setup();
    const responses = await Promise.all([leave('alice'), join('bob')]);
    expect(responses[0].status).toBe(204);
    expect([200, 404]).toContain(responses[1].status);
    const surviving = store.teams.get(team._id);
    if (surviving) {
      const bob = [...store.users.values()].find((user) => user.cognitoSub === 'bob');
      expect(surviving.memberIds).toEqual([bob._id]);
      expect(surviving.captainId).toBe(bob._id);
      expect(bob.teamId).toBe(team._id);
    } else {
      expect([...store.users.values()].every((user) => user.teamId === null)).toBe(true);
    }
  });

  it.each([1, 2])('rolls back leave/deletion if clearing user membership fails (%i members)', async (count) => {
    const { team, members } = setup(count);
    User.findOneAndUpdate.mockResolvedValueOnce(null);
    await leave('alice').expect(409);
    expect(store.teams.get(team._id)).toEqual(team);
    expect(store.users.get(members[0]._id).teamId).toBe(team._id);
  });

  it.each(['get', 'patch'])('includes the team in /me responses: %s', async (method) => {
    const { team } = setup();
    const response = await api(method, '/me', 'alice', method === 'patch' ? { displayName: 'Alice Updated' } : undefined).expect(200);
    expect(response.body.team).toEqual({ id: team._id, name: team.name });
    expect(response.body).not.toHaveProperty('inviteCode');
  });

  it('returns team null after leaving and for missing team references', async () => {
    const { team, members } = setup();
    await leave('alice').expect(204);
    expect((await api('get', '/me').expect(200)).body.team).toBeNull();
    store.users.get(members[0]._id).teamId = team._id;
    expect((await api('get', '/me').expect(200)).body.team).toBeNull();
  });
});

describe('team input and authorization', () => {
  it.each([
    ['/teams', {}], ['/teams', { name: ' ab ' }], ['/teams', { name: 'a'.repeat(25) }],
    ['/teams', { name: 123 }], ['/teams', { name: 'Good Name', captainId: 'forged' }],
    ['/teams/join', {}], ['/teams/join', { inviteCode: 'short' }],
    ['/teams/join', { inviteCode: 'ABCDEF', teamId: 'forged' }],
    ['/teams/me/leave', { userId: 'forged' }],
  ])('returns VALIDATION_ERROR for %s %j', async (path, body) => {
    expect((await api('post', path, 'alice', body).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    expect(User.db.transaction).not.toHaveBeenCalled();
  });

  it.each([['post', '/teams'], ['post', '/teams/join'], ['get', '/teams/me'], ['post', '/teams/me/leave']])
  ('requires a token for %s %s', async (method, path) => {
    expect((await request(app)[method](`/api${path}`).expect(401)).body.error.code).toBe('UNAUTHENTICATED');
    expect(User.db.transaction).not.toHaveBeenCalled();
  });

  it('uses the existing role guard to deny admins on player-only team routes', async () => {
    expect((await create('admin').expect(403)).body.error.code).toBe('FORBIDDEN');
    expect(User.db.transaction).not.toHaveBeenCalled();
  });
});
