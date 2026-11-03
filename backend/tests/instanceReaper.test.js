import { beforeEach, describe, expect, it, vi } from 'vitest';
import Instance from '../src/models/Instance.js';
import { createInstanceService } from '../src/services/instanceService.js';
import { createReaper } from '../src/services/reaper.js';

vi.mock('../src/models/Instance.js', () => ({
  default: {
    find: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn(), updateOne: vi.fn(),
    create: vi.fn(), countDocuments: vi.fn(), exists: vi.fn(),
  },
  ACTIVE_STATUSES: ['starting', 'running', 'stopping'],
}));
vi.mock('../src/config/env.js', () => ({ env: { PUBLIC_HOST: 'localhost' } }));

const config = {
  CHALLENGE_PORT_MIN: 30000, CHALLENGE_PORT_MAX: 30003, INSTANCE_TTL_MINUTES: 30,
  MAX_INSTANCES_PER_TEAM: 2, FLAG_SECRET: 'y'.repeat(40),
};
const challenge = { _id: 'c1', slug: 'cookie-monster', type: 'docker', image: 'ctf/cookie-monster', internalPort: 8000 };
const team = { _id: 't1' };
const user = { _id: 'u1' };
const duplicate = (field) => Object.assign(new Error('dup'), { code: 11000, keyPattern: { [field]: 1 } });

let docker;
let service;
beforeEach(() => {
  vi.resetAllMocks();
  docker = { createInstance: vi.fn().mockResolvedValue('container-1'), stopInstance: vi.fn().mockResolvedValue() };
  service = createInstanceService({ docker, config });
  Instance.find.mockResolvedValue([]);
  Instance.countDocuments.mockResolvedValue(0);
  Instance.exists.mockResolvedValue(null);
  Instance.create.mockImplementation(async (doc) => ({ _id: 'i1', ...doc }));
  Instance.findOneAndUpdate.mockImplementation(async (filter, update) => ({ _id: 'i1', port: 30000, ...update.$set }));
});

describe('instanceService.start', () => {
  it('claims a port, starts the container with the team flag and marks it running', async () => {
    const instance = await service.start({ challenge, team, user });
    expect(instance.status).toBe('running');
    expect(instance.containerId).toBe('container-1');
    const call = docker.createInstance.mock.calls[0][0];
    expect(call.flag).toMatch(/^CTF\{cookie_monster_[0-9a-f]{12}\}$/);
    expect(call.port).toBeGreaterThanOrEqual(30000);
    expect(call.port).toBeLessThanOrEqual(30003);
  });

  it('skips ports that another replica claimed first and never reuses a claimed one', async () => {
    const tried = [];
    Instance.create.mockImplementation(async (doc) => {
      tried.push(doc.port);
      if (tried.length < 3) { throw duplicate('port'); }
      return { _id: 'i1', ...doc };
    });
    await service.start({ challenge, team, user });
    expect(new Set(tried).size).toBe(3);
  });

  it('reports NO_FREE_PORT when every port is taken', async () => {
    Instance.find.mockResolvedValue([30000, 30001, 30002, 30003].map((port) => ({ port })));
    await expect(service.start({ challenge, team, user })).rejects.toMatchObject({ status: 503, code: 'NO_FREE_PORT' });
    expect(docker.createInstance).not.toHaveBeenCalled();
  });

  it('enforces the team limit, one instance per challenge and docker-only challenges', async () => {
    Instance.countDocuments.mockResolvedValue(2);
    await expect(service.start({ challenge, team, user })).rejects.toMatchObject({ code: 'INSTANCE_LIMIT' });
    Instance.countDocuments.mockResolvedValue(1);
    Instance.exists.mockResolvedValue({ _id: 'x' });
    await expect(service.start({ challenge, team, user })).rejects.toMatchObject({ code: 'ALREADY_RUNNING' });
    await expect(service.start({ challenge: { ...challenge, type: 'static' }, team, user }))
      .rejects.toMatchObject({ code: 'NOT_DOCKER_CHALLENGE' });
  });

  it('maps a racing duplicate team claim to ALREADY_RUNNING', async () => {
    Instance.create.mockRejectedValue(duplicate('teamId'));
    await expect(service.start({ challenge, team, user })).rejects.toMatchObject({ code: 'ALREADY_RUNNING' });
  });

  it('marks the instance failed (freeing its port) when Docker fails', async () => {
    docker.createInstance.mockRejectedValue(new Error('daemon down'));
    await expect(service.start({ challenge, team, user })).rejects.toMatchObject({ status: 500 });
    expect(Instance.updateOne).toHaveBeenCalledWith({ _id: 'i1' }, { $set: expect.objectContaining({ status: 'failed' }) });
  });
});

