import { env } from '../config/env.js';
import Instance, { ACTIVE_STATUSES } from '../models/Instance.js';
import { AppError } from '../utils/AppError.js';
import { dockerService as defaultDocker } from './dockerService.js';
import { expectedFlagFor } from './flagService.js';

const EXTEND_MINUTES = 15;
const minutes = (count) => count * 60 * 1000;

export const instanceUrl = (port) => `http://${env.PUBLIC_HOST}:${port}`;

export function serializeInstance(instance) {
  return {
    id: String(instance._id),
    challengeId: String(instance.challengeId),
    status: instance.status,
    url: instanceUrl(instance.port),
    expiresAt: instance.expiresAt,
    extended: Boolean(instance.extended),
  };
}

const isDuplicate = (error) => error?.code === 11000;

export function createInstanceService({ docker = defaultDocker, config = env } = {}) {
  // Claims a free port by inserting the instance document. The partial unique index
  // on port makes the claim atomic across replicas; collisions just try another port.
  async function claimPort({ team, user, challenge }) {
    const taken = new Set((await Instance.find({ status: { $in: ACTIVE_STATUSES } }, 'port')).map((i) => i.port));
    const free = [];
    for (let port = config.CHALLENGE_PORT_MIN; port <= config.CHALLENGE_PORT_MAX; port += 1) {
      if (!taken.has(port)) { free.push(port); }
    }
    // Random order so replicas that race rarely pick the same port first.
    for (let i = free.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]];
    }
    for (const port of free.slice(0, 25)) {
      try {
        return await Instance.create({
          teamId: team._id, challengeId: challenge._id, userId: user._id, port, status: 'starting',
          expiresAt: new Date(Date.now() + minutes(config.INSTANCE_TTL_MINUTES)),
        });
      } catch (error) {
        if (!isDuplicate(error)) { throw error; }
        if (error.keyPattern?.teamId) {
          throw new AppError(409, 'ALREADY_RUNNING', 'Your team already has an instance of this challenge.');
        }
      }
    }
    throw new AppError(503, 'NO_FREE_PORT', 'No free challenge ports are available. Try again shortly.');
  }

  async function start({ challenge, team, user }) {
    if (challenge.type !== 'docker') {
      throw new AppError(400, 'NOT_DOCKER_CHALLENGE', 'This challenge does not use an instance.');
    }
    const active = await Instance.countDocuments({ teamId: team._id, status: { $in: ACTIVE_STATUSES } });
    const existing = await Instance.exists({
      teamId: team._id, challengeId: challenge._id, status: { $in: ACTIVE_STATUSES },
    });
    if (existing) {
      throw new AppError(409, 'ALREADY_RUNNING', 'Your team already has an instance of this challenge.');
    }
    if (active >= config.MAX_INSTANCES_PER_TEAM) {
      throw new AppError(409, 'INSTANCE_LIMIT', `Your team can run at most ${config.MAX_INSTANCES_PER_TEAM} instances.`);
    }
    const instance = await claimPort({ team, user, challenge });
    // The check above is not atomic: parallel starts of different challenges can all pass it. Counting again after
    // our own claim is stored means at most MAX_INSTANCES_PER_TEAM claims survive; the others give their port back.
    if (await Instance.countDocuments({ teamId: team._id, status: { $in: ACTIVE_STATUSES } }) > config.MAX_INSTANCES_PER_TEAM) {
      await Instance.updateOne({ _id: instance._id }, { $set: { status: 'failed', stoppedAt: new Date() } });
      throw new AppError(409, 'INSTANCE_LIMIT', `Your team can run at most ${config.MAX_INSTANCES_PER_TEAM} instances.`);
    }
    try {
      const containerId = await docker.createInstance({
        instanceId: instance._id, teamId: team._id, challengeId: challenge._id,
        image: challenge.image, internalPort: challenge.internalPort, port: instance.port,
        flag: expectedFlagFor(challenge, { secret: config.FLAG_SECRET, teamId: team._id }),
      });
      return await Instance.findOneAndUpdate(
        { _id: instance._id, status: 'starting' },
        { $set: {
          status: 'running', containerId, expiresAt: new Date(Date.now() + minutes(config.INSTANCE_TTL_MINUTES)),
        } },
        { new: true },
      ) ?? instance;
    } catch (error) {
      // Free the port claim; the 'failed' status is outside the partial unique indexes.
      await Instance.updateOne({ _id: instance._id }, { $set: { status: 'failed', stoppedAt: new Date() } });
      if (error instanceof AppError) { throw error; }
      throw new AppError(500, 'SERVER_ERROR', 'Could not start the challenge instance.');
    }
  }

  // Atomically claims an active instance, removes its container, then marks it stopped.
  // Two replicas (or the reaper and a player) can race; only one proceeds.
  //
  // `force` also takes over an instance stuck in 'stopping': a replica that crashed after claiming it never
  // finishes, and the normal claim (starting|running) can no longer see it. Only the admin kill route passes
  // it. The player routes and the reaper keep the exclusive claim, so they never touch another caller's
  // stop in progress. Removing a container is idempotent (an already removed one is ignored), so a forced
  // stop overlapping a slow normal one is harmless.
  async function stop(instanceId, { force = false } = {}) {
    const claimable = force ? ['starting', 'running', 'stopping'] : ['starting', 'running'];
    const claimed = await Instance.findOneAndUpdate(
      { _id: instanceId, status: { $in: claimable } },
      { $set: { status: 'stopping' } },
      { new: true },
    );
    if (!claimed) { return null; }
    try {
      await docker.stopInstance(claimed.containerId);
    } catch (error) {
      // Put it back so the reaper retries instead of leaking the container.
      await Instance.updateOne({ _id: claimed._id, status: 'stopping' }, { $set: { status: 'running' } });
      throw error;
    }
    return Instance.findOneAndUpdate(
      { _id: claimed._id }, { $set: { status: 'stopped', stoppedAt: new Date() } }, { new: true },
    );
  }

  async function stopTeamChallenge(teamId, challengeId) {
    const instance = await Instance.findOne({
      teamId, challengeId, status: { $in: ['starting', 'running'] },
    });
    if (instance) { await stop(instance._id); }
  }

  async function stopTeamInstances(teamId) {
    const instances = await Instance.find({ teamId, status: { $in: ['starting', 'running'] } }, '_id');
    for (const instance of instances) { await stop(instance._id); }
  }

  async function stopChallengeInstances(challengeId) {
    const instances = await Instance.find({ challengeId, status: { $in: ['starting', 'running'] } }, '_id');
    for (const instance of instances) { await stop(instance._id); }
  }

  // One extension of 15 minutes, applied atomically so double clicks cannot extend twice.
  async function extend({ instanceId, teamId }) {
    const updated = await Instance.findOneAndUpdate(
      { _id: instanceId, teamId, status: 'running', extended: false },
      [{ $set: {
        extended: true,
        expiresAt: { $dateAdd: { startDate: '$expiresAt', unit: 'minute', amount: EXTEND_MINUTES } },
      } }],
      { new: true },
    );
    if (updated) { return updated; }
    const current = await Instance.findOne({ _id: instanceId, teamId });
    if (!current || !ACTIVE_STATUSES.includes(current.status)) {
      throw new AppError(404, 'NOT_FOUND', 'Instance not found.');
    }
    throw new AppError(409, 'CONFLICT', 'This instance has already been extended.');
  }

  return {
    start, stop, extend, stopTeamChallenge, stopTeamInstances, stopChallengeInstances,
  };
}

export const instanceService = createInstanceService();
