import mongoose from 'mongoose';

// One connection per process. On Vercel a warm function instance serves many requests, so the in-flight
// connect is cached on globalThis and shared; a failed attempt is forgotten so the next request retries.
const cache = (globalThis.__ctfMongo ??= { promise: null });

// Serverless instances multiply, so each keeps a tiny pool and fails fast instead of buffering queries.
const serverlessOptions = process.env.VERCEL ? { maxPoolSize: 3, bufferCommands: false } : {};

const baseOptions = { serverSelectionTimeoutMS: 10000, maxPoolSize: 10, minPoolSize: 1, maxIdleTimeMS: 60000 };

export async function connectDB(uri) {
  if (mongoose.connection?.readyState === 1) { return; }
  if (!cache.promise) {
    cache.promise = mongoose.connect(uri, { ...baseOptions, ...serverlessOptions })
      .then(() => { process.stdout.write('MongoDB connected\n'); })
      .finally(() => { cache.promise = null; });
  }
  await cache.promise;
}
