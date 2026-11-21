import User from '../models/User.js';
import Team from '../models/Team.js';
import { AppError } from '../utils/AppError.js';

// Resolves the caller's persisted user and team (lean documents with only the fields callers use: two indexed reads). Role and team are decided on the server.
export async function getTeamContext(reqUser, { requireTeam = true, blockBanned = true } = {}) {
  const user = await User.findOne({ cognitoSub: reqUser.cognitoSub }, '_id teamId displayName banned', { lean: true });
  if (!user) {
    if (!requireTeam) { return { user: null, team: null }; }
    throw new AppError(404, 'NO_TEAM', 'You do not belong to a team.');
  }
  if (user.banned && blockBanned) { throw new AppError(403, 'USER_BANNED', 'Your account has been banned.'); }
  const team = user.teamId ? await Team.findById(user.teamId, '_id name banned memberIds captainId', { lean: true }) : null;
  if (requireTeam && !team) { throw new AppError(404, 'NO_TEAM', 'You do not belong to a team.'); }
  if (team?.banned && blockBanned) { throw new AppError(403, 'TEAM_BANNED', 'Your team has been banned.'); }
  return { user, team };
}
