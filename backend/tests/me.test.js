import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import Team from '../src/models/Team.js';
import User from '../src/models/User.js';

// Use the existing auth middleware with the same verifier mock as auth.test.js.
vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../src/models/Team.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../src/models/User.js', () => ({ default: { findOneAndUpdate: vi.fn(), findOne: vi.fn(), exists: vi.fn() } }));

const claims = { sub: 'cognito-alice', email: 'alice@example.com', 'cognito:groups': ['player'] };
let verify;
let users;

beforeEach(() => {
  vi.resetAllMocks();
  users = new Map();
  verify = vi.fn().mockResolvedValue({ ...claims });
  getCognitoVerifier.mockReturnValue({ verify });
  // Emulate insert-only defaults and updates without opening a MongoDB connection.
  User.findOne.mockImplementation(async (filter) => users.get(filter.cognitoSub) ?? null);
  User.exists.mockImplementation(async (filter) => (users.get(filter.cognitoSub)?.banned === Boolean(filter.banned) ? { _id: 'x' } : null));
  User.findOneAndUpdate.mockImplementation(async (filter, update) => {
    let user = users.get(filter.cognitoSub);
    // A filter that excludes the existing document makes the upsert insert a duplicate cognitoSub.
    if (user && filter.banned?.$ne === true && user.banned) {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyPattern: { cognitoSub: 1 } });
    }
    if (!user) {
      user = {
        _id: '507f1f77bcf86cd799439011', cognitoSub: filter.cognitoSub, teamId: null,
        ...update.$setOnInsert,
      };
      users.set(filter.cognitoSub, user);
    }
    Object.assign(user, update.$set);
    return user;
  });
});

function getMe() {
  return request(app).get('/api/me').set('Authorization', 'Bearer test-token');
}

function patchMe(body) {
  return request(app).patch('/api/me').set('Authorization', 'Bearer test-token').send(body);
}

