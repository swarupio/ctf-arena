import { createRequire } from 'node:module';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// dockerode is CommonJS and heavy (about 7 MB of heap): load it on first real use, never on a cold start or when
// Docker challenges are disabled (Vercel). createRequire keeps createDockerService synchronous.
const loadDocker = () => createRequire(import.meta.url)('dockerode');

export const CHALLENGE_NETWORK = 'ctf-challenges';
export const MANAGED_LABEL = 'ctf.managed';
// Containers of different teams must not reach each other over the bridge (docs/SECURITY.md).
export const ICC_OPTION = 'com.docker.network.bridge.enable_icc';

const IMAGE_PATTERN = /^ctf\/[a-z0-9][a-z0-9._-]*(?::[A-Za-z0-9._-]+)?$/;

// All Docker access for challenges goes through here. Callers pass only validated values;
// there is no way to supply a command, volume or arbitrary env from outside.
export function createDockerService({ docker = new (loadDocker())(), limits = env } = {}) {
  let warnedIcc = false;

  async function ensureNetwork() {
    const existing = await docker.listNetworks({ filters: { name: [CHALLENGE_NETWORK] } });
    const found = existing.find((network) => network.Name === CHALLENGE_NETWORK);
    if (found) {
      // An existing network keeps the options it was created with. Never delete it automatically: it may hold
      // running challenge containers. Tell the owner once per process.
      if (found.Options?.[ICC_OPTION] !== 'false' && !warnedIcc) {
        warnedIcc = true;
        process.stderr.write(`[docker] network ${CHALLENGE_NETWORK} allows container-to-container traffic (${ICC_OPTION} is not false). Stop the challenge containers, then remove and recreate it (docker network rm ${CHALLENGE_NETWORK}); see docs/SECURITY.md.
`);
      }
      return;
    }
    try {
      await docker.createNetwork({
        Name: CHALLENGE_NETWORK, Driver: 'bridge', Labels: { [MANAGED_LABEL]: 'true' }, Options: { [ICC_OPTION]: 'false' },
      });
    } catch (error) {
      // Another replica created it first.
      if (error.statusCode !== 409) { throw error; }
    }
  }

  async function createInstance({ instanceId, teamId, challengeId, image, internalPort, port, flag }) {
    if (!IMAGE_PATTERN.test(image)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Challenge image must start with ctf/.');
    }
    if (port < limits.CHALLENGE_PORT_MIN || port > limits.CHALLENGE_PORT_MAX) {
      throw new AppError(500, 'SERVER_ERROR', 'Port is outside the allowed challenge range.');
    }
    const containerPort = `${internalPort}/tcp`;
    const container = await docker.createContainer({
      Image: image,
      Env: [`FLAG=${flag}`],
      ExposedPorts: { [containerPort]: {} },
      Labels: {
        [MANAGED_LABEL]: 'true',
        'ctf.instance': String(instanceId),
        'ctf.team': String(teamId),
        'ctf.challenge': String(challengeId),
        'ctf.ttl_minutes': String(limits.INSTANCE_TTL_MINUTES),
      },
      HostConfig: {
        Memory: limits.CHALLENGE_MEMORY_MB * 1024 * 1024,
        MemorySwap: limits.CHALLENGE_MEMORY_MB * 1024 * 1024,
        NanoCpus: Math.round(limits.CHALLENGE_CPU_LIMIT * 1e9),
        PidsLimit: limits.CHALLENGE_PIDS_LIMIT,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': 'rw,size=16m' },
        NetworkMode: CHALLENGE_NETWORK,
        PortBindings: { [containerPort]: [{ HostPort: String(port) }] },
        RestartPolicy: { Name: 'no' },
      },
    });
    try {
      await container.start();
    } catch (error) {
      await container.remove({ force: true }).catch(() => {});
      throw error;
    }
    return container.id;
  }

  // Idempotent: a container that is already gone counts as stopped.
  async function stopInstance(containerId) {
    if (!containerId) { return; }
    try {
      await docker.getContainer(containerId).remove({ force: true });
    } catch (error) {
      if (error.statusCode !== 404) { throw error; }
    }
  }

  async function listManagedContainers() {
    const containers = await docker.listContainers({
      all: true, filters: { label: [`${MANAGED_LABEL}=true`] },
    });
    return containers
      .filter((container) => container.Labels?.['ctf.instance'])
      .map((container) => ({
        id: container.Id,
        instanceId: container.Labels['ctf.instance'],
        state: container.State,
      }));
  }

  return { ensureNetwork, createInstance, stopInstance, listManagedContainers };
}

let shared;
export const dockerService = new Proxy({}, {
  get(_target, property) {
    shared ??= createDockerService();
    return shared[property];
  },
});
