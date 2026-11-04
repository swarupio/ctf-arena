import { defineConfig } from 'vitest/config';

// The suite is large and runs many files in parallel; a few terminal tests execute hundreds of commands and can take
// several seconds on a busy CI machine even though each takes under a second alone.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
