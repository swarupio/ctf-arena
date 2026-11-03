import { apiRequest } from './client.js';

const send = (path, method, body) => apiRequest(path, {
  method,
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});

export const listChallenges = () => apiRequest('/challenges');
export const getChallenge = (id) => apiRequest(`/challenges/${id}`);
export const startInstance = (id) => send(`/challenges/${id}/instance`, 'POST');
export const stopInstance = (instanceId) => send(`/instances/${instanceId}`, 'DELETE');
export const extendInstance = (instanceId) => send(`/instances/${instanceId}/extend`, 'POST');
export const submitFlag = (id, flag) => send(`/challenges/${id}/submit`, 'POST', { flag });

export const adminList = () => apiRequest('/admin/challenges');
export const adminCreate = (body) => send('/admin/challenges', 'POST', body);
export const adminUpdate = (id, body) => send(`/admin/challenges/${id}`, 'PUT', body);
export const adminDelete = (id) => send(`/admin/challenges/${id}`, 'DELETE');
