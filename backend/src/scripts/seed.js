import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Team from '../models/Team.js';
import { connectDB } from '../config/db.js';

// Reserved IDs plus complete fingerprints distinguish our fixtures from real data.
export const fixtures = ['Alpha', 'Beta'].map((name, index) => {
  const userId = `5eed0000000000000000000${index + 1}`;
  const teamId = `5eed0000000000000000000${index + 3}`;
  return {
    user: {
      _id: userId, cognitoSub: `seed-demo-${name.toLowerCase()}`,
      email: `seed-demo-${name.toLowerCase()}@example.invalid`,
      displayName: `Demo ${name}`, role: 'player', teamId,
    },
    team: {
      _id: teamId, name: `Demo ${name}`, inviteCode: index === 0 ? 'SEEDAA' : 'SEEDBB',
      captainId: userId, memberIds: [userId], banned: false,
    },
  };
});

function matches(document, expected) {
  return Object.entries(expected).every(([key, value]) => Array.isArray(value)
    ? document[key]?.length === value.length && value.every((id, i) => String(document[key][i]) === id)
    : String(document[key]) === String(value));
}

export async function seedData(reset = false) {
  await Promise.all([User.init(), Team.init()]);
  return User.db.transaction(async (session) => {
    const users = fixtures.map(({ user }) => user);
    const teams = fixtures.map(({ team }) => team);
    const userIds = users.map(({ _id }) => _id);
    const teamIds = teams.map(({ _id }) => _id);
    const existingUsers = await User.find({ $or: [
      { _id: { $in: userIds } }, { cognitoSub: { $in: users.map((u) => u.cognitoSub) } },
      { email: { $in: users.map((u) => u.email) } }, { teamId: { $in: teamIds } },
    ] }, null, { session });
    const existingTeams = await Team.find({ $or: [
      { _id: { $in: teamIds } }, { name: { $in: teams.map((t) => t.name) } },
      { inviteCode: { $in: teams.map((t) => t.inviteCode) } },
      { captainId: { $in: userIds } }, { memberIds: { $in: userIds } },
    ] }, null, { session }).collation({ locale: 'en', strength: 2 });

    // Refuse collisions, changed fixtures, and real accounts referencing fixtures.
    // Never repair or adopt an existing document based on a name or seed- prefix.
    if (existingUsers.some((doc) => !users.some((u) => matches(doc, u)))
        || existingTeams.some((doc) => !teams.some((t) => matches(doc, t)))) {
      throw new Error('SEED_CONFLICT');
    }
    if (reset) {
      const teamResult = await Team.deleteMany({ _id: { $in: existingTeams.map((t) => t._id) } }, { session });
      const userResult = await User.deleteMany({ _id: { $in: existingUsers.map((u) => u._id) } }, { session });
      return { users: userResult.deletedCount, teams: teamResult.deletedCount, action: 'removed' };
    }
    const missingUsers = users.filter((u) => !existingUsers.some((doc) => String(doc._id) === u._id));
    const missingTeams = teams.filter((t) => !existingTeams.some((doc) => String(doc._id) === t._id));
    if (missingUsers.length) { await User.create(missingUsers, { session, ordered: true }); }
    if (missingTeams.length) { await Team.create(missingTeams, { session, ordered: true }); }
    return { users: missingUsers.length, teams: missingTeams.length, action: 'created' };
  });
}

export async function runSeed(args = process.argv.slice(2)) {
  let failed = false;
  try {
    if (args.some((arg) => !['--reset', '--force'].includes(arg))) {
      process.stderr.write('Usage: npm run seed -- [--reset] [--force]\n');
      return 1;
    }
    const { env } = await import('../config/env.js');
    if (env.NODE_ENV === 'production' && !args.includes('--force')) {
      process.stderr.write('Seed refused in production. Pass --force to proceed.\n');
      return 1;
    }
    await connectDB(env.MONGODB_URI);
    const result = await seedData(args.includes('--reset'));
    process.stdout.write(`Seed: ${result.action} ${result.users} users, ${result.teams} teams.\n`);
  } catch (error) {
    failed = true;
    process.stderr.write(error.message === 'SEED_CONFLICT'
      ? 'Seed refused: fixture collision, modified demo data, or external membership. No documents changed.\n'
      : 'Seed failed. Check configuration, database access, and transaction support.\n');
  } finally {
    try { await mongoose.disconnect(); }
    catch {
      failed = true;
      process.stderr.write('Seed database disconnect failed.\n');
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runSeed();
}
