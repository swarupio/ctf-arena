// Lab (medium boss): a hand-rolled token whose verifier honours alg "none". Not our real Cognito/JWT verifier.
import { bearer, bodyParams, json, notFound, strField } from '../http.js';
import { checkSignature, decodeToken, signToken } from '../token.js';

const IAT = 1700000000;

function verify(ctx, req) {
  const decoded = decodeToken(bearer(req));
  if (!decoded) { return { error: 'Missing or malformed token.' }; }
  // The bug: the algorithm is read from the token itself and "none" skips the signature check.
  const alg = String(decoded.header.alg ?? '');
  if (alg.toLowerCase() === 'none') { return { claims: decoded.payload }; }
  if (alg !== 'HS256' || !checkSignature(decoded, ctx.key('secret'))) { return { error: 'Bad signature.' }; }
  return { claims: decoded.payload };
}

export default {
  id: 'jwt-none',
  title: 'Kitchen Pass',
  summary: 'The kitchen dashboard reads your role from a signed token. Signed by whom?',
  story: 'Boss fight: the Slice of Life kitchen dashboard hands out staff passes as tokens. Only the head chef may open the walk-in freezer.',
  objective: 'Open /api/kitchen/freezer as the head chef (role "chef"). Log in as guest/guest first to see what a normal pass looks like.',
  hints: [
    'Decode the middle part of your token: it is base64url JSON containing your role.',
    'The first part tells the server which algorithm protects the token. Who decides it?',
    'Set the algorithm to none, change the role, and leave the third part empty (keep the final dot).',
  ],
  points: 140,
  severity: 'critical',
  bountyUsd: 2500,
  boss: true,
  requires: ['path-traversal', 'xss-filter'],
  site: { name: 'Slice of Life Kitchen', theme: 'pizza', path: 'kitchen.slice.pizza/api' },
  template: () => ({ method: 'POST', path: '/api/login', headers: { 'content-type': 'application/json' }, cookies: {}, body: '{"username":"guest","password":"guest"}' }),
  handle(ctx, req) {
    if (req.method === 'POST' && req.pathname === '/api/login') {
      const params = bodyParams(req.body);
      if (strField(params.username) !== 'guest' || strField(params.password) !== 'guest') { return json(401, { error: 'Unknown staff member.' }); }
      const token = signToken({ sub: `guest-${ctx.key('sub').slice(0, 4)}`, role: 'guest', iat: IAT }, ctx.key('secret'));
      return json(200, { token, hint: 'Send it as Authorization: Bearer <token>' });
    }
    if (req.method !== 'GET') { return notFound(); }
    if (req.pathname === '/api/me') {
      const { claims, error } = verify(ctx, req);
      return error ? json(401, { error }) : json(200, { sub: String(claims.sub ?? '').slice(0, 40), role: String(claims.role ?? '').slice(0, 20) });
    }
    if (req.pathname === '/api/kitchen/freezer') {
      const { claims, error } = verify(ctx, req);
      if (error) { return json(401, { error }); }
      if (claims.role !== 'chef') { return json(403, { error: 'Only the head chef may open the freezer.' }); }
      return json(200, { message: 'Freezer open.', secretRecipe: ctx.flag }, { exploited: true });
    }
    return notFound();
  },
};
