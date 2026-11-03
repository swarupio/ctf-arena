import { AppError } from '../utils/AppError.js';

// Roles are exact: pass every role that may use the route, e.g. requireRole('player', 'admin').
export function requireRole(...roles) {
  return function checkRole(req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'));
    }
    return next();
  };
}
