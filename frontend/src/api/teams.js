// The request function is supplied by the caller; all HTTP goes through api/client.js.
export async function fetchTeamState(request) {
  const [teamResult, profileResult] = await Promise.allSettled([
    request('/teams/me'), request('/me'),
  ]);
  if (profileResult.status === 'rejected') throw profileResult.reason;
  const profile = profileResult.value;
  if (profile.team === null || (teamResult.status === 'rejected' && teamResult.reason.code === 'NO_TEAM')) {
    return { team: null, profile: { ...profile, team: null } };
  }
  if (teamResult.status === 'fulfilled') return { team: teamResult.value, profile };
  throw teamResult.reason;
}
