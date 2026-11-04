import { AppError } from '../utils/AppError.js';

export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Route not found.'));
}

// Operators need to see that a request failed, but a message or stack can carry connection strings or user input.
// So only the route, the error class and its code are written, never error.message, error.stack or the query string.
function logUnexpected(req, error) {
  try {
    const name = typeof error?.name === 'string' ? error.name.slice(0, 60) : 'Error';
    const code = error?.code === undefined ? '' : ` code=${String(error.code).slice(0, 40)}`;
    process.stderr.write(`[error] ${req.method} ${String(req.path).slice(0, 120)} ${name}${code}\n`);
  } catch {
    // Logging must never turn into a second failure.
  }
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

  // Other client errors raised by the body parser (unsupported charset or encoding, aborted upload, ...).
  // The message is fixed text: the library's own message can echo what the client sent.
  const status = error.status ?? error.statusCode;
  if (error.expose === true && Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({
      error: { code: 'VALIDATION_ERROR', message: 'The request could not be processed.' },
    });
  }

  logUnexpected(req, error);
  return res.status(500).json({
    error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' },
  });
}
