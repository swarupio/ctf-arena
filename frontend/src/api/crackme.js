import { apiRequest } from './client.js';

// HTTP for Crackme Arcade (docs/CRACKME_ARCADE.md). The browser runs the program locally to explore it; the server
// runs its own copy of the VM on a submitted input and decides whether it is accepted.
const post = (path, body) => apiRequest(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const level = (id) => `/crackme/levels/${encodeURIComponent(id)}`;

export const getOverview = () => apiRequest('/crackme/overview');
export const getLevel = (id) => apiRequest(level(id));
export const openHint = (id) => post(`${level(id)}/hints`, {});
export const submitInput = (id, answer) => post(`${level(id)}/answer`, { answer });
export const submitPatch = (id, edits) => post(`${level(id)}/patch`, { edits });
