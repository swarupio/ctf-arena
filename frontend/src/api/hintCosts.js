import { apiGet } from './client.js';

// GET /api/hint-costs (public): { enabled, nudge, approach, walkthrough, maxPercent }. The server caches it for 10 s.
export const getHintCosts = () => apiGet('/hint-costs', { ttl: 10_000 });
