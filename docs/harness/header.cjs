// Header account area check (usage: PPTR=<puppeteer-core path> BASE=http://127.0.0.1:<port> OUT=<dir> node header.cjs; the harness dev server from vite.config.js must run).
// Roles owner (24 character address, single-word display name), admin and player (two-word name) at 1101 to 1920 px in light and dark: one nav row, the account box, Logout and the theme button share one height and top,
// the address text is hidden in the wide header, no horizontal overflow, and the footer 'Use device setting' line appears only after the header switch was used and disappears when it is clicked.
const puppeteer = require(process.env.PPTR);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const rows = []; const fails = [];
  for (const role of ['owner', 'admin', 'player']) for (const theme of ['light', 'dark']) for (const w of [1101, 1200, 1273, 1366, 1440, 1920]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 700, deviceScaleFactor: 1.5 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await page.setRequestInterception(true);
    page.on('request', (req) => { const u = new URL(req.url()); if (!u.pathname.startsWith('/api/')) return req.continue(); req.respond({ status: 200, contentType: 'application/json', body: u.pathname === '/api/me' ? JSON.stringify({ displayName: role === 'player' ? 'Ada Lovelace' : 'zer0cool', team: null }) : '[]' }); });
    await page.goto(process.env.BASE + '/?as=' + role, { waitUntil: 'networkidle2', timeout: 9000 }).catch(() => {});
    await wait(600);
    const m = await page.evaluate(() => {
      const r = (el) => el && el.getBoundingClientRect();
      const hdr = document.querySelector('.site-header'); const nav = hdr.querySelector('nav'); const acc = hdr.querySelector('.account');
      const av = acc.querySelector('.avatar'); const email = acc.querySelector('.email'); const logout = acc.querySelector('button.small'); const tog = acc.querySelector('.theme-btn');
      const links = [...nav.querySelectorAll('a')].map((a) => Math.round(r(a).top));
      const foot = document.querySelector('.site-footer');
      return {
        hdrH: Math.round(r(hdr).height), navRows: new Set(links).size,
        avatarText: av ? av.textContent : null, avatarSolo: av ? av.classList.contains('is-solo') : null, avatarLabel: av ? av.getAttribute('aria-label') : null,
        emailShown: email ? getComputedStyle(email).display !== 'none' : null,
        h: [av, logout, tog].map((e) => e ? Math.round(r(e).height) : null), w: [av, tog].map((e) => e ? Math.round(r(e).width) : null),
        tops: [av, logout, tog].map((e) => e ? Math.round(r(e).top) : null),
        footerAuto: foot ? !!foot.querySelector('.theme-auto-line') : null,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    rows.push({ role, theme, w, ...m });
    const bad = [];
    if (m.navRows !== 1) bad.push('nav wraps into ' + m.navRows + ' rows');
    if (m.hdrH > 90) bad.push('header height ' + m.hdrH);
    if (new Set(m.h).size !== 1) bad.push('control heights differ ' + m.h.join('/'));
    if (m.w[0] !== m.h[0] || m.w[1] !== m.h[2]) bad.push('boxes not square ' + m.w.join('/') + ' vs ' + m.h.join('/'));
    if (new Set(m.tops).size !== 1) bad.push('controls misaligned ' + m.tops.join('/'));
    if (m.emailShown) bad.push('email text still shown in the wide header');
    if (m.footerAuto) bad.push('footer shows the device-setting line before any choice');
    if (m.overflowX) bad.push('horizontal overflow');
    if (bad.length) fails.push(role + ' ' + theme + ' ' + w + ': ' + bad.join('; '));
    if (theme === 'light' && w === 1273) await page.screenshot({ path: process.env.OUT + '/hdr2_' + role + '_1273.png', clip: { x: 573, y: 0, width: 700, height: 90 } });
    // footer after the first click on the header switch
    if (theme === 'light' && w === 1273) {
      await page.click('.theme-btn'); await wait(300);
      const after = await page.evaluate(() => ({ line: document.querySelector('.theme-auto-line')?.textContent ?? null, stored: localStorage.getItem('ctf.theme') }));
      await page.screenshot({ path: process.env.OUT + '/foot2_' + role + '.png', clip: { x: 0, y: 0, width: 1273, height: 700 } });
      await page.evaluate(() => document.querySelector('.theme-auto-btn')?.click()); await wait(300);
      const back = await page.evaluate(() => ({ line: document.querySelector('.theme-auto-line')?.textContent ?? null, stored: localStorage.getItem('ctf.theme') }));
      console.log(role, '1273 click ->', JSON.stringify(after), '| use device setting ->', JSON.stringify(back));
      if (!after.line || !/Use device setting/.test(after.line) || back.line || back.stored) fails.push(role + ': footer line behaviour wrong');
    }
    await page.close();
  }
  await browser.close();
  console.log('role width | hdrH rows | avatar (solo) | heights');
  for (const r of rows.filter((x) => x.theme === 'light')) console.log([r.role, r.w, '|', r.hdrH, r.navRows, '|', JSON.stringify(r.avatarText), r.avatarSolo ? 'solo' : 'two', '|', r.h.join('/')].join(' '));
  console.log(fails.length ? 'FAIL (' + fails.length + '):\n' + fails.join('\n') : 'OK: avatar box, equal even heights, one nav row, no overflow, footer line only after a choice');
  process.exit(fails.length ? 1 : 0);
})();
