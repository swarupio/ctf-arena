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
  router.get('/either', createAuthMiddleware(verifier), requireRole('player', 'admin'), (req, res) => res.json(req.user));
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

  it.each(['Basic token', 'Bearer', 'Bearer token extra', 'Bearer token,other'])('rejects malformed authorization: %s', async (header) => {
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
    // mfa is null: this token has no amr claim, so nothing is known about a second factor.
    expect(response.body).toEqual({ cognitoSub: player.sub, email: player.email, role: 'player', mfa: null });
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
    expect(response.body).toEqual({ cognitoSub: admin.sub, email: admin.email, role: 'admin', mfa: null });
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
    { ...admin, amr: 'mfa' },
    { ...admin, amr: [1, 'mfa'] },
    { ...admin, amr: { mfa: true } },
    { ...admin, amr: null },
  ])('rejects malformed verified claims: %j', async (payload) => {
    verifier.verify.mockResolvedValueOnce(payload);
    const response = await request(testApp).get('/test/identity')
      .set('Authorization', 'Bearer test-token').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

describe('admin MFA (amr claim)', () => {
  const withAmr = (base, amr) => ({ ...base, amr });
  const call = (path, payload) => {
    verifier.verify.mockResolvedValueOnce(payload);
    return request(testApp).get(path).set('Authorization', 'Bearer test-token');
  };

  it('accepts an admin whose token proves MFA (amr contains mfa)', async () => {
    const response = await call('/test/admin', withAmr(admin, ['pwd', 'otp', 'mfa'])).expect(200);
    expect(response.body.mfa).toBe(true);
  });

  it.each([[['pwd']], [[]], [['pwd', 'otp']]])('rejects an admin whose token proves no MFA (amr %j) with 403 ADMIN_MFA_REQUIRED', async (amr) => {
    const response = await call('/test/admin', withAmr(admin, amr)).expect(403);
    expect(response.body.error.code).toBe('ADMIN_MFA_REQUIRED');
  });

  it('also refuses that admin on a route open to players and admins', async () => {
    const response = await call('/test/either', withAmr(admin, ['pwd'])).expect(403);
    expect(response.body.error.code).toBe('ADMIN_MFA_REQUIRED');
  });

  it('accepts a player without MFA and a player with MFA', async () => {
    expect((await call('/test/identity', withAmr(player, ['pwd'])).expect(200)).body.mfa).toBe(false);
    expect((await call('/test/either', withAmr(player, ['pwd'])).expect(200)).body.role).toBe('player');
    expect((await call('/test/either', withAmr(player, ['pwd', 'otp', 'mfa'])).expect(200)).body.mfa).toBe(true);
    expect((await call('/test/either', player).expect(200)).body.mfa).toBeNull();
  });

  it('keeps identity reachable for an admin without MFA so the app can explain why', async () => {
    const response = await call('/test/identity', withAmr(admin, ['pwd'])).expect(200);
    expect(response.body).toMatchObject({ role: 'admin', mfa: false });
  });

  it('allows an admin token with no amr claim by default (the claim cannot be relied on) and refuses it in strict mode', async () => {
    await call('/test/admin', admin).expect(200);
    const strict = Router();
    strict.get('/admin', createAuthMiddleware(verifier, { strictAdminMfa: true }), requireRole('admin'), (req, res) => res.json(req.user));
    strict.get('/player', createAuthMiddleware(verifier, { strictAdminMfa: true }), requireRole('player'), (req, res) => res.json(req.user));
    const strictApp = express();
    strictApp.use('/strict', strict);
    strictApp.use(errorHandler);
    verifier.verify.mockResolvedValueOnce(admin);
    const denied = await request(strictApp).get('/strict/admin').set('Authorization', 'Bearer test-token').expect(403);
    expect(denied.body.error.code).toBe('ADMIN_MFA_REQUIRED');
    verifier.verify.mockResolvedValueOnce(withAmr(admin, ['pwd', 'otp', 'mfa']));
    await request(strictApp).get('/strict/admin').set('Authorization', 'Bearer test-token').expect(200);
    verifier.verify.mockResolvedValueOnce(player);
    expect((await request(strictApp).get('/strict/player').set('Authorization', 'Bearer test-token').expect(200)).body.mfa).toBeNull();
  });

  it('never lets the amr claim grant a role', async () => {
    const response = await call('/test/admin', withAmr(player, ['pwd', 'otp', 'mfa'])).expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
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
