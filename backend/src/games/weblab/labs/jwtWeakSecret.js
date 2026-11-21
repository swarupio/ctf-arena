// Lab (hard): alg "none" is rejected, but the HMAC secret is a dictionary word. The lab ships a simulated
// "attacker toolbox" (crack / sign) so the whole chain can be played in the browser.
import { bearer, bodyParams, json, notFound, parseJsonObject, strField } from '../http.js';
import { LIMITS } from '../limits.js';
import { checkSignature, decodeToken, signToken } from '../token.js';

export const WORDLIST = [
  'password', 'letmein', 'welcome', 'qwerty', 'dragon', 'monkey', 'sunshine', 'princess', 'football', 'shadow',
  'master', 'hunter2', 'trustno1', 'iloveyou', 'admin123', 'secret', 'changeme', 'batman', 'starwars', 'pizza',
  'coffee', 'banana', 'rainbow', 'summer', 'winter', 'hospital', 'nurse', 'doctor', 'stethoscope', 'scalpel',
  'penguin', 'unicorn', 'pancake', 'wizard', 'ninja', 'pirate', 'rocket', 'galaxy', 'thunder', 'matrix',
];
const IAT = 1700000000;

const secretOf = (ctx) => ctx.pick('secret', WORDLIST);

function verify(ctx, req) {
  const decoded = decodeToken(bearer(req));
  if (!decoded) { return { error: 'Missing or malformed token.' }; }
  if (decoded.header.alg !== 'HS256') { return { error: 'Only HS256 tokens are accepted (alg none is disabled).' }; }
  if (!checkSignature(decoded, secretOf(ctx))) { return { error: 'Bad signature.' }; }
  return { claims: decoded.payload };
}

export default {
  id: 'jwt-weak-secret',
  title: 'Staff SSO',
  summary: 'The signature is solid. The secret behind it is not.',
  story: 'Mercy General\'s single sign-on signs staff passes with HMAC. Somebody picked the secret from memory.',
  objective: 'Become a hospital administrator and open /api/records/audit. The toolbox endpoints (/tools/crack and /tools/sign) simulate the tools an attacker would run on their own machine.',
  hints: [
    'This server rejects alg none. A forged token needs a valid signature, so you need the secret.',
    'HMAC secrets chosen by humans are often dictionary words. POST /tools/crack with {"token": "..."} tries a wordlist offline.',
    'Once you know the secret, POST /tools/sign with {"secret": "...", "payload": "{\\"sub\\":\\"x\\",\\"role\\":\\"admin\\"}"} and use the token on /api/records/audit.',
  ],
  points: 150,
  severity: 'critical',
  bountyUsd: 3500,
  site: { name: 'Mercy General Staff SSO', theme: 'hospital', path: 'sso.mercy.health/api' },
  template: () => ({ method: 'POST', path: '/api/login', headers: { 'content-type': 'application/json' }, cookies: {}, body: '{"username":"intern","password":"intern"}' }),
  handle(ctx, req) {
    if (req.method === 'POST' && req.pathname === '/api/login') {
      const params = bodyParams(req.body);
      if (strField(params.username) !== 'intern' || strField(params.password) !== 'intern') { return json(401, { error: 'Unknown staff member.' }); }
      return json(200, { token: signToken({ sub: `intern-${ctx.key('sub').slice(0, 4)}`, role: 'intern', iat: IAT }, secretOf(ctx)) });
    }
    if (req.method === 'POST' && req.pathname === '/tools/crack') {
      // Simulated offline cracker: a fixed 40-word list, one HMAC per word.
      const decoded = decodeToken(strField(bodyParams(req.body).token, LIMITS.TOKEN));
      if (!decoded) { return json(400, { error: 'Give me {"token": "<jwt>"}.' }); }
      const found = WORDLIST.find((word) => checkSignature(decoded, word));
      return json(200, found ? { found: true, secret: found, tried: WORDLIST.indexOf(found) + 1 } : { found: false, tried: WORDLIST.length });
    }
    if (req.method === 'POST' && req.pathname === '/tools/sign') {
      const params = bodyParams(req.body);
      const payload = parseJsonObject(strField(params.payload, LIMITS.BODY));
      const secret = strField(params.secret, 100);
      if (!payload || !secret) { return json(400, { error: 'Give me {"secret": "...", "payload": "<json text>"}.' }); }
      return json(200, { token: signToken(payload, secret) });
    }
    if (req.method !== 'GET') { return notFound(); }
    if (req.pathname === '/api/me') {
      const { claims, error } = verify(ctx, req);
      return error ? json(401, { error }) : json(200, { sub: String(claims.sub ?? '').slice(0, 40), role: String(claims.role ?? '').slice(0, 20) });
    }
    if (req.pathname === '/api/records/audit') {
      const { claims, error } = verify(ctx, req);
      if (error) { return json(401, { error }); }
      if (claims.role !== 'admin') { return json(403, { error: 'Administrators only.' }); }
      return json(200, { message: 'Audit export ready.', masterKey: ctx.flag }, { exploited: true });
    }
    return notFound();
  },
};
