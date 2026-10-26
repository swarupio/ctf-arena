import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import app from './app.js';

try {
  await connectDB(env.MONGODB_URI);
} catch {
  // Driver errors can contain credentials or the URI; never print them.
  process.stderr.write('MongoDB connection failed. Check MONGODB_URI, credentials, and network access.\n');
  process.exit(1);
}

const server = app.listen(env.PORT, () => {
  process.stdout.write(`Backend listening on port ${env.PORT}\n`);
});

server.on('error', () => {
  process.stderr.write('Backend could not start listening. Check PORT and whether it is already in use.\n');
  process.exit(1);
});