describe('current user profile', () => {
  it('creates the first user by Cognito sub with an email-based name', async () => {
    const response = await getMe().expect(200);
    expect(response.body).toEqual({
      id: '507f1f77bcf86cd799439011', email: claims.email,
      displayName: 'alice', role: 'player', team: null, teamBanned: false,
    });
    expect(users.size).toBe(1);
    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { cognitoSub: claims.sub },
      { $set: { email: claims.email, role: 'player' }, $setOnInsert: { displayName: 'alice' } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true, lean: true },
    );
    expect(verify).toHaveBeenCalledWith('test-token');
  });

  it('reuses the same user on subsequent calls', async () => {
    const first = await getMe().expect(200);
    const second = await getMe().expect(200);
    expect(second.body).toEqual(first.body);
    expect(users.size).toBe(1);
  });

  it('refreshes token email while preserving an edited display name', async () => {
    await getMe().expect(200);
    await patchMe({ displayName: 'Alice Smith' }).expect(200);
    verify.mockResolvedValue({ ...claims, email: 'new-address@example.com' });
    const response = await getMe().expect(200);
    expect(response.body.email).toBe('new-address@example.com');
    expect(response.body.displayName).toBe('Alice Smith');
    expect(users.size).toBe(1);
  });

  it('copies token role changes on every GET, including demotion', async () => {
    await getMe().expect(200);
    verify.mockResolvedValue({ ...claims, 'cognito:groups': ['player', 'admin'] });
    expect((await getMe().expect(200)).body.role).toBe('admin');
    verify.mockResolvedValue(claims);
    expect((await getMe().expect(200)).body.role).toBe('player');
  });

  it.each(['abc', 'a'.repeat(30)])('accepts and trims valid names: %s', async (name) => {
    const response = await patchMe({ displayName: `  ${name}  ` }).expect(200);
    expect(response.body).toEqual({
      id: '507f1f77bcf86cd799439011', email: claims.email,
      displayName: name, role: 'player', team: null, teamBanned: false,
    });
    expect((await getMe().expect(200)).body.displayName).toBe(name);
  });

  it('PATCH updates the existing profile and refreshes email and role from the token', async () => {
    const first = await getMe().expect(200);
    verify.mockResolvedValue({ ...claims, email: 'admin@example.com', 'cognito:groups': ['admin'] });
    const response = await patchMe({ displayName: '  Administrator  ' }).expect(200);
    expect(response.body).toEqual({
      ...first.body, email: 'admin@example.com', role: 'admin', displayName: 'Administrator',
    });
    expect(users.size).toBe(1);
  });

  it.each([
    {}, { displayName: 'ab' }, { displayName: '   ' }, { displayName: ' ab ' },
    { displayName: 'a'.repeat(31) }, { displayName: 123 }, { displayName: null },
    { displayName: 'Alice', role: 'admin' }, { displayName: 'Alice', teamId: 'forged' },
  ])('rejects invalid PATCH bodies without writing: %j', async (body) => {
    const response = await patchMe(body).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toEqual(expect.any(String));
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each(['get', 'patch'])('requires a token for %s', async (method) => {
    const response = await request(app)[method]('/api/me').send({ displayName: 'Alice' }).expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(verify).not.toHaveBeenCalled();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens before accessing the model', async () => {
    verify.mockRejectedValue(new Error('private verifier details'));
    expect((await getMe().expect(401)).body.error.code).toBe('UNAUTHENTICATED');
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns team null and exposes only the contracted profile fields', async () => {
    await getMe().expect(200);
    Object.assign(users.get(claims.sub), { teamId: 'some-team', privateField: 'private' });
    expect((await getMe().expect(200)).body).toEqual({
      id: '507f1f77bcf86cd799439011', email: claims.email,
      displayName: 'alice', role: 'player', team: null, teamBanned: false,
    });
  });

  it('reports banned: true additively for a banned user, who can still read /api/me', async () => {
    await getMe().expect(200);
    expect((await getMe().expect(200)).body).not.toHaveProperty('banned');
    users.get(claims.sub).banned = true;
    const response = await getMe().expect(200);
    expect(response.body).toMatchObject({ id: '507f1f77bcf86cd799439011', email: claims.email, banned: true });
  });

  describe('teamBanned', () => {
    const teamId = '507f1f77bcf86cd799439022';
    const withTeam = async (team) => {
      await getMe().expect(200);
      users.get(claims.sub).teamId = teamId;
      Team.findById.mockResolvedValue(team);
      return (await getMe().expect(200)).body;
    };

    it('is true for a user whose team is banned, with the team still listed', async () => {
      const body = await withTeam({ _id: teamId, name: 'Red', banned: true });
      expect(body).toMatchObject({ team: { id: teamId, name: 'Red' }, teamBanned: true });
      expect(body).not.toHaveProperty('banned');
    });

    it('is false for a normal team, and for a team that has no banned field', async () => {
      expect((await withTeam({ _id: teamId, name: 'Red', banned: false })).teamBanned).toBe(false);
      expect((await withTeam({ _id: teamId, name: 'Red' })).teamBanned).toBe(false);
    });

    it('is false without a team, and for a team that no longer exists', async () => {
      expect((await getMe().expect(200)).body.teamBanned).toBe(false);
      expect(Team.findById).not.toHaveBeenCalled();
      const body = await withTeam(null);
      expect(body).toMatchObject({ team: null, teamBanned: false });
    });

    it('reads the flag in the existing team lookup (one projection, no extra query)', async () => {
      await withTeam({ _id: teamId, name: 'Red', banned: true });
      expect(Team.findById).toHaveBeenCalledTimes(1);
      expect(Team.findById).toHaveBeenCalledWith(teamId, 'name banned', { lean: true });
    });

    it('leaves the account flag unchanged: a banned account on a normal team', async () => {
      await getMe().expect(200);
      Object.assign(users.get(claims.sub), { teamId, banned: true });
      Team.findById.mockResolvedValue({ _id: teamId, name: 'Red', banned: false });
      expect((await getMe().expect(200)).body).toMatchObject({ banned: true, teamBanned: false });
    });

    it('reports both flags when the account and the team are banned', async () => {
      await getMe().expect(200);
      Object.assign(users.get(claims.sub), { teamId, banned: true });
      Team.findById.mockResolvedValue({ _id: teamId, name: 'Red', banned: true });
      expect((await getMe().expect(200)).body).toMatchObject({ banned: true, teamBanned: true });
    });
  });

  it('reads the banned flag in the existing lean projection (no extra query)', async () => {
    await getMe().expect(200);
    await getMe().expect(200);
    expect(User.findOne).toHaveBeenCalledWith(
      { cognitoSub: claims.sub }, '_id email role displayName teamId banned', { lean: true },
    );
    expect(User.exists).not.toHaveBeenCalled();
  });

  it('blocks a banned user from changing the display name with 403 USER_BANNED', async () => {
    await getMe().expect(200);
    users.get(claims.sub).banned = true;
    const response = await patchMe({ displayName: 'Sneaky' }).expect(403);
    expect(response.body.error.code).toBe('USER_BANNED');
    expect(users.get(claims.sub).displayName).toBe('alice');
  });

  it('does not run the extra ban lookup when PATCH succeeds', async () => {
    await patchMe({ displayName: 'Alice Smith' }).expect(200);
    expect(User.exists).not.toHaveBeenCalled();
  });

  it('hides internal database errors', async () => {
    User.findOneAndUpdate.mockRejectedValue(new Error('private database details'));
    expect((await getMe().expect(500)).body).toEqual({
      error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' },
    });
  });

  it('keeps health public without invoking the verifier or User model', async () => {
    expect((await request(app).get('/api/health').expect(200)).body.status).toBe('ok');
    expect(getCognitoVerifier).not.toHaveBeenCalled();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
