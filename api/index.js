// Vercel serverless entry: wraps the Express app (backend/src/app.js) without calling listen().
// vercel.json rewrites /api/* here; req.url keeps the original path so Express routing works unchanged.
let ready;

async function load() {
  // Imported lazily so a bad configuration becomes a clean 500 instead of a crashed function.
  const [{ env }, { connectDB }, { default: app }] = await Promise.all([
    import('../backend/src/config/env.js'),
    import('../backend/src/config/db.js'),
    import('../backend/src/app.js'),
  ]);
  return { app, connectDB, uri: env.MONGODB_URI };
}

function fail(res, status, code, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: { code, message } }));
}

export default async function handler(req, res) {
  try {
    ready ??= load();
    const { app, connectDB, uri } = await ready;
    await connectDB(uri); // no-op while the cached connection is alive; reconnects after a drop
    return app(req, res);
  } catch (error) {
    ready = undefined; // retry on the next invocation
    // Names only: env.js has already logged which variables are invalid; driver errors may contain credentials.
    process.stderr.write(`[api] startup failed: ${error?.message === 'Invalid environment configuration' ? error.message : 'could not connect to MongoDB'}
`);
    return fail(res, 503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.');
  }
}
