import http from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Serverless entry (api/index.js) and the DOCKER_ENABLED gating added for Vercel.
const connectDB = vi.fn();
vi.mock('../src/config/db.js', () => ({ connectDB: (...args) => connectDB(...args) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  connectDB.mockReset();
});

async function loadHandler() {
  // No resetModules here: re-evaluating the models would recompile them on the shared mongoose instance.
  const { default: handler } = await import('../../api/index.js');
  return request(http.createServer(handler));
}

describe('serverless entry', () => {
  it('serves /api/health through the exported handler without listen()', async () => {
    connectDB.mockResolvedValue();
    const response = await (await loadHandler()).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(connectDB).toHaveBeenCalledOnce();
  });

  it('answers 503 JSON without leaking driver details when MongoDB is unreachable', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    connectDB.mockRejectedValue(new Error('mongodb://user:secret@host failed'));
    const response = await (await loadHandler()).get('/api/health').expect(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('retries the connection on the next request after a failure', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    connectDB.mockRejectedValueOnce(new Error('down')).mockResolvedValue();
    const agent = await loadHandler();
    await agent.get('/api/health').expect(503);
    await agent.get('/api/health').expect(200);
  });
});

describe('DOCKER_ENABLED', () => {
  async function loadEnv(overrides) {
    vi.resetModules();
    for (const [name, value] of Object.entries(overrides)) { vi.stubEnv(name, value); }
    return (await import('../src/config/env.js')).env;
  }

  it('defaults to true outside Vercel and accepts an explicit false', async () => {
    expect((await loadEnv({ VERCEL: '' })).DOCKER_ENABLED).toBe(true);
    expect((await loadEnv({ VERCEL: '', DOCKER_ENABLED: 'false' })).DOCKER_ENABLED).toBe(false);
  });

  it('defaults to false on Vercel and the container-only settings need no values', async () => {
    const env = await loadEnv({
      VERCEL: '1', PORT: '', PUBLIC_HOST: '', CHALLENGE_PORT_MIN: '', CHALLENGE_PORT_MAX: '',
      INSTANCE_TTL_MINUTES: '', MAX_INSTANCES_PER_TEAM: '', CHALLENGE_MEMORY_MB: '',
      CHALLENGE_CPU_LIMIT: '', CHALLENGE_PIDS_LIMIT: '',
      NODE_ENV: 'production', FLAG_SECRET: 'a-private-random-value-of-32-characters-x',
    });
    expect(env.DOCKER_ENABLED).toBe(false);
  });
});
