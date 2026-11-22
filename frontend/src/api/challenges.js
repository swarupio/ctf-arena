import { apiGet, apiRequest, apiWrite } from './client.js';

const send = (path, method, body) => apiWrite(path, {
  method,
  ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});

export const listChallenges = (options) => apiGet('/challenges', { ttl: 5_000, swr: 60_000, ...options });
export const getChallenge = (id) => apiRequest(`/challenges/${id}`);
export const startInstance = (id) => send(`/challenges/${id}/instance`, 'POST');
export const stopInstance = (instanceId) => send(`/instances/${instanceId}`, 'DELETE');
export const extendInstance = (instanceId) => send(`/instances/${instanceId}/extend`, 'POST');
export const submitFlag = (id, flag) => send(`/challenges/${id}/submit`, 'POST', { flag });

