const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core'); const { route } = require('./data.cjs'); const K = puppeteer.KnownDevices; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const cases = [['iPhone SE', {}], ['iPhone SE landscape', {}], ['iPhone SE', { f20: true }], ['iPad Mini', { f20: true }], ['iPad Mini', { zoom: true }], ['desktop', { w: 1366, h: 768, zoom: true }], ['desktop', { w: 1366, h: 768, f20: true }], ['desktop', { w: 1100, h: 700 }]];
  for (const [dev, o] of cases) {
    const page = await browser.newPage();
    if (dev === 'desktop') { await page.setViewport({ width: o.zoom ? o.w / 2 : o.w, height: o.zoom ? o.h / 2 : o.h, deviceScaleFactor: o.zoom ? 2 : 1 }); } else { const d = K[dev]; await page.emulate(d); if (o.zoom) { await page.setViewport({ ...d.viewport, width: d.viewport.width / 2, height: d.viewport.height / 2, deviceScaleFactor: d.viewport.deviceScaleFactor * 2 }); } }
    if (o.f20) { await page.evaluateOnNewDocument(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'html{font-size:20px !important}'; document.head.appendChild(s); }); }); }
    await page.setRequestInterception(true); page.on('request', (req) => { const u = new URL(req.url()); if (!u.pathname.startsWith('/api/')) { return req.continue(); } req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(route(u.pathname.slice(4), {})) }); });
    await page.goto(`http://127.0.0.1:${process.env.PORT || 5480}/?as=player`, { waitUntil: 'networkidle2' }).catch(() => {}); await wait(700);
    const toggle = await page.$('.menu-toggle'); const vis = toggle ? await toggle.evaluate((e) => getComputedStyle(e).display !== 'none') : false;
    if (vis) { await toggle.tap ? await toggle.click() : 0; await wait(300); }
    const m = await page.evaluate(() => { const vw = document.documentElement.clientWidth; const links = [...document.querySelectorAll('.site-header nav a')]; const hid = links.filter((a) => a.getBoundingClientRect().height === 0).length; const out = links.filter((a) => { const r = a.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; }).length; const lo = document.querySelector('.site-header .account button'); return { vw, vh: innerHeight, toggle: !!document.querySelector('.menu-toggle') && getComputedStyle(document.querySelector('.menu-toggle')).display !== 'none', links: links.length, hidden: hid, outside: out, sw: document.documentElement.scrollWidth, hdrH: Math.round(document.querySelector('.site-header').getBoundingClientRect().height), logout: lo ? Math.round(lo.getBoundingClientRect().right) : null }; });
    console.log((dev + ' ' + JSON.stringify(o)).padEnd(46), JSON.stringify(m), m.hidden === 0 && m.outside === 0 && m.sw <= m.vw ? 'OK' : 'CHECK');
    await page.screenshot({ path: `${__dirname}/out/menu_${dev.replace(/\W+/g, '_')}_${o.zoom ? 'zoom' : o.f20 ? 'f20' : 'std'}_${o.w || ''}.png` });
    await page.close();
  }
  await browser.close();
})();
