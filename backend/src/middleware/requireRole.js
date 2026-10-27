import { AppError } from '../utils/AppError.js';

export function requireRole(role) {
  return function checkRole(req, res, next) {
    if (!req.user || req.user.role !== role) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource.'));
    }
    return next();
  };
}
