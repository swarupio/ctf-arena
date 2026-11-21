// Registers one Challenge per Web Exploit Lab (docs/WEB_EXPLOIT_LAB.md). Safe to repeat: rows are keyed by slug
// `weblab-<id>`, updated in place, and keep solveCount and `visible`. Usage: npm run seed:weblab
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import { LABS, labSlug } from '../games/weblab/index.js';
import { isEntryPoint } from './seedChallenges.js';

export function weblabDefinitions(labs = LABS) {
  return labs.map((lab) => ({
    slug: labSlug(lab.id),
    title: `Web Lab: ${lab.title}`,
    description: `${lab.story} Open the Web Exploit Lab page, attack the simulated site and submit the flag you find.`,
    category: 'web',
    type: 'weblab',
    difficulty: lab.track === 'insane' ? 'hard' : lab.track,
    points: lab.points,
  }));
}

export async function seedWebLab(definitions = weblabDefinitions()) {
  const summary = { created: 0, updated: 0 };
  for (const definition of definitions) {
    const existing = await Challenge.findOne({ slug: definition.slug });
    if (existing) {
      // solveCount and visible are not part of the update: solves and admin choices survive a re-seed.
      await Challenge.updateOne({ _id: existing._id }, { $set: definition });
      summary.updated += 1;
    } else {
      await Challenge.create({ ...definition, visible: true });
      summary.created += 1;
    }
  }
  return summary;
}

if (isEntryPoint(import.meta.url)) {
  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    const summary = await seedWebLab();
    process.stdout.write(`Web lab challenges seeded: ${summary.created} created, ${summary.updated} updated.\n`);
  } catch {
    // Driver errors can contain credentials; never print them.
    process.stderr.write('Web lab seeding failed. Check MONGODB_URI.\n');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
