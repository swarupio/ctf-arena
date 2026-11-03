import { apiRequest } from './client.js';

export const getStats = () => apiRequest('/admin/stats');

export const getInstances = () => apiRequest('/admin/instances');
export const killInstance = (id) =>
  apiRequest(`/admin/instances/${id}/kill`, { method: 'POST' });

export const getTeams = () => apiRequest('/admin/teams');
export const banTeam = (id, banned) =>
  apiRequest(`/admin/teams/${id}/ban`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ banned }),
  });
