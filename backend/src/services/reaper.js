import Instance from '../models/Instance.js';
import { dockerService as defaultDocker } from './dockerService.js';
import { instanceService as defaultInstances } from './instanceService.js';

const log = (message) => process.stdout.write(`[reaper] ${message}\n`);

export function createReaper({
  docker = defaultDocker, instances = defaultInstances, intervalMs = 60_000, graceMs = 2 * 60_000,
} = {}) {
  let timer;

  // Stops every expired instance. Each stop is an atomic claim, so replicas never fight.
  async function reapExpired() {
    const expired = await Instance.find({
      status: { $in: ['starting', 'running'] }, expiresAt: { $lte: new Date() },
    }, '_id');
    let stopped = 0;
    for (const { _id } of expired) {
      try {
        if (await instances.stop(_id)) { stopped += 1; }
      } catch {
        log('could not stop an expired instance; will retry next run');
      }
    }
    return stopped;
  }

  // Startup reconciliation between the database and the real containers.
  async function reconcile() {
    const containers = await docker.listManagedContainers();
    const activeInstances = await Instance.find({ status: { $in: ['starting', 'running'] } });
    const byId = new Map(activeInstances.map((instance) => [String(instance._id), instance]));
    let orphans = 0;
    for (const container of containers) {
      if (!byId.has(container.instanceId)) {
        await docker.stopInstance(container.id).catch(() => {});
        orphans += 1;
      }
    }
    const liveContainers = new Set(containers.map((container) => container.id));
    let missing = 0;
    for (const instance of activeInstances) {
      const young = Date.now() - new Date(instance.createdAt).getTime() < graceMs;
      if (instance.status === 'running' && !liveContainers.has(instance.containerId) && !young) {
        await Instance.updateOne(
          { _id: instance._id, status: 'running' }, { $set: { status: 'stopped', stoppedAt: new Date() } },
        );
        missing += 1;
      }
    }
    return { orphans, missing };
  }

  async function start() {
    try {
      await docker.ensureNetwork();
      const result = await reconcile();
      log(`reconciled: ${result.orphans} orphan containers removed, ${result.missing} missing marked stopped`);
    } catch {
      log('Docker is unavailable; challenge instances will not work until it is reachable');
    }
    timer = setInterval(() => {
      reapExpired().catch(() => log('reap run failed'));
    }, intervalMs);
    timer.unref();
  }

  function stop() { clearInterval(timer); }

  return { reapExpired, reconcile, start, stop };
}

export const reaper = createReaper();
