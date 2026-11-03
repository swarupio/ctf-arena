import Challenge from '../models/Challenge.js';
import Instance, { ACTIVE_STATUSES } from '../models/Instance.js';
import ReplicaStat from '../models/ReplicaStat.js';
import Solve from '../models/Solve.js';
import Submission from '../models/Submission.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { instanceService as defaultInstances, serializeInstance } from './instanceService.js';

const ids = (documents, field) => [...new Set(documents.map((document) => String(document[field])))];

// Explicit allow-lists below: flags, flag hashes, container ids, invite codes and emails never appear.
export function createAdminService({ instances = defaultInstances } = {}) {
  async function getStats() {
    const [users, teams, solves, submissions, wrong, activeInstances, replicas] = await Promise.all([
      User.countDocuments({}),
      Team.countDocuments({}),
      Solve.countDocuments({}),
      Submission.countDocuments({}),
      Submission.countDocuments({ correct: false }),
      Instance.countDocuments({ status: { $in: ACTIVE_STATUSES } }),
      ReplicaStat.find({}, 'replica requests'),
    ]);
    const requestsByReplica = {};
    for (const { replica, requests } of replicas) { requestsByReplica[replica] = requests; }
    return {
      users,
      teams,
      solves,
      submissions,
      wrongRate: submissions === 0 ? 0 : wrong / submissions,
      activeInstances,
      requestsByReplica,
    };
  }

  async function listActiveInstances() {
    const active = await Instance.find({ status: { $in: ACTIVE_STATUSES } }).sort({ createdAt: 1 });
    if (active.length === 0) { return []; }
    const [teams, challenges] = await Promise.all([
      Team.find({ _id: { $in: ids(active, 'teamId') } }, 'name'),
      Challenge.find({ _id: { $in: ids(active, 'challengeId') } }, 'slug title'),
    ]);
    const teamById = new Map(teams.map((team) => [String(team._id), team]));
    const challengeById = new Map(challenges.map((challenge) => [String(challenge._id), challenge]));
    return active.map((instance) => {
      const team = teamById.get(String(instance.teamId));
      const challenge = challengeById.get(String(instance.challengeId));
      // A deleted team or challenge leaves the reference dangling; show it as unknown instead of failing.
      return {
        id: String(instance._id),
        status: instance.status,
        port: instance.port,
        url: serializeInstance(instance).url,
        expiresAt: instance.expiresAt,
        extended: Boolean(instance.extended),
        team: { id: String(instance.teamId), name: team?.name ?? null },
        challenge: {
          id: String(instance.challengeId), slug: challenge?.slug ?? null, title: challenge?.title ?? null,
        },
      };
    });
  }

  async function killInstance(instanceId) {
    const stopped = await instances.stop(instanceId);
    if (!stopped) { throw new AppError(404, 'NOT_FOUND', 'Active instance not found.'); }
  }

  async function listTeams() {
    const [teams, totals] = await Promise.all([
      Team.find({}, 'name memberIds banned'),
      Solve.aggregate([{ $group: { _id: '$teamId', score: { $sum: '$points' }, solves: { $sum: 1 } } }]),
    ]);
    const totalsByTeam = new Map(totals.map((row) => [String(row._id), row]));
    return teams
      .map((team) => {
        const total = totalsByTeam.get(String(team._id));
        return {
          id: String(team._id),
          name: team.name,
          members: team.memberIds?.length ?? 0,
          score: total?.score ?? 0,
          banned: Boolean(team.banned),
          solves: total?.solves ?? 0,
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  // Banning first flips the flag (so the team cannot start anything new), then stops what is running.
  // It is idempotent: if stopping fails the call errors and an admin can simply repeat it.
  async function setTeamBanned(teamId, banned) {
    const team = await Team.findOneAndUpdate({ _id: teamId }, { $set: { banned } }, { new: true });
    if (!team) { throw new AppError(404, 'NOT_FOUND', 'Team not found.'); }
    if (banned) { await instances.stopTeamInstances(team._id); }
    return { id: String(team._id), name: team.name, banned: Boolean(team.banned) };
  }

  return { getStats, listActiveInstances, killInstance, listTeams, setTeamBanned };
}

export const adminService = createAdminService();
