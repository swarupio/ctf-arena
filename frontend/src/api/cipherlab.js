import { apiRequest } from './client.js';

// HTTP for Cipher Lab (docs/CIPHER_LAB.md). The server never sends plaintexts; answers are checked there.
const post = (path, body) => apiRequest(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const level = (id) => `/cipherlab/levels/${encodeURIComponent(id)}`;

export const getOverview = () => apiRequest('/cipherlab/overview');
export const getLevel = (id) => apiRequest(level(id));
export const openHint = (id) => post(`${level(id)}/hints`, {});
export const submitAnswer = (id, answer) => post(`${level(id)}/answer`, { answer });
