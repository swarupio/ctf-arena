// Defers loading of a rarely used router (and everything it imports) until its first request, which shrinks cold
// starts and idle memory on serverless hosts. The wrapper sits exactly where the router would have been mounted, so
// route order, middleware order and error handling are unchanged: a loading failure is passed to the error handler
// like any thrown error, and the next request tries again (a failed import is never cached).
//
// `match` (optional) limits loading to requests whose path could belong to the router. It is for routers mounted on a
// broad prefix such as '/api' that normally fall through: other requests skip the wrapper without loading anything.
// The router must answer the same requests either way, so `match` may only be broader than the router, never narrower.
export function lazyRouter(load, { match } = {}) {
  let pending = null;
  let router = null;

  const ensure = () => {
    pending ??= Promise.resolve()
      .then(load)
      .then((module) => { router = module.default ?? module; return router; })
      .catch((error) => { pending = null; throw error; });
    return pending;
  };

  function handler(req, res, next) {
    if (match && !match(req)) { return next(); }
    if (router) { return router(req, res, next); }
    return ensure().then((loaded) => loaded(req, res, next), next);
  }
  handler.ready = ensure;
  handler.isLoaded = () => router !== null;
  return handler;
}

// Under the test runner the routers are mounted directly (top-level await), so the security tests can introspect the
// real route stacks. Set CTF_LAZY_ROUTES=1 to exercise the lazy path in a test.
export async function mountable(load, options) {
  const eager = process.env.NODE_ENV === 'test' && process.env.CTF_LAZY_ROUTES !== '1';
  return eager ? (await load()).default : lazyRouter(load, options);
}