describe('instanceService.stop and extend', () => {
  it('only the caller that wins the atomic claim stops the container', async () => {
    Instance.findOneAndUpdate.mockResolvedValueOnce(null);
    expect(await service.stop('i1')).toBeNull();
    expect(docker.stopInstance).not.toHaveBeenCalled();
    Instance.findOneAndUpdate.mockResolvedValueOnce({ _id: 'i1', containerId: 'c-1' })
      .mockResolvedValueOnce({ _id: 'i1', status: 'stopped' });
    expect((await service.stop('i1')).status).toBe('stopped');
    expect(docker.stopInstance).toHaveBeenCalledWith('c-1');
  });

  it('restores the instance for a retry when removal fails', async () => {
    Instance.findOneAndUpdate.mockResolvedValueOnce({ _id: 'i1', containerId: 'c-1' });
    docker.stopInstance.mockRejectedValue(new Error('busy'));
    await expect(service.stop('i1')).rejects.toThrow('busy');
    expect(Instance.updateOne).toHaveBeenCalledWith({ _id: 'i1', status: 'stopping' }, { $set: { status: 'running' } });
  });

  it('extends once with a single atomic update and rejects a second extension', async () => {
    Instance.findOneAndUpdate.mockResolvedValueOnce({ _id: 'i1', extended: true });
    await service.extend({ instanceId: 'i1', teamId: 't1' });
    const [filter, pipeline] = Instance.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'i1', teamId: 't1', status: 'running', extended: false });
    expect(pipeline[0].$set.expiresAt.$dateAdd).toMatchObject({ unit: 'minute', amount: 15 });
    Instance.findOneAndUpdate.mockResolvedValueOnce(null);
    Instance.findOne.mockResolvedValue({ status: 'running', extended: true });
    await expect(service.extend({ instanceId: 'i1', teamId: 't1' })).rejects.toMatchObject({ status: 409 });
    Instance.findOneAndUpdate.mockResolvedValueOnce(null);
    Instance.findOne.mockResolvedValue(null);
    await expect(service.extend({ instanceId: 'i1', teamId: 't1' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('reaper', () => {
  it('stops every expired instance through the atomic claim', async () => {
    const instances = { stop: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(null) };
    Instance.find.mockResolvedValue([{ _id: 'a' }, { _id: 'b' }]);
    const reaper = createReaper({ docker: {}, instances });
    expect(await reaper.reapExpired()).toBe(1);
    expect(Instance.find.mock.calls[0][0]).toMatchObject({ status: { $in: ['starting', 'running'] } });
  });

  it('keeps going when one stop fails', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const instances = { stop: vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({}) };
    Instance.find.mockResolvedValue([{ _id: 'a' }, { _id: 'b' }]);
    expect(await createReaper({ docker: {}, instances }).reapExpired()).toBe(1);
  });

  it('reconciles orphans and missing containers on startup', async () => {
    const docker = {
      listManagedContainers: vi.fn().mockResolvedValue([
        { id: 'k1', instanceId: 'i1' }, { id: 'k-orphan', instanceId: 'gone' },
      ]),
      stopInstance: vi.fn().mockResolvedValue(),
    };
    const old = new Date(Date.now() - 10 * 60_000);
    Instance.find.mockResolvedValue([
      { _id: 'i1', status: 'running', containerId: 'k1', createdAt: old },
      { _id: 'i2', status: 'running', containerId: 'k-missing', createdAt: old },
      { _id: 'i3', status: 'running', containerId: 'k-new', createdAt: new Date() },
    ]);
    const result = await createReaper({ docker, instances: {} }).reconcile();
    expect(result).toEqual({ orphans: 1, missing: 1 });
    expect(docker.stopInstance).toHaveBeenCalledWith('k-orphan');
    expect(Instance.updateOne).toHaveBeenCalledTimes(1);
    expect(Instance.updateOne.mock.calls[0][0]).toEqual({ _id: 'i2', status: 'running' });
  });
});
