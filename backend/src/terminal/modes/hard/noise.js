// Deterministic filler for the Hard mode: auth/syslog/error logs and ELF-looking blobs.
// Everything is seeded through gen.js; no Math.random, no Date.now.
import { rng, int, pick, hex } from '../../gen.js';
import { WEB } from './constants.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const at = (iso) => Date.parse(iso) / 1000;

const syslogStamp = (sec) => {
  const d = new Date(sec * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

const errorStamp = (sec) => {
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

// Sorts timeline entries by time (stable) and joins their rendered text.
const render = (entries, format) => `${entries
  .map((entry, index) => ({ entry, index }))
  .sort((a, b) => a.entry.t - b.entry.t || a.index - b.index)
  .map(({ entry }) => format(entry))
  .join('\n')}\n`;

const START = at('2024-03-10T06:00:00Z');
const ATTACKERS = [WEB.scanner, '185.220.101.46', '91.240.118.172', '194.26.135.12', '103.152.220.44', '218.92.0.31'];
const BAD_USERS = ['admin', 'test', 'oracle', 'ubuntu', 'postgres', 'git', 'deploy', 'pi', 'user', 'ftpuser', 'support', 'root'];

export function buildAuthLog() {
  const r = rng('hard-auth-log');
  const entries = [];
  let t = START;
  for (let i = 0; i < 1100; i += 1) {
    t += int(r, 5, 330);
    const who = pick(r, ATTACKERS);
    const port = int(r, 1024, 65535);
    const user = pick(r, BAD_USERS);
    const pid = int(r, 900, 31000);
    const roll = r();
    let text;
    if (roll < 0.35) { text = `sshd[${pid}]: Failed password for invalid user ${user} from ${who} port ${port} ssh2`; }
    else if (roll < 0.55) { text = `sshd[${pid}]: Invalid user ${user} from ${who} port ${port}`; }
    else if (roll < 0.75) { text = `sshd[${pid}]: Connection closed by authenticating user root ${who} port ${port} [preauth]`; }
    else if (roll < 0.85) { text = `sshd[${pid}]: Disconnected from invalid user ${user} ${who} port ${port} [preauth]`; }
    else if (roll < 0.93) { text = `CRON[${pid}]: pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)`; }
    else { text = `CRON[${pid}]: pam_unix(cron:session): session closed for user root`; }
    entries.push({ t, text });
  }
  const fixed = [
    ['2024-03-13T21:02:11Z', 'sshd[27410]: Accepted publickey for ghost from 10.8.0.9 port 52114 ssh2: ED25519 SHA256:q9Zr0v1kU2yXw4oM7aB3nHf6LsJt8cEeD5PgTiVxYuA'],
    ['2024-03-13T21:02:11Z', 'systemd-logind[611]: New session 412 of user ghost.'],
    ['2024-03-13T23:36:50Z', 'sshd[27410]: pam_unix(sshd:session): session closed for user ghost'],
    ['2024-03-13T23:38:02Z', 'sshd[27655]: Accepted publickey for ghost from 185.199.108.34 port 40022 ssh2: ED25519 SHA256:q9Zr0v1kU2yXw4oM7aB3nHf6LsJt8cEeD5PgTiVxYuA'],
    ['2024-03-13T23:41:07Z', 'usermod[27702]: lock user \'ghost\''],
    ['2024-03-13T23:41:07Z', 'sshd[27655]: pam_unix(sshd:session): session closed for user ghost'],
    ['2024-03-14T09:18:02Z', 'sshd[28011]: Accepted password for guest from 10.8.0.14 port 51833 ssh2'],
    ['2024-03-14T09:18:02Z', 'systemd-logind[611]: New session 431 of user guest.'],
  ];
  for (const [iso, text] of fixed) { entries.push({ t: at(iso), text }); }
  return render(entries, (e) => `${syslogStamp(e.t)} arena ${e.text}`);
}

export function buildSyslog() {
  const r = rng('hard-syslog');
  const entries = [];
  let t = START;
  const units = ['Started Daily apt download activities.', 'Starting Daily apt upgrade and clean activities...',
    'Finished Daily apt upgrade and clean activities.', 'Started Session 4%d of user guest.', 'Reloading nginx.',
    'Started Rotate log files.', 'Starting Clean php session files...', 'Finished Clean php session files.'];
  for (let i = 0; i < 600; i += 1) {
    t += int(r, 20, 700);
    const roll = r();
    let text;
    if (roll < 0.4) { text = `systemd[1]: ${pick(r, units).replace('%d', String(int(r, 10, 31)))}`; }
    else if (roll < 0.7) { text = `kernel: [${int(r, 1000, 480000)}.${int(r, 100000, 999999)}] audit: type=1400 audit(${at('2024-03-10T06:00:00Z') + int(r, 0, 300000)}.${int(r, 100, 999)}:${int(r, 100, 999)}): apparmor="ALLOWED" operation="open" profile="/usr/sbin/nginx"`; }
    else if (roll < 0.85) { text = `nginx[${int(r, 900, 2000)}]: [warn] 1021#1021: *${int(r, 1000, 9999)} upstream response is buffered to a temporary file`; }
    else { text = `rsyslogd: [origin software="rsyslogd" swVersion="8.2112.0" x-pid="${int(r, 500, 900)}"] rsyslogd was HUPed`; }
    entries.push({ t, text });
  }
  // ghost-ledgerd heartbeat every 15 minutes, a cron line for the nightly seal job.
  for (let k = 0; k < 300; k += 1) {
    entries.push({ t: at('2024-03-11T06:00:00Z') + k * 900, text: 'ghost-ledgerd[1337]: receipt written (113 bytes)' });
  }
  for (const day of ['2024-03-11', '2024-03-12', '2024-03-13', '2024-03-14']) {
    entries.push({ t: at(`${day}T03:00:01Z`), text: 'CRON[1823]: (root) CMD (/opt/ghost/bin/seal.sh /var/backups/.stash/onion.b64)' });
  }
  entries.push({ t: at('2024-03-14T03:00:03Z'), text: 'seal.sh[1824]: job 0314-0300 finished (see /var/lib/ghost/spool)' });
  entries.push({ t: at('2024-03-13T23:41:08Z'), text: 'ghost-ledgerd[1337]: owner session ended, keeping schedule' });
  return render(entries, (e) => `${syslogStamp(e.t)} arena ${e.text}`);
}

export function buildErrorLog() {
  const r = rng('hard-error-log');
  const entries = [];
  const missing = ['/usr/share/nginx/html/.env', '/usr/share/nginx/html/wp-login.php', '/usr/share/nginx/html/admin',
    '/usr/share/nginx/html/.git/config', '/usr/share/nginx/html/phpmyadmin/', '/usr/share/nginx/html/xmlrpc.php'];
  let t = START;
  for (let i = 0; i < 300; i += 1) {
    t += int(r, 30, 1100);
    const target = pick(r, missing);
    const who = pick(r, ATTACKERS);
    const worker = int(r, 1000, 1030);
    entries.push({ t, text: `[error] ${worker}#${worker}: *${int(r, 1000, 9999)} open() "${target}" failed (2: No such file or directory), client: ${who}, server: _, request: "GET ${target.replace('/usr/share/nginx/html', '')} HTTP/1.1", host: "arena"` });
  }
  return render(entries, (e) => `${errorStamp(e.t)} ${e.text}`);
}

// --- ELF-looking blobs -------------------------------------------------------------------------------------
// Pure 7-bit text, so the bytes are identical whatever encoding the engine uses to read them. The header
// starts with the real ELF magic (7f 45 4c 46) so `file` can identify the blob. Filler bytes are non-printable,
// so `strings` only ever shows what we put there on purpose.
const NOISE_CODES = [1, 2, 3, 4, 5, 6, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31];

function noiseBytes(r, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) { out += r() < 0.45 ? '\x00' : String.fromCharCode(pick(r, NOISE_CODES)); }
  return out;
}

const ELF_HEADER = `\x7fELF\x02\x01\x01\x00${'\x00'.repeat(8)}\x03\x00>\x00\x01\x00\x00\x00${'\x00'.repeat(40)}`;

// `strings`: printable strings in order. `wide`: a string stored as UTF-16LE (invisible to `strings`, readable in
// `xxd`), aligned to a 16-byte row so the hex dump shows it cleanly. `wideAfter`: index of the string it follows.
// `wideSeed`: a seed token with the `|wide` filter appended right after `wide` (a per team value that the engine
// widens when the file is read). Nothing before the wide block may contain a token, or the alignment would shift.
export function elfBlob(seed, {
  strings = [], wide = null, wideSeed = '', wideAfter = 1,
} = {}) {
  const r = rng(seed);
  let out = ELF_HEADER + noiseBytes(r, int(r, 96, 160));
  strings.forEach((text, index) => {
    out += `\x00${text}\x00${noiseBytes(r, int(r, 8, 32))}`;
    if (wide && index === wideAfter) {
      while (out.length % 16 !== 0) { out += '\x00'; }
      out += `${[...wide].map((ch) => `${ch}\x00`).join('')}${wideSeed}\x00\x00${noiseBytes(r, int(r, 8, 24))}`;
    }
  });
  return out;
}

export const toBase64 = (text) => Buffer.from(text, 'latin1').toString('base64');

const LIB_NAMES = ['libnss_files.so.2', 'libnss_dns.so.2', 'libnss_compat.so.2', 'libnss_myhostname.so.2',
  'libnss_resolve.so.2', 'libnss_systemd.so.2', 'libz.so.1', 'libm.so.6', 'libc.so.6', 'libpthread.so.0',
  'libdl.so.2', 'libresolv.so.2', 'libcrypt.so.1', 'libpam.so.0', 'libselinux.so.1', 'libssl.so.3',
  'libcrypto.so.3', 'libgcc_s.so.1', 'libutil.so.1', 'librt.so.1', 'libpcre2-8.so.0', 'libaudit.so.1'];

// Plain system libraries: older than the lockout stamp, nothing to see in them.
export function decoyLibs() {
  const libs = {};
  for (const name of LIB_NAMES) {
    const r = rng(`hard-lib:${name}`);
    libs[name] = elfBlob(`hard-lib:${name}`, {
      strings: [`GLIBC_2.${int(r, 2, 35)}`, name, `${name.split('.so')[0].replace('lib', '')}_init`, `build-id ${hex(r, 20)}`],
    });
  }
  return libs;
}
