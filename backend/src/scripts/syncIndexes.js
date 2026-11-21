// Builds the MongoDB indexes declared in src/models/*. Needed when Mongoose autoIndex is off (the default on Vercel,
// see config/db.js): run it once after the first deploy and after every schema change.
//   npm run db:indexes           creates missing indexes (safe, never drops anything)
//   npm run db:indexes -- --prune  also drops indexes that are no longer in a schema (Model.syncIndexes)
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { isEntryPoint } from './seedChallenges.js';

const MODELS_DIR = new URL('../models/', import.meta.url);

export async function loadModels() {
  const files = readdirSync(fileURLToPath(MODELS_DIR)).filter((name) => name.endsWith('.js')).sort();
  const models = [];
  for (const file of files) { models.push((await import(new URL(file, MODELS_DIR).href)).default); }
  return models.filter((model) => typeof model?.createIndexes === 'function');
}

export async function syncAllIndexes(models, { prune = false } = {}) {
  const summary = [];
  for (const model of models) {
    if (prune) { await model.syncIndexes(); } else { await model.createIndexes(); }
    summary.push(model.modelName);
  }
  return summary;
}

if (isEntryPoint(import.meta.url)) {
  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    const done = await syncAllIndexes(await loadModels(), { prune: process.argv.includes('--prune') });
    process.stdout.write(`Indexes ready for ${done.length} models: ${done.join(', ')}.\n`);
  } catch {
    // Driver errors can contain credentials; never print them.
    process.stderr.write('Index sync failed. Check MONGODB_URI and Atlas access.\n');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
