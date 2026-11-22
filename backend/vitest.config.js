import { defineConfig } from 'vitest/config';

// The suite is large and CPU heavy: terminal fuzz and generator sweeps (forensics timeline, crackme, terminal hard tests)
// take 10 to 40 seconds each on a loaded or small CI machine, and the first import of the whole app (vercel.test.js)
// takes about 15 s cold. 60 s keeps those from failing as "timed out" while a real hang still fails the job.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
