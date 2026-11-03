import { apiRequest } from './client.js';

export const getLeaderboard = () => apiRequest('/leaderboard');
export const getTimeline = () => apiRequest('/leaderboard/timeline');
