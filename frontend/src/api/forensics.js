import { apiRequest } from './client.js';

// HTTP for Forensics Desk (docs/API_SPEC.md "Forensics Desk"). Artefact pages are small; the viewers fetch more on demand.
const base = (track) => `/forensics/tracks/${encodeURIComponent(track)}`;

export const listTracks = () => apiRequest('/forensics/tracks');
export const getTrack = (track) => apiRequest(base(track));
export const getArtefact = (track, artefact, params = {}, { signal } = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  const suffix = query.size > 0 ? `?${query}` : '';
  return apiRequest(`${base(track)}/artefacts/${encodeURIComponent(artefact)}${suffix}`, { signal });
};
export const getInterviews = (track) => apiRequest(`${base(track)}/interviews`);
export const askSuspect = (track, suspectId, questionId) => apiRequest(`${base(track)}/interviews`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ suspectId, questionId }),
});
export const submitAnswer = (track, stage, answer) => apiRequest(`${base(track)}/stages/${stage}/answer`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ answer }),
});
