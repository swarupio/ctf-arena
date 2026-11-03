import User from '../models/User.js';
import Team from '../models/Team.js';
import { AppError } from '../utils/AppError.js';

// Resolves the caller's persisted user and team. Role and team are decided on the server.
export async function getTeamContext(reqUser, { requireTeam = true, blockBanned = true } = {}) {
  const user = await User.findOne({ cognitoSub: reqUser.cognitoSub });
  if (!user) { throw new AppError(404, 'NO_TEAM', 'You do not belong to a team.'); }
  const team = user.teamId ? await Team.findById(user.teamId) : null;
  if (requireTeam && !team) { throw new AppError(404, 'NO_TEAM', 'You do not belong to a team.'); }
  if (team?.banned && blockBanned) { throw new AppError(403, 'TEAM_BANNED', 'Your team has been banned.'); }
  return { user, team };
}
