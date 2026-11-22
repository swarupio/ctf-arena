// usage: TAG=before CFG="iPhone SE,desktop 1366" node run.cjs   (CFG = comma list of config names, default all)
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const fs = require('fs');
const { route } = require('./data.cjs');
const ov = require('./ovdata.cjs');
const { makeHandler } = require('./playhandler.cjs');
const PORT = process.env.PORT || 5480;
const BASE = 'http://127.0.0.1:' + PORT;
const TAG = process.env.TAG || 'run';
const MODE = process.env.MODE || ''; // '', 'zoom', 'font20'
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const z = (k) => '0'.repeat(24 - String(k).length) + k;
const K = puppeteer.KnownDevices;
const AND = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const mob = (name, w, h, dsf, ua) => [
  [name, { viewport: { width: w, height: h, deviceScaleFactor: dsf, isMobile: true, hasTouch: true }, userAgent: ua || K['iPhone SE'].userAgent, cls: 'phone-portrait' }],
  [name + ' landscape', { viewport: { width: h, height: w, deviceScaleFactor: dsf, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: ua || K['iPhone SE'].userAgent, cls: 'phone-landscape' }],
];
const CFG = {};
for (const n of ['iPhone SE', 'iPhone 14 Pro Max', 'Galaxy S9+']) { CFG[n] = { ...K[n], cls: 'phone-portrait' }; CFG[n + ' landscape'] = { ...K[n + ' landscape'], cls: 'phone-landscape' }; }
for (const [k, v] of mob('Pixel 7', 412, 915, 2.625, AND)) { CFG[k] = v; }
for (const [k, v] of mob('iPhone 390', 390, 844, 3)) { CFG[k] = v; }
for (const n of ['iPad Mini', 'iPad Pro 11']) { CFG[n] = { ...K[n], cls: 'tablet-portrait' }; CFG[n + ' landscape'] = { ...K[n + ' landscape'], cls: 'tablet-landscape' }; }
for (const [w, h] of [[1366, 768], [1920, 1080], [2560, 1440], [3840, 2160]]) { CFG['desktop ' + w] = { viewport: { width: w, height: h, deviceScaleFactor: 1 }, cls: 'desktop' }; }
// narrow-zoom floor: a phone at 150-300% zoom is 107-240 CSS px wide (guard: document never scrolls sideways at 160px and up)
for (const w of [320, 240, 200, 180, 160]) { for (const d of [2, 3]) { CFG['narrow ' + w + ' x' + d] = { viewport: { width: w, height: 640, deviceScaleFactor: d, isMobile: true, hasTouch: true }, userAgent: K['iPhone SE'].userAgent, cls: 'phone-portrait' }; } }
for (const w of [240, 200, 160]) { CFG['narrow ' + w + ' fine'] = { viewport: { width: w, height: 640, deviceScaleFactor: 2 }, cls: 'desktop' }; } // mouse pointer: the touch-only rules do not apply, so fixed widths show up here
const only = process.env.CFG ? process.env.CFG.split(',') : Object.keys(CFG);

const PAGES = [
  ['home-anon', '/', 'anon', 'home'], ['home', '/', 'player', 'home'],
  ['login', '/login', 'anon', 'auth'], ['signup', '/signup', 'anon', 'auth'], ['confirm', '/confirm', 'anon', 'auth'], ['forgot', '/forgot', 'anon', 'auth'], ['mfa-setup', '/mfa-setup', 'mfa-setup', 'auth'], ['mfa', '/mfa', 'mfa', 'auth'],
  ['hub', '/range', 'player', 'hub'],
  ['ov-cipherlab', '/cipherlab', 'player', 'overview'], ['ov-terminal', '/terminal', 'player', 'overview'], ['ov-weblab', '/weblab', 'player', 'overview'], ['ov-forensics', '/forensics', 'player', 'overview'], ['ov-reversing', '/reversing', 'player', 'overview'], ['ov-osint', '/osint', 'player', 'overview'],
  ['play-cipherlab', '/cipherlab/e1', 'player', 'play'], ['play-reversing', '/reversing/e1', 'player', 'play'], ['play-forensics', '/forensics/easy', 'player', 'play'], ['play-osint', '/osint/easy', 'player', 'play'], ['play-weblab', '/weblab/weblab-sqli-login', 'player', 'play'], ['play-terminal', '/terminal/easy', 'player', 'play'],
  ['challenges', '/challenges', 'player', 'challenges'], ['challenge-docker', '/challenges/' + z(200), 'player', 'challenge-detail'], ['challenge-static', '/challenges/' + z(203), 'player', 'challenge-detail'],
  ['leaderboard', '/leaderboard', 'player', 'leaderboard'], ['profile', '/profile', 'player', 'profile'], ['team', '/team', 'player', 'team'], ['fairplay', '/fair-play', 'anon', 'fairplay'], ['demo', '/demo', 'anon', 'demo'],
  ['adm-overview', '/admin', 'admin', 'admin'], ['adm-users', '/admin/users', 'admin', 'admin'], ['adm-users-drawer', '/admin/users?user=' + z(11), 'admin', 'admin'], ['adm-teams', '/admin/teams', 'admin', 'admin'], ['adm-challenges', '/admin/challenges', 'admin', 'admin'], ['adm-challenges-drawer', '/admin/challenges?challenge=' + z(200), 'admin', 'admin'],
  ['adm-activity', '/admin/activity', 'admin', 'admin'], ['adm-integrity', '/admin/integrity', 'admin', 'admin'], ['adm-instances', '/admin/instances', 'admin', 'admin'], ['adm-audit', '/admin/audit', 'admin', 'admin'], ['adm-settings', '/admin/settings', 'admin', 'admin'], ['adm-exports', '/admin/exports', 'admin', 'admin'],
];
const pageFilter = process.env.ONLY ? process.env.ONLY.split(',') : null;

function measure() {
  const de = document.documentElement; const vw = de.clientWidth; const vh = innerHeight;
  const vis = (r, st) => r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  const clipped = (el) => { for (let n = el.parentElement; n && n !== document.body && n !== de; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { return true; } } return false; };
  const desc = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '') + (el.textContent ? '"' + el.textContent.trim().replace(/\s+/g, ' ').slice(0, 18) + '"' : (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label').slice(0, 18) + ']' : ''));
  const res = { sw: de.scrollWidth, cw: vw, sh: de.scrollHeight, vh, off: [], small: [], nTargets: 0, fixedFrac: 0, minFont: 99, tinyText: 0, inputsUnder16: [] };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
    if (!vis(r, st) || st.position === 'fixed') { continue; }
    if (el.closest('.skip-link') || el.classList.contains('skip-link')) { continue; }
    if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) { res.off.push(desc(el) + ' r=' + Math.round(r.right) + ' l=' + Math.round(r.left)); }
  }
  res.off = res.off.slice(0, 6);
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=tab],[role=button],[role=link],[role=menuitem],[role=switch],[tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  for (const el of document.querySelectorAll(sel)) {
    const st = getComputedStyle(el); let target = el;
    if (el.matches('input[type=checkbox],input[type=radio]')) { target = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]')) || el; }
    const r = target.getBoundingClientRect();
    if (!vis(r, getComputedStyle(target)) || el.classList.contains('skip-link') || seen.has(target)) { continue; }
    if (el.closest('[aria-hidden=true]')) { continue; }
    seen.add(target);
    if (el.tagName === 'A' && st.display === 'inline') { continue; }
    res.nTargets++;
    if (r.width < 43.5 || r.height < 43.5) { res.small.push({ d: desc(el), w: Math.round(r.width), h: Math.round(r.height), a: Math.round(r.width * r.height) }); }
    if (/^(input|textarea|select)$/i.test(el.tagName) && !/checkbox|radio|range|button|submit|file|color/.test(el.type || '') && parseFloat(st.fontSize) < 15.99) { res.inputsUnder16.push(desc(el) + ' ' + st.fontSize); }
  }
  res.small.sort((a, b) => a.a - b.a);
  let fixed = 0;
  for (const el of document.querySelectorAll('body *')) { const st = getComputedStyle(el); if (st.position === 'fixed' || st.position === 'sticky') { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { fixed += Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)); } } }
  res.fixedFrac = +(fixed / vh).toFixed(2);
  for (const el of document.querySelectorAll('main *, header *, footer *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { continue; }
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) { continue; }
    const fs = parseFloat(getComputedStyle(el).fontSize); res.minFont = Math.min(res.minFont, fs); if (fs < 11.5) { res.tinyText++; }
  }
  const m = document.querySelector('main'); if (m) { const r = m.getBoundingClientRect(); res.mainW = Math.round(r.width); res.mainL = Math.round(r.left); }
  const hd = document.querySelector('.site-header'); res.headerH = hd ? Math.round(hd.getBoundingClientRect().height) : 0;
  res.rootFont = getComputedStyle(de).fontSize;
  return res;
}

