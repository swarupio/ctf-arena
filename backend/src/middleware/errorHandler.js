import { AppError } from '../utils/AppError.js';

export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Route not found.'));
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof AppError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message },
    });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' },
    });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'VALIDATION_ERROR', message: 'Request body exceeds the 100 KB limit.' },
    });
  }

  return res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' },
  });
}
