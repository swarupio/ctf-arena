// Registers one Challenge per question of OSINT Trail (docs/OSINT_TRAIL.md).
// Safe to repeat: rows are keyed by slug `osint-<track>-<n>`, updated in place, and keep solveCount and `visible`.
// Usage: npm run seed:osint
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import { TRACKS, TRACK_IDS } from '../osint/cases.js';
import { isEntryPoint } from './seedChallenges.js';

export const osintSlug = (track, n) => `osint-${track}-${n}`;

export function osintDefinitions(tracks = TRACKS, ids = TRACK_IDS) {
  return ids.flatMap((id) => tracks[id].stages.map((stage) => ({
    slug: osintSlug(id, stage.n),
    title: `OSINT ${tracks[id].title}: ${stage.title}`,
    description: `Question ${stage.n} of the OSINT Trail case "${tracks[id].caseTitle}". Open the OSINT page, investigate the fictional case file and answer the question.`,
    category: 'misc',
    type: 'osint',
    // The challenge difficulty enum has no "insane": that case is stored as hard (its track name lives in `osint`).
    difficulty: id === 'insane' ? 'hard' : id,
    points: stage.points,
    osint: { track: id, stage: stage.n },
  })));
}

export async function seedOsint(definitions = osintDefinitions()) {
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
    const summary = await seedOsint();
    process.stdout.write(`OSINT challenges seeded: ${summary.created} created, ${summary.updated} updated.\n`);
  } catch {
    // Driver errors can contain credentials; never print them.
    process.stderr.write('OSINT seeding failed. Check MONGODB_URI.\n');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
