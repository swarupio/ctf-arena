// FLAG_SECRET is the root of every team flag (HMAC). The value in .env.example is public, so a production start with
// it must be refused, without ever printing the secret.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const example = Object.fromEntries(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((line) => line && !line.startsWith('#'))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

async function loadEnv(overrides) {
  vi.resetModules();
  for (const [name, value] of Object.entries({ ...example, ...overrides })) { vi.stubEnv(name, value); }
  return import('../../src/config/env.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('FLAG_SECRET in production', () => {
  const PLACEHOLDERS = [example.FLAG_SECRET, 'replace_with_a_private_random_secret_value', 'PLACEHOLDER-secret-0123456789-abcdefghijkl', 'please_changeme_0123456789abcdefghijklmnop'];

  it.each(PLACEHOLDERS)('refuses to start with the public placeholder %s and names only the variable', async (secret) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('startup refused'); });
    await expect(loadEnv({ NODE_ENV: 'production', FLAG_SECRET: secret })).rejects.toThrow('startup refused');
    expect(exit).toHaveBeenCalledWith(1);
    const output = stderr.mock.calls.flat().join('');
    expect(output).toContain('FLAG_SECRET');
    expect(output).not.toContain(secret);
  });

  it('starts in production with a private random secret', async () => {
    const secret = randomBytes(32).toString('hex'); // a fresh private-looking secret each run, never stored in source
    const { env } = await loadEnv({ NODE_ENV: 'production', FLAG_SECRET: secret });
    expect(env.FLAG_SECRET).toBe(secret);
    expect(env.NODE_ENV).toBe('production');
  });

  it('still allows the placeholder on a laptop and in tests (NODE_ENV development or test)', async () => {
    for (const NODE_ENV of ['development', 'test']) {
      const { env } = await loadEnv({ NODE_ENV, FLAG_SECRET: example.FLAG_SECRET });
      expect(env.NODE_ENV).toBe(NODE_ENV);
    }
  });

  it('keeps refusing secrets shorter than 32 characters in every mode', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('startup refused'); });
    for (const NODE_ENV of ['development', 'production']) {
      await expect(loadEnv({ NODE_ENV, FLAG_SECRET: 'too-short-secret' })).rejects.toThrow('startup refused');
    }
  });
});
