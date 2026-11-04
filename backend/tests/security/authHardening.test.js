// Token verification with the REAL aws-jwt-verify configured exactly like production (getCognitoVerifier) and a
// locally generated signing key: token_use, audience, issuer, expiry, algorithm confusion, tampering, malformed
// tokens and claim handling must all end in 401, and the role must come from an exact `admin` group match.
import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import { createAuthMiddleware } from '../../src/middleware/auth.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { requireRole } from '../../src/middleware/requireRole.js';

const POOL = env.COGNITO_USER_POOL_ID;
const CLIENT = env.COGNITO_CLIENT_ID;
const ISSUER = `https://cognito-idp.${POOL.split('_')[0]}.amazonaws.com/${POOL}`;
const KID = 'test-key-1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const claims = (over = {}) => ({
  sub: 'user-1', email: 'user1@example.com', token_use: 'id', aud: CLIENT, iss: ISSUER, iat: now() - 5, exp: now() + 600,
  'cognito:groups': ['player'], ...over,
});
function sign(payload, { key = privateKey, kid = KID, alg = 'RS256' } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' });
  const body = b64(payload);
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${signature}`;
}

let app;
beforeAll(() => {
  const verifier = getCognitoVerifier(); // same options as production: pool, client id, tokenUse 'id'
  verifier.cacheJwks({ keys: [jwk] }); // no network: the test key is the pool's key
  const auth = createAuthMiddleware(verifier);
  app = express();
  app.get('/whoami', auth, (req, res) => res.json(req.user));
  app.get('/admin-only', auth, requireRole('admin'), (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
});

const whoami = (token, path = '/whoami') => request(app).get(path).set('Authorization', `Bearer ${token}`);

describe('ID token verification (real library, production options)', () => {
  it('accepts a correctly signed ID token and derives identity from its claims', async () => {
    const response = await whoami(sign(claims()));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cognitoSub: 'user-1', email: 'user1@example.com', role: 'player' });
  });

  it.each([
    ['an access token (token_use access)', () => sign(claims({ token_use: 'access' }))],
    ['a token without token_use', () => sign(claims({ token_use: undefined }))],
    ['a token for another app client (audience)', () => sign(claims({ aud: 'some-other-client-id' }))],
    ['a token without an audience', () => sign(claims({ aud: undefined }))],
    ['a token from another user pool (issuer)', () => sign(claims({ iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_OtherPool' }))],
    ['a token from a look-alike issuer', () => sign(claims({ iss: `${ISSUER}/` }))],
    ['an expired token', () => sign(claims({ iat: now() - 7200, exp: now() - 1 }))],
    ['a token that is not valid yet (nbf)', () => sign(claims({ nbf: now() + 3600 }))],
    ['a token signed by another key under the same kid', () => sign(claims(), { key: attacker.privateKey })],
    ['a token with an unsigned header (alg none)', () => `${b64({ alg: 'none', typ: 'JWT', kid: KID })}.${b64(claims())}.`],
    ['a token with alg none and a dummy signature', () => `${b64({ alg: 'none', typ: 'JWT', kid: KID })}.${b64(claims())}.AAAA`],
    ['an HS256 token keyed with the public key (algorithm confusion)', () => {
      const head = b64({ alg: 'HS256', kid: KID, typ: 'JWT' });
      const body = b64(claims());
      const pem = publicKey.export({ type: 'spki', format: 'pem' });
      return `${head}.${body}.${createHmac('sha256', pem).update(`${head}.${body}`).digest('base64url')}`;
    }],
    ['a token with its payload swapped after signing (privilege escalation)', () => {
      const [head, , signature] = sign(claims()).split('.');
      return `${head}.${b64(claims({ 'cognito:groups': ['admin'] }))}.${signature}`;
    }],
    ['a token with a flipped signature bit', () => {
      const [head, body, signature] = sign(claims()).split('.');
      return `${head}.${body}.${signature.slice(0, -2)}${signature.endsWith('A') ? 'B' : 'A'}`;
    }],
    ['a two-part token', () => sign(claims()).split('.').slice(0, 2).join('.')],
    ['a four-part token', () => `${sign(claims())}.extra`],
    ['an empty-looking token', () => '..'],
    ['garbage', () => 'not.a.jwt'],
    ['a large token (just under the header limit)', () => `${'a'.repeat(4000)}.${'b'.repeat(4000)}.${'c'.repeat(4000)}`],
  ])('rejects %s with 401', async (label, make) => {
    const response = await whoami(make());
    expect(response.status, label).toBe(401);
    expect(response.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token.' } });
  });

  it('does not tolerate clock skew on expiry (no grace period)', async () => {
    expect((await whoami(sign(claims({ exp: now() + 30 })))).status).toBe(200);
    expect((await whoami(sign(claims({ exp: now() - 1 })))).status).toBe(401);
  });

  it('refuses a header above the HTTP header limit before the application sees it', async () => {
    const outcome = await request(app).get('/whoami').set('Authorization', `Bearer ${'a'.repeat(60_000)}`).then((r) => r.status, (e) => e.code);
    expect([431, 'ECONNRESET', 'EPIPE']).toContain(outcome);
  });

  it('answers with a fixed message that does not reveal why the token failed', async () => {
    const reasons = await Promise.all([
      whoami(sign(claims({ aud: 'x' }))), whoami(sign(claims({ exp: now() - 5 }))), whoami(sign(claims(), { key: attacker.privateKey })),
    ]);
    expect(new Set(reasons.map((response) => JSON.stringify(response.body))).size).toBe(1);
  });
});

describe('claims handling', () => {
  it.each([
    ['missing email', { email: undefined }], ['empty email', { email: '' }], ['malformed email', { email: 'not-an-email' }],
    ['email as number', { email: 5 }], ['missing sub', { sub: undefined }], ['empty sub', { sub: '' }], ['numeric sub', { sub: 12345 }],
    ['groups as a string', { 'cognito:groups': 'admin' }], ['groups with non-strings', { 'cognito:groups': [{ admin: true }] }],
    ['groups as an object', { 'cognito:groups': { admin: true } }],
  ])('rejects a validly signed token with %s (401)', async (label, over) => {
    const response = await whoami(sign(claims(over)));
    expect(response.status, label).toBe(401);
  });

  it.each([
    [undefined, 'player'], [[], 'player'], [['player'], 'player'], [['Admin'], 'player'], [['ADMIN'], 'player'], [[' admin'], 'player'],
    [['admin '], 'player'], [['administrators'], 'player'], [['admin-readonly'], 'player'], [['superadmin'], 'player'], [['a', 'dmin'], 'player'],
    [['admin'], 'admin'], [['player', 'admin'], 'admin'], [['admin', 'admin'], 'admin'],
  ])('maps groups %j to role %s (exact string match on "admin")', async (groups, role) => {
    const response = await whoami(sign(claims({ 'cognito:groups': groups })));
    expect(response.status).toBe(200);
    expect(response.body.role).toBe(role);
  });

  it('keeps the e-mail only as information: identity and role never depend on it', async () => {
    const lower = await whoami(sign(claims({ sub: 'sub-a', email: 'same@example.com' })));
    const upper = await whoami(sign(claims({ sub: 'sub-b', email: 'SAME@EXAMPLE.COM' })));
    expect(lower.body.cognitoSub).toBe('sub-a');
    expect(upper.body.cognitoSub).toBe('sub-b');
    const adminLookalike = await whoami(sign(claims({ email: 'admin@example.com' })), '/admin-only');
    expect(adminLookalike.status).toBe(403);
  });

  it('guards admin routes by role, with 403 for players and 200 only for the exact admin group', async () => {
    expect((await whoami(sign(claims()), '/admin-only')).status).toBe(403);
    expect((await whoami(sign(claims({ 'cognito:groups': ['admin'] })), '/admin-only')).status).toBe(200);
    expect((await request(app).get('/admin-only')).status).toBe(401);
  });
});

describe('Authorization header parsing', () => {
  it.each([
    [undefined], [''], ['Bearer'], ['Bearer '], ['Basic dXNlcjpwYXNz'], ['Token abc'], ['Bearer a b'], ['Bearer a,b'], ['Bearer\tabc def'],
    ['abc'], ['Bearer  '], ['BearerBearer abc'],
  ])('rejects the header %j (401) before any verification', async (header) => {
    let call = request(app).get('/whoami');
    if (header !== undefined) { call = call.set('Authorization', header); }
    const response = await call;
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('ignores tokens sent anywhere else (query string, cookie, other header)', async () => {
    const token = sign(claims());
    expect((await request(app).get(`/whoami?access_token=${token}`)).status).toBe(401);
    expect((await request(app).get('/whoami').set('Cookie', `token=${token}`)).status).toBe(401);
    expect((await request(app).get('/whoami').set('X-Access-Token', token)).status).toBe(401);
    expect((await request(app).get('/whoami').set('Proxy-Authorization', `Bearer ${token}`)).status).toBe(401);
  });
});
