// Registers one Challenge per stage of Forensics Desk (docs/FORENSICS_DESK.md).
// Safe to repeat: rows are keyed by slug `forensics-<track>-<n>`, updated in place, and keep solveCount and `visible`.
// Usage: npm run seed:forensics
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import { TRACKS, TRACK_IDS } from '../forensics/tracks.js';
import { isEntryPoint } from './seedChallenges.js';

export const forensicsSlug = (track, n) => `forensics-${track}-${n}`;

export function forensicsDefinitions(tracks = TRACKS, ids = TRACK_IDS) {
  return ids.flatMap((id) => tracks[id].stages.map((stage) => ({
    slug: forensicsSlug(id, stage.n),
    title: `${tracks[id].title}: ${stage.title}`,
    description: `Stage ${stage.n} of the Forensics Desk case "${tracks[id].caseTitle}". Open the Forensics page, investigate the case file and answer the question.`,
    category: 'forensics',
    type: 'forensics',
    // The challenge difficulty enum has no "insane": that track is stored as hard (its track name lives in `forensics`).
    difficulty: id === 'insane' ? 'hard' : id,
    points: stage.points,
    forensics: { track: id, stage: stage.n },
  })));
}

export async function seedForensics(definitions = forensicsDefinitions()) {
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
    const summary = await seedForensics();
    process.stdout.write(`Forensics challenges seeded: ${summary.created} created, ${summary.updated} updated.\n`);
  } catch {
    // Driver errors can contain credentials; never print them.
    process.stderr.write('Forensics seeding failed. Check MONGODB_URI.\n');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
