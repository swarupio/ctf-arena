// Home hero + page-top measurement. usage (dev server from vite.config.js must be running):
//   PORT=5480 OUT=<dir> TAG=after node hero.cjs            (hero table, screenshots in OUT)
//   PORT=5480 OUT=<dir> TAG=after TOP=1 node hero.cjs      (also first-content gap of other pages at 1273x627)
//   TOP_ONLY=1 skips the hero table.
// Asserts for screens at least 560 px high and 700 px wide: hero panel incl. offset shadow inside the first viewport,
// gap above and gap below within 8 px of each other, and (unless the hero is capped at 52rem) the next section starts at the fold. Always: no horizontal overflow, shadow inside the right edge.
// Exit code 1 when an assertion fails.
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const fs = require('fs');
const path = require('path');
const { route } = require('./data.cjs');
const ov = require('./ovdata.cjs');
const { makeHandler } = require('./playhandler.cjs');
const PORT = process.env.PORT || 5480;
const BASE = 'http://127.0.0.1:' + PORT;
const OUT = process.env.OUT || path.join(__dirname, 'out', 'hero');
const TAG = process.env.TAG || 'run';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = [
  ['1273x627', 1273, 627, 1], ['1366x768', 1366, 768, 1], ['1536x730', 1536, 730, 1], ['1920x940', 1920, 940, 1],
  ['2560x1300', 2560, 1300, 1], ['1024x700', 1024, 700, 1], ['390x844', 390, 844, 3, true], ['844x390', 844, 390, 3, true],
  ['1273x560', 1273, 560, 1], ['1273x1100', 1273, 1100, 1],
];
const ROLES = ['anon', 'player', 'admin'];
const THEMES = ['light', 'dark'];
const TOP_PAGES = [['challenges', '/challenges', 'player'], ['range', '/range', 'player'], ['skills', '/skills', 'player'], ['leaderboard', '/leaderboard', 'player'],
  ['profile', '/profile', 'player'], ['team', '/team', 'player'], ['login', '/login', 'anon'], ['signup', '/signup', 'anon'], ['demo', '/demo', 'anon'], ['adm-overview', '/admin', 'admin']];

