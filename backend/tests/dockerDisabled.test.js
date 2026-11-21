import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playerSummary } from '../src/routes/challenges.js';
import { createInstanceService } from '../src/services/instanceService.js';
import { createRequestCounter } from '../src/middleware/requestCounter.js';

vi.mock('../src/models/Instance.js', () => ({
  default: { find: vi.fn(), create: vi.fn(), countDocuments: vi.fn(), exists: vi.fn() },
  ACTIVE_STATUSES: ['starting', 'running', 'stopping'],
}));

const config = {
  CHALLENGE_PORT_MIN: 30000, CHALLENGE_PORT_MAX: 30003, INSTANCE_TTL_MINUTES: 30,
  MAX_INSTANCES_PER_TEAM: 2, FLAG_SECRET: 'y'.repeat(40),
};
const challenge = { _id: 'c1', slug: 'cookie-monster', type: 'docker', image: 'ctf/cookie-monster', internalPort: 8000 };

describe('instances with DOCKER_ENABLED=false', () => {
  let docker;
  beforeEach(() => { docker = { createInstance: vi.fn(), stopInstance: vi.fn() }; });

  it('refuses to start an instance with 503 DOCKER_DISABLED and never touches Docker', async () => {
    const service = createInstanceService({ docker, config: { ...config, DOCKER_ENABLED: false } });
    await expect(service.start({ challenge, team: { _id: 't1' }, user: { _id: 'u1' } })).rejects.toMatchObject({
      status: 503, code: 'DOCKER_DISABLED',
      message: 'Docker challenges are only available when the platform is run locally.',
    });
    expect(docker.createInstance).not.toHaveBeenCalled();
  });
});

describe('challenge summaries', () => {
  const base = { _id: 'c1', slug: 's', title: 't', category: 'web', difficulty: 'easy', points: 100, solveCount: 0 };

  it('marks docker challenges with dockerAvailable and leaves other types unchanged', () => {
    const docker = playerSummary({ ...base, type: 'docker' }, new Set());
    expect(typeof docker.dockerAvailable).toBe('boolean');
    expect(playerSummary({ ...base, type: 'static' }, new Set())).not.toHaveProperty('dockerAvailable');
  });
});

describe('request counter on serverless', () => {
  it('counts nothing and still calls next when disabled', () => {
    const counter = createRequestCounter({ model: { updateOne: vi.fn() }, disabled: true, log: vi.fn() });
    const next = vi.fn();
    counter.middleware({ path: '/api/teams' }, {}, next);
    expect(next).toHaveBeenCalledOnce();
    expect(counter.pending()).toBe(0);
  });
});
