import { apiRequest } from './client.js';

// HTTP for the Web Exploit Lab (docs/WEB_EXPLOIT_LAB.md). Every target is simulated by the server: `sendLabRequest`
// only carries the request the player edited in the inspector; nothing runs in the browser.
const post = (path, body, signal) => apiRequest(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
});
const lab = (slug) => `/weblab/labs/${encodeURIComponent(slug)}`;

export const listLabs = () => apiRequest('/weblab/labs');
export const getLab = (slug) => apiRequest(lab(slug));
// Opening a hint is recorded and priced for the team, so it is a POST (idempotent per lab and level).
export const openLabHint = (slug, level) => post(`${lab(slug)}/hints/${encodeURIComponent(level)}`, {});
export const sendLabRequest = (slug, payload, { signal } = {}) => post(`${lab(slug)}/request`, payload, signal);
export const submitLabFlag = (slug, flag) => post(`${lab(slug)}/submit`, { flag });
