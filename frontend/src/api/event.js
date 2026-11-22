import { apiGet } from './client.js';

// Public schedule of the Arena event (no token needed): { name, phase, startsAt, endsAt, freezeAt, serverTime }.
// No client cache (only de-duplication of concurrent calls): the clock offset needs a fresh `serverTime`.
export const getEvent = (options) => apiGet('/event', options);

// Frozen scoreboard only: the caller's own live totals { frozen, asOf, team }.
export const getMyScore = (options) => apiGet('/leaderboard/me', { ttl: 3_000, ...options });
