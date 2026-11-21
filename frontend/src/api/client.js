import { getToken } from '../auth/token.js';
import { createApiCache } from './cache.js';

export async function apiRequest(path, options = {}) {
  const token = await getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...options, headers });
  const replica = response.headers.get('X-Served-By');
  if (replica) window.dispatchEvent(new CustomEvent('api:served-by', { detail: replica }));
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? 'The API request failed.');
    error.status = response.status;
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}

const cache = createApiCache({ request: (path) => apiRequest(path) });

// Safe GETs only. Concurrent identical calls share one request; `ttl`/`swr` (ms) opt in to caching.
export const apiGet = cache.get;
export const clearApiCache = cache.clear;

// Writes drop the whole cache (success or failure), so a cached answer never hides your own change.
export async function apiWrite(path, options = {}) {
  try { return await apiRequest(path, options); }
  finally { cache.clear(); }
}
