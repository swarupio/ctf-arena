// Log artefact: a combined web-server and SSH auth log with an intrusion hidden in it.
// Line i is a pure function of (seed, i): a page costs O(page size) and nothing is kept between requests.
import { int, pick } from '../terminal/gen.js';
import {
  WORDS, clockText, homeIp, isoText, pageBounds, place, publicIp, rngFor,
} from './core.js';

export const LOG_PAGE_MAX = 500;

// Knobs per difficulty: more noise, slower attacker and more look-alike decoys as the track gets harder.
const LEVELS = {
  easy: { lines: 1500, step: 6, fails: 14, probes: 0, decoyBrute: 0, slow: false, vpn: false, adminDecoy: false, background: 0.05 },
  insane: { lines: 5000, step: 5, fails: 45, probes: 40, decoyBrute: 30, slow: true, vpn: true, adminDecoy: true, background: 0.4 },
};
export const logLevel = (level) => LEVELS[level] ?? LEVELS.easy;

const PATHS = ['/', '/index.html', '/login', '/static/app.js', '/static/site.css', '/api/v1/items', '/api/v1/orders', '/health',
  '/images/logo.png', '/about', '/pricing', '/favicon.ico', '/docs/guide.pdf', '/api/v1/session', '/contact', '/static/vendor.js'];
const AGENTS = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/124.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) Chrome/122.0 Safari/537.36', 'curl/8.4.0', 'Googlebot/2.1', 'python-requests/2.31.0'];
const PROBES = ['/wp-login.php', '/.env', '/phpmyadmin/', '/admin', '/.git/config', '/server-status', '/xmlrpc.php', '/backup.zip'];
const JUNK_USERS = ['admin', 'root', 'test', 'oracle', 'postgres', 'ubuntu', 'guest', 'git', 'pi', 'deploy'];
const START_HOUR = 1;
const DAY = Date.UTC(2026, 2, 14, START_HOUR, 0, 0);

