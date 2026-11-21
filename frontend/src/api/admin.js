// Admin API v2 client (docs/API_SPEC.md "Admin API v2"). Reads go through apiGet (de-duplicated, never cached),
// writes through apiWrite (which clears the cache). Only imported by the lazy admin chunks.
import { apiDownload, apiGet, apiWrite } from './client.js';
import { buildQuery, listQueryString, path } from '../admin/query.js';
import { csvPath, filenameFromDisposition, saveBlob } from '../admin/download.js';

const json = (method, body) => ({
  method,
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});
const read = (url, signal) => apiGet(url, { signal });
const write = (url, method, body) => apiWrite(url, json(method, body));

// ---- stats
export const getOverview = (days, signal) => read(`/admin/stats/overview${buildQuery({ days })}`, signal);

// ---- users
export const listUsers = (state, signal) => read(`/admin/users${listQueryString(state)}`, signal);
export const getUser = (id, signal) => read(path('admin', 'users', id), signal);
export const setUserBanned = (id, banned, reason) => write(`${path('admin', 'users', id)}/ban`, 'PATCH', { banned, ...(reason ? { reason } : {}) });
export const removeUserFromTeam = (id) => write(`${path('admin', 'users', id)}/remove-from-team`, 'POST', {});
export const resetUserTerminal = (id) => write(`${path('admin', 'users', id)}/reset-terminal`, 'POST', { confirm: true });

// ---- teams (any query parameter selects the paginated form, listQueryString always sends page)
export const listTeams = (state, signal) => read(`/admin/teams${listQueryString(state)}`, signal);
export const getTeam = (id, signal) => read(path('admin', 'teams', id), signal);
export const setTeamBanned = (id, banned) => write(`${path('admin', 'teams', id)}/ban`, 'PATCH', { banned });
export const renameTeam = (id, name) => write(path('admin', 'teams', id), 'PATCH', { name });
export const deleteTeam = (id) => write(`${path('admin', 'teams', id)}?confirm=true`, 'DELETE');
export const removeTeamMember = (teamId, userId) => write(path('admin', 'teams', teamId, 'members', userId), 'DELETE');
export const regenerateInviteCode = (id) => write(`${path('admin', 'teams', id)}/invite-code/regenerate`, 'POST', {});
export const adjustTeamScore = (id, body) => write(`${path('admin', 'teams', id)}/score-adjustments`, 'POST', body);

// ---- challenges
export const listChallenges = (state, signal) => read(`/admin/challenges${listQueryString(state)}`, signal);
export const createChallenge = (body) => write('/admin/challenges', 'POST', body);
export const updateChallenge = (id, body) => write(path('admin', 'challenges', id), 'PUT', body);
export const deleteChallenge = (id) => write(path('admin', 'challenges', id), 'DELETE');
export const setChallengeVisible = (id, visible) => write(`${path('admin', 'challenges', id)}/visibility`, 'PATCH', { visible });
export const duplicateChallenge = (id, body = {}) => write(`${path('admin', 'challenges', id)}/duplicate`, 'POST', body);
export const getChallengeStats = (id, signal) => read(`${path('admin', 'challenges', id)}/stats`, signal);
export const resetChallengeSolves = (id, clearSubmissions) => write(`${path('admin', 'challenges', id)}/reset-solves`, 'POST', { confirm: true, clearSubmissions: Boolean(clearSubmissions) });
export const importChallenges = (challenges, { mode = 'skip', dryRun = false } = {}) => write('/admin/challenges/import', 'POST', { challenges, mode, dryRun });

// ---- solves and submissions
export const listSolves = (state, signal) => read(`/admin/solves${listQueryString(state)}`, signal);
export const deleteSolve = (id, reason) => write(`${path('admin', 'solves', id)}${buildQuery({ reason })}`, 'DELETE');
export const listSubmissions = (state, signal) => read(`/admin/submissions${listQueryString(state)}`, signal);

// ---- integrity
export const getIntegritySummary = (signal) => read('/admin/integrity/summary', signal);
export const listIntegrityUsers = (state, signal) => read(`/admin/integrity/users${listQueryString(state)}`, signal);
export const resolveIntegrity = (userId, note) => write(`${path('admin', 'integrity', userId)}/resolve`, 'POST', { note });
export const dismissIntegrity = (userId) => write(path('admin', 'integrity', userId), 'DELETE');

// ---- instances
export const listInstances = (state, signal) => read(`/admin/instances${listQueryString(state)}`, signal);
export const killInstance = (id) => write(`${path('admin', 'instances', id)}/kill`, 'POST');

// ---- audit and settings
export const listAudit = (state, signal) => read(`/admin/audit${listQueryString(state)}`, signal);
export const getSettings = (signal) => read('/admin/settings', signal);
export const saveSettings = (patch) => write('/admin/settings', 'PUT', patch);

// ---- downloads: fetched with the Authorization header and saved from a Blob (no token in any URL)
export async function downloadFile(url, fallbackName) {
  const { blob, disposition } = await apiDownload(url);
  const filename = filenameFromDisposition(disposition, fallbackName);
  saveBlob(blob, filename);
  return filename;
}

export const downloadCsv = (name, state) => downloadFile(
  `${csvPath(name)}${state ? buildQuery({ q: String(state.q ?? '').trim(), sort: state.sort, ...state.filters }) : ''}`, `${name}.csv`,
);
export const exportChallenges = () => downloadFile('/admin/challenges/export', 'challenges.json');