(async () => {
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
  const outDir = `${__dirname}/out/${TAG}`; fs.mkdirSync(outDir, { recursive: true });
  const all = [];
  for (const cname of only) {
    const c = CFG[cname]; if (!c) { console.error('unknown cfg', cname); continue; }
    const slug = cname.replace(/[^a-z0-9]+/gi, '_');
    for (const [name, path, as, family] of PAGES) {
      if (pageFilter && !pageFilter.some((o) => name === o || name.startsWith(o))) { continue; }
      const page = await browser.newPage();
      let vp = { ...c.viewport };
      if (MODE === 'zoom') { vp = { ...vp, width: Math.round(vp.width / 2), height: Math.round(vp.height / 2), deviceScaleFactor: vp.deviceScaleFactor * 2 }; }
      await page.setViewport(vp);
      if (c.userAgent) { await page.setUserAgent(c.userAgent); }
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
      await page.setRequestInterception(true); page.on('request', handler);
      if (MODE === 'font20') { await page.evaluateOnNewDocument(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'html{font-size:20px !important}'; document.head.appendChild(s); }); }); }
      try {
        await page.goto(BASE + path + (path.includes('?') ? '&' : '?') + 'as=' + as, { waitUntil: 'networkidle2', timeout: 9000 });
      } catch (e) { errs.push('goto ' + e.message.slice(0, 60)); }
      await wait(500);
      let m;
      try { m = await page.evaluate(measure); } catch (e) { m = { err: e.message }; }
      all.push({ cfg: cname, cls: c.cls, name, family, ...m, errs });
      try { await page.screenshot({ path: `${outDir}/${slug}__${name}${MODE ? '_' + MODE : ''}.png` }); } catch (e) { /* ignore */ }
      await page.close();
    }
    console.error('done', cname);
  }
  await browser.close();
  fs.writeFileSync(`${outDir}/results-${(process.env.CFG || 'all').replace(/[^a-z0-9,]+/gi, '_').slice(0, 40)}${MODE}.json`, JSON.stringify(all));
  console.log('written', all.length);
})().catch((e) => { console.error(e); process.exit(1); });
