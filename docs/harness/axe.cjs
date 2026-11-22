// axe-core over every page state of pages.cjs, light and dark (see docs/LIGHTHOUSE.md). Exit code 1 when a serious or
// critical violation is found that is not in ALLOWLIST.
//   DIST=<built dir> PERF_TOOLS=<dir with axe-core and puppeteer-core installed> node axe.cjs
// Optional: THEMES=light,dark  ONLY=home,login (name prefixes)  PORT=5493  SUMMARY=1 (counts by rule only)  CHROME=<path>
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');
const { startServer } = require('./perfserver.cjs');
const PAGES = require('./pages.cjs');

const tools = createRequire(path.resolve(process.env.PERF_TOOLS || '.', 'package.json'));
const puppeteer = (() => { try { return tools('puppeteer-core'); } catch { return require(process.env.PUPPETEER_CORE || 'puppeteer-core'); } })();
const axeSource = fs.readFileSync(tools.resolve('axe-core/axe.min.js'), 'utf8');
const PORT = Number(process.env.PORT || 5493);
const themes = (process.env.THEMES || 'light,dark').split(',');
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Documented exceptions: [rule, regex tested against the axe selector, reason]. Keep it short; every line needs a reason.
const ALLOWLIST = [
  ['label-content-name-mismatch', /\.cm-row|button\[aria-label="Address /, 'Crackme listing row: the name is one spoken sentence (address, instruction, comment, state); the visible columns are aria-hidden pieces of it'],
  ['label-content-name-mismatch', /\.tm-chip--mail/, 'Terminal mail chip: the visible text carries an unread counter badge, the label is "mail, N unread messages" (asserted by tests/terminalStory.test.js)'],
  ['label-content-name-mismatch', /points"\]|a\[href\$="[a-z]+\d+"\]|\.wl-card/, 'Web Lab card link: the name is "<title>, <state>, <points>" on purpose, the card prose is not repeated'],
  ['label-content-name-mismatch', /^g\[transform=/, 'Crackme control-flow graph node (SVG group): the name summarises the block, the drawn text is its raw instructions'],
  ['color-contrast', /\.cm-addr|\.cm-dim/, 'Crackme listing: dim address and xref text on the dark code panel and the current-row highlight (3.9:1 and 2.6:1 in light); crackme theme work, see docs/FIXLOG.md'],
];
const allowed = (rule, target) => ALLOWLIST.some(([r, sel]) => r === rule && sel.test(String(target)));

async function main() {
  const server = await startServer({ dist: path.resolve(process.env.DIST), port: PORT });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const byRule = {}; const failures = []; const detail = [];
  try {
    for (const theme of themes) {
      for (const [name, p, as] of PAGES) {
        if (only && !only.some((o) => name === o || name.startsWith(o))) continue;
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('ctf.theme', JSON.stringify(t)); } catch { /* blocked */ } }, theme);
        if (theme === 'dark') await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        try { await page.goto(`http://127.0.0.1:${PORT}${p}${p.includes('?') ? '&' : '?'}as=${as}`, { waitUntil: 'networkidle2', timeout: 15000 }); } catch (e) { console.error('goto', name, e.message); }
        await wait(700);
        await page.evaluate(axeSource);
        const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] }));
        for (const v of res.violations) {
          const nodes = v.nodes.filter((n) => !allowed(v.id, n.target.join(' ')));
          if (!nodes.length) continue;
          const key = `${v.id} (${v.impact})`;
          byRule[key] = (byRule[key] || 0) + nodes.length;
          detail.push({ page: name, theme, rule: v.id, impact: v.impact, count: nodes.length, sample: nodes.slice(0, 3).map((n) => n.target.join(' ') + ' | ' + (n.any[0]?.message || n.all[0]?.message || n.none[0]?.message || '').slice(0, 120)) });
          if (v.impact === 'serious' || v.impact === 'critical') failures.push(`${name} [${theme}] ${v.id} x${nodes.length}`);
        }
        await page.close();
      }
    }
  } finally { await browser.close(); server.close(); }
  console.log('| Rule (impact) | Violating nodes |\n|---|---|');
  for (const [k, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`| ${k} | ${n} |`);
  if (!process.env.SUMMARY) { console.log(); for (const d of detail) console.log(`${d.page} [${d.theme}] ${d.rule} (${d.impact}) x${d.count}\n   ${d.sample.join('\n   ')}`); }
  if (failures.length) { console.error(`\nSerious/critical violations (${failures.length}):\n- ${failures.join('\n- ')}`); process.exit(1); }
  console.log('\nNo serious or critical violations.');
}
main().catch((e) => { console.error(e); process.exit(1); });
