// Registers challenges/*/challenge.json in MongoDB. Run inside the backend image by deploy/deploy.sh:
//   docker compose run --rm --no-deps -v ./challenges:/challenges:ro \
//     -v ./deploy/seed-challenges.mjs:/app/seed-challenges.mjs:ro backend node /app/seed-challenges.mjs
//
// Why not `npm run seed:challenges`? backend/src/scripts/seedChallenges.js only runs when it is the
// entry file, and it checks that with `file:///` + argv[1]. On Linux that is `file:////app/...`, which
// never matches, so the npm script exits silently without doing anything. This wrapper imports the
// same functions, so behaviour is identical (repeatable, updates in place, keeps solve counts).
import mongoose from 'mongoose';
import { env } from '/app/src/config/env.js';
import { loadDefinitions, seedChallenges } from '/app/src/scripts/seedChallenges.js';

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
