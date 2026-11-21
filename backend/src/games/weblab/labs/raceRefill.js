// Lab (hard boss): a check-then-act race on a one-time voucher. Concurrency is SIMULATED: the `parallel` field says
// how many identical requests arrive at once, and the fake server checks "already used?" before any of them writes.
// State lives in a signed cookie, so nothing is stored on the server (and the lab is replica-safe).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { json, notFound, page, parseJsonObject } from '../http.js';
import { LIMITS } from '../limits.js';

const VOUCHER_VALUE = 20;
const POOL_LIMIT = 8; // the fake DB connection pool: at most this many racers slip through
const PRICE = 100;

const sign = (ctx, balance, used) => createHmac('sha256', ctx.key('wallet')).update(`${balance}.${used}`).digest('hex').slice(0, 16);
const cookieFor = (ctx, balance, used) => ({ name: 'wallet', value: `${balance}.${used}.${sign(ctx, balance, used)}` });

function readWallet(ctx, req) {
  const parts = String(req.cookies.wallet ?? '').split('.');
  if (parts.length !== 3) { return null; }
  const [balanceText, usedText, mac] = parts;
  const balance = Number(balanceText);
  if (!Number.isInteger(balance) || balance < 0 || balance > 100000 || (usedText !== '0' && usedText !== '1')) { return null; }
  const expected = Buffer.from(sign(ctx, balance, usedText));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) { return null; }
  return { balance, used: usedText === '1' };
}

export default {
  id: 'race-refill',
  title: 'Voucher Rush',
  summary: 'One welcome voucher per patient. The server checks first and writes later.',
  story: 'Boss fight: Mercy General\'s pharmacy gives every new patient one welcome voucher. Credits buy the confidential audit report.',
  objective: `Buy the audit report (it costs ${PRICE} credits) even though the voucher only pays ${VOUCHER_VALUE} and can be used once.`,
  hints: [
    'Redeem the voucher once, then try again. What does the server say? Now look at the parallel field of the request.',
    'The server checks "already used?" and only afterwards writes. Several requests arriving at the same moment all pass the check.',
    'Send the redeem request with parallel set between 5 and 8, then buy the item. Tampering with the wallet cookie will not work, it is signed.',
  ],
  points: 250,
  severity: 'high',
  bountyUsd: 4000,
  boss: true,
  requires: ['sqli-union', 'jwt-weak-secret'],
  site: { name: 'Mercy General Pharmacy', theme: 'hospital', path: 'pharmacy.mercy.health' },
  template: (ctx) => ({
    method: 'POST', path: '/redeem', headers: { 'content-type': 'application/json' }, cookies: { wallet: cookieFor(ctx, 0, 0).value },
    body: `{"code":"WELCOME-${ctx.key('voucher').slice(0, 4).toUpperCase()}","parallel":1}`,
  }),
  handle(ctx, req) {
    const voucher = `WELCOME-${ctx.key('voucher').slice(0, 4).toUpperCase()}`;
    const wallet = readWallet(ctx, req);
    if (req.method === 'GET' && (req.pathname === '/' || req.pathname === '/pharmacy')) {
      const current = wallet ?? { balance: 0, used: false };
      return page(200, 'Pharmacy', [
        { t: 'heading', text: 'Mercy Pharmacy Credits' },
        { t: 'text', text: `New patient voucher: ${voucher} (worth ${VOUCHER_VALUE} credits, one use). The audit report costs ${PRICE}.` },
        { t: 'kv', items: [['Balance', String(current.balance)], ['Voucher used', current.used ? 'yes' : 'no']] },
      ], { setCookies: [cookieFor(ctx, current.balance, current.used ? 1 : 0)] });
    }
    if (req.method !== 'POST') { return notFound(); }
    if (!wallet) { return json(401, { error: 'Missing or tampered wallet cookie. Open GET /pharmacy first.' }); }
    const body = parseJsonObject(req.body) ?? {};
    if (req.pathname === '/redeem') {
      if (body.code !== voucher) { return json(400, { error: 'Unknown voucher code.' }); }
      const requested = Number(body.parallel ?? 1);
      const parallel = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), LIMITS.PARALLEL) : 1;
      if (wallet.used) { return json(409, { error: 'Voucher already used.', balance: wallet.balance }); }
      // The bug: every concurrent request saw used=false before any of them wrote it back.
      const accepted = Math.min(parallel, POOL_LIMIT);
      const balance = wallet.balance + accepted * VOUCHER_VALUE;
      return json(200, { redeemed: accepted, balance, note: accepted > 1 ? `${accepted} concurrent requests were accepted.` : 'Voucher redeemed.' },
        { setCookies: [cookieFor(ctx, balance, 1)] });
    }
    if (req.pathname === '/buy') {
      if (body.item !== 'audit-report') { return json(400, { error: 'Unknown item. Try "audit-report".' }); }
      if (wallet.balance < PRICE) { return json(402, { error: `Not enough credits (${wallet.balance}/${PRICE}).` }); }
      const balance = wallet.balance - PRICE;
      return json(200, { message: 'Purchased.', report: ctx.flag, balance }, { exploited: true, setCookies: [cookieFor(ctx, balance, wallet.used ? 1 : 0)] });
    }
    return notFound();
  },
};
