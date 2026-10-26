import { env } from './config/env.js';
import app from './app.js';

const server = app.listen(env.PORT, () => {
  process.stdout.write(`Backend listening on port ${env.PORT}\n`);
});

server.on('error', () => {
  process.stderr.write('Backend could not start listening. Check PORT and whether it is already in use.\n');
  process.exit(1);
});
