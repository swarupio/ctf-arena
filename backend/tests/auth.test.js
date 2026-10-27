import express, { Router } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app.js';
import { getCognitoVerifier } from '../src/config/cognito.js';
import { auth, createAuthMiddleware } from '../src/middleware/auth.js';
import { requireRole } from '../src/middleware/requireRole.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

// Prevent importing env.js or constructing an AWS verifier, even for default auth.
vi.mock('../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));

const player = { sub: 'cognito-player', email: 'player@example.com', 'cognito:groups': ['player'] };
const admin = { sub: 'cognito-admin', email: 'admin@example.com', 'cognito:groups': ['player', 'admin'] };
let verifier;
let testApp;

beforeEach(() => {
  vi.resetAllMocks();
  verifier = { verify: vi.fn() };
  const router = Router();
  router.get('/identity', createAuthMiddleware(verifier), (req, res) => res.json(req.user));
  router.get('/admin', createAuthMiddleware(verifier), requireRole('admin'), (req, res) => res.json(req.user));
  router.get('/default', auth, (req, res) => res.json(req.user));
  router.get('/unguarded-role', requireRole('admin'), (req, res) => res.sendStatus(200));
  testApp = express();
  testApp.use('/test', router);
  testApp.use(errorHandler);
});

describe('route authentication', () => {
  it('rejects missing authorization without calling the verifier', async () => {
    const response = await request(testApp).get('/test/identity').expect(401);
    expect(response.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'A valid Bearer token is required.' },
    });
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it.each(['Basic token', 'Bearer', 'Bearer token extra', 'Bearer token,other'])
  ('rejects malformed authorization: %s', async (header) => {
    const response = await request(testApp).get('/test/identity').set('Authorization', header).expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it.each(['invalid signature', 'token expired'])('rejects verification failure: %s', async (reason) => {
    verifier.verify.mockRejectedValueOnce(new Error(`${reason}: private-token-details`));
    const response = await request(testApp).get('/test/identity')
      .set('Authorization', 'Bearer test-token').expect(401);
    expect(response.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token.' },
    });
    expect(verifier.verify).toHaveBeenCalledWith('test-token');
  });

  it('attaches only verified identity fields for a player', async () => {
    verifier.verify.mockResolvedValueOnce({ ...player, role: 'admin', extra: 'private' });
    const response = await request(testApp).get('/test/identity')
      .set('Authorization', 'bearer test-token').expect(200);
    expect(response.body).toEqual({ cognitoSub: player.sub, email: player.email, role: 'player' });
  });

  it('rejects a player on an admin route', async () => {
    verifier.verify.mockResolvedValueOnce(player);
    const response = await request(testApp).get('/test/admin')
      .set('Authorization', 'Bearer test-token').expect(403);
    expect(response.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to access this resource.' },
    });
  });

  it('permits a verified admin', async () => {
    verifier.verify.mockResolvedValueOnce(admin);
    const response = await request(testApp).get('/test/admin')
      .set('Authorization', 'Bearer test-token').expect(200);
    expect(response.body).toEqual({ cognitoSub: admin.sub, email: admin.email, role: 'admin' });
  });

  it.each([undefined, [], ['superadmin'], ['Admin']])('defaults groups %j to player', async (groups) => {
    verifier.verify.mockResolvedValueOnce({ sub: player.sub, email: player.email, 'cognito:groups': groups });
    const response = await request(testApp).get('/test/identity')
      .set('Authorization', 'Bearer test-token').expect(200);
    expect(response.body.role).toBe('player');
  });

  it.each([
    { email: player.email },
    { sub: player.sub },
    { ...player, 'cognito:groups': 'admin' },
  ])('rejects malformed verified claims: %j', async (payload) => {
    verifier.verify.mockResolvedValueOnce(payload);
    const response = await request(testApp).get('/test/identity')
      .set('Authorization', 'Bearer test-token').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('uses the exported verifier getter for default auth', async () => {
    verifier.verify.mockResolvedValueOnce(player);
    getCognitoVerifier.mockReturnValueOnce(verifier);
    await request(testApp).get('/test/default').set('Authorization', 'Bearer test-token').expect(200);
    expect(getCognitoVerifier).toHaveBeenCalledOnce();
    expect(verifier.verify).toHaveBeenCalledWith('test-token');
  });

  it('denies a role check when authentication is absent', async () => {
    const response = await request(testApp).get('/test/unguarded-role').expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('keeps the real health route public without constructing a verifier', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(getCognitoVerifier).not.toHaveBeenCalled();
  });
});
