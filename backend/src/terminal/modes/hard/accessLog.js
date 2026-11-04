// Deterministic nginx access logs for the Hard mode. The main log has 8,000+ lines (all from gen.js, seeded).
//
// Puzzle (code 1): exactly one request comes from an address that appears nowhere else in the log AND was
// answered with HTTP 200. It is a POST to /internal/rotate whose ref= value is the code, hex-encoded after
// being reversed ({{flag:1|rev|hex}}). Two other one-off addresses are tripwires (403 and 404), a scanner
// produces a loud 404 storm, and a brute-force bot hammers /internal/rotate with 401s.
// The address of the real request and its kid are per team seed tokens ({{seed:ip:1}}, {{seed:word:1}}); every
// other address in this file stays out of 198.51.100.0/24 and 203.0.113.0/24, so a seed address is always unique.
import { rng, int, pick, hex, ip } from '../../gen.js';
import { WEB, KID_WEB, SEED_IP_RANGE, DECOY_ENCODED, hexOf, reverse } from './constants.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const at = (iso) => Date.parse(iso) / 1000;

function clf(sec) {
  const d = new Date(sec * 1000);
  const day = `${pad(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
  return `${day}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

const UA = {
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) Safari/605.1',
  lin: 'Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Firefox/123.0',
  iph: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3) Mobile/15E148',
  bot: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
  mon: 'NovaMonitor/1.4',
  cron: 'NovaCron/1.4',
  curl: 'curl/7.81.0',
  go: 'Go-http-client/1.1',
  zgrab: 'Mozilla/5.0 zgrab/0.x',
};
const BROWSERS = [UA.win, UA.win, UA.win, UA.mac, UA.mac, UA.lin, UA.iph, UA.iph, UA.bot];

const PATHS = [
  '/', '/', '/', '/', '/index.html', '/login', '/login', '/static/app.js', '/static/app.js', '/static/app.css',
  '/static/vendor.js', '/assets/logo.svg', '/favicon.ico', '/robots.txt', '/pricing', '/docs', '/docs/api',
  '/contact', '/about', '/careers', '/status', '/api/v1/status', '/api/v1/status', '/api/v1/orders',
  '/api/v1/profile', '/api/v1/items', '/sitemap.xml', '/blog',
];
const SLUGS = ['zero-trust-basics', 'q1-roadmap', 'meet-the-team', 'incident-reviews', 'release-notes-2-4', 'hiring-2024',
  'on-call-handbook', 'terraform-tips', 'rotating-secrets', 'why-we-love-nginx', 'backups-that-restore', 'sre-diaries'];
const SCAN_PATHS = ['/wp-login.php', '/.env', '/phpmyadmin/', '/.git/config', '/admin', '/xmlrpc.php',
  '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php', '/cgi-bin/luci', '/actuator/env', '/config.json',
  '/server-status', '/backup.zip', '/.aws/credentials', '/solr/admin/info/system', '/login.action', '/console'];
const BRUTE_KIDS = ['admin', 'root', 'test', 'ghost', 'default', 'nova', 'rotate', 'backup', 'key1', 'letmein'];
const REFERERS = ['-', '-', '-', '-', 'https://www.novacorp.example/', 'https://www.novacorp.example/pricing',
  'https://search.example/?q=novacorp'];

const STATUS = [
  ...Array(70).fill(200), ...Array(10).fill(304), ...Array(4).fill(301), ...Array(7).fill(404),
  ...Array(2).fill(403), ...Array(3).fill(401), ...Array(2).fill(500), 502,
];

function bytesFor(r, status) {
  if (status === 304) { return 0; }
  if (status === 301) { return 185; }
  if (status === 200) { return int(r, 210, 48000); }
  return int(r, 120, 900);
}

function format(e) {
  return `${e.ip} - - [${clf(e.t)}] "${e.method} ${e.path} HTTP/1.1" ${e.status} ${e.bytes} "${e.referer}" "${e.ua}"`;
}

const RESERVED = new Set(Object.values(WEB));

function makePool(r, size) {
  const pool = new Set();
  while (pool.size < size) {
    const candidate = ip(r);
    if (!RESERVED.has(candidate) && !SEED_IP_RANGE.test(candidate)) { pool.add(candidate); }
  }
  return [...pool];
}

function noiseEntry(r, t, who) {
  if (who.startsWith('10.0.0.')) {
    return { t, ip: who, method: 'GET', path: '/healthz', status: 200, bytes: 2, referer: '-', ua: UA.mon };
  }
  const roll = r();
  let path = pick(r, PATHS);
  if (roll < 0.12) { path = `/api/v1/items?page=${int(r, 1, 30)}`; }
  else if (roll < 0.2) { path = `/blog/${pick(r, SLUGS)}`; }
  else if (roll < 0.24) { path = `/api/v1/download?id=${int(r, 100, 999)}&sig=${hex(r, 64)}`; }
  let method = 'GET';
  if (path === '/login' || path === '/api/v1/orders') { method = r() < 0.4 ? 'POST' : 'GET'; }
  else if (path === '/' && r() < 0.03) { method = 'HEAD'; }
  const status = pick(r, STATUS);
  return { t, ip: who, method, path, status, bytes: bytesFor(r, status), referer: pick(r, REFERERS), ua: pick(r, BROWSERS) };
}

