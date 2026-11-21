import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { lazyRouter } from '../src/middleware/lazyRouter.js';

const routerModule = () => {
  const router = express.Router();
  router.get('/ping', (req, res) => res.json({ ok: true }));
  router.get('/boom', () => { throw new Error('inside the router'); });
  return { default: router };
};

function appWith(wrapper) {
  const app = express();
  app.use('/api/x', wrapper);
  app.use((req, res) => res.status(404).json({ fell: 'through' }));
  app.use((error, req, res, next) => res.status(500).json({ error: error.message })); // eslint-disable-line no-unused-vars
  return app;
}

describe('lazyRouter', () => {
  it('loads on the first request only and then serves every request from the same router', async () => {
    const load = vi.fn(async () => routerModule());
    const wrapper = lazyRouter(load);
    const app = appWith(wrapper);
    expect(load).not.toHaveBeenCalled();
    expect(wrapper.isLoaded()).toBe(false);
    await request(app).get('/api/x/ping').expect(200, { ok: true });
    await Promise.all([request(app).get('/api/x/ping').expect(200), request(app).get('/api/x/ping').expect(200)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(wrapper.isLoaded()).toBe(true);
  });

  it('shares one load between concurrent first requests', async () => {
    const load = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return routerModule(); });
    const app = appWith(lazyRouter(load));
    await Promise.all([1, 2, 3].map(() => request(app).get('/api/x/ping').expect(200)));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the router behaviour: unknown paths fall through, thrown errors reach the error handler', async () => {
    const app = appWith(lazyRouter(async () => routerModule()));
    await request(app).get('/api/x/missing').expect(404, { fell: 'through' });
    await request(app).get('/api/x/boom').expect(500, { error: 'inside the router' });
  });

  it('passes a failed load to the error handler and retries on the next request', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('import failed'))
      .mockResolvedValue(routerModule());
    const wrapper = lazyRouter(load);
    const app = appWith(wrapper);
    await request(app).get('/api/x/ping').expect(500, { error: 'import failed' });
    expect(wrapper.isLoaded()).toBe(false);
    await request(app).get('/api/x/ping').expect(200, { ok: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('skips loading for requests the match function rejects', async () => {
    const load = vi.fn(async () => routerModule());
    const app = appWith(lazyRouter(load, { match: (req) => req.path.startsWith('/ping') }));
    await request(app).get('/api/x/other').expect(404, { fell: 'through' });
    expect(load).not.toHaveBeenCalled();
    await request(app).get('/api/x/ping').expect(200);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
