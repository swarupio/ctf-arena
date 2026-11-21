// Registers one Challenge per Cipher Lab level (docs/CIPHER_LAB.md). Safe to repeat: rows are keyed by slug
// `cipherlab-<level id>`, updated in place, and keep solveCount and `visible`. Usage: npm run seed:cipherlab
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import { slugOf } from '../games/cipherlab/game.js';
import { LEVELS, TRACKS } from '../games/cipherlab/levels.js';
import { isEntryPoint } from './seedChallenges.js';

export function cipherLabDefinitions() {
  return LEVELS.map((level) => {
    const track = TRACKS.find((item) => item.id === level.track);
    return {
      slug: slugOf(level),
      title: `Cipher Lab ${track.title} #${level.n}: ${level.title}`,
      description: `${level.briefing} Play it on the Cipher Lab page; the answer is checked there.`,
      category: 'crypto',
      type: 'game',
      // The Challenge model only knows easy, medium and hard; the insane track is stored as hard.
      difficulty: level.track === 'insane' ? 'hard' : level.track,
      points: level.points,
    };
  });
}

export async function seedCipherLab(definitions = cipherLabDefinitions()) {
  const summary = { created: 0, updated: 0 };
  for (const definition of definitions) {
    const existing = await Challenge.findOne({ slug: definition.slug });
    if (existing) {
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
    const summary = await seedCipherLab();
    process.stdout.write(`Cipher Lab seeded: ${summary.created} created, ${summary.updated} updated.\n`);
  } catch {
    // Driver errors can contain credentials; never print them.
    process.stderr.write('Cipher Lab seeding failed. Check MONGODB_URI.\n');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
