// Lab (easy boss): statements are fetched by id; the server checks that you are logged in, not that they are yours.
import { json, notFound, parseTarget } from '../http.js';

const OWNERS = ['pixel_pete', 'byte_betty', 'disco_dan', 'arcade_ann', 'joystick_joe', 'neon_nancy'];
const MEMOS = ['Rent', 'Arcade tokens', 'Pizza night', 'Gift', 'Savings top-up', 'Coffee fund', 'Joystick repair', 'Refund'];

function world(ctx) {
  const base = ctx.int('base', 41000, 89000);
  const me = ctx.pick('me', OWNERS);
  const secretIndex = ctx.int('secret', 0, 11);
  const myIndexes = new Set([(secretIndex + 4) % 12, (secretIndex + 7) % 12]);
  const owners = ctx.shuffle('owners', OWNERS.filter((name) => name !== me));
  const statements = Array.from({ length: 12 }, (_, index) => {
    const mine = myIndexes.has(index);
    const secret = index === secretIndex;
    return {
      id: base + index,
      owner: secret ? 'vault_manager' : (mine ? me : owners[index % owners.length]),
      amount: 10 + ctx.int(`amt:${index}`, 0, 490),
      memo: secret ? `Sealed vault code: ${ctx.flag}` : ctx.pick(`memo:${index}`, MEMOS),
      secret,
    };
  });
  return { me, uid: `u_${ctx.key('uid').slice(0, 8)}`, statements };
}

export default {
  id: 'idor-statements',
  title: 'Statement Roulette',
  summary: 'Every statement has a number. Some of them are not yours.',
  story: 'Boss fight: the RetroBank statement archive has a vault manager account with a very interesting memo.',
  objective: 'Read a statement that belongs to the vault manager.',
  hints: [
    'Fetch your own statement from the list, then look at the id in the URL.',
    'The server only checks that you are logged in. What about the numbers next to yours?',
    'The ids are all in a short run. Try every id close to your own until the owner is not you.',
  ],
  points: 60,
  severity: 'critical',
  bountyUsd: 1200,
  boss: true,
  requires: ['sqli-login', 'cookie-tamper'],
  site: { name: 'RetroBank Statements', theme: 'retro-bank', path: 'statements.retro/api/statements' },
  template: (ctx) => {
    const { uid, statements, me } = world(ctx);
    const own = statements.find((s) => s.owner === me);
    return { method: 'GET', path: `/api/statements/${own.id}`, headers: {}, cookies: { uid }, body: '' };
  },
  handle(ctx, req) {
    const { uid, statements, me } = world(ctx);
    if (req.method !== 'GET') { return notFound(); }
    if (req.cookies.uid !== uid) { return json(401, { error: 'Not logged in. Your uid cookie is missing or wrong.' }); }
    const { pathname } = parseTarget(req.pathname);
    if (pathname === '/api/statements') {
      return json(200, statements.filter((s) => s.owner === me).map(({ id, amount }) => ({ id, amount })));
    }
    if (pathname.startsWith('/api/statements/')) {
      const raw = pathname.slice('/api/statements/'.length);
      const statement = raw.length > 0 && raw.length < 12 && [...raw].every((c) => c >= '0' && c <= '9')
        ? statements.find((s) => s.id === Number(raw)) : null;
      if (!statement) { return json(404, { error: 'No such statement.' }); }
      // The bug: no ownership check.
      return json(200, { id: statement.id, owner: statement.owner, amount: statement.amount, memo: statement.memo },
        statement.secret ? { exploited: true } : {});
    }
    return notFound();
  },
};
