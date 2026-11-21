// Registers one Challenge per Crackme Arcade level (docs/CRACKME_ARCADE.md). Safe to repeat: rows are keyed by slug
// `crackme-<level id>`, updated in place, and keep solveCount and `visible`. Usage: npm run seed:crackme
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import { slugOf } from '../games/crackme/game.js';
import { LEVELS, TRACKS } from '../games/crackme/levels.js';
import { isEntryPoint } from './seedChallenges.js';

export function crackmeDefinitions() {
  return LEVELS.map((level) => {
    const track = TRACKS.find((item) => item.id === level.track);
    return {
      slug: slugOf(level),
      title: `Crackme Arcade ${track.title} #${level.n}: ${level.title}`,
      description: `${level.briefing} Play it on the Crackme Arcade page (/reversing); the input is checked there.`,
      // The category list has no reverse-engineering entry; binary work is filed under pwn.
      category: 'pwn',
      type: 'reversing',
      // The Challenge model only knows easy, medium and hard; the insane track is stored as hard.
      difficulty: level.track === 'insane' ? 'hard' : level.track,
      points: level.points,
    };
  });
}

export async function seedCrackme(definitions = crackmeDefinitions()) {
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
    const summary = await seedCrackme();
    process.stdout.write(`Crackme Arcade seeded: ${summary.created} created, ${summary.updated} updated.\n`);
  } catch {
    // Driver errors can contain credentials; never print them.
    process.stderr.write('Crackme Arcade seeding failed. Check MONGODB_URI.\n');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
