import { apiRequest } from './client.js';

export const getFeed = (limit = 12) => apiRequest(`/feed?limit=${encodeURIComponent(limit)}`);
export const getDaily = () => apiRequest('/daily');
export const getPlayerProfile = (id) => apiRequest(`/players/${encodeURIComponent(id)}/profile`);
export const getMyAchievements = () => apiRequest('/me/achievements');
