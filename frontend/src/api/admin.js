import { apiRequest } from './client.js';
import { ADMIN_PATHS } from '../pages/adminHelpers.js';

const send = (path, method, body) => apiRequest(path, {
  method,
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});

export const getStats = () => apiRequest(ADMIN_PATHS.stats);
export const listInstances = () => apiRequest(ADMIN_PATHS.instances);
export const killInstance = (instanceId) => send(ADMIN_PATHS.kill(instanceId), 'POST');
export const listTeams = () => apiRequest(ADMIN_PATHS.teams);
export const setTeamBanned = (teamId, banned) => send(ADMIN_PATHS.ban(teamId), 'PATCH', { banned });

export async function fetchDashboard() {
  const [stats, instances, teams] = await Promise.all([getStats(), listInstances(), listTeams()]);
  return { stats, instances, teams };
}
