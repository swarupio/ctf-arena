// Upper bound for one request. A handler stuck on a slow dependency answers 503 in the standard error shape instead of
// leaving the client (and nginx, 30 s) waiting. It sits below the platform limits: Vercel maxDuration is 15 s.
// The work itself cannot be cancelled; Mongo operations carry their own maxTimeMS (config/mongoLimits.js).
// Under the test runner a busy machine can legitimately take long (the slow terminal tests), so the default is relaxed there.
export const DEFAULT_REQUEST_TIMEOUT_MS = process.env.NODE_ENV === 'test' ? 120_000 : process.env.VERCEL ? 12_000 : 25_000;

export function requestTimeout(ms = DEFAULT_REQUEST_TIMEOUT_MS) {
  return function limit(req, res, next) {
    const timer = setTimeout(() => {
      // A response that already started streaming cannot be replaced.
      if (res.headersSent) { return; }
      // Answered here, not through next(): calling next() a second time would skip the still-running handler's own
      // error path, and its late failure would reach Express's default handler instead of ours.
      res.status(503).json({ error: { code: 'REQUEST_TIMEOUT', message: 'The request took too long. Try again.' } });
    }, ms);
    timer.unref?.();
    const clear = () => clearTimeout(timer);
    res.once('finish', clear);
    res.once('close', clear);
    next();
  };
}
