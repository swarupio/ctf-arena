// Gives the two demo teams from `npm run seed` some solves so the leaderboard looks alive.
// Usage: npm run seed:demo [-- --reset]. Run `npm run seed` and `npm run seed:challenges` first.
// Only touches solves of the reserved demo teams, and recomputes solveCount from real solves.
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';
import { fixtures } from './seed.js';
import { firstBloodBonus } from '../services/scoringService.js';

const MINUTE = 60 * 1000;
// [team index, challenge slug, minutes ago]
export const plan = [
  [0, 'sanity-check', 50], [1, 'sanity-check', 40], [0, 'caesar-says', 30],
  [1, 'cookie-monster', 20], [0, 'robots-rule', 10],
];

export async function seedDemoSolves({ reset = false } = {}) {
  const teamIds = fixtures.map(({ team }) => team._id);
  await Solve.deleteMany({ teamId: { $in: teamIds } });
  if (!reset) {
    const challenges = new Map((await Challenge.find({})).map((c) => [c.slug, c]));
    const missing = [...new Set(plan.map(([, slug]) => slug))].filter((slug) => !challenges.has(slug));
    if (missing.length) { throw new Error(`Run npm run seed:challenges first (missing: ${missing.join(', ')}).`); }
    const first = new Set();
    for (const [teamIndex, slug, minutesAgo] of [...plan].sort((a, b) => b[2] - a[2])) {
      const challenge = challenges.get(slug);
      const firstBlood = !first.has(slug) && !(await Solve.exists({ challengeId: challenge._id }));
      first.add(slug);
      const { team, user } = fixtures[teamIndex];
      await Solve.create({
        teamId: team._id, userId: user._id, challengeId: challenge._id, firstBlood,
        points: challenge.points + (firstBlood ? firstBloodBonus(challenge.points) : 0),
        solvedAt: new Date(Date.now() - minutesAgo * MINUTE),
      });
    }
  }
  // Keep the counter equal to the real number of solves.
  for (const challenge of await Challenge.find({})) {
    await Challenge.updateOne({ _id: challenge._id }, { $set: { solveCount: await Solve.countDocuments({ challengeId: challenge._id }) } });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await connectDB(env.MONGODB_URI);
    await seedDemoSolves({ reset: process.argv.includes('--reset') });
    process.stdout.write(process.argv.includes('--reset') ? 'Demo solves removed.\n' : 'Demo solves added for Demo Alpha and Demo Beta.\n');
  } catch (error) {
    process.stderr.write(`${error.message?.startsWith('Run npm') ? error.message : 'Demo seeding failed. Check MONGODB_URI and run the other seeds first.'}\n`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
