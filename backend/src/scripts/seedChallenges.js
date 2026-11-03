// Registers the starter challenges from challenges/<slug>/challenge.json.
// Safe to repeat: existing challenges are updated in place and keep their solve counts.
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import Challenge from '../models/Challenge.js';
import { hashStaticFlag, verifyStaticFlag } from '../services/flagService.js';

const root = fileURLToPath(new URL('../../../challenges/', import.meta.url));

export async function loadDefinitions(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const definitions = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) { continue; }
    try {
      definitions.push(JSON.parse(await readFile(join(directory, entry.name, 'challenge.json'), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') { throw error; }
    }
  }
  return definitions;
}

// True when this file is the script node was started with. Comparing file URLs built by pathToFileURL works
// for POSIX paths (the Azure VM) and Windows drive paths alike; a hand-built 'file:///' string does not.
export function isEntryPoint(moduleUrl, entry = process.argv[1]) {
  return Boolean(entry) && moduleUrl === pathToFileURL(resolve(entry)).href;
}

export async function seedChallenges(definitions) {
  const summary = { created: 0, updated: 0 };
  for (const { flag, ...definition } of definitions) {
    const existing = await Challenge.findOne({ slug: definition.slug });
    const fields = { ...definition };
    if (definition.type === 'static') {
      // Keep the existing salt/hash when the flag has not changed.
      Object.assign(fields, existing && verifyStaticFlag(existing, flag) ? {} : hashStaticFlag(flag));
    }
    if (existing) {
      await Challenge.updateOne({ _id: existing._id }, { $set: fields });
      summary.updated += 1;
    } else {
      await Challenge.create(fields);
      summary.created += 1;
    }
  }
  return summary;
}

if (isEntryPoint(import.meta.url)) {
  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    const summary = await seedChallenges(await loadDefinitions());
    process.stdout.write(`Challenges seeded: ${summary.created} created, ${summary.updated} updated.\n`);
  } catch {
    // Driver errors can contain credentials; never print them.
    process.stderr.write('Challenge seeding failed. Check MONGODB_URI and challenges/*/challenge.json.\n');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
