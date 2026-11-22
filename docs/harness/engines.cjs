// Cross-engine layout check with Playwright (WebKit and Firefox) on the same stubbed-auth pages as run.cjs.
// WebKit on Windows is the WebKit engine, not Safari on iOS (no real toolbar, keyboard, touch or safe-area insets).
// usage: PLAYWRIGHT=/path/to/node_modules/playwright PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers PORT=5480 ENGINES=webkit,firefox node engines.cjs
// Results: out/engines/results.json plus a summary on stdout.
const fs = require('fs');
const { chromium, webkit, firefox, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const { route } = require('./data.cjs');
const ov = require('./ovdata.cjs');
const { makeHandler } = require('./playhandler.cjs');
const PORT = process.env.PORT || 5480;
const BASE = 'http://127.0.0.1:' + PORT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const runSrc = fs.readFileSync(__dirname + '/run.cjs', 'utf8');
const measureSrc = runSrc.match(/function measure\(\) \{[\s\S]*?\r?\n\}\r?\n/)[0];
const WANT = ['home-anon', 'home', 'login', 'signup', 'mfa', 'hub', 'ov-cipherlab', 'ov-terminal', 'ov-weblab', 'ov-forensics', 'ov-reversing', 'ov-osint',
  'play-cipherlab', 'play-reversing', 'play-forensics', 'play-osint', 'play-weblab', 'play-terminal', 'leaderboard', 'profile', 'team', 'adm-overview', 'adm-settings'];
const pages = require('./pages.cjs').filter((p) => WANT.includes(p[0]));
pages.push(['skills', '/skills', 'player', 'skills']);
const DEVICES = {
  webkit: [['iPhone 13', devices['iPhone 13']], ['iPhone SE', devices['iPhone SE']], ['iPad Mini', devices['iPad Mini']], ['iPhone 13 landscape', devices['iPhone 13 landscape']]],
  firefox: [['Firefox 320x568', { viewport: { width: 320, height: 568 } }], ['Firefox 412x915', { viewport: { width: 412, height: 915 } }], ['Firefox 1366x768', { viewport: { width: 1366, height: 768 } }]],
  chromium: [['Chromium 390x844', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]],
};
// NARROW=160,200 swaps the device list for narrow-zoom viewports (width x 640) in each engine
if (process.env.NARROW) {
  for (const eng of Object.keys(DEVICES)) { DEVICES[eng] = process.env.NARROW.split(',').map((w) => [`${eng} narrow ${w}`, { viewport: { width: Number(w), height: 640 }, deviceScaleFactor: 2 }]); }
}
const featureProbe = () => {
  const s = (c) => CSS.supports(c);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:0;left:0;height:100dvh;padding-top:env(safe-area-inset-top)';
  document.body.appendChild(el);
  const dvh = el.getBoundingClientRect().height;
  el.remove();
  const btn = document.querySelector('button');
  const meta = document.querySelector('meta[name=viewport]');
  return {
    has: s('selector(:has(a))'), colorMix: s('color: color-mix(in srgb, red, blue)'), subgrid: s('grid-template-columns: subgrid'), min: s('width: min(10px, 100%)'),
    dvh: s('height: 100dvh'), env: s('padding-top: env(safe-area-inset-top)'), dvhPx: Math.round(dvh), innerH: innerHeight,
    hoverHover: matchMedia('(hover: hover)').matches, pointerCoarse: matchMedia('(pointer: coarse)').matches,
    touchAction: btn ? getComputedStyle(btn).touchAction : null, viewportMeta: meta ? meta.content : null,
  };
};
(async () => {
  const json = (r, status, body) => r.fulfill({ status, contentType: 'application/json', headers: { 'X-Served-By': 'replica-2' }, body: JSON.stringify(body) });
  const play = await makeHandler((req, p) => json(req.raw, 200, route(p, Object.fromEntries(new URL(req.url()).searchParams))));
  const gp = /^\/(cipherlab|crackme|forensics|osint|terminal|weblab)(\/|$)/;
  // the handlers were written for puppeteer requests: adapt a playwright route to that shape
  const adapt = (r) => ({ raw: r, url: () => r.request().url(), method: () => r.request().method(), postData: () => r.request().postData(), continue: () => r.continue(), respond: (o) => r.fulfill({ status: o.status, contentType: o.contentType, headers: o.headers, body: o.body }) });
  const handler = (r) => {
    const req = adapt(r);
    const u = new URL(req.url());
    const p = u.pathname.slice(4);
    if (ov[p]) { return json(r, 200, ov[p]); }
    if (p === '/challenges' || /^\/challenges\//.test(p)) { return json(r, 200, route(p, {})); }
    if (gp.test(p)) { return play(req); }
    return json(r, 200, route(p, Object.fromEntries(u.searchParams)));
  };
  const out = [];
  for (const eng of (process.env.ENGINES || 'webkit,firefox').split(',')) {
    const type = { webkit, firefox, chromium }[eng];
    let browser;
    try { browser = await type.launch(); } catch (e) { console.log(eng, 'LAUNCH FAILED', e.message.split('\n')[0]); continue; }
    for (const [dname, opts] of DEVICES[eng]) {
      const ctx = await browser.newContext({ ...opts });
      await ctx.route((url) => url.pathname.startsWith('/api/'), handler);
      let probe = null;
      for (const [name, path, as] of pages) {
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
        page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|Viewport argument key/.test(m.text())) { errs.push('console: ' + m.text().slice(0, 100)); } });
        try { await page.goto(`${BASE}${path}${path.includes('?') ? '&' : '?'}as=${as}`, { waitUntil: 'networkidle', timeout: 15000 }); } catch (e) { errs.push('goto ' + e.message.split('\n')[0].slice(0, 60)); }
        await wait(500);
        let m;
        try { m = await page.evaluate(`(${measureSrc})()`); } catch (e) { m = { err: e.message.slice(0, 80) }; }
        if (!probe && !m.err) { probe = await page.evaluate(featureProbe).catch(() => null); }
        out.push({ engine: eng, device: dname, name, ...m, errs });
        await page.close();
      }
      await ctx.close();
      const rows = out.filter((r) => r.engine === eng && r.device === dname);
      const touch = !!opts.hasTouch;
      const bad = rows.filter((r) => r.err || r.sw > r.cw || r.off?.length || r.errs.length);
      console.log(`${eng} / ${dname}: ${rows.length} pages, overflow ${rows.filter((r) => r.sw > r.cw).length}, off-screen ${rows.filter((r) => r.off?.length).length}, errors ${rows.filter((r) => r.errs.length).length}, small targets ${rows.filter((r) => r.small?.length).length}${touch ? '' : ' (no touch emulation)'}, inputs<16 ${rows.filter((r) => r.inputsUnder16?.length).length}, max fixed/sticky ${Math.max(...rows.map((r) => r.fixedFrac || 0))}`);
      for (const r of bad.slice(0, 12)) { console.log('   ', r.name, r.err || '', r.sw > r.cw ? `sw ${r.sw}/${r.cw}` : '', (r.off || []).slice(0, 2).join(' | '), r.errs.join(' | ')); }
      console.log('    features', JSON.stringify(probe));
    }
    await browser.close();
  }
  fs.mkdirSync(__dirname + '/out/engines', { recursive: true });
  fs.writeFileSync(__dirname + '/out/engines/results.json', JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
