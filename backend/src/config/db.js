import mongoose from 'mongoose';
import { warnIfIndexesMissing } from '../services/indexGuard.js';

// One connection per process. On Vercel a warm function instance serves many requests, so the in-flight
// connect is cached on globalThis and shared; a failed attempt is forgotten so the next request retries.
const cache = (globalThis.__ctfMongo ??= { promise: null });

// Serverless instances multiply, so each keeps a tiny pool and fails fast instead of buffering queries.
const serverlessOptions = process.env.VERCEL ? { maxPoolSize: 3, bufferCommands: false } : {};

// MONGOOSE_AUTO_INDEX (true/false/1/0) decides whether Mongoose builds the schema indexes when a model first
// connects. Default: on locally, off on Vercel, where every cold start would otherwise re-check every index.
// With it off, run `npm run db:indexes` (in backend/) after deploying a schema change: the unique indexes (users,
// teams, solves, ...) are part of correctness, so do not skip that step. Read from process.env here so
// config/env.js stays untouched; an unrecognised value falls back to the default.
export function autoIndexEnabled(source = process.env) {
  const value = String(source.MONGOOSE_AUTO_INDEX ?? '').trim().toLowerCase();
  if (value === 'true' || value === '1') { return true; }
  if (value === 'false' || value === '0') { return false; }
  return !source.VERCEL;
}

const baseOptions = { serverSelectionTimeoutMS: 10000, maxPoolSize: 10, minPoolSize: 1, maxIdleTimeMS: 60000 };

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function connectOnce(uri) {
  if (mongoose.connection?.readyState === 1) { return; }
  if (!cache.promise) {
    cache.promise = mongoose.connect(uri, { ...baseOptions, ...serverlessOptions, autoIndex: autoIndexEnabled() })
      .then(() => {
        process.stdout.write('MongoDB connected\n');
        // Diagnostics only, not awaited: one loud line when the unique indexes were never built.
        warnIfIndexesMissing().catch(() => {});
      })
      .finally(() => { cache.promise = null; });
  }
  await cache.promise;
}

// `attempts` > 1 (the long-running server does this at boot) retries a failed first connection with exponential
// backoff, so a database that is still starting or briefly unreachable does not make the container crash-loop.
// Default is one attempt: serverless handlers fail fast and retry on the next invocation. The driver error is never
// logged (it can carry the URI); the last one is rethrown for the caller to report.
export async function connectDB(uri, { attempts = 1, baseDelayMs = 1000, maxDelayMs = 10000, sleep = wait } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await connectOnce(uri);
    } catch (error) {
      if (attempt >= attempts) { throw error; }
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      process.stderr.write(`MongoDB connection attempt ${attempt}/${attempts} failed; retrying in ${Math.round(delay / 1000)}s.\n`);
      await sleep(delay);
    }
  }
}
