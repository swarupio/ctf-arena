// Lab (insane): three simulated bugs chained: IDOR leaks a signing key -> forged admin token -> path traversal export.
import { bearer, bodyParams, json, notFound, parseJsonObject, safeDecode, strField } from '../http.js';
import { LIMITS } from '../limits.js';
import { checkSignature, decodeToken, signToken } from '../token.js';
import { VirtualTree, resolvePath, stripDotDotOnce } from '../vfs.js';

const NAMES = ['Ayla Reed', 'Bo Tanaka', 'Cy Okafor', 'Dara Quill', 'Eli Voss', 'Fern Ito', 'Gil Marsh', 'Hana Lowe'];
const BASE = '/srv/exports';

function world(ctx) {
  const base = ctx.int('base', 3000, 9000);
  const devKey = `nova-${ctx.key('devkey').slice(0, 12)}`;
  const leakIndex = ctx.int('leak', 1, 7);
  const staff = NAMES.map((name, index) => ({
    id: base + index,
    name,
    title: index === leakIndex ? 'DevOps lead' : (index === 0 ? 'Intern' : 'Engineer'),
    bio: index === leakIndex
      ? `Rotating the staging box. Reminder to self: the token signing key is still ${devKey} on prod too.`
      : 'Loves spreadsheets and standing desks.',
  }));
  const vaultKey = `/srv/vault/master-${ctx.key('vault').slice(0, 8)}.key`;
  const vfs = new VirtualTree({
    [`${BASE}/q3-summary.csv`]: 'team,revenue\nplatform,1200\nmobile,800',
    [`${BASE}/readme.txt`]: `Exports are served from ${BASE}. Master keys are archived under /srv/vault (see ${vaultKey}).`,
    '/etc/hostname': 'novacorp-api-02',
    [vaultKey]: `NOVACORP MASTER KEY: ${ctx.flag}`,
  });
  return { staff, devKey, vfs, me: staff[0] };
}

function claimsFor(ctx, req, devKey) {
  const decoded = decodeToken(bearer(req));
  if (!decoded) { return { error: 'Missing or malformed token.' }; }
  if (decoded.header.alg !== 'HS256' || !checkSignature(decoded, devKey)) { return { error: 'Bad signature.' }; }
  return { claims: decoded.payload };
}

export default {
  id: 'chain-vault',
  title: 'Operation Blackout',
  summary: 'Three small holes. One big vault. No hints.',
  story: 'Final boss. NovaCorp Cloud keeps the master key for every customer in a vault. You have an intern badge and a browser.',
  objective: 'You are intern Ayla Reed at NovaCorp. Take the master key from the vault. There is no hint system here. The toolbox at /tools/sign is yours.',
  hints: [],
  points: 500,
  severity: 'critical',
  bountyUsd: 10000,
  boss: true,
  requires: ['race-refill'],
  site: { name: 'NovaCorp Cloud Console', theme: 'vault', path: 'console.novacorp.cloud/api' },
  template: (ctx) => {
    const { me } = world(ctx);
    return { method: 'GET', path: `/api/staff/${me.id}`, headers: {}, cookies: { sid: `s_${ctx.key('sid').slice(0, 8)}` }, body: '' };
  },
  handle(ctx, req) {
    const { staff, devKey, vfs } = world(ctx);
    if (req.method === 'POST' && req.pathname === '/api/login') {
      const params = bodyParams(req.body);
      if (strField(params.username) !== 'intern' || strField(params.password) !== 'intern') { return json(401, { error: 'Bad credentials.' }); }
      return json(200, { token: signToken({ sub: 'intern', role: 'intern', iat: 1700000000 }, devKey) });
    }
    if (req.method === 'POST' && req.pathname === '/tools/sign') {
      const params = bodyParams(req.body);
      const payload = parseJsonObject(strField(params.payload, LIMITS.BODY));
      const secret = strField(params.secret, 100);
      if (!payload || !secret) { return json(400, { error: 'Give me {"secret": "...", "payload": "<json text>"}.' }); }
      return json(200, { token: signToken(payload, secret) });
    }
    if (req.method !== 'GET') { return notFound(); }
    if (req.pathname.startsWith('/api/staff/')) {
      if (req.cookies.sid !== `s_${ctx.key('sid').slice(0, 8)}`) { return json(401, { error: 'Not logged in.' }); }
      const raw = req.pathname.slice('/api/staff/'.length);
      const entry = raw.length > 0 && raw.length < 10 && [...raw].every((c) => c >= '0' && c <= '9') ? staff.find((s) => s.id === Number(raw)) : null;
      // The bug: any logged-in user can read any profile.
      return entry ? json(200, entry) : json(404, { error: 'No such staff member.' });
    }
    if (req.pathname === '/api/admin/exports') {
      const { claims, error } = claimsFor(ctx, req, devKey);
      if (error) { return json(401, { error }); }
      if (claims.role !== 'admin') { return json(403, { error: 'Admins only.' }); }
      const file = strField(req.query.file, LIMITS.FIELD);
      if (!file) { return json(200, { files: vfs.read(BASE).entries }); }
      const path = resolvePath(BASE, safeDecode(stripDotDotOnce(file)));
      const node = path === null ? null : vfs.read(path);
      if (!node) { return json(404, { error: 'No such export.' }); }
      if (node.type === 'dir') { return json(200, { directory: path, entries: node.entries }); }
      return json(200, { path, content: node.content }, node.content.includes(ctx.flag) ? { exploited: true } : {});
    }
    return notFound();
  },
};