// Builds one log. `specials` adds the puzzle lines of the main log (scanner storm, brute force, one-off addresses).
function buildLog({ seed, baseCount, start, gapMin, gapMax, specials }) {
  const r = rng(seed);
  const pool = makePool(r, 140);
  const everyone = [...pool, '10.0.0.6', '10.0.0.7'];
  const entries = [];
  let t = start;
  for (let i = 0; i < baseCount; i += 1) {
    t += int(r, gapMin, gapMax);
    entries.push(noiseEntry(r, t, pick(r, everyone)));
  }
  if (specials) {
    const end = t;
    // Scanner: three bursts of 404s. The loudest address in the log, and a red herring.
    for (const offset of [40000, 120000, 200000]) {
      let when = start + offset;
      for (let i = 0; i < 127; i += 1) {
        when += int(r, 0, 3);
        const status = r() < 0.9 ? 404 : 400;
        entries.push({ t: when, ip: WEB.scanner, method: 'GET', path: pick(r, SCAN_PATHS), status, bytes: int(r, 120, 600), referer: '-', ua: UA.zgrab });
      }
    }
    // Brute force against the rotation endpoint: all 401, no ref.
    for (let i = 0; i < 40; i += 1) {
      const when = at('2024-03-13T20:00:00Z') + int(r, 0, 5400);
      entries.push({ t: when, ip: WEB.brute, method: 'POST', path: `/internal/rotate?kid=${pick(r, BRUTE_KIDS)}`, status: 401, bytes: 52, referer: '-', ua: UA.curl });
    }
    // Legit rotation cron: POST 200 every six hours, never carries a ref.
    for (let k = 0; k < 12; k += 1) {
      entries.push({ t: at('2024-03-11T03:00:00Z') + k * 21600, ip: WEB.cron, method: 'POST', path: '/internal/rotate', status: 200, bytes: 64, referer: '-', ua: UA.cron });
    }
    // Short ref= values on a harmless endpoint (so grep ref= is noisy), and a few odd user agents.
    for (let i = 0; i < 30; i += 1) {
      entries.push({ t: start + int(r, 0, end - start), ip: pick(r, pool), method: 'GET', path: `/api/v1/share?ref=${hex(r, 12)}`, status: 200, bytes: int(r, 300, 4000), referer: '-', ua: pick(r, BROWSERS) });
    }
    for (let i = 0; i < 15; i += 1) {
      const agent = i < 6 ? UA.curl : UA.go;
      entries.push({ t: start + int(r, 0, end - start), ip: pool[i % 4], method: 'GET', path: '/api/v1/status', status: 200, bytes: int(r, 80, 400), referer: '-', ua: agent });
    }
    // The three one-off addresses. Only the last one is answered with 200.
    entries.push({
      t: at('2024-03-13T23:09:41Z'), ip: WEB.tripwire, method: 'POST',
      path: `/internal/rotate?ref=${hexOf(reverse(DECOY_ENCODED.tripwireRef))}&kid=ember`,
      status: 403, bytes: 153, referer: '-', ua: UA.win,
    });
    entries.push({ t: at('2024-03-12T14:05:30Z'), ip: WEB.favicon, method: 'GET', path: '/favicon.ico', status: 404, bytes: 153, referer: '-', ua: UA.mac });
    entries.push({
      t: at('2024-03-13T23:12:07Z'), ip: WEB.real, method: 'POST',
      path: `/internal/rotate?ref={{flag:1|rev|hex}}&kid=${KID_WEB}`,
      status: 200, bytes: 64, referer: '-', ua: UA.win,
    });
  }
  const ordered = entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.t - b.entry.t || a.index - b.index);
  return `${ordered.map(({ entry }) => format(entry)).join('\n')}\n`;
}

export function buildAccessLog() {
  return buildLog({
    seed: 'hard-access-main', baseCount: 7900, start: at('2024-03-11T06:00:00Z'), gapMin: 1, gapMax: 64, specials: true,
  });
}

// Previous (rotated) log: pure noise, a different week. A wrong turn for anyone who stops at the first file.
export function buildRotatedAccessLog() {
  return buildLog({
    seed: 'hard-access-rotated', baseCount: 880, start: at('2024-03-07T18:00:00Z'), gapMin: 60, gapMax: 600, specials: false,
  });
}
