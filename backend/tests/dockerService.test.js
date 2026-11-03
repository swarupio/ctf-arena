import { describe, expect, it, vi } from 'vitest';
import { createDockerService } from '../src/services/dockerService.js';

const limits = {
  CHALLENGE_PORT_MIN: 30000, CHALLENGE_PORT_MAX: 30100, INSTANCE_TTL_MINUTES: 30,
  CHALLENGE_MEMORY_MB: 128, CHALLENGE_CPU_LIMIT: 0.25, CHALLENGE_PIDS_LIMIT: 64,
};

function fakeDocker() {
  const container = { id: 'abc123', start: vi.fn().mockResolvedValue(), remove: vi.fn().mockResolvedValue() };
  return {
    container,
    listNetworks: vi.fn().mockResolvedValue([]),
    createNetwork: vi.fn().mockResolvedValue(),
    createContainer: vi.fn().mockResolvedValue(container),
    getContainer: vi.fn().mockReturnValue(container),
    listContainers: vi.fn().mockResolvedValue([]),
  };
}
const args = {
  instanceId: 'i1', teamId: 't1', challengeId: 'c1', image: 'ctf/cookie-monster',
  internalPort: 8000, port: 30001, flag: 'CTF{x}',
};

describe('dockerService', () => {
  it('creates containers with every required isolation setting and label', async () => {
    const docker = fakeDocker();
    const id = await createDockerService({ docker, limits }).createInstance(args);
    expect(id).toBe('abc123');
    const config = docker.createContainer.mock.calls[0][0];
    expect(config.Env).toEqual(['FLAG=CTF{x}']);
    expect(config.HostConfig).toMatchObject({
      Memory: 128 * 1024 * 1024, NanoCpus: 250_000_000, PidsLimit: 64, CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'], ReadonlyRootfs: true, NetworkMode: 'ctf-challenges',
      PortBindings: { '8000/tcp': [{ HostPort: '30001' }] }, RestartPolicy: { Name: 'no' },
    });
    expect(config.HostConfig.Binds).toBeUndefined();
    expect(config.Labels).toMatchObject({
      'ctf.managed': 'true', 'ctf.instance': 'i1', 'ctf.team': 't1', 'ctf.challenge': 'c1', 'ctf.ttl_minutes': '30',
    });
    expect(docker.container.start).toHaveBeenCalled();
  });

  it('refuses images outside the ctf/ namespace and ports outside the range', async () => {
    const service = createDockerService({ docker: fakeDocker(), limits });
    await expect(service.createInstance({ ...args, image: 'alpine' })).rejects.toMatchObject({ status: 400 });
    await expect(service.createInstance({ ...args, image: 'evil/ctf/x' })).rejects.toMatchObject({ status: 400 });
    await expect(service.createInstance({ ...args, port: 80 })).rejects.toMatchObject({ status: 500 });
  });

  it('removes a container that fails to start', async () => {
    const docker = fakeDocker();
    docker.container.start.mockRejectedValue(new Error('boom'));
    await expect(createDockerService({ docker, limits }).createInstance(args)).rejects.toThrow('boom');
    expect(docker.container.remove).toHaveBeenCalledWith({ force: true });
  });

  it('stops idempotently and tolerates an already-missing container', async () => {
    const docker = fakeDocker();
    const service = createDockerService({ docker, limits });
    await service.stopInstance('abc123');
    docker.container.remove.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 404 }));
    await expect(service.stopInstance('abc123')).resolves.toBeUndefined();
    docker.container.remove.mockRejectedValue(Object.assign(new Error('denied'), { statusCode: 500 }));
    await expect(service.stopInstance('abc123')).rejects.toThrow('denied');
  });

  it('creates the challenge network once and tolerates a lost race', async () => {
    const docker = fakeDocker();
    const service = createDockerService({ docker, limits });
    await service.ensureNetwork();
    expect(docker.createNetwork).toHaveBeenCalledWith(expect.objectContaining({ Name: 'ctf-challenges' }));
    docker.createNetwork.mockRejectedValue(Object.assign(new Error('exists'), { statusCode: 409 }));
    await expect(service.ensureNetwork()).resolves.toBeUndefined();
    docker.listNetworks.mockResolvedValue([{ Name: 'ctf-challenges' }]);
    docker.createNetwork.mockClear();
    await service.ensureNetwork();
    expect(docker.createNetwork).not.toHaveBeenCalled();
  });

  it('lists only managed containers that carry an instance label', async () => {
    const docker = fakeDocker();
    docker.listContainers.mockResolvedValue([
      { Id: 'a', State: 'running', Labels: { 'ctf.instance': 'i1' } },
      { Id: 'b', State: 'running', Labels: {} },
    ]);
    expect(await createDockerService({ docker, limits }).listManagedContainers())
      .toEqual([{ id: 'a', instanceId: 'i1', state: 'running' }]);
    expect(docker.listContainers).toHaveBeenCalledWith({ all: true, filters: { label: ['ctf.managed=true'] } });
  });
});