function measureHero() {
  const hero = document.querySelector('.hero'); const header = document.querySelector('.site-header');
  const vh = innerHeight; const cw = document.documentElement.clientWidth;
  const hr = hero.getBoundingClientRect(); const hb = header.getBoundingClientRect();
  const sh = getComputedStyle(hero).boxShadow.match(/(-?\d+(?:\.\d+)?)px/g) || ['0px', '0px'];
  const ox = parseFloat(sh[0]); const oy = parseFloat(sh[1]);
  let next = hero.nextElementSibling; while (next && next.getBoundingClientRect().height === 0) { next = next.nextElementSibling; }
  const nr = next && next.getBoundingClientRect();
  const bottom = hr.bottom + oy;
  const blocks = document.querySelector('.hero .pixel-blocks');
  return { vh, header: Math.round(hb.bottom), top: Math.round(hr.top - hb.bottom), bottom: Math.round(bottom), heroH: Math.round(hr.height),
    below: nr ? Math.round(nr.top - bottom) : null, nextTop: nr ? Math.round(nr.top) : null,
    overflowX: document.documentElement.scrollWidth > cw, shadowRightOver: hr.right + ox > cw + 0.5, art: blocks ? getComputedStyle(blocks).display !== 'none' : false };
}
function measureTop() {
  const header = document.querySelector('.site-header'); const main = document.querySelector('main');
  const hb = header.getBoundingClientRect();
  const first = [...main.querySelectorAll('*')].find((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.height > 0 && r.width > 0 && s.visibility !== 'hidden' && (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderTopWidth) > 0 || /^(H1|H2|P|A|BUTTON|LABEL|NAV)$/.test(e.tagName)); });
  const r = first.getBoundingClientRect();
  return { gap: Math.round(r.top - hb.bottom), first: first.tagName.toLowerCase() + '.' + String(first.className).split(' ')[0] };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  function json(req, status, body) { req.respond({ status, contentType: 'application/json', headers: { 'X-Served-By': 'replica-2' }, body: JSON.stringify(body) }); }
  const play = await makeHandler((req, p) => json(req, 200, route(p, Object.fromEntries(new URL(req.url()).searchParams))));
  const gamePrefix = /^\/(cipherlab|crackme|forensics|osint|terminal|weblab)(\/|$)/;
  const handler = (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith('/api/')) { return req.continue(); }
    const p = u.pathname.slice(4);
    if (ov[p]) { return json(req, 200, ov[p]); }
    if (p === '/challenges' || /^\/challenges\//.test(p)) { return json(req, 200, route(p, {})); }
    if (gamePrefix.test(p)) { return play(req); }
    return json(req, 200, route(p, Object.fromEntries(u.searchParams)));
  };
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const rows = []; const fails = [];
  async function open(w, h, dsf, mobile, url, theme) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf, isMobile: !!mobile, hasTouch: !!mobile, isLandscape: w > h && !!mobile });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('ctf.theme', t); } catch (e) { /* ignore */ } }, theme);
    await page.setRequestInterception(true); page.on('request', handler);
    try { await page.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 9000 }); } catch (e) { /* ignore */ }
    await wait(500);
    return page;
  }
  if (!process.env.TOP_ONLY) {
    for (const [name, w, h, dsf, mobile] of VPS) {
      for (const theme of THEMES) {
        for (const role of ROLES) {
          const page = await open(w, h, dsf, mobile, '/?as=' + role, theme);
          const m = await page.evaluate(measureHero);
          rows.push({ vp: name, theme, role, ...m });
          const checks = [];
          if (h >= 560 && w >= 700) {
            if (m.bottom > m.vh) checks.push('hero bottom ' + m.bottom + ' > vh ' + m.vh);
            if (Math.abs(m.top - m.below) > 8) checks.push('gap top ' + m.top + ' vs below ' + m.below);
            // the hero fills the first screen: the next section starts at the fold (nothing cut off peeks in), unless the hero hit its 52rem cap
            if (m.heroH < 52 * 16 - 2 && m.nextTop !== null && Math.abs(m.nextTop - m.vh) > 3) checks.push('next section starts at ' + m.nextTop + ', expected the fold at ' + m.vh);
          }
          if (m.overflowX) checks.push('horizontal overflow');
          if (m.shadowRightOver) checks.push('shadow beyond right edge');
          if (checks.length) fails.push(name + ' ' + theme + ' ' + role + ': ' + checks.join('; '));
          await page.screenshot({ path: path.join(OUT, TAG + '_' + name + '_' + theme + '_' + role + '.png') });
          await page.close();
        }
      }
    }
    console.log('vp | theme | role | header | top | heroH | bottom(incl shadow) | vh | below | nextTop | art');
    for (const r of rows) console.log([r.vp, r.theme, r.role, r.header, r.top, r.heroH, r.bottom, r.vh, r.below, r.nextTop, r.art ? 'y' : 'n'].join(' | '));
  }
  if (process.env.TOP || process.env.TOP_ONLY) {
    console.log('\npage first-content gap below header at 1273x627 (light):');
    for (const [name, url, role] of TOP_PAGES) {
      const page = await open(1273, 627, 1, false, url + '?as=' + role, 'light');
      let m; try { m = await page.evaluate(measureTop); } catch (e) { m = { gap: 'err', first: e.message.slice(0, 40) }; }
      console.log(name.padEnd(14), String(m.gap).padStart(4), m.first);
      await page.screenshot({ path: path.join(OUT, TAG + '_top_' + name + '.png') });
      await page.close();
    }
  }
  await browser.close();
  if (fails.length) { console.log('\nFAIL (' + fails.length + '):\n' + fails.join('\n')); process.exit(1); }
  console.log('\nOK: all assertions passed');
})();
