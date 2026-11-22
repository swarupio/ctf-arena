// Lighthouse over the production build with stubbed auth and API (see docs/LIGHTHOUSE.md).
//   DIST=<built dir> PERF_TOOLS=<dir with lighthouse and puppeteer-core installed> node lighthouse.cjs
// Optional: THROTTLING=devtools (real CDP throttling instead of simulated)  PRESETS=mobile,desktop  ONLY=/,/login  PORT=5492  OUT=<json file>  CHROME=<path>  JSON_DIR=<dir for full reports>
// Simulated throttling (Lighthouse defaults: mobile = Slow 4G + 4x CPU, desktop = no CPU slowdown, 40 ms RTT, 10 Mbit/s).
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { startServer } = require('./perfserver.cjs');

const tools = createRequire(path.resolve(process.env.PERF_TOOLS || '.', 'package.json'));
const puppeteer = (() => { try { return tools('puppeteer-core'); } catch { return require(process.env.PUPPETEER_CORE || 'puppeteer-core'); } })();
const PORT = Number(process.env.PORT || 5492);
const PAGES = [['/', 'anon'], ['/login', 'anon'], ['/range', 'player'], ['/challenges', 'player'], ['/skills', 'anon'], ['/leaderboard', 'player'], ['/demo', 'anon'], ['/terminal/easy', 'player'], ['/weblab/weblab-sqli-login', 'player'], ['/admin', 'admin']];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const presets = (process.env.PRESETS || 'mobile,desktop').split(',');
const CATS = ['performance', 'accessibility', 'best-practices', 'seo'];

async function main() {
  const lhPath = tools.resolve('lighthouse');
  const lhDir = path.dirname(lhPath);
  const lhMod = await import(pathToFileURL(tools.resolve('lighthouse')).href);
  const lighthouse = lhMod.default;
  const desktopConfig = (await import(pathToFileURL(path.join(lhDir, '..', 'core', 'config', 'desktop-config.js')).href)).default;
  const server = await startServer({ dist: path.resolve(process.env.DIST), port: PORT });
  const results = [];
  const launch = () => puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  try {
    for (const preset of presets) {
      for (const [p, as] of PAGES) {
        if (only && !only.includes(p)) continue;
        const url = `http://127.0.0.1:${PORT}${p}?as=${as}`;
        const flags = { output: 'json', logLevel: 'error', onlyCategories: CATS, ...(process.env.THROTTLING ? { throttlingMethod: process.env.THROTTLING } : {}) };
        // A fresh Chrome per run: isolated profile and no leftover tab state (reusing one browser sometimes closed the target).
        const browser = await launch();
        let r;
        try { r = await lighthouse(url, { ...flags, port: Number(new URL(browser.wsEndpoint()).port) }, preset === 'desktop' ? desktopConfig : undefined); } finally { await browser.close(); }
        const lhr = r.lhr; const a = lhr.audits;
        const score = (id) => Math.round((lhr.categories[id].score ?? 0) * 100);
        const issues = [];
        for (const [id, au] of Object.entries(a)) {
          if (au.score === null || au.score === undefined || au.score >= 0.9 || au.scoreDisplayMode === 'informative' || au.scoreDisplayMode === 'notApplicable' || au.scoreDisplayMode === 'manual') continue;
          issues.push(`${id}${au.details?.overallSavingsMs ? ` (-${Math.round(au.details.overallSavingsMs)}ms)` : ''}`);
        }
        const row = {
          page: p, preset, perf: score('performance'), a11y: score('accessibility'), bp: score('best-practices'), seo: score('seo'),
          lcp: Math.round(a['largest-contentful-paint'].numericValue), tbt: Math.round(a['total-blocking-time'].numericValue), cls: +a['cumulative-layout-shift'].numericValue.toFixed(3),
          fcp: Math.round(a['first-contentful-paint'].numericValue), tti: Math.round(a.interactive.numericValue), si: Math.round(a['speed-index'].numericValue),
          kb: Math.round(a['total-byte-weight'].numericValue / 1000), issues,
        };
        results.push(row);
        console.error(`${preset} ${p}: P${row.perf} A${row.a11y} BP${row.bp} SEO${row.seo} LCP ${row.lcp} TBT ${row.tbt} CLS ${row.cls}`);
        if (process.env.JSON_DIR) { fs.mkdirSync(process.env.JSON_DIR, { recursive: true }); fs.writeFileSync(path.join(process.env.JSON_DIR, `${preset}${p.replace(/\//g, '_') || '_'}.json`), r.report); }
      }
    }
  } finally { server.close(); }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
  console.log('| Page | Preset | Perf | A11y | BP | SEO | LCP ms | TBT ms | CLS | FCP ms | TTI ms | KB | Failing audits |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) console.log(`| ${r.page} | ${r.preset} | ${r.perf} | ${r.a11y} | ${r.bp} | ${r.seo} | ${r.lcp} | ${r.tbt} | ${r.cls} | ${r.fcp} | ${r.tti} | ${r.kb} | ${r.issues.join(', ')} |`);
}
main().catch((e) => { console.error(e); process.exit(1); });
