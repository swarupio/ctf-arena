const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const { route } = require('./data.cjs'); const ov = require('./ovdata.cjs'); const { makeHandler } = require('./playhandler.cjs');
const K = puppeteer.KnownDevices; const PORT = process.env.PORT || 5480; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const json = (req, status, body) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const play = await makeHandler((req, p) => json(req, 200, route(p, {})));
  const gp = /^\/(cipherlab|crackme|forensics|osint|terminal|weblab)(\/|$)/;
  const handler = (req) => { const u = new URL(req.url()); if (!u.pathname.startsWith('/api/')) { return req.continue(); } const p = u.pathname.slice(4); if (ov[p]) { return json(req, 200, ov[p]); } if (gp.test(p)) { return play(req); } return json(req, 200, route(p, {})); };
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  async function open(path, dev) {
    const page = await browser.newPage(); await page.emulate(K[dev]); await page.setRequestInterception(true); page.on('request', handler);
    await page.goto(`http://127.0.0.1:${PORT}${path}${path.includes('?') ? '&' : '?'}as=player`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}); await wait(800); return page;
  }
  const dev = 'iPhone 14 Pro Max'; if (process.env.KB) { } 
  // 1. OSINT board: pin two items by tapping, drag one pin by touch, check it moved
  {
    const page = await open('/osint/easy', dev);
    const tapText = async (sel, text) => { const h = await page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((x) => x.textContent.trim().startsWith(t)), sel, text); const el = h.asElement(); if (!el) { return false; } await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); await wait(150); await el.tap(); return true; };
    const pinned = []; await tapText('[role=tab]', 'Case board'); await wait(1500);
    for (let i = 0; i < 2; i++) { const h = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((x) => /^Pin (?!to)/.test(x.textContent.trim()) && !x.disabled)); const el = h.asElement(); if (el) { await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); await wait(150); await el.tap(); pinned.push(true); } await wait(600); }
    await page.evaluate(() => window.scrollTo(0, 0)); await wait(300);
    const pin = await page.$('.os-pin');
    if (!pin) { console.log('OSINT board: no pin found', pinned); } else {
      await pin.evaluate((e) => e.scrollIntoView({ block: 'center' })); await wait(200);
      const before = await pin.evaluate((e) => [e.style.getPropertyValue('--x'), e.style.getPropertyValue('--y')]); const box = await pin.boundingBox();
      const sx = box.x + box.width / 2; const sy = box.y + box.height / 2;
      await page.touchscreen.touchStart(sx, sy); for (let i = 1; i <= 8; i++) { await page.touchscreen.touchMove(sx + i * 12, sy + i * 6); await wait(30); } await page.touchscreen.touchEnd(); await wait(600);
      const after = await pin.evaluate((e) => [e.style.getPropertyValue('--x'), e.style.getPropertyValue('--y')]);
      const scrollY = await page.evaluate(() => window.scrollY);
      console.log('OSINT pin touch drag', JSON.stringify(before), '->', JSON.stringify(after), after[0] !== before[0] || after[1] !== before[1] ? 'MOVED (pointer events work on touch)' : 'NOT MOVED', 'touch-action', await pin.evaluate((e) => getComputedStyle(e).touchAction));
    }
    await page.close();
  }
  // 2. keyboard simulation: shrink the viewport height like an on-screen keyboard and check the focused field stays in view
  for (const [path, sel, name] of [['/terminal/easy', '.tm-input', 'terminal input'], ['/reversing/e1', '.cm-input input', 'crackme answer'], ['/osint/easy', 'input[type=search]', 'osint search'], ['/forensics/easy', 'input[type=text], input:not([type])', 'forensics answer']]) {
    for (const d of ['iPhone SE', 'iPhone 14 Pro Max']) {
      const page = await open(path, d); const el = await page.$(sel);
      if (!el) { console.log('KEYBOARD', name, d, 'field not found'); await page.close(); continue; }
      await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); await el.focus(); const vp = K[d].viewport;
      await page.setViewport({ ...vp, height: Math.round(vp.height * 0.55) }); await wait(500); // keyboard open
      await el.evaluate((e) => e.scrollIntoView({ block: 'nearest' })); await wait(200);
      const r = await el.evaluate((e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight, fs: getComputedStyle(e).fontSize }; });
      const win = await page.evaluate(() => { const w = document.querySelector('.tm-window'); if (!w) return null; const b = w.getBoundingClientRect(); return { h: Math.round(b.height), top: Math.round(b.top) }; });
      console.log('KEYBOARD', name.padEnd(16), d.padEnd(18), JSON.stringify(r), win ? 'window ' + JSON.stringify(win) : '', r.top >= 0 && r.bottom <= r.vh ? 'VISIBLE' : 'HIDDEN');
      await page.close();
    }
  }
  await browser.close();
})();
