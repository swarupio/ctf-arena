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
    // The request id (middleware/requestId.js) is generated or format-checked, so it is safe to print.
    const id = typeof req.id === 'string' ? ` id=${req.id.slice(0, 64)}` : '';
    process.stderr.write(`[error] ${req.method} ${String(req.path).slice(0, 120)} ${name}${code}${id}\n`);
  } catch {
    // Logging must never turn into a second failure.
  }
}

// Database trouble that is the server's or the network's fault, not the caller's: answer 503 so clients and
// orchestrators can tell "try again" from a bug. Matched on error class and code only (never the message).
const DB_UNAVAILABLE_NAME = /^Mongo(?:ose)?(?:Network|ServerSelection|Topology|NotConnected|WaitQueue|PoolCleared|PoolClosed)/;
const MAX_TIME_MS_EXPIRED = 50;
const isDatabaseUnavailable = (error) => DB_UNAVAILABLE_NAME.test(String(error?.name))
  || error?.code === MAX_TIME_MS_EXPIRED || error?.codeName === 'MaxTimeMSExpired';

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    // The answer is complete (for example the request timeout already replied): a late failure of the handler is
    // only logged. A half-written response is handed to Express, which closes the connection.
    if (res.writableEnded) { logUnexpected(req, error); return undefined; }
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

  // Errors that escaped the route-level validation: a malformed id or value is the caller's mistake (400), a unique
  // index hit is a conflict (409), an unreachable or overloaded database is 503. All messages are fixed text.
  if (error?.name === 'CastError' || error?.name === 'ValidationError' || error?.name === 'ZodError') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'A value in the request has the wrong format.' },
    });
  }

  if (error?.code === 11000) {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'That value is already in use.' },
    });
  }

  if (isDatabaseUnavailable(error)) {
    logUnexpected(req, error);
    return res.status(503).json({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable.' },
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
