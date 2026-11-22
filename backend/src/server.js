import mongoose from 'mongoose';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import app from './app.js';
import { reaper } from './services/reaper.js';
import { createLifecycle } from './lifecycle.js';

// The request counter is loaded through app.js already; it is imported on demand here so this file stays light.
const counter = {
  async flush() {
    const { replicaCounter } = await import('./middleware/requestCounter.js');
    replicaCounter.stop();
    await replicaCounter.flush();
  },
};
const lifecycle = createLifecycle({ reaper, counter, mongoose });
// Installed before the first await so a failure during startup is also logged safely and exits non-zero. Skipped under
// the test runner, which has its own handlers.
if (process.env.NODE_ENV !== 'test') { lifecycle.install(); }

try {
  // A database that is still starting is retried with backoff (about a minute in total) before giving up.
  await connectDB(env.MONGODB_URI, { attempts: 5 });
} catch {
  // Driver errors can contain credentials or the URI; never print them.
  process.stderr.write('MongoDB connection failed. Check MONGODB_URI, credentials, and network access.\n');
  process.exit(1);
}

const server = app.listen(env.PORT, () => {
  process.stdout.write(`Backend listening on port ${env.PORT}\n`);
});

// Slow-client protection and keep-alive limits. Nginx talks to the replicas with `Connection: close`, so there is no
// idle-socket race; the values are kept above nginx's 30 s proxy timeouts so a reply is never cut short by Node first.
server.requestTimeout = 35_000; // whole request (headers and body) must arrive within this time
server.headersTimeout = 15_000; // slow-loris guard: headers must arrive within this time
server.keepAliveTimeout = 65_000; // above the usual 60 s idle timeout of a load balancer
lifecycle.attach(server);

// Reconcile containers (only when Docker challenges are enabled) and reap expired instances. Runs on every replica; each stop is an atomic claim.
if (env.DOCKER_ENABLED !== false) { reaper.start(); }

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    process.stderr.write(`Backend could not start: port ${env.PORT} is already in use. Stop the other process or change PORT.\n`);
  } else if (error?.code === 'EACCES') {
    process.stderr.write(`Backend could not start: no permission to listen on port ${env.PORT}. Choose a port above 1024.\n`);
  } else {
    process.stderr.write('Backend could not start listening. Check PORT and whether it is already in use.\n');
  }
  process.exit(1);
});
