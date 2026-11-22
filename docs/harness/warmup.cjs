// Loads the harness dev server once in headless Chrome so Vite finishes its first-request work (dependency pre-bundling,
// the lazy page chunks) before the timed checks start. Without it the first page of the first check can hit its 9 s
// navigation timeout on a cold CI runner. usage: PORT=5480 node warmup.cjs   (the dev server from vite.config.js must run)
const { launchBrowser, loadPuppeteer } = require('./env.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:' + (process.env.PORT || 5480);
const ROUTES = ['/?as=player', '/challenges?as=player', '/terminal/easy?as=player', '/admin?as=admin', '/login?as=anon'];

(async () => {
  const browser = await launchBrowser(loadPuppeteer());
  try {
    for (const route of ROUTES) {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = new URL(req.url());
        if (!url.pathname.startsWith('/api/')) { return req.continue(); }
        return req.respond({ status: 200, contentType: 'application/json', body: '[]' });
      });
      await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 90000 }).catch((error) => console.error('warm-up', route, error.message));
      await page.close();
    }
    console.log('warm-up done');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
