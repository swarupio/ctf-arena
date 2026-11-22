// Process lifecycle of the long-running server (Docker replicas, local dev). Vercel functions never run this: they have
// no listen(), and the platform owns their lifetime.
//
//  - SIGTERM / SIGINT (docker stop, deploys, Ctrl+C): stop accepting connections, let in-flight requests finish (up to
//    `timeoutMs`), stop the reaper and the request-count flush timer, save the buffered request counts, close MongoDB,
//    exit 0. A second signal exits immediately.
//  - uncaughtException / unhandledRejection: the process state is unknown, so log one line (class and code only, never the
//    message or stack: they can carry connection strings), try the same drain for a few seconds, exit 1 so the
//    orchestrator (docker restart policy) starts a fresh replica.
// Everything is injectable so tests can drive it with a fake process and server.
const DEFAULT_TIMEOUT_MS = 10_000;
const FATAL_TIMEOUT_MS = 5_000;

const describeError = (error) => {
  const name = typeof error?.name === 'string' ? error.name.slice(0, 60) : typeof error;
  const code = error?.code === undefined ? '' : ` code=${String(error.code).slice(0, 40)}`;
  return `${name}${code}`;
};

export function createLifecycle({
  server: initialServer = null,
  reaper,
  counter,
  mongoose,
  proc = process,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fatalTimeoutMs = FATAL_TIMEOUT_MS,
  log = (message) => proc.stderr.write(`${message}\n`),
} = {}) {
  let server = initialServer;
  let shuttingDown = null;

  const closeServer = () => new Promise((resolve) => {
    if (typeof server?.close !== 'function') { resolve(); return; }
    server.close(() => resolve());
    // Keep-alive sockets with no request in flight would hold close() open until they time out.
    server.closeIdleConnections?.();
  });

  const quietly = async (work) => { try { await work(); } catch { /* shutdown is best effort */ } };

  function shutdown(reason, exitCode = 0, limitMs = timeoutMs) {
    if (shuttingDown) { return shuttingDown; }
    log(`[shutdown] ${reason}: draining requests (limit ${Math.round(limitMs / 1000)}s)`);
    const forced = new Promise((resolve) => {
      const timer = setTimeout(() => {
        log('[shutdown] drain limit reached; closing remaining connections');
        server?.closeAllConnections?.();
        resolve();
      }, limitMs);
      timer.unref?.();
    });
    shuttingDown = (async () => {
      const closed = closeServer();
      reaper?.stop?.();
      counter?.stop?.();
      await Promise.race([closed, forced]);
      await quietly(() => counter?.flush?.());
      await quietly(() => mongoose?.disconnect?.());
      log('[shutdown] done');
      proc.exit(exitCode);
    })();
    return shuttingDown;
  }

  function fatal(kind, error) {
    log(`[fatal] ${kind} ${describeError(error)}`);
    return shutdown(kind, 1, fatalTimeoutMs);
  }

  function install() {
    for (const signal of ['SIGTERM', 'SIGINT']) {
      proc.on(signal, () => {
        if (shuttingDown) { proc.exit(1); return; }
        shutdown(signal);
      });
    }
    proc.on('uncaughtException', (error) => { fatal('uncaughtException', error); });
    proc.on('unhandledRejection', (reason) => { fatal('unhandledRejection', reason); });
  }

  // The HTTP server is created after the database is up; until then there is nothing to drain.
  const attach = (httpServer) => { server = httpServer; };

  return { install, attach, shutdown, fatal };
}
