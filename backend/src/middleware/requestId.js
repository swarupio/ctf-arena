import { randomUUID } from 'node:crypto';

// Correlation id for one request: echoed in the X-Request-Id response header and in the one-line error log, so an
// operator can match a user's report to a log line. A caller (nginx, a load test) may supply its own id; it is only
// kept when it is short and made of safe characters, so a hostile value can never forge log lines or headers.
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestId(req, res, next) {
  const supplied = req.get('x-request-id');
  req.id = typeof supplied === 'string' && SAFE_ID.test(supplied) ? supplied : randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}
