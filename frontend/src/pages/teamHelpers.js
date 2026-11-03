export function normalizeInviteCode(value) {
  return value.trim().toUpperCase();
}

export function validInviteCode(value) {
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(normalizeInviteCode(value));
}

export function validTeamName(value) {
  const length = value.trim().length;
  return length >= 3 && length <= 24;
}

export function teamErrorMessage(error, action) {
  switch (error?.code) {
    case 'CONFLICT':
      return action === 'create'
        ? 'You already belong to a team, or that team name is taken. Refresh your team or choose another name.'
        : 'You already belong to a team. Refresh your team before trying again.';
    case 'TEAM_FULL': return 'That team already has 3 members. Ask for an invite to another team.';
    case 'NOT_FOUND': return 'No team matches that invite code. Check the code and try again.';
    case 'VALIDATION_ERROR': return 'Check your details: team names need 3–24 characters and invite codes need 6 valid letters or digits.';
    case 'NO_TEAM': return 'You are not in a team yet. Create a team or join with an invite code.';
    default: return error?.message || 'Unable to reach the arena. Please try again.';
  }
}
