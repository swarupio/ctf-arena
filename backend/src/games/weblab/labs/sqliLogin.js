// Lab: login form that builds its query by string concatenation. Simulated with the hand-written evaluator.
import { LIMITS } from '../limits.js';
import { bodyParams, notFound, page, strField } from '../http.js';
import { SqlError, runQuery } from '../miniSql.js';

const CUSTOMERS = ['neon_nancy', 'pixel_pete', 'byte_betty', 'disco_dan', 'arcade_ann', 'joystick_joe'];

function world(ctx) {
  const names = ctx.shuffle('names', CUSTOMERS).slice(0, 4);
  const users = names.map((username, index) => ({
    id: index + 1, username, password: ctx.key(`pw:${index}`).slice(0, 12), role: 'customer',
  }));
  const admin = { id: 9, username: `teller_${ctx.key('admin').slice(0, 4)}`, password: ctx.key('pw:admin').slice(0, 16), role: 'admin' };
  users.push(admin);
  return { users, admin, tables: { users: { columns: ['id', 'username', 'password', 'role'], rows: users } } };
}

export default {
  id: 'sqli-login',
  title: 'Teller Window',
  summary: 'The RetroBank login box trusts whatever you type.',
  story: 'RetroBank has a new online teller window. Its security team swears it is "unbreakable". File the report.',
  objective: 'Log in as the bank teller (the admin account) without knowing the password. The staff directory lists who the teller is.',
  hints: [
    'The login builds one SQL string out of your username and password. What happens if your input contains a quote?',
    'A quote ends the text early; two dashes turn the rest of the query into a comment.',
    'You need the row whose role is admin: either type the teller username followed by a quote and a comment, or add an OR condition on the role column.',
  ],
  points: 30,
  severity: 'high',
  bountyUsd: 500,
  site: { name: 'RetroBank Teller Window', theme: 'retro-bank', path: 'bank.retro/login' },
  form: { fields: [{ name: 'username', label: 'Username', type: 'text' }, { name: 'password', label: 'Password', type: 'password' }], submit: { method: 'POST', path: '/login', label: 'Log in', encoding: 'json' } },
  template: () => ({ method: 'POST', path: '/login', headers: { 'content-type': 'application/json' }, cookies: {}, body: '{"username":"neon_nancy","password":"hunter2"}' }),
  handle(ctx, req) {
    const { users, admin, tables } = world(ctx);
    if (req.method === 'GET' && req.pathname === '/staff') {
      return page(200, 'Staff directory', [
        { t: 'heading', text: 'Staff directory' },
        { t: 'table', columns: ['Name', 'Desk'], rows: [[admin.username, 'Teller window 1']] },
      ]);
    }
    if (req.method === 'GET' && (req.pathname === '/' || req.pathname === '/login')) {
      return page(200, 'RetroBank login', [
        { t: 'heading', text: 'RetroBank Online' },
        { t: 'text', text: 'Please log in. Staff? See /staff.' },
      ]);
    }
    if (req.method !== 'POST' || req.pathname !== '/login') { return notFound(); }
    const params = bodyParams(req.body);
    const username = strField(params.username, LIMITS.FIELD);
    const password = strField(params.password, LIMITS.FIELD);
    // The bug: user input is concatenated into the query text.
    const sql = `SELECT * FROM users WHERE username='${username}' AND password='${password}'`;
    let result;
    try { result = runQuery(sql, tables); } catch (error) {
      if (!(error instanceof SqlError)) { throw error; }
      return page(500, 'Database error', [
        { t: 'notice', tone: 'error', text: `Database error: ${error.message}` },
        { t: 'code', text: sql },
      ]);
    }
    if (result.rows.length === 0) {
      return page(401, 'Login failed', [{ t: 'notice', tone: 'error', text: 'Wrong username or password.' }]);
    }
    const row = Object.fromEntries(result.columns.map((name, index) => [name, result.rows[0][index]]));
    const user = users.find((candidate) => candidate.id === row.id) ?? { username: 'unknown', role: 'customer' };
    if (user.role === 'admin') {
      return page(200, 'Teller console', [
        { t: 'heading', text: `Welcome back, ${user.username}` },
        { t: 'notice', tone: 'success', text: 'Teller console unlocked.' },
        { t: 'kv', items: [['Vault audit code', ctx.flag]] },
      ], { exploited: true, setCookies: [{ name: 'session', value: `t-${ctx.key('session').slice(0, 8)}` }] });
    }
    return page(200, 'Account', [
      { t: 'heading', text: `Welcome, ${user.username}` },
      { t: 'text', text: 'Balance: 12 coins. Nothing interesting here.' },
    ]);
  },
};
