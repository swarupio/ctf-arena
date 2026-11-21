import { listChallenges, listTeams } from '../api/admin.js';
import { useAdminData } from './hooks.js';

// Team and challenge dropdowns for filters: the first 100 by name (enough for a CTF), loaded once.
export function useTeamChallengeOptions() {
  const teams = useAdminData((signal) => listTeams({ limit: 100, sort: 'name' }, signal), []);
  const challenges = useAdminData((signal) => listChallenges({ limit: 100, sort: 'title' }, signal), []);
  return {
    teams: (teams.data?.items ?? []).map((team) => ({ value: team.id, label: team.name })),
    challenges: (challenges.data?.items ?? []).map((item) => ({ value: item.id, label: item.title })),
  };
}

// Select options with a first "all" entry. An id that came from the URL but is not in the list is kept as an option.
export function withCurrent(options, current, label) {
  const base = [{ value: '', label }, ...options];
  return current && !options.some((option) => option.value === current) ? [...base, { value: current, label: `ID ${current}` }] : base;
}
