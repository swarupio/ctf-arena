import { apiRequest } from './client.js';
import {
  normalizeComplete, normalizeExec, normalizeModes, normalizeProgress, normalizeSubmit,
} from '../terminal/adapters.js';

// HTTP for the Arena Terminal game (docs/TERMINAL_GAME.md section 8). Every response goes through the adapters in
// terminal/adapters.js, so the UI only ever sees the normalised shapes. `signal` lets Ctrl+C abort a request.

const post = (path, body, signal) => apiRequest(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
});
const base = (mode) => `/terminal/${encodeURIComponent(mode)}`;

export const listModes = async () => normalizeModes(await apiRequest('/terminal/modes'));
export const getProgress = async (mode) => normalizeProgress(await apiRequest(`${base(mode)}/progress`), mode);
export const execCommand = async (mode, { command, cwd }, { signal } = {}) => (
  normalizeExec(await post(`${base(mode)}/exec`, { command, cwd }, signal)));
export const completePath = async (mode, { partial, cwd }, { signal } = {}) => (
  normalizeComplete(await post(`${base(mode)}/complete`, { partial, cwd }, signal)));
export const submitCode = async (mode, flag, { signal } = {}) => (
  normalizeSubmit(await post(`${base(mode)}/submit`, { flag }, signal)));
