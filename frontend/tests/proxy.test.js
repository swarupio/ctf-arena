import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { test } from 'node:test';
import { createServer as createViteServer } from 'vite';

test('the Vite API proxy uses the target override and preserves X-Served-By', async () => {
  const upstream = createHttpServer((req, res) => {
    assert.equal(req.url, '/api/health');
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Served-By': 'proxy-test-backend' });
    res.end(JSON.stringify({ status: 'ok', db: 'up', replica: 'proxy-test-backend' }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const previous = process.env.API_PROXY_TARGET;
  process.env.API_PROXY_TARGET = `http://127.0.0.1:${upstream.address().port}`;
  let vite;
  try {
    vite = await createViteServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
    await vite.listen();
    const response = await fetch(`http://127.0.0.1:${vite.httpServer.address().port}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Served-By'), 'proxy-test-backend');
    assert.equal((await response.json()).replica, 'proxy-test-backend');
  } finally {
    if (previous === undefined) { delete process.env.API_PROXY_TARGET; }
    else { process.env.API_PROXY_TARGET = previous; }
    await vite?.close();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