const clf = (date) => {
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${String(date.getUTCDate()).padStart(2, '0')}/${month}/${date.getUTCFullYear()}:${clockText(date)} +0000`;
};
const clientIp = (seed, k) => publicIp(rngFor(seed, `cip:${k}`));

export function lineTime(seed, level, index) {
  const { step } = logLevel(level);
  const r = rngFor(seed, `t:${index}`);
  return new Date(DAY + (index * step + int(r, 0, step - 1)) * 1000);
}

const access = (date, ip, path, status, bytes, agent, user = '-') => (
  `${ip} - ${user} [${clf(date)}] "GET ${path} HTTP/1.1" ${status} ${bytes} "-" "${agent}"`);
const sshd = (date, pid, text) => `${isoText(date)} srv01 sshd[${pid}]: ${text}`;

// Per-line draws for planned events: seeded by the final line index, so the page that shows the line decides nothing.
const eventDraws = (seed, index) => {
  const r = rngFor(seed, `ev:${index}`);
  return { r, pid: () => int(r, 1000, 32000), port: () => int(r, 20000, 64000) };
};

// The planned intrusion. Built from the scenario in O(events); `events` maps line index -> function(date) => text.
export function logPlan(seed, level, scn) {
  const cfg = logLevel(level);
  const n = cfg.lines;
  const r = rngFor(seed, 'logplan');
  const events = new Map();
  const put = (frac, make, spread = 0.02) => place(events, Math.floor(n * (frac + r() * spread)), make, n);
  const atk = scn.attackerIp;

  for (let k = 0; k < cfg.probes; k += 1) {
    const path = pick(r, PROBES);
    put(0.05 + (k / cfg.probes) * 0.9, (d, q) => access(d, scn.scannerIp, path, pick(q.r, [404, 404, 403]), int(q.r, 150, 560), 'python-requests/2.31.0'), 0.01);
  }
  for (let k = 0; k < cfg.decoyBrute; k += 1) {
    const user = pick(r, JUNK_USERS);
    put(0.1 + (k / cfg.decoyBrute) * 0.8, (d, q) => sshd(d, q.pid(), `Failed password for invalid user ${user} from ${scn.decoyIp2} port ${q.port()} ssh2`), 0.01);
  }
  // Attacker guesses: bunched together on the easy track, spread out (low and slow) on the hard ones.
  const lo = cfg.slow ? 0.05 : 0.3;
  const hi = cfg.slow ? 0.5 : 0.48;
  for (let k = 0; k < cfg.fails; k += 1) {
    const user = k % 3 === 0 ? scn.victim : pick(r, [...JUNK_USERS, scn.lateral]);
    const invalid = user !== scn.victim && user !== scn.lateral;
    put(lo + (k / cfg.fails) * (hi - lo), (d, q) => sshd(d, q.pid(), `Failed password for ${invalid ? 'invalid user ' : ''}${user} from ${atk} port ${q.port()} ssh2`), 0.005);
  }
  if (cfg.vpn) {
    put(0.2, (d, q) => sshd(d, q.pid(), `Accepted password for ${scn.vpnUser} from ${scn.decoyIp} port ${q.port()} ssh2`));
    put(0.201, (d, q) => sshd(d, q.pid(), `pam_unix(sshd:session): session opened for user ${scn.vpnUser}(uid=1007) by (uid=0)`), 0);
    put(0.22, (d, q) => access(d, scn.decoyIp, `/download?file=report_q3.pdf`, 200, int(q.r, 200000, 900000), AGENTS[0], scn.vpnUser));
  }
  if (cfg.adminDecoy) {
    const name = `contractor-${pick(r, WORDS)}`;
    put(0.25, (d, q) => `${isoText(d)} srv01 sudo[${q.pid()}]: ${scn.admin} : TTY=pts/1 ; PWD=/home/${scn.admin} ; USER=root ; COMMAND=/usr/sbin/useradd -m ${name}`, 0);
    put(0.2501, (d, q) => `${isoText(d)} srv01 useradd[${q.pid()}]: new user: name=${name}, UID=1031, GID=1031, home=/home/${name}, shell=/bin/bash`, 0);
    put(0.7, (d, q) => access(d, `10.0.0.${int(q.r, 5, 40)}`, '/download?file=backup_nightly.tar.gz', 200, int(q.r, 150e6, 300e6), 'curl/8.4.0', scn.admin));
  }

  const breach = put(0.5, (d, q) => sshd(d, q.pid(), `Accepted password for ${scn.victim} from ${atk} port ${q.port()} ssh2`), 0.03);
  put(0.515, (d, q) => sshd(d, q.pid(), `pam_unix(sshd:session): session opened for user ${scn.victim}(uid=1002) by (uid=0)`), 0);
  const useradd = Math.floor(n * 0.54);
  place(events, useradd, (d, q) => `${isoText(d)} srv01 sudo[${q.pid()}]: ${scn.victim} : TTY=pts/0 ; PWD=/home/${scn.victim} ; USER=root ; COMMAND=/usr/sbin/useradd -m ${scn.backdoor}`, n);
  place(events, useradd + 1, (d, q) => `${isoText(d)} srv01 useradd[${q.pid()}]: new user: name=${scn.backdoor}, UID=1043, GID=1043, home=/home/${scn.backdoor}, shell=/bin/bash`, n);
  put(0.6, (d, q) => sshd(d, q.pid(), `Accepted password for ${scn.lateral} from ${atk} port ${q.port()} ssh2`));
  for (const file of ['passwords.txt', 'secrets.json', scn.exfilFile.replace('.tar.gz', '.zip')]) {
    put(0.64, (d, q) => access(d, atk, `/download?file=${file}`, pick(q.r, [403, 404]), int(q.r, 180, 420), 'curl/8.4.0'), 0.02);
  }
  const bytes = int(r, 40e6, 90e6);
  put(0.68, (d, q) => access(d, atk, `/download?file=${scn.exfilFile}`, 200, bytes, 'curl/8.4.0'), 0.02);
  return { events, breachIndex: breach, breachTime: clockText(lineTime(seed, level, breach)) };
}

// Background chatter for line i. Pure function of (seed, i).
function noiseLine(seed, level, scn, index) {
  const cfg = logLevel(level);
  const date = lineTime(seed, level, index);
  const r = rngFor(seed, `L:${index}`);
  const kind = r();
  const ip = clientIp(seed, int(r, 0, 59));
  if (kind < 0.68) {
    const status = pick(r, [200, 200, 200, 200, 200, 200, 304, 404, 404, 302, 500]);
    return access(date, ip, pick(r, PATHS), status, int(r, 120, 48000), pick(r, AGENTS));
  }
  if (kind < 0.76) {
    return access(date, ip, `/download?file=${pick(r, ['report_q3.pdf', 'handbook.pdf', 'price_list.csv'])}`, 200, int(r, 20000, 900000), AGENTS[0]);
  }
  if (kind < 0.93) {
    const user = pick(r, scn.users.slice(0, 12));
    const pid = int(r, 1000, 32000);
    const sub = r();
    if (sub < cfg.background) {
      const junk = pick(r, JUNK_USERS);
      return sshd(date, pid, `Failed password for invalid user ${junk} from ${clientIp(seed, int(r, 60, 120))} port ${int(r, 20000, 64000)} ssh2`);
    }
    if (sub < 0.55) { return sshd(date, pid, `Accepted password for ${user} from ${homeIp(seed, user)} port ${int(r, 20000, 64000)} ssh2`); }
    if (sub < 0.7) { return sshd(date, pid, `Failed password for ${user} from ${homeIp(seed, user)} port ${int(r, 20000, 64000)} ssh2`); }
    if (sub < 0.85) { return sshd(date, pid, `pam_unix(sshd:session): session closed for user ${user}`); }
    return sshd(date, pid, `Connection closed by ${ip} port ${int(r, 20000, 64000)} [preauth]`);
  }
  return `${isoText(date)} srv01 CRON[${int(r, 1000, 32000)}]: (root) CMD (${pick(r, ['run-parts /etc/cron.hourly', '/usr/local/bin/rotate-logs', 'test -x /usr/sbin/anacron'])})`;
}

// One page of lines, as plain strings. `plan` may be passed in when the caller already built it.
export function logPage(seed, level, scn, offset, limit, plan = logPlan(seed, level, scn)) {
  const { lines: total } = logLevel(level);
  const { start, size } = pageBounds(total, offset, limit, LOG_PAGE_MAX);
  const lines = [];
  for (let i = start; i < start + size; i += 1) {
    const event = plan.events.get(i);
    lines.push(event ? event(lineTime(seed, level, i), eventDraws(seed, i)) : noiseLine(seed, level, scn, i));
  }
  return { total, offset: start, lines };
}
