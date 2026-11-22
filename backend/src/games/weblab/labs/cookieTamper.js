// Lab: the server trusts an unsigned, base64-encoded preferences cookie to decide who is a manager.
import { notFound, page, parseJsonObject } from '../http.js';

const NAMES = ['coin_collector', 'saver_sam', 'penny_pixel', 'ledger_lee'];

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');

function decode(text) {
  const decoded = Buffer.from(text, 'base64').toString('utf8');
  return parseJsonObject(decoded);
}

export default {
  id: 'cookie-tamper',
  title: 'Cookie Jar',
  summary: 'The rewards portal remembers who you are in a cookie. Who else could write that cookie?',
  story: 'RetroBank Rewards keeps its member tier in the browser. Marketing says that is "faster".',
  objective: 'Get into the managers-only vault page at /vault.',
  hints: [
    'Look at the prefs cookie in the inspector. It looks like random letters, but is it encrypted?',
    'It is base64 text. Decode it (the Decoder tool unlocks after your first solve, or use any base64 tool).',
    'The decoded JSON has a tier and a true/false field that says whether you are an admin. Change what the server trusts, encode it again and send it back.',
  ],
  points: 30,
  severity: 'medium',
  bountyUsd: 300,
  site: { name: 'RetroBank Rewards', theme: 'retro-bank', path: 'rewards.retro/' },
  template: (ctx) => ({
    method: 'GET', path: '/rewards', headers: {},
    cookies: { prefs: encode({ user: ctx.pick('user', NAMES), tier: 'silver', admin: false }) }, body: '',
  }),
  handle(ctx, req) {
    const prefs = req.cookies.prefs === undefined ? null : decode(req.cookies.prefs);
    if (req.method !== 'GET') { return notFound(); }
    if (req.pathname === '/' || req.pathname === '/rewards') {
      if (!prefs) { return page(400, 'Corrupt cookie', [{ t: 'notice', tone: 'error', text: 'Your prefs cookie is missing or unreadable.' }]); }
      return page(200, 'Rewards', [
        { t: 'heading', text: `Hi ${String(prefs.user ?? 'friend').slice(0, 40)}` },
        { t: 'kv', items: [['Tier', String(prefs.tier ?? 'none').slice(0, 20)], ['Points', '1,200']] },
        { t: 'text', text: 'Managers get access to /vault.' },
      ]);
    }
    if (req.pathname === '/vault') {
      if (!prefs) { return page(400, 'Corrupt cookie', [{ t: 'notice', tone: 'error', text: 'Your prefs cookie is missing or unreadable.' }]); }
      if (prefs.admin !== true) {
        return page(403, 'Managers only', [{ t: 'notice', tone: 'error', text: `Access denied for tier "${String(prefs.tier ?? '').slice(0, 20)}".` }]);
      }
      return page(200, 'Manager vault', [
        { t: 'heading', text: 'Manager vault' },
        { t: 'notice', tone: 'success', text: 'Welcome, manager.' },
        { t: 'kv', items: [['Vault code', ctx.flag]] },
      ], { exploited: true });
    }
    return notFound();
  },
};
