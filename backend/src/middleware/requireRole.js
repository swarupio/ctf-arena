import { AppError } from '../utils/AppError.js';

// Roles are exact: pass every role that may use the route, e.g. requireRole('player', 'admin').
export function requireRole(...roles) {
  return function checkRole(req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'));
    }
    // Fail closed: an admin whose token provably lacks a second factor gets no admin or player-route access at all (/api/me
    // stays open so the app can show why). See docs/SECURITY.md for what the token can and cannot prove.
    if (req.user.role === 'admin' && req.user.mfa === false) {
      return next(new AppError(403, 'ADMIN_MFA_REQUIRED', 'Admin accounts must sign in with an authenticator app. Turn it on in your profile, then log in again.'));
    }
    return next();
  };
}
