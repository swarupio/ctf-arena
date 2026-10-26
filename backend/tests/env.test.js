import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const example = Object.fromEntries(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((line) => line && !line.startsWith('#'))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

async function loadEnv(overrides = {}) {
  vi.resetModules();
  for (const [name, value] of Object.entries({ ...example, ...overrides })) {
    vi.stubEnv(name, value);
  }
  return import('../src/config/env.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('environment configuration', () => {
  it('loads root .env before backend/.env without overriding process variables', async () => {
    await loadEnv();
    expect(dotenv.config).toHaveBeenLastCalledWith({
      path: [
        fileURLToPath(new URL('../../.env', import.meta.url)),
        fileURLToPath(new URL('../.env', import.meta.url)),
      ],
      override: false,
      quiet: true,
    });
  });

  it.each([
    'mongodb://user:password@host1:27017,host2:27017/ctf_arena?replicaSet=rs0',
    'mongodb+srv://user:password@cluster.example.com/ctf_arena',
  ])('accepts MongoDB URI format %s', async (uri) => {
    const { env } = await loadEnv({ MONGODB_URI: uri });
    expect(env.MONGODB_URI).toBe(uri);
  });
  it('accepts all template variables and converts numeric settings', async () => {
    const { env } = await loadEnv();
    expect(Object.keys(env).sort()).toEqual(Object.keys(example).sort());
    expect(env.PORT).toBe(4000);
    expect(env.CHALLENGE_CPU_LIMIT).toBe(0.25);
  });

  it.each(Object.keys(example))('refuses startup when %s is missing', async (name) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('startup refused'); });
    await expect(loadEnv({ [name]: undefined })).rejects.toThrow('startup refused');
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr.mock.calls.flat().join('')).toContain(name);
  });

  it.each([
    { PORT: '0' },
    { CHALLENGE_PORT_MAX: '29999' },
    { CHALLENGE_CPU_LIMIT: '-1' },
    { MONGODB_URI: 'private-invalid-uri' },
    { FLAG_SECRET: 'private-short-secret' },
  ])('rejects invalid settings without logging their values: %j', async (overrides) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('startup refused'); });
    await expect(loadEnv(overrides)).rejects.toThrow('startup refused');
    const output = stderr.mock.calls.flat().join('');
    expect(output).toContain(Object.keys(overrides)[0]);
    expect(output).not.toContain('private-invalid-uri');
    expect(output).not.toContain('private-short-secret');
  });
});
