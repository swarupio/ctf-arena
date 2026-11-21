import { apiGet } from './client.js';

export const getLeaderboard = () => apiGet('/leaderboard', { ttl: 3_000 });
export const getTimeline = () => apiGet('/leaderboard/timeline', { ttl: 3_000 });
