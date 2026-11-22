import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { FetchError, JwksValidationError, JwtExpiredError } from 'aws-jwt-verify/error';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { errorHandler, notFound } from '../src/middleware/errorHandler.js';
import { requestId } from '../src/middleware/requestId.js';
import { requestTimeout } from '../src/middleware/requestTimeout.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const STACK_MARKER = 'node_modules/secret-lib/index.js:12:3';
const withStack = (error) => { error.stack = `${error.name}: leak\n    at thing (${STACK_MARKER})`; return error; };

function miniApp(setup) {
  const app = express();
  app.use(requestId);
  setup(app);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe('request id', () => {
  const app = miniApp((a) => a.get('/ping', (req, res) => res.json({ id: req.id })));

  it('generates an id and returns it in X-Request-Id', async () => {
    const response = await request(app).get('/ping');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.id).toBe(response.headers['x-request-id']);
  });

  it('keeps a well-formed id from the caller (for example nginx) and replaces anything else', async () => {
    const kept = await request(app).get('/ping').set('X-Request-Id', 'abc-123_DEF.456');
    expect(kept.headers['x-request-id']).toBe('abc-123_DEF.456');
    for (const bad of ['short', 'x'.repeat(65), 'has space in it', 'semi;colon;value', '<script>alert(1)</script>']) {
      const response = await request(app).get('/ping').set('X-Request-Id', bad);
      expect(response.headers['x-request-id'], bad).not.toBe(bad);
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('puts the id into the one-line error log and nothing else of the request', async () => {
    const writes = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    const failing = miniApp((a) => a.get('/boom', () => { throw withStack(new Error('mongodb://u:hunter2@h/db')); }));
    const response = await request(failing).get('/boom?token=eyJsecret').set('X-Request-Id', 'req-id-00000001').set('Authorization', 'Bearer eyJsecret');
    expect(response.status).toBe(500);
    const log = writes.join('');
    expect(log).toBe('[error] GET /boom Error id=req-id-00000001\n');
  });
});

describe('request timeout', () => {
  const slow = (ms, fail) => miniApp((a) => {
    a.use(requestTimeout(30));
    a.get('/slow', async (req, res) => {
      await new Promise((resolve) => { setTimeout(resolve, ms); });
      if (fail) { throw new Error('late failure'); }
      res.json({ ok: true });
    });
  });

  it('answers 503 REQUEST_TIMEOUT in the standard shape when a handler is too slow', async () => {
    const response = await request(slow(150)).get('/slow');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: { code: 'REQUEST_TIMEOUT', message: 'The request took too long. Try again.' } });
  });

  it('lets a fast handler finish and does not crash when a late handler fails after the answer', async () => {
    expect((await request(slow(0)).get('/slow')).body).toEqual({ ok: true });
    const writes = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { writes.push(String(chunk)); return true; });
    const app = slow(120, true);
    const response = await request(app).get('/slow');
    expect(response.status).toBe(503);
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    expect(writes.join('')).toMatch(/^\[error\] GET \/slow Error/);
    expect(writes.join('')).not.toContain('late failure');
  });
});

describe('errors that escape route validation', () => {
  const cast = new mongoose.Error.CastError('ObjectId', 'not-an-id', '_id');
  const invalid = new mongoose.Error.ValidationError();
  const cases = [
    ['CastError', cast, 400, 'VALIDATION_ERROR'],
    ['mongoose ValidationError', invalid, 400, 'VALIDATION_ERROR'],
    ['duplicate key', Object.assign(new Error('E11000 duplicate key error collection: ctf.users index: x'), { code: 11000 }), 409, 'CONFLICT'],
    ['server selection failure', Object.assign(new Error('getaddrinfo ENOTFOUND cluster0.example.mongodb.net'), { name: 'MongooseServerSelectionError' }), 503, 'SERVICE_UNAVAILABLE'],
    ['network error', Object.assign(new Error('read ECONNRESET'), { name: 'MongoNetworkError' }), 503, 'SERVICE_UNAVAILABLE'],
    ['maxTimeMS expired', Object.assign(new Error('operation exceeded time limit'), { name: 'MongoServerError', code: 50 }), 503, 'SERVICE_UNAVAILABLE'],
    ['plain Error', new Error('anything'), 500, 'SERVER_ERROR'],
    ['non-error throw', 'a string', 500, 'SERVER_ERROR'],
  ];

  for (const [label, error, status, code] of cases) {
    it(`maps ${label} to ${status} ${code} with a fixed message and no internals`, async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      const thrown = typeof error === 'object' ? withStack(error) : error;
      const app = miniApp((a) => a.get('/x', () => { throw thrown; }));
      const response = await request(app).get('/x');
      expect(response.status).toBe(status);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(Object.keys(response.body)).toEqual(['error']);
      expect(Object.keys(response.body.error).sort()).toEqual(['code', 'message']);
      expect(response.body.error.code).toBe(code);
      expect(response.text).not.toMatch(/node_modules|\bat \S+ \(|E11000|ENOTFOUND|ECONNRESET|mongodb|cluster0|not-an-id|stack/i);
    });
  }

  it('never writes a stack trace to the response in production, also for errors raised by middleware and async handlers', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const app = express();
    app.set('env', 'production');
    app.use((req, res, next) => (req.path === '/mw' ? next(withStack(new Error('from middleware'))) : next()));
    app.get('/async', async () => { throw withStack(new TypeError('from async handler')); });
    app.use(errorHandler);
    for (const path of ['/mw', '/async']) {
      const response = await request(app).get(path);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } });
      expect(response.text).not.toContain(STACK_MARKER);
      expect(response.text).not.toContain('from ');
    }
  });

  it('unknown routes answer 404 NOT_FOUND in the standard shape, for any method', async () => {
    const app = miniApp(() => {});
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const response = await request(app)[method]('/api/does/not/exist');
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
    }
  });
});

describe('token verification failures', () => {
  const run = async (failure) => {
    const authenticate = createAuthMiddleware({ verify: async () => { throw failure; } });
    const next = vi.fn();
    await authenticate({ get: () => 'Bearer abc.def.ghi' }, {}, next);
    return next.mock.calls[0][0];
  };

  it('answers 503 (retry later) when the signing keys cannot be fetched, not 401', async () => {
    for (const failure of [new FetchError('https://cognito-idp.example/jwks.json', 'timeout'), new JwksValidationError('bad jwks')]) {
      const error = await run(failure);
      expect(error.status).toBe(503);
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      expect(error.message).not.toMatch(/cognito|jwks|timeout/i);
    }
  });

  it('keeps 401 for expired, malformed and every other token problem', async () => {
    for (const failure of [new JwtExpiredError('expired'), new Error('garbage'), 'string failure']) {
      const error = await run(failure);
      expect(error.status).toBe(401);
      expect(error.code).toBe('UNAUTHENTICATED');
    }
  });
});
