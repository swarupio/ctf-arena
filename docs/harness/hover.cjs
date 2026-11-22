// Hover audit (dark by default): hovers (or STATE=active presses) every link/button/tab/summary on every harness page and lists elements whose text contrast is below THRESH (default 3).
// Usage (the harness dev server from vite.config.js must run): PORT=5480 THEME=dark|light THRESH=4.5 [STATE=active] [ONLY=home,challenges] [OUT=<dir for the JSON of offenders>] node hover.cjs
// BASE (default http://127.0.0.1:$PORT), HARNESS (default this folder), PERF_TOOLS / PUPPETEER_CORE / CHROME: see env.cjs.
// Exit code 1 when any element is below THRESH.
const { launchBrowser, loadPuppeteer } = require('./env.cjs');
const puppeteer = loadPuppeteer();
const fs = require('fs');
const H = process.env.HARNESS || __dirname;
const { route } = require(H + '/data.cjs');
const ov = require(H + '/ovdata.cjs');
const { makeHandler } = require(H + '/playhandler.cjs');
const PAGES = require(H + '/pages.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:' + (process.env.PORT || 5480), THEME = process.env.THEME || 'dark';
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const STATE = process.env.STATE || 'hover', THRESH = Number(process.env.THRESH || 3);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function inPage() {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const bgOf = (el) => { let stack = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } } let acc = parse(getComputedStyle(document.documentElement).backgroundColor); if (acc[3] === 0) acc = [13, 17, 23, 1]; for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc); return acc; };
  return { parse, over, ratio, bgOf };
}

async function measureEl(page, handle) {
  return page.evaluate((el, src) => {
    const lib = (new Function('return (' + src + ')()'))();
    const bg = lib.bgOf(el);
    const texts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t; const seen = new Set();
    while ((t = walker.nextNode())) { if (!t.textContent.trim()) continue; const pe = t.parentElement; if (seen.has(pe)) continue; seen.add(pe); const own = lib.bgOf(pe); const col = lib.parse(getComputedStyle(pe).color); const eff = lib.over(col, own); texts.push({ tag: pe.tagName.toLowerCase() + (pe.className && typeof pe.className === 'string' ? '.' + pe.className.trim().split(/\s+/)[0] : ''), text: t.textContent.trim().slice(0, 24), ratio: Math.round(lib.ratio(eff, own) * 100) / 100, fg: getComputedStyle(pe).color, bg: String(own), hovered: pe.matches(":hover"), cls: String(pe.className).slice(0, 60) }); if (texts.length >= 6) break; }
    const worst = texts.reduce((m, x) => (x.ratio < m.ratio ? x : m), { ratio: 99 });
    return { worst, n: texts.length };
  }, handle, inPage.toString());
}

(async () => {
  const json = (req, status, body) => req.respond({ status, contentType: 'application/json', headers: { 'X-Served-By': 'replica-2' }, body: JSON.stringify(body) });
  const play = await makeHandler((req, p) => json(req, 200, route(p, Object.fromEntries(new URL(req.url()).searchParams))));
  const gamePrefix = /^\/(cipherlab|crackme|forensics|osint|terminal|weblab)(\/|$)/;
  const handler = (req) => { const u = new URL(req.url()); if (!u.pathname.startsWith('/api/')) return req.continue(); const p = u.pathname.slice(4); if (ov[p]) return json(req, 200, ov[p]); if (p === '/challenges' || /^\/challenges\//.test(p)) return json(req, 200, route(p, {})); if (gamePrefix.test(p)) return play(req); return json(req, 200, route(p, Object.fromEntries(u.searchParams))); };
  const browser = await launchBrowser(puppeteer);
  const bad = []; let checked = 0;
  const list = PAGES.filter(([name]) => !['mfa-setup', 'mfa'].includes(name)).filter(([name]) => !only.length || only.includes(name));
  for (const [name, path, as] of list) {
    const asses = as === 'player' ? ['player', 'admin'] : [as];
    for (const role of asses) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1273, height: 627, deviceScaleFactor: 1.5 });
      await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('ctf.theme', t); } catch (e) { /* ignore */ } }, THEME);
      await page.setRequestInterception(true); page.on('request', handler);
      try { await page.goto(BASE + path + (path.includes('?') ? '&' : '?') + 'as=' + role, { waitUntil: 'networkidle2', timeout: 9000 }); } catch (e) { /* ignore */ }
      await wait(400);
      const handles = await page.$$('a[href], button:not([disabled]), summary, [role="tab"]');
      let count = 0;
      for (const h of handles) {
        if (count >= 70) break;
        const vis = await h.boundingBox().catch(() => null); if (!vis || vis.width < 4 || vis.height < 4) continue;
        try { await h.scrollIntoView(); await h.hover(); if (STATE === 'active') await page.mouse.down(); } catch (e) { continue; }
        await wait(90);
        const m = await measureEl(page, h).catch(() => null); if (!m || !m.n) continue;
        count++; checked++;
        if (STATE === 'active') await page.mouse.up().catch(() => {});
        if (m.worst.ratio < THRESH) {
          const label = await page.evaluate((el) => (el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '')).slice(0, 70) + ' "' + (el.textContent || '').trim().slice(0, 20) + '"', h);
          bad.push({ page: name, role, el: label, worst: m.worst });
        }
      }
      await page.close();
    }
  }
  await browser.close();
  const uniq = new Map(); for (const b of bad) { const k = b.el.replace(/ ".*"$/, ''); if (!uniq.has(k)) uniq.set(k, { ...b, pages: new Set([b.page]) }); else uniq.get(k).pages.add(b.page); }
  console.log('hovered elements checked:', checked, '| low-contrast hover cases:', bad.length, '| distinct selectors:', uniq.size);
  for (const [k, v] of uniq) console.log(' -', k, '| ratio', v.worst.ratio, 'on', v.worst.tag, '"' + v.worst.text + '" fg=' + v.worst.fg + ' bg=' + v.worst.bg + ' hovered=' + v.worst.hovered + ' cls=' + v.worst.cls + ' | pages:', [...v.pages].slice(0, 5).join(','));
  if (process.env.OUT && bad.length) { fs.mkdirSync(process.env.OUT, { recursive: true }); fs.writeFileSync(`${process.env.OUT}/hover-${THEME}-${STATE}.json`, JSON.stringify(bad, null, 1)); }
  console.log(bad.length ? `FAIL (${THEME}, ${STATE}, threshold ${THRESH}): ${uniq.size} selector(s) below the threshold` : `OK (${THEME}, ${STATE}, threshold ${THRESH}): ${checked} elements`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
