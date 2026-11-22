// Arena Terminal on short landscape phones (and one portrait): run 6 commands, open the HUD and the hint bar, then simulate the
// on-screen keyboard (viewport height x 0.55). Reports horizontal overflow, off-screen elements and whether the window and the
// input row stay inside the viewport. usage: PORT=5480 PUPPETEER_CORE=... CHROME=... node terminal.cjs
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');
const { route } = require('./data.cjs'); const ov = require('./ovdata.cjs'); const { makeHandler } = require('./playhandler.cjs');
const PORT = process.env.PORT || 5480; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[568, 320], [667, 375], [740, 360], [844, 390], [896, 414], [932, 430], [320, 568]];
const MODES = (process.env.MODES || 'easy,medium,hard').split(',');
const UA = puppeteer.KnownDevices['iPhone SE'].userAgent;
function measure() {
  const de = document.documentElement; const vw = de.clientWidth; const vh = innerHeight;
  const clipped = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { if (getComputedStyle(n).overflowX !== 'visible') { return true; } } return false; };
  const off = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none' || st.position === 'fixed') { continue; }
    if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) { off.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]); }
  }
  const win = document.querySelector('.tm-window'); const input = document.querySelector('.tm-input'); const wr = win ? win.getBoundingClientRect() : null; const ir = input ? input.getBoundingClientRect() : null;
  return { sw: de.scrollWidth, cw: vw, sh: de.scrollHeight, vh, off: off.slice(0, 4), winBottom: wr ? Math.round(wr.bottom) : null, winH: wr ? Math.round(wr.height) : null, inputInView: !!ir && ir.top >= 0 && ir.bottom <= vh };
}
(async () => {
  const json = (req, status, body) => req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const play = await makeHandler((req, p) => json(req, 200, route(p, {})));
  const gp = /^\/(cipherlab|crackme|forensics|osint|terminal|weblab)(\/|$)/;
  const handler = (req) => { const u = new URL(req.url()); if (!u.pathname.startsWith('/api/')) { return req.continue(); } const p = u.pathname.slice(4); if (ov[p]) { return json(req, 200, ov[p]); } if (gp.test(p)) { return play(req); } return json(req, 200, route(p, {})); };
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  let bad = 0;
  console.log('mode   size     stage      sw/cw    page h/vh   window bottom  input  off-screen');
  for (const mode of MODES) {
    for (const [w, h] of SIZES) {
      const page = await browser.newPage(); await page.setUserAgent(UA);
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: w > h });
      await page.setRequestInterception(true); page.on('request', handler);
      await page.goto(`http://127.0.0.1:${PORT}/terminal/${mode}?as=player`, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
      await wait(2500); // boot lines
      const row = (stage, m) => { const ok = m.sw <= m.cw && m.off.length === 0; if (!ok) { bad++; } console.log(mode.padEnd(6), `${w}x${h}`.padEnd(8), stage.padEnd(10), `${m.sw}/${m.cw}`.padEnd(8), `${m.sh}/${m.vh}`.padEnd(11), String(m.winBottom).padEnd(14), String(m.inputInView).padEnd(6), ok ? 'ok' : 'OVERFLOW ' + m.off.join(' ')); };
      row('loaded', await page.evaluate(measure));
      for (const cmd of ['help', 'ls', 'pwd', 'whoami', 'cat notes.txt', 'echo hello']) { await page.focus('.tm-input').catch(() => {}); await page.keyboard.type(cmd); await page.keyboard.press('Enter'); await wait(500); }
      row('6 cmds', await page.evaluate(measure));
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Show HUD/.test(x.textContent)); if (b) { b.click(); } }); await wait(300);
      row('HUD open', await page.evaluate(measure));
      for (const label of ['Hints', 'Next hint']) { await page.evaluate((l) => { const b = [...document.querySelectorAll('.tm-hint-btn')].find((x) => x.textContent.trim() === l); if (b && !b.disabled) { b.click(); } }, label); await wait(800); }
      row('hint bar', await page.evaluate(measure));
      await page.setViewport({ width: w, height: Math.round(h * 0.55), deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: w > h }); await wait(500);
      await page.evaluate(() => { const e = document.querySelector('.tm-input'); if (e) { e.focus(); e.scrollIntoView({ block: 'nearest' }); } }); await wait(300);
      row('keyboard', await page.evaluate(measure));
      await page.close();
    }
  }
  await browser.close();
  console.log(bad === 0 ? 'ALL OK' : bad + ' stage(s) overflow');
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
