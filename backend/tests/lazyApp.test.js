// The real app with lazy routers enabled (CTF_LAZY_ROUTES=1): nothing heavy is loaded by a cold start, a request for
// a lazy router loads it, and routing/auth answers are the same as with the routers mounted directly.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ shell: 0, cipher: 0 }));
vi.mock('../src/terminal/shell.js', () => { loaded.shell += 1; return { execute: vi.fn(), complete: vi.fn() }; });
vi.mock('../src/games/cipherlab/service.js', async (importOriginal) => { loaded.cipher += 1; return importOriginal(); });

let app;
let replicaCounter;
beforeAll(async () => {
  process.env.CTF_LAZY_ROUTES = '1';
  ({ default: app } = await import('../src/app.js'));
  ({ replicaCounter } = await import('../src/middleware/requestCounter.js'));
});
afterAll(() => { delete process.env.CTF_LAZY_ROUTES; replicaCounter?.stop(); });

describe('lazy routers in the real app', () => {
  it('does not load the terminal engine or a game for unrelated requests', async () => {
    await request(app).get('/api/health');
    await request(app).get('/api/nothing-here').expect(404);
    await request(app).get('/api/feedback').expect(404); // starts like /feed but is not the social router
    expect(loaded.shell).toBe(0);
    expect(loaded.cipher).toBe(0);
  });

  it('loads a router on its first request and still answers 401 without a token', async () => {
    await request(app).get('/api/terminal/modes').expect(401);
    expect(loaded.shell).toBe(1);
    await request(app).get('/api/cipherlab/overview').expect(401);
    expect(loaded.cipher).toBe(1);
    await request(app).get('/api/terminal/modes').expect(401);
    expect(loaded.shell).toBe(1);
  });

  it('keeps guarding the other lazy mounts and the fall-through to 404', async () => {
    for (const path of ['/api/weblab/overview', '/api/forensics/tracks', '/api/admin/users', '/api/admin/stats', '/api/feed', '/api/me/achievements']) {
      const response = await request(app).get(path);
      expect([path, response.status]).toEqual([path, 401]);
    }
    await request(app).get('/api/admin/definitely-not-a-route').expect(404);
    await request(app).get('/api/terminal/easy/exec').expect(401);
  });
});
