// Prints the size of every built frontend asset and fails when a budget is exceeded.
// Usage: node deploy/bundle-size.mjs [distDir]   (default: frontend/dist)
// Budgets are about 30% above the PRODUCTION build measured on 2026-11-22 after the NODE_ENV fix in
// frontend/vite.config.js (JS 1.18 MB, largest chunk 223 kB (react), entry 38.5 kB, CSS 211 kB). The first
// budgets were set from a development-mode React build by mistake. If the react chunk is about 430 kB again,
// the development build is back. They catch an accidental big dependency, not normal growth: raise on purpose.
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = {
  totalJs: 1_550_000,
  largestJs: 290_000,
  entryJs: 50_000,
  totalCss: 280_000,
};

const dist = process.argv[2] ?? 'frontend/dist';
const dir = join(dist, 'assets');
const files = readdirSync(dir)
  .filter((name) => /\.(js|css)$/.test(name))
  .map((name) => {
    const body = readFileSync(join(dir, name));
    return { name, ext: name.split('.').pop(), raw: body.length, gzip: gzipSync(body).length };
  })
  .sort((a, b) => b.raw - a.raw);

const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
const sum = (list) => list.reduce((total, file) => total + file.raw, 0);
const js = files.filter((file) => file.ext === 'js');
const css = files.filter((file) => file.ext === 'css');
const entry = js.find((file) => file.name.startsWith('index-'));

const measured = {
  totalJs: sum(js),
  largestJs: js[0]?.raw ?? 0,
  entryJs: entry?.raw ?? 0,
  totalCss: sum(css),
};

const lines = ['| asset | size | gzip |', '|---|---|---|'];
for (const file of files.slice(0, 15)) { lines.push(`| ${file.name} | ${kb(file.raw)} | ${kb(file.gzip)} |`); }
lines.push('', '| budget | measured | limit |', '|---|---|---|');
const failures = [];
for (const [key, limit] of Object.entries(BUDGET)) {
  lines.push(`| ${key} | ${kb(measured[key])} | ${kb(limit)} |`);
  if (measured[key] > limit) { failures.push(`${key} ${kb(measured[key])} is over the ${kb(limit)} budget`); }
}
if (!entry) { failures.push('entry chunk index-*.js not found: has the build output layout changed?'); }
// The aws-amplify chunk (about 40 kB gzip) is loaded on demand for signed-out visitors (frontend/src/auth/session.js).
// If index.html preloads it, a static import of aws-amplify crept back into the entry closure.
try {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  if (html.includes('/assets/amplify-')) { failures.push('index.html references the amplify chunk: the auth code is loaded in the first load again'); }
} catch { failures.push('index.html not found in the dist directory'); }

process.stdout.write(`${lines.join('\n')}\n`);
if (process.env.GITHUB_STEP_SUMMARY) { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Frontend bundle size\n\n${lines.join('\n')}\n`); }
if (failures.length > 0) {
  process.stderr.write(`Bundle budget exceeded:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}
