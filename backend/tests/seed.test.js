import mongoose from 'mongoose';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import { connectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { fixtures, seedData, runSeed } from '../src/scripts/seed.js';

vi.mock('../src/config/env.js', () => ({ env: { NODE_ENV: 'test', MONGODB_URI: 'private-uri' } }));
vi.mock('../src/config/db.js', () => ({ connectDB: vi.fn() }));
vi.mock('../src/models/User.js', () => ({ default: {
  init: vi.fn(), find: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), db: { transaction: vi.fn() },
} }));
vi.mock('../src/models/Team.js', () => ({ default: {
  init: vi.fn(), find: vi.fn(), create: vi.fn(), deleteMany: vi.fn(),
} }));

let users;
let teams;
let out;
let err;
const session = { testSession: true };
const clone = (value) => structuredClone(value);

beforeEach(() => {
  vi.resetAllMocks();
  env.NODE_ENV = 'test';
  users = [];
  teams = [];
  out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.spyOn(mongoose, 'disconnect').mockResolvedValue();
  // All records returned here are candidates; unrelated real records are covered
  // separately by asserting that deletes target only inspected fixture IDs.
  User.find.mockImplementation(async () => clone(users));
  Team.find.mockImplementation(() => ({ collation: vi.fn(async () => clone(teams)) }));
  User.create.mockImplementation(async (docs) => { users.push(...clone(docs)); });
  Team.create.mockImplementation(async (docs) => { teams.push(...clone(docs)); });
  for (const [model, get, set] of [
    [User, () => users, (value) => { users = value; }],
    [Team, () => teams, (value) => { teams = value; }],
  ]) {
    model.deleteMany.mockImplementation(async (filter) => {
      const before = get();
      const remaining = before.filter((doc) => !filter._id.$in.includes(doc._id));
      set(remaining);
      return { deletedCount: before.length - remaining.length };
    });
  }
  User.db.transaction.mockImplementation(async (work) => {
    const snapshot = clone({ users, teams });
    try { return await work(session); }
    catch (error) { ({ users, teams } = snapshot); throw error; }
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('demo fixtures', () => {
  it('creates linked demo players and valid teams, then makes no writes on a second run', async () => {
    expect(await seedData()).toEqual({ users: 2, teams: 2, action: 'created' });
    const snapshot = clone({ users, teams });
    expect(await seedData()).toEqual({ users: 0, teams: 0, action: 'created' });
    expect({ users, teams }).toEqual(snapshot);
    expect(User.create).toHaveBeenCalledTimes(1);
    expect(Team.create).toHaveBeenCalledTimes(1);
    expect(User.create).toHaveBeenCalledWith(expect.any(Array), { session, ordered: true });
    for (const { user, team } of fixtures) {
      expect(user.cognitoSub).toMatch(/^seed-/);
      expect(user.email).toMatch(/@example\.invalid$/);
      expect(mongoose.isValidObjectId(user._id)).toBe(true);
      expect(team.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(team.memberIds).toEqual([user._id]);
      expect(user.teamId).toBe(team._id);
    }
  });

  it('creates schema-valid fixtures through the real Mongoose create method with a session', async () => {
    const { default: RealUser } = await vi.importActual('../src/models/User.js');
    const { default: RealTeam } = await vi.importActual('../src/models/Team.js');
    const saved = [];
    for (const model of [RealUser, RealTeam]) {
      // Keep Mongoose validation and create option handling; replace only database writes.
      vi.spyOn(model.prototype, '$save').mockImplementation(async function (options) {
        await this.validate();
        expect(options.session).toBe(session);
        saved.push(this);
        return this;
      });
    }
    User.create.mockImplementation(RealUser.create.bind(RealUser));
    Team.create.mockImplementation(RealTeam.create.bind(RealTeam));
    expect(await seedData()).toEqual({ users: 2, teams: 2, action: 'created' });
    expect(saved).toHaveLength(4);
    expect(saved.map((doc) => String(doc._id))).toEqual([
      ...fixtures.map((f) => f.user._id), ...fixtures.map((f) => f.team._id),
    ]);
  });

  it('resets only exact fixture IDs, and repeated reset is harmless', async () => {
    await seedData();
    expect(await seedData(true)).toEqual({ users: 2, teams: 2, action: 'removed' });
    expect(User.deleteMany).toHaveBeenCalledWith({ _id: { $in: fixtures.map((f) => f.user._id) } }, { session });
    expect(Team.deleteMany).toHaveBeenCalledWith({ _id: { $in: fixtures.map((f) => f.team._id) } }, { session });
    expect(await seedData(true)).toEqual({ users: 0, teams: 0, action: 'removed' });
  });

  it('fills missing fixtures without rewriting existing ones', async () => {
    users = [clone(fixtures[0].user)];
    teams = [clone(fixtures[1].team)];
    expect(await seedData()).toEqual({ users: 1, teams: 1, action: 'created' });
    expect(User.create).toHaveBeenCalledWith([fixtures[1].user], { session, ordered: true });
    expect(Team.create).toHaveBeenCalledWith([fixtures[0].team], { session, ordered: true });
  });

  it('rolls back reset if removing users fails after removing teams', async () => {
    await seedData();
    const snapshot = clone({ users, teams });
    User.deleteMany.mockRejectedValueOnce(new Error('write failure'));
    await expect(seedData(true)).rejects.toThrow('write failure');
    expect({ users, teams }).toEqual(snapshot);
  });

  it.each(['user', 'team', 'changed', 'external-user', 'external-team'])('refuses %s collisions on both seed and reset', async (kind) => {
    if (kind === 'user') { users = [{ ...fixtures[0].user, _id: 'real-user' }]; }
    if (kind === 'team') { teams = [{ ...fixtures[0].team, _id: 'real-team', name: 'demo alpha' }]; }
    if (kind === 'changed') { users = [{ ...fixtures[0].user, displayName: 'Changed' }]; }
    if (kind === 'external-user') { users = [{ _id: 'real-user', teamId: fixtures[0].team._id }]; }
    if (kind === 'external-team') { teams = [{ _id: 'real-team', memberIds: [fixtures[0].user._id] }]; }
    for (const reset of [false, true]) {
      await expect(seedData(reset)).rejects.toThrow('SEED_CONFLICT');
    }
    expect(User.create).not.toHaveBeenCalled();
    expect(Team.create).not.toHaveBeenCalled();
    expect(User.deleteMany).not.toHaveBeenCalled();
    expect(Team.deleteMany).not.toHaveBeenCalled();
  });

  it('rolls back users if team insertion fails', async () => {
    Team.create.mockRejectedValueOnce(new Error('duplicate'));
    await expect(seedData()).rejects.toThrow('duplicate');
    expect(users).toEqual([]);
    expect(teams).toEqual([]);
  });
});

describe('seed command', () => {
  it.each([[], ['--reset']])('refuses production without force (%j)', async (args) => {
    env.NODE_ENV = 'production';
    expect(await runSeed(args)).toBe(1);
    expect(connectDB).not.toHaveBeenCalled();
    expect(User.db.transaction).not.toHaveBeenCalled();
    expect(mongoose.disconnect).toHaveBeenCalled();
  });

  it('accepts force in production, prints summary, and disconnects', async () => {
    env.NODE_ENV = 'production';
    expect(await runSeed(['--force'])).toBe(0);
    expect(connectDB).toHaveBeenCalledWith(env.MONGODB_URI);
    expect(out).toHaveBeenCalledWith('Seed: created 2 users, 2 teams.\n');
    expect(await runSeed(['--force', '--reset'])).toBe(0);
    expect(out).toHaveBeenCalledWith('Seed: removed 2 users, 2 teams.\n');
    expect(mongoose.disconnect).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown arguments without connecting', async () => {
    expect(await runSeed(['--typo'])).toBe(1);
    expect(connectDB).not.toHaveBeenCalled();
  });

  it.each(['connect', 'write', 'disconnect'])('handles %s failure without exposing driver details', async (where) => {
    const sensitive = new Error('private-uri credentials');
    if (where === 'connect') { connectDB.mockRejectedValueOnce(sensitive); }
    if (where === 'write') { Team.create.mockRejectedValueOnce(sensitive); }
    if (where === 'disconnect') { mongoose.disconnect.mockRejectedValueOnce(sensitive); }
    expect(await runSeed()).toBe(1);
    expect(mongoose.disconnect).toHaveBeenCalled();
    expect(err.mock.calls.flat().join('')).not.toContain('private-uri');
  });
});
