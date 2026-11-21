import { apiGet } from './client.js';

// Public banner and platform flags (no token needed). Cached briefly so several mounts share one request.
export const getAnnouncement = (options) => apiGet('/announcement', { ttl: 10_000, ...options });
