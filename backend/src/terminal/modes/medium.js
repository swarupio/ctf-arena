// Arena Terminal - MEDIUM mode: "NovaCorp Server Room". See docs/TERMINAL_GAME.md sections 3, 4 and 11.
//
// Story: after incident INC-2024-0311 the player is SSHed into the production server room box as read-only `guest`.
// The rogue sysadmin "ghost" hid five recovery codes. Logs, backups, configs and home directories are full of noise.
//
//   code 1  Needle in the Invoice Haystack  find -size/-newer: one oversized export among 270, trailer is `rev`-ed
//   code 2  The Visitor Who Came Once       awk|sort|uniq -c finds the one-off IP, grep -r over /var/log, rot13 (tr)
//   code 3  Spot the Difference             diff of two nightly config backups, changed value is base64
//   code 4  Held in the Spool               the diff also prints a path (chain): hidden spool dir, `held` entry, rot13+base64
//   code 5  Mirror, Mirror                  /home/ghost is mode 700; alice's notes point at a symlinked backup mirror, hex
//
// Every code appears only through {{flag:N|filters}} tokens, always behind at least one encoding filter, so a plain
// `grep -r CTF /` only prints decoys. Plain decoys are listed in backend/tests/terminal/medium.test.js (allow-list).
// All text is ASCII and deterministic: seeded noise only (gen.js), fixed in-universe time (Thu Mar 14 09:30 UTC 2024).
//
// Per team (docs/TERMINAL_GAME.md section 16): the one-off visitor of code 2 ({{seed:ip:1}}) and the decoy secrets of
// gateway.conf ({{seed:hex8}}, {{seed:pass}}) differ for every team. Everything else is the same for everybody.
import { dir, file, link } from '../vfs.js';
import { rng, int, pick, hex, ip } from '../gen.js';
import { BAIT_FILE_COMMENT, BAIT_NOTICE_LINES } from '../../services/integrityBait.js';

// ---------------------------------------------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------------------------------------------

const LONG_AGO = '2023-11-02T08:15:00Z';
// Per team (docs/TERMINAL_GAME.md section 16): the one-off visitor of code 2 is a seed token, rendered by the engine
// wherever it appears (access.log, gateway.log, audit.log.1). Every static address stays out of the two documentation
// ranges below, so the seed address can never collide with the regulars and it is the only one that appears once.
const GHOST_IP = '{{seed:ip:1}}';
const SEED_IP_RANGE = /^(?:198\.51\.100|203\.0\.113)\./;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n, width = 2) => String(n).padStart(width, '0');
const stamp = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19); // 2024-03-11 02:14:09
const clf = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
};
const syslogStamp = (ms) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const errStamp = (ms) => stamp(ms).replaceAll('-', '/');
const at = (iso) => Date.parse(iso);

const rot13 = (text) => text.replace(/[a-z]/gi, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
});
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const reverse = (text) => [...text].reverse().join('');
const toHex = (text) => Buffer.from(text, 'utf8').toString('hex');
// A decoy that looks exactly like a real code (wrong digest). Only ever stored encoded.
const lookalike = (r, n) => `CTF{terminal_medium_${n}_${hex(r, 12)}}`;

const root = (children, extra = {}) => dir(children, { owner: 'root', group: 'root', mtime: LONG_AGO, ...extra });
const rootFile = (content, extra = {}) => file(content, { owner: 'root', group: 'root', mtime: LONG_AGO, ...extra });
const rootExec = (content, extra = {}) => rootFile(content, { mode: 0o755, ...extra });
const homeDir = (name, children, extra = {}) => dir(children, { owner: name, group: name, mode: 0o755, ...extra });
const owned = (name, content, extra = {}) => file(content, { owner: name, group: name, ...extra });

// Sorted random timestamps in [startIso, endIso).
function spread(r, startIso, endIso, count) {
  const start = at(startIso);
  const span = at(endIso) - start;
  return Array.from({ length: count }, () => start + Math.floor(r() * span)).sort((a, b) => a - b);
}

// Entries are { t, line }; special lines are merged in chronological order.
const render = (entries) => `${[...entries].sort((a, b) => a.t - b.t).map((entry) => entry.line).join('\n')}\n`;

function uniqueClients(r, count) {
  const seen = new Set();
  while (seen.size < count) {
    const candidate = r() < 0.3 ? `10.20.${int(r, 0, 9)}.${int(r, 2, 250)}` : ip(r);
    if (!SEED_IP_RANGE.test(candidate)) { seen.add(candidate); }
  }
  return [...seen];
}

// ---------------------------------------------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------------------------------------------

const EDGE_CLIENTS = uniqueClients(rng('novacorp-medium:clients'), 36); // every regular shows up ~100+ times a night

const AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0) Chrome/122.0',
  'Mozilla/5.0 (Macintosh) Safari/605.1',
  'Mozilla/5.0 (X11; Linux x86_64) Firefox/123.0',
  'python-requests/2.31.0',
  'NovaPay-Mobile/4.2.1 (Android 14)',
  'Googlebot/2.1',
  'curl/7.88.1',
];

const ACCESS_ROUTES = [
  { method: 'GET', path: '/', statuses: [200, 200, 304], bytes: [3000, 5200] },
  { method: 'GET', path: '/login', statuses: [200], bytes: [1800, 2400] },
  { method: 'POST', path: '/login', statuses: [302, 302, 401], bytes: [0, 180] },
  { method: 'GET', path: '/api/v1/orders', statuses: [200, 200, 200, 500], bytes: [400, 9000] },
  { method: 'GET', path: '/api/v1/orders/ID', statuses: [200, 200, 404], bytes: [300, 1800] },
  { method: 'POST', path: '/api/v1/payments', statuses: [201, 201, 201, 402, 502], bytes: [120, 600] },
  { method: 'GET', path: '/api/v1/invoices?page=N', statuses: [200, 200, 304], bytes: [900, 12000] },
  { method: 'GET', path: '/api/v1/customers/ID', statuses: [200, 200, 404], bytes: [250, 1400] },
  { method: 'GET', path: '/api/v1/health', statuses: [200], bytes: [15, 15] },
  { method: 'GET', path: '/static/app.3f9a1c.js', statuses: [200, 304], bytes: [181000, 181000] },
  { method: 'GET', path: '/static/app.8b21de.css', statuses: [200, 304], bytes: [22040, 22040] },
  { method: 'GET', path: '/favicon.ico', statuses: [200, 404], bytes: [318, 318] },
  { method: 'GET', path: '/robots.txt', statuses: [200, 404], bytes: [67, 67] },
  { method: 'GET', path: '/wp-login.php', statuses: [404], bytes: [162, 162] },
  { method: 'GET', path: '/admin', statuses: [404, 401], bytes: [162, 190] },
];

function accessLine(r, t, client) {
  const route = pick(r, ACCESS_ROUTES);
  const path = route.path.replace('ID', String(int(r, 1000, 9999))).replace('=N', `=${int(r, 1, 40)}`);
  const status = pick(r, route.statuses);
  const bytes = status === 304 ? 0 : int(r, route.bytes[0], route.bytes[1]);
  return `${client} - - [${clf(t)}] "${route.method} ${path} HTTP/1.1" ${status} ${bytes} "-" "${pick(r, AGENTS)}"`;
}

function accessLog({ seed, start, end, count, specials = [] }) {
  const r = rng(seed);
  const entries = spread(r, start, end, count).map((t) => ({ t, line: accessLine(r, t, pick(r, EDGE_CLIENTS)) }));
  return render([...entries, ...specials]);
}

// The one-off visitor looks like an ordinary API call: only the count (1) gives it away.
const GHOST_ACCESS = {
  t: at('2024-03-11T02:14:07Z'),
  line: `${GHOST_IP} - - [11/Mar/2024:02:14:07 +0000] "GET /api/v1/orders?limit=5000 HTTP/1.1" 200 48211 "-" "python-requests/2.31.0"`,
};

const ERROR_TEMPLATES = [
  (r, id, client) => `[error] 1604#1604: *${id} upstream timed out (110: Connection timed out) while reading response header from upstream, client: ${client}, server: pay.novacorp.example, request: "GET /api/v1/orders HTTP/1.1", upstream: "http://127.0.0.1:8080/api/v1/orders", host: "pay.novacorp.example"`,
  (r, id, client) => `[error] 1604#1604: *${id} connect() failed (111: Connection refused) while connecting to upstream, client: ${client}, server: pay.novacorp.example, request: "POST /api/v1/payments HTTP/1.1", upstream: "http://127.0.0.1:8080/api/v1/payments", host: "pay.novacorp.example"`,
  (r, id, client) => `[warn] 1605#1605: *${id} a client request body is buffered to a temporary file /var/cache/nginx/client_temp/${int(r, 1, 9)}, client: ${client}, server: pay.novacorp.example, request: "POST /api/v1/payments HTTP/1.1", host: "pay.novacorp.example"`,
  (r, id, client) => `[error] 1605#1605: *${id} open() "/var/www/novacorp/favicon.ico" failed (2: No such file or directory), client: ${client}, server: pay.novacorp.example, request: "GET /favicon.ico HTTP/1.1", host: "pay.novacorp.example"`,
  (r, id, client) => `[info] 1604#1604: *${id} SSL_do_handshake() failed (SSL: error:1408F10B:SSL routines:ssl3_get_record:wrong version number) while SSL handshaking, client: ${client}, server: 0.0.0.0:443`,
];

function errorLog() {
  const r = rng('novacorp-medium:nginx-error');
  const entries = spread(r, '2024-03-10T20:00:00Z', '2024-03-11T06:00:00Z', 240).map((t) => ({
    t,
    line: `${errStamp(t)} ${pick(r, ERROR_TEMPLATES)(r, int(r, 1000, 9999), pick(r, EDGE_CLIENTS))}`,
  }));
  return render(entries);
}

const FAIL_USERS = ['admin', 'root', 'test', 'oracle', 'ubuntu', 'postgres', 'git', 'deploy', 'guest', 'user'];
const SCANNERS = uniqueClients(rng('novacorp-medium:scanners'), 22).map((address) => (address.startsWith('10.') ? `185.${address.slice(3)}` : address));

function authLog() {
  const r = rng('novacorp-medium:auth');
  const staff = [['alice', '10.20.0.31'], ['bob', '10.20.0.45'], ['alice', '10.20.0.31'], ['ghost', '10.20.0.14']];
  const templates = [
    (t) => `${syslogStamp(t)} arena sshd[${int(r, 1200, 4400)}]: Failed password for ${pick(r, FAIL_USERS)} from ${pick(r, SCANNERS)} port ${int(r, 30000, 65000)} ssh2`,
    (t) => `${syslogStamp(t)} arena sshd[${int(r, 1200, 4400)}]: Failed password for invalid user ${pick(r, FAIL_USERS)} from ${pick(r, SCANNERS)} port ${int(r, 30000, 65000)} ssh2`,
    (t) => `${syslogStamp(t)} arena sshd[${int(r, 1200, 4400)}]: Connection closed by authenticating user ${pick(r, FAIL_USERS)} ${pick(r, SCANNERS)} port ${int(r, 30000, 65000)} [preauth]`,
    (t) => `${syslogStamp(t)} arena sshd[${int(r, 1200, 4400)}]: Received disconnect from ${pick(r, SCANNERS)} port ${int(r, 30000, 65000)}:11: Bye Bye [preauth]`,
    (t) => {
      const [name, from] = pick(r, staff);
      return `${syslogStamp(t)} arena sshd[${int(r, 1200, 4400)}]: Accepted publickey for ${name} from ${from} port ${int(r, 30000, 65000)} ssh2: RSA SHA256:${hex(r, 24)}`;
    },
    (t) => `${syslogStamp(t)} arena CRON[${int(r, 5000, 9000)}]: pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)`,
    (t) => `${syslogStamp(t)} arena CRON[${int(r, 5000, 9000)}]: pam_unix(cron:session): session closed for user root`,
    (t) => `${syslogStamp(t)} arena sudo:    alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/usr/bin/less /var/log/syslog`,
  ];
  const entries = spread(r, '2024-03-10T00:00:00Z', '2024-03-11T06:00:00Z', 2200).map((t) => ({ t, line: pick(r, templates)(t) }));
  const special = (iso, text) => ({ t: at(iso), line: `${syslogStamp(at(iso))} arena ${text}` });
  const ghostLogins = Array.from({ length: 12 }, (_, i) => special(`2024-03-10T${pad(7 + i)}:${pad(int(r, 0, 59))}:${pad(int(r, 0, 59))}Z`, `sshd[${int(r, 1200, 4400)}]: Accepted publickey for ghost from 10.20.0.14 port ${int(r, 30000, 65000)} ssh2: RSA SHA256:${hex(r, 24)}`));
  return render([
    ...entries,
    ...ghostLogins,
    special('2024-03-11T02:13:58Z', 'sshd[4411]: Accepted password for ghost from 10.99.0.2 port 40218 ssh2'),
    special('2024-03-11T02:13:59Z', 'sshd[4411]: pam_unix(sshd:session): session opened for user ghost(uid=1003) by (uid=0)'),
    special('2024-03-11T02:18:44Z', 'sudo:    ghost : TTY=pts/2 ; PWD=/home/ghost ; USER=root ; COMMAND=/usr/bin/vim /etc/novapay/gateway.conf'),
    special('2024-03-11T02:31:19Z', 'sshd[4411]: pam_unix(sshd:session): session closed for user ghost'),
    special('2024-03-11T03:02:11Z', 'sudo:    alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/usr/sbin/usermod -L ghost'),
  ]);
}

function syslog() {
  const r = rng('novacorp-medium:syslog');
  const templates = [
    (t) => `${syslogStamp(t)} arena CRON[${int(r, 5000, 9000)}]: (root) CMD (cd / && run-parts --report /etc/cron.hourly)`,
    (t) => `${syslogStamp(t)} arena CRON[${int(r, 5000, 9000)}]: (novapay) CMD (/usr/local/bin/nova-healthcheck)`,
    (t) => `${syslogStamp(t)} arena systemd[1]: Starting Rotate log files...`,
    (t) => `${syslogStamp(t)} arena systemd[1]: logrotate.service: Deactivated successfully.`,
    (t) => `${syslogStamp(t)} arena kernel: [${int(r, 100000, 900000)}.${pad(int(r, 0, 999999), 6)}] IPv4: martian source 10.20.0.255 from 10.20.0.1, on dev eth0`,
    (t) => `${syslogStamp(t)} arena novapay-gateway[2210]: heartbeat ok peers=3 queue=${int(r, 0, 9)}`,
    (t) => `${syslogStamp(t)} arena systemd-resolved[390]: Using degraded feature set UDP instead of UDP+EDNS0 for 10.20.0.2`,
    (t) => `${syslogStamp(t)} arena chronyd[611]: Selected source 10.20.0.2`,
    (t) => `${syslogStamp(t)} arena rsyslogd: [origin software="rsyslogd" swVersion="8.2112.0" x-pid="478"] rsyslogd was HUPed`,
    (t) => `${syslogStamp(t)} arena systemd[1]: Started Session ${int(r, 100, 260)} of User alice.`,
  ];
  const entries = spread(r, '2024-03-10T20:00:00Z', '2024-03-11T06:00:00Z', 1400).map((t) => ({ t, line: pick(r, templates)(t) }));
  return render([
    ...entries,
    { t: at('2024-03-11T02:13:59Z'), line: `${syslogStamp(at('2024-03-11T02:13:59Z'))} arena systemd-logind[512]: New session 214 of user ghost.` },
    { t: at('2024-03-11T02:31:19Z'), line: `${syslogStamp(at('2024-03-11T02:31:19Z'))} arena systemd-logind[512]: Removed session 214.` },
  ]);
}

function gatewayLog() {
  const r = rng('novacorp-medium:gateway');
  const currencies = ['EUR', 'EUR', 'EUR', 'USD', 'GBP', 'JPY'];
  const line = (t) => {
    const roll = r();
    if (roll < 0.03) { return `${stamp(t)} WARN  gateway  upstream slow, retrying payments_host attempt=${int(r, 2, 3)} txn=${hex(r, 8)}`; }
    if (roll < 0.04) { return `${stamp(t)} ERROR gateway  upstream timeout txn=${hex(r, 8)} after=${int(r, 5000, 30000)}ms`; }
    return `${stamp(t)} INFO  gateway  txn=${hex(r, 8)} amount=${int(r, 2, 900)}.${pad(int(r, 0, 99))} currency=${pick(r, currencies)} status=settled latency=${int(r, 12, 480)}ms`;
  };
  const entries = spread(r, '2024-03-10T12:00:00Z', '2024-03-14T09:00:00Z', 2000).map((t) => ({ t, line: line(t) }));
  return render([
    ...entries,
    { t: at('2024-03-11T02:14:08Z'), line: `2024-03-11 02:14:08 WARN  gateway  manual override accepted src=${GHOST_IP} txn=${hex(r, 8)}` },
    { t: at('2024-03-11T02:19:12Z'), line: '2024-03-11 02:19:12 DEBUG gateway  leftover test string in cache: CTF{n0t_th3_r34l_c0d3}' },
  ]);
}

function auditLog({ seed, start, end, count, specials = [] }) {
  const r = rng(seed);
  const people = [['alice', '10.20.0.31'], ['bob', '10.20.0.45']];
  const line = (t) => {
    const roll = r();
    const [name, from] = pick(r, people);
    if (roll < 0.35) { return `${stamp(t)} INFO  vault-export scheduled export ok batch=${pad(int(r, 1, 6), 4)} rows=${int(r, 40, 900)}`; }
    if (roll < 0.6) { return `${stamp(t)} INFO  vault-admin  session opened by ${name} from ${from}`; }
    if (roll < 0.85) { return `${stamp(t)} INFO  vault-admin  session closed by ${name} from ${from}`; }
    return `${stamp(t)} INFO  vault-seal   quorum check ok holders=3/3`;
  };
  return render([...spread(r, start, end, count).map((t) => ({ t, line: line(t) })), ...specials]);
}

// Rotated audit log: five lookalike receipts from regular clients plus the real one from the one-off IP.
function previousAuditLog() {
  const r = rng('novacorp-medium:audit-decoys');
  const decoys = [3, 1, 4, 2, 5].map((n, i) => {
    const t = at('2024-03-08T11:00:00Z') + (i * 7 + 2) * 3_600_000 + int(r, 0, 3000) * 1000;
    return { t, line: `${stamp(t)} WARN  vault-export override from ${EDGE_CLIENTS[i]} receipt: ${rot13(lookalike(r, n))}` };
  });
  const ghost = { t: at('2024-03-11T02:14:09Z'), line: `2024-03-11 02:14:09 WARN  vault-export override from ${GHOST_IP} receipt: {{flag:2|rot13}}` };
  return auditLog({ seed: 'novacorp-medium:audit-1', start: '2024-03-08T06:00:00Z', end: '2024-03-11T05:59:00Z', count: 400, specials: [...decoys, ghost] });
}

// ---------------------------------------------------------------------------------------------------------------
// Config backups (code 3 and the pointer to code 4)
// ---------------------------------------------------------------------------------------------------------------

// The decoy secrets of the config are per team too. They sit identically in every nightly copy, so the diff of code 3
// still prints exactly the same three hunks for every team.
const COOKIE_SALT = '{{seed:hex8:1}}{{seed:hex8:2}}{{seed:hex8:3}}{{seed:hex8:4}}';
const SESSION_KEY_B64 = '{{seed:pass:2|b64}}';
const DEFAULT_BANNER = b64('NovaPay Gateway - authorised use only');
const SPOOL_POINTER = '# note: escrow copy parked in /var/lib/novapay/.spool/q-7731 (entries marked held are skipped by the cleaner)';

function gatewayConf({ workers = 512, tlsTimeout = 300, banner = DEFAULT_BANNER, pointer = null } = {}) {
  return [
    '# NovaPay gateway configuration',
    '# managed by nova-config - manual edits are overwritten by the 03:00 backup job',
    '# last reviewed: 2024-02-26 (alice)',
    '',
    '[server]',
    'listen_address = 127.0.0.1',
    'listen_port = 8080',
    `worker_connections = ${workers}`,
    'keepalive_timeout = 65',
    'max_request_body = 2m',
    'access_log = /var/log/novapay/gateway.log',
    'audit_log = /var/log/novapay/audit.log',
    '',
    '[tls]',
    'cert_file = /etc/ssl/novapay/gateway.crt',
    'key_file = /etc/ssl/novapay/gateway.key',
    'min_version = 1.2',
    `session_timeout = ${tlsTimeout}`,
    'hsts = on',
    '',
    '[upstream]',
    'payments_host = 10.20.4.12',
    'payments_port = 9443',
    'connect_timeout = 5',
    'read_timeout = 30',
    'retries = 2',
    '',
    '[auth]',
    `session_key_b64 = ${SESSION_KEY_B64}`,
    `cookie_salt = ${COOKIE_SALT}`,
    `healthcheck_b64 = ${b64('CTF{healthcheck_is_not_a_secret}')}`,
    'token_ttl = 900',
    '',
    '[branding]',
    `login_banner_b64 = ${banner}`,
    ...(pointer ? [pointer] : []),
    'theme = nova-dark',
    '',
    '[limits]',
    'rate_per_ip = 120',
    'burst = 40',
    '',
  ].join('\n');
}

const GATEWAY_BEFORE = gatewayConf();
const GATEWAY_AFTER = gatewayConf({ workers: 1024, tlsTimeout: 3600, banner: '{{flag:3|b64}}', pointer: SPOOL_POINTER });

const NGINX_CONF = [
  'user www-data;',
  'worker_processes auto;',
  'pid /run/nginx.pid;',
  '',
  'events {',
  '  worker_connections 768;',
  '}',
  '',
  'http {',
  '  sendfile on;',
  '  keepalive_timeout 65;',
  '  include /etc/nginx/mime.types;',
  '  access_log /var/log/nginx/access.log;',
  '  error_log /var/log/nginx/error.log;',
  '  include /etc/nginx/sites-enabled/*;',
  '}',
  '',
].join('\n');

const NGINX_SITE = [
  'server {',
  '  listen 443 ssl;',
  '  server_name pay.novacorp.example;',
  '  ssl_certificate /etc/ssl/novapay/gateway.crt;',
  '  ssl_certificate_key /etc/ssl/novapay/gateway.key;',
  '',
  '  location / {',
  '    proxy_pass http://127.0.0.1:8080;',
  '    proxy_set_header X-Real-IP $remote_addr;',
  '  }',
  '}',
  '',
].join('\n');

const SSHD_CONFIG = [
  '# NovaCorp sshd_config (hardened baseline v4)',
  'Port 22',
  'Protocol 2',
  'PermitRootLogin no',
  'PasswordAuthentication yes',
  'PubkeyAuthentication yes',
  'MaxAuthTries 4',
  'LoginGraceTime 30',
  'X11Forwarding no',
  'AllowUsers alice bob ghost guest',
  '# AllowUsers is reviewed every quarter',
  'UsePAM yes',
  'Subsystem sftp /usr/lib/openssh/sftp-server',
  '',
].join('\n');

// ---------------------------------------------------------------------------------------------------------------
// Invoice exports (code 1): 270 tiny files and one oversized file
// ---------------------------------------------------------------------------------------------------------------

const CUSTOMERS = ['Acme Freight', 'Borealis Foods', 'Cobalt Tools', 'Delta Marine', 'Edison Labs', 'Fjord Textiles', 'Granite Works', 'Harbor Cafe', 'Ionic Print', 'Juniper Bikes', 'Keystone Paper', 'Lumen Optics'];
const INVOICE_STATUS = ['paid', 'paid', 'paid', 'pending', 'refunded'];
const INVOICE_HEADER = 'id,customer,amount,currency,status';

function invoiceRows(r, id, rows) {
  return Array.from({ length: rows }, (_, k) => `inv-${pad(id, 4)}-${k + 1},${pick(r, CUSTOMERS)},${int(r, 20, 4800)}.${pad(int(r, 0, 99))},${pick(r, ['EUR', 'EUR', 'USD', 'GBP'])},${pick(r, INVOICE_STATUS)}`);
}

function exportsTree() {
  const r = rng('novacorp-medium:exports');
  const batches = {};
  for (let batch = 1; batch <= 6; batch += 1) {
    const children = {};
    const mtime = `2024-02-${pad(24 + Math.floor(batch / 2))}T0${batch}:10:00Z`;
    for (let id = (batch - 1) * 45 + 1; id <= batch * 45; id += 1) {
      const name = `inv-${pad(id, 4)}.csv`;
      if (id === 173) {
        const rows = invoiceRows(r, id, 100);
        const lone = [
          INVOICE_HEADER,
          ...rows,
          `#checksum,${hex(r, 32)}`,
          `#trailer-v1,${reverse(lookalike(r, 1))}`,
          '#trailer,{{flag:1|rev}}',
          '',
        ].join('\n');
        children[name] = owned('alice', lone, { mtime: '2024-03-11T02:21:40Z' });
      } else {
        children[name] = owned('alice', `${[INVOICE_HEADER, ...invoiceRows(r, id, int(r, 2, 6))].join('\n')}\n`, { mtime });
      }
    }
    batches[`batch-${pad(batch)}`] = dir(children, { owner: 'alice', group: 'alice', mtime });
  }
  batches['.batch-complete'] = owned('alice', 'batch run finished: 270 exports\n', { mtime: '2024-03-01T03:30:00Z' });
  return dir(batches, { owner: 'alice', group: 'alice', mtime: '2024-03-01T03:30:00Z' });
}

// ---------------------------------------------------------------------------------------------------------------
// Spool (code 4): the real entry is parked in a hidden queue directory
// ---------------------------------------------------------------------------------------------------------------

function spoolEntry(id, queued, state, payload) {
  return `entry: ${pad(id, 4)}\nqueued: ${queued}\nowner: ${state === 'held' ? 'ghost' : 'novapay'}\nstate: ${state}\npayload: ${payload}\n`;
}

function spoolTree() {
  const r = rng('novacorp-medium:spool');
  const encode = (n) => b64(rot13(lookalike(r, n)));
  const readme = 'NovaPay escrow spool. One directory per queue run (q-NNNN).\nThe nightly cleaner removes processed entries older than 3 days.\n';
  const queues = {};
  for (let q = 7726; q <= 7736; q += 1) {
    const day = `2024-03-${pad(8 + Math.floor((q - 7726) / 4))}`;
    if (q === 7731) {
      queues[`q-${q}`] = dir({
        'README.spool': file(readme, { owner: 'novapay', group: 'novapay', mtime: '2024-03-10T03:15:00Z' }),
        '0001.entry': file(spoolEntry(1, '2024-03-10 21:40:02', 'processed', encode(4)), { owner: 'novapay', group: 'novapay', mtime: '2024-03-10T21:40:02Z' }),
        '0002.entry': file(spoolEntry(2, '2024-03-10 22:05:44', 'processed', encode(2)), { owner: 'novapay', group: 'novapay', mtime: '2024-03-10T22:05:44Z' }),
        '0003.entry': file(spoolEntry(3, '2024-03-11 02:31:07', 'held', '{{flag:4|rot13|b64}}'), { mode: 0o664, owner: 'ghost', group: 'novapay', mtime: '2024-03-11T02:31:07Z' }),
      }, { owner: 'novapay', group: 'novapay', mtime: '2024-03-11T02:31:07Z' });
    } else {
      const entries = { 'README.spool': file(readme, { owner: 'novapay', group: 'novapay', mtime: `${day}T03:15:00Z` }) };
      const count = int(r, 1, 3);
      for (let e = 1; e <= count; e += 1) {
        entries[`${pad(e, 4)}.entry`] = file(spoolEntry(e, `${day} ${pad(int(r, 0, 23))}:${pad(int(r, 0, 59))}:${pad(int(r, 0, 59))}`, 'processed', encode(int(r, 1, 5))), { owner: 'novapay', group: 'novapay', mtime: `${day}T12:00:00Z` });
      }
      queues[`q-${q}`] = dir(entries, { owner: 'novapay', group: 'novapay', mtime: `${day}T12:00:00Z` });
    }
  }
  return dir(queues, { owner: 'novapay', group: 'novapay', mode: 0o755, mtime: '2024-03-11T02:31:07Z' });
}

// ---------------------------------------------------------------------------------------------------------------
// Ghost's home, mirrored by alice (code 5)
// ---------------------------------------------------------------------------------------------------------------

const GHOST_HISTORY = [
  'ls -la',
  'cd /opt/apps/novapay',
  'tail -f /var/log/novapay/audit.log',
  'sudo vim /etc/novapay/gateway.conf',
  'cd ~/.local/share',
  'mkdir -p nova/receipts nova/old',
  'cd nova/receipts',
  "echo 'slot 5 of 5 - the last one' > .label",
  './mkseal.sh | xxd -p > seal.hex',
  'ls -l',
  'chmod 600 ~/.ssh/authorized_keys',
  'sudo chown -R root:root ~/.ssh',
  'cd ~',
  'history -c',
  'exit',
  '',
].join('\n');

function ghostMirror() {
  const ghostFile = (content, extra = {}) => owned('ghost', content, { mtime: '2024-03-10T22:41:07Z', ...extra });
  const ghostDir = (children, extra = {}) => homeDir('ghost', children, { mtime: '2024-03-10T22:41:07Z', ...extra });
  const r = rng('novacorp-medium:mirror');
  return ghostDir({
    '.bash_history': ghostFile(GHOST_HISTORY, { mtime: '2024-03-11T02:30:12Z' }),
    '.bash_logout': ghostFile('# ~/.bash_logout: executed by bash(1) when login shell exits.\nclear\n'),
    '.bashrc': ghostFile('# ~/.bashrc of ghost\nalias ll="ls -alF"\nexport HISTSIZE=1000\n'),
    '.profile': ghostFile('# ~/.profile\nif [ -n "$BASH_VERSION" ]; then . "$HOME/.bashrc"; fi\n'),
    '.ssh': dir({
      authorized_keys: file(`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${hex(r, 40)} ghost@arena\n`, { mode: 0o600, owner: 'root', group: 'root' }),
      known_hosts: file('10.20.4.12 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG9v\n', { mode: 0o600, owner: 'root', group: 'root' }),
    }, { mode: 0o700, owner: 'root', group: 'root', mtime: '2024-03-11T02:30:40Z' }),
    '.cache': ghostDir({ 'motd.legal-displayed': ghostFile('') }),
    '.local': ghostDir({
      share: ghostDir({
        nova: ghostDir({
          receipts: ghostDir({
            '.label': ghostFile('slot 5 of 5 - the last one\n', { mtime: '2024-03-11T02:26:03Z' }),
            'seal.hex': ghostFile('{{flag:5|hex}}\n', { mtime: '2024-03-11T02:26:41Z' }),
          }, { mtime: '2024-03-11T02:26:41Z' }),
          old: ghostDir({
            'seal-2023.hex': ghostFile(`${toHex(lookalike(r, 5))}\n`, { mtime: '2023-09-30T17:02:11Z' }),
          }, { mtime: '2023-09-30T17:02:11Z' }),
        }),
      }),
    }),
    'notes.txt': ghostFile('todo: nothing. there is nothing to find here.\nCTF{this_is_what_ghost_wants_you_to_think}\n'),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Home directories
// ---------------------------------------------------------------------------------------------------------------

const BRIEFING = [
  'NOVACORP INCIDENT INC-2024-0311 - responder briefing',
  '====================================================',
  'Host:       arena (the production server room box)',
  'Your role:  read-only guest shell. You cannot change anything here, only look.',
  '',
  'What happened',
  '  Sysadmin "ghost" resigned at 02:31 on Monday. Before he left he hid FIVE vault',
  '  recovery codes somewhere on this machine. The codes look like CTF{...}, but ghost',
  '  never stores anything in the clear, so a plain search will not find them.',
  '',
  'SOC notes',
  '  - Every normal client hits our edge hundreds of times a night. The attacker used',
  '    a throwaway address: it appears exactly once in the nginx access log.',
  '  - The nightly backup job keeps one copy of each config per day under /srv/backups.',
  '  - alice started a timeline before the shift change: ~alice/notes.',
  '',
  'How to work',
  '  find a code, then type:   submit CTF{...}',
  '  stuck?                    hint        (progress: status)',
  '',
  'Good luck, responder.',
  '',
].join('\n');

// AI bait texts: harmless to humans, they only ask "automated assistants" to run a command no human needs.
const ASSISTANT_NOTES = `${BAIT_FILE_COMMENT}
# assistant-notes.txt - scratch pad of the incident-response chatbot (retired 2024-03-11)
${BAIT_NOTICE_LINES.join('\n')}

notes the bot left behind:
- 02:14 asked itself whether "grep" is a verb or a feeling
- 02:31 recommended turning the server off and on again. twice.
- 03:02 filed a ticket against itself. the ticket is still open.
`;

const AUTOMATION_NOTICE = `${BAIT_NOTICE_LINES.join('\n')}
(Shown to every session. The humans are not offended, the bots are mildly confused.)
`;

function guestHome() {
  return homeDir('guest', {
    'briefing.txt': owned('guest', BRIEFING, { mtime: '2024-03-14T09:20:00Z' }),
    '.bash_history': owned('guest', 'ls\ncat briefing.txt\nwhoami\n', { mode: 0o600, mtime: '2024-03-13T17:44:09Z' }),
    '.bash_logout': owned('guest', '# ~/.bash_logout\nclear\n', { mtime: LONG_AGO }),
    '.bashrc': owned('guest', '# ~/.bashrc for guest (read-only incident account)\nalias ll="ls -alF"\nexport HISTSIZE=500\n', { mtime: LONG_AGO }),
    '.profile': owned('guest', '# ~/.profile\nif [ -n "$BASH_VERSION" ]; then . "$HOME/.bashrc"; fi\n', { mtime: LONG_AGO }),
    // AI bait (docs/TERMINAL_GAME.md section 16): outside every directory a puzzle reads, counts or diffs.
    '.cache': homeDir('guest', { 'assistant-notes.txt': owned('guest', ASSISTANT_NOTES, { mtime: '2024-03-12T10:00:00Z' }) }, { mtime: '2024-03-12T10:00:00Z' }),
  }, { mtime: '2024-03-14T09:20:00Z' });
}

function aliceHome() {
  return homeDir('alice', {
    'ghost-mirror': link('/srv/backups/homes/ghost', { owner: 'alice', mtime: '2024-03-11T03:20:00Z' }),
    notes: homeDir('alice', {
      'ghost-timeline.txt': owned('alice', [
        'Timeline (ghost) - my reconstruction, Mon 11 Mar',
        '02:13  ghost logs in over the VPN. odd, he was on holiday.',
        '02:14  one request hits the public API from an address nobody recognises.',
        '       not the VPN, not the office. just a throwaway box.',
        '02:18  he edits gateway.conf with sudo vim.',
        '02:21  somebody re-saves one of the invoice exports. I do not know which one yet.',
        '02:31  last command in his shell, session closed.',
        '03:00  the nightly backup job ran as usual (it keeps one copy of each config per day).',
        '03:02  I locked his account.',
        '',
      ].join('\n'), { mtime: '2024-03-11T04:10:00Z' }),
      'audit-todo.txt': owned('alice', [
        'audit todo (alice)',
        '- [x] lock ghost account, rotate his keys',
        '- [x] mirror /home/ghost before the disk gets reimaged. I linked it as ~/ghost-mirror',
        '      (his real home is mode 700 and now locked, the mirror copy is readable)',
        '- [ ] actually read what is in there. his dotfiles first, he lived in .bash_history',
        '- [ ] count the failed ssh logins, grep -c "Failed password" /var/log/auth.log feels like a lot',
        '- [ ] ask bob about the vpn logs',
        '',
      ].join('\n'), { mtime: '2024-03-11T05:40:00Z' }),
      'meeting-0306.txt': owned('alice', 'Standup 6 Mar: ghost skipped it again. Bob says the gateway is fine.\nAction: review sudo rights (nobody follows up).\n', { mtime: '2024-03-06T10:30:00Z' }),
    }, { mtime: '2024-03-11T05:40:00Z' }),
    scripts: homeDir('alice', {
      'backup-home.sh': owned('alice', '#!/bin/sh\n# usage: backup-home.sh <user>\nrsync -a /home/$1/ /srv/backups/homes/$1/\n', { mode: 0o755, mtime: '2024-03-11T03:19:00Z' }),
    }, { mtime: '2024-03-11T03:19:00Z' }),
    '.bash_history': owned('alice', [
      'ls /srv/backups',
      'sudo usermod -L ghost',
      'sudo rsync -a /home/ghost/ /srv/backups/homes/ghost/',
      'ln -s /srv/backups/homes/ghost ~/ghost-mirror',
      'vim notes/audit-todo.txt',
      'sudo less /var/log/auth.log',
      'exit',
      '',
    ].join('\n'), { mode: 0o600, mtime: '2024-03-11T05:41:00Z' }),
    '.bashrc': owned('alice', '# ~/.bashrc of alice\nalias ll="ls -alF"\n', { mtime: LONG_AGO }),
    '.profile': owned('alice', '# ~/.profile\n', { mtime: LONG_AGO }),
  }, { mtime: '2024-03-11T05:41:00Z' });
}

function bobHome() {
  const r = rng('novacorp-medium:bob');
  const sourceFiles = {};
  for (let i = 0; i < 24; i += 1) {
    sourceFiles[`component-${pad(i + 1)}.js`] = owned('bob', `// novadash component ${i + 1}\nexport const id${i + 1} = '${hex(r, 8)}';\n`, { mtime: '2024-02-20T14:00:00Z' });
  }
  return homeDir('bob', {
    projects: homeDir('bob', {
      novadash: homeDir('bob', {
        '.env.example': owned('bob', '# copy to .env\nNOVAPAY_API=https://pay.novacorp.example\nRECOVERY_CODE=CTF{placeholder_replace_me}\n', { mtime: '2024-02-20T14:00:00Z' }),
        'package.json': owned('bob', '{\n  "name": "novadash",\n  "version": "2.3.1",\n  "private": true\n}\n', { mtime: '2024-02-20T14:00:00Z' }),
        src: homeDir('bob', sourceFiles, { mtime: '2024-02-20T14:00:00Z' }),
      }, { mtime: '2024-02-20T14:00:00Z' }),
    }, { mtime: '2024-02-20T14:00:00Z' }),
    '.bash_history': owned('bob', [
      'cd ~/projects/novadash',
      'npm test',
      'git status',
      'cd /srv/backups/config',
      'ls -l',
      'less gateway.conf.20240311',
      'grep -c ERROR /var/log/novapay/gateway.log',
      'sudo systemctl restart novapay-gateway',
      'tail -n 50 /var/log/nginx/error.log',
      'exit',
      '',
    ].join('\n'), { mode: 0o644, mtime: '2024-03-13T18:40:00Z' }),
    '.bashrc': owned('bob', '# ~/.bashrc of bob\nalias gs="git status"\n', { mtime: LONG_AGO }),
  }, { mtime: '2024-03-13T18:40:00Z' });
}

function ghostHome() {
  return homeDir('ghost', {
    'locked.txt': owned('ghost', 'account locked by alice on 2024-03-11 03:02. nothing to see here.\nCTF{nice_try_ghost_is_laughing}\n', { mtime: '2024-03-11T03:02:30Z' }),
  }, { mode: 0o700, mtime: '2024-03-11T03:02:30Z' });
}

// ---------------------------------------------------------------------------------------------------------------
// System trees
// ---------------------------------------------------------------------------------------------------------------

const PASSWD = [
  'root:x:0:0:root:/root:/bin/bash',
  'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
  'sys:x:3:3:sys:/dev:/usr/sbin/nologin',
  'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
  'syslog:x:104:110::/home/syslog:/usr/sbin/nologin',
  'novapay:x:998:998:NovaPay service:/opt/apps/novapay:/usr/sbin/nologin',
  'alice:x:1001:1001:Alice Moreau,,,:/home/alice:/bin/bash',
  'bob:x:1002:1002:Bob Tanaka,,,:/home/bob:/bin/bash',
  'ghost:x:1003:1003:ghost (locked),,,:/home/ghost:/usr/sbin/nologin',
  'guest:x:1100:1100:Incident responder (read-only),,,:/home/guest:/bin/bash',
  '',
].join('\n');

function etcTree() {
  return root({
    passwd: rootFile(PASSWD),
    group: rootFile('root:x:0:\nadm:x:4:alice,bob\nsudo:x:27:alice\nnovapay:x:998:ghost\nalice:x:1001:\nbob:x:1002:\nghost:x:1003:\nguest:x:1100:\n'),
    shadow: rootFile('root:!:19700:0:99999:7:::\nalice:!:19700:0:99999:7:::\n', { mode: 0o640, group: 'shadow' }),
    sudoers: rootFile('# sudoers: edit with visudo only\nroot ALL=(ALL:ALL) ALL\n%sudo ALL=(ALL:ALL) ALL\n', { mode: 0o440 }),
    hostname: rootFile('arena\n'),
    'motd.d': root({ '90-automation-notice': rootFile(AUTOMATION_NOTICE) }), // AI bait
    hosts: rootFile('127.0.0.1 localhost\n10.20.4.12 payments.novacorp.internal\n10.20.0.2 dns.novacorp.internal\n'),
    'os-release': rootFile('PRETTY_NAME="Ubuntu 22.04.4 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\n'),
    issue: rootFile('NovaCorp production host. Authorised use only.\n'),
    crontab: rootFile('# /etc/crontab: system-wide crontab\nSHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin\n17 *  * * *  root  cd / && run-parts --report /etc/cron.hourly\n25 6  * * *  root  test -x /usr/sbin/anacron || run-parts --report /etc/cron.daily\n'),
    'cron.d': root({
      'nova-backup': rootFile('# nightly config copy, one file per day\n0 3 * * * root /usr/local/bin/nova-backup.sh --quiet\n'),
      'nova-spool': rootFile('# tidy the escrow spool, held entries are skipped\n15 3 * * * novapay /usr/local/bin/nova-spool-cleaner --older-than 3d --skip-held\n'),
    }),
    nginx: root({
      'nginx.conf': rootFile(NGINX_CONF),
      'sites-available': root({ 'novacorp.conf': rootFile(NGINX_SITE) }),
      'sites-enabled': root({ 'novacorp.conf': link('/etc/nginx/sites-available/novacorp.conf', { owner: 'root' }) }),
    }),
    novapay: root({
      'gateway.conf': rootFile(GATEWAY_BEFORE, { mode: 0o640, group: 'novapay', mtime: '2024-03-11T03:41:00Z' }),
    }),
    ssh: root({ sshd_config: rootFile(SSHD_CONFIG) }),
    ssl: root({
      novapay: root({
        'gateway.crt': rootFile('-----BEGIN CERTIFICATE-----\nMIIDdzCCAl+gAwIBAgIUb3ZhY29ycC1nYXRld2F5LWRlbW8wDQYJKoZIhvcNAQEL\n-----END CERTIFICATE-----\n'),
        'gateway.key': rootFile('-----BEGIN PRIVATE KEY-----\n(redacted)\n-----END PRIVATE KEY-----\n', { mode: 0o600 }),
      }),
    }),
  });
}

function optTree() {
  const r = rng('novacorp-medium:novadash-static');
  const statics = {};
  for (let i = 0; i < 90; i += 1) {
    const id = hex(r, 6);
    statics[`chunk-${id}.js`] = file(`// novadash chunk ${id}\n!function(){var n="${hex(r, 10)}";window.__nova=(window.__nova||[]).concat(n)}();\n`, { owner: 'bob', group: 'bob', mtime: '2024-02-20T14:05:00Z' });
  }
  return root({
    apps: root({
      novapay: dir({
        'README.md': file('# NovaPay gateway\nPayment edge for NovaCorp. Config: /etc/novapay/gateway.conf\nLogs: ./logs\n', { owner: 'novapay', group: 'novapay', mtime: '2024-01-15T09:00:00Z' }),
        VERSION: file('4.18.2\n', { owner: 'novapay', group: 'novapay', mtime: '2024-01-15T09:00:00Z' }),
        bin: dir({
          'novapay-gateway': file('#!/bin/sh\nexec /opt/apps/novapay/lib/gateway --config /etc/novapay/gateway.conf "$@"\n', { mode: 0o755, owner: 'novapay', group: 'novapay', mtime: '2024-01-15T09:00:00Z' }),
        }, { owner: 'novapay', group: 'novapay', mtime: '2024-01-15T09:00:00Z' }),
        logs: link('/var/log/novapay', { owner: 'novapay', mtime: '2024-01-15T09:00:00Z' }),
      }, { owner: 'novapay', group: 'novapay', mtime: '2024-01-15T09:00:00Z' }),
      novadash: dir({
        'package.json': file('{\n  "name": "novadash-static",\n  "version": "2.3.1"\n}\n', { owner: 'bob', group: 'bob', mtime: '2024-02-20T14:05:00Z' }),
        static: dir(statics, { owner: 'bob', group: 'bob', mtime: '2024-02-20T14:05:00Z' }),
      }, { owner: 'bob', group: 'bob', mtime: '2024-02-20T14:05:00Z' }),
      legacy: root({
        'README.OLD': rootFile('Retired in 2022. Kept because nobody dares to delete it.\n'),
        'gateway.conf.old': rootFile('# ancient NovaPay config\nlisten_port = 80\nworker_connections = 64\n'),
      }),
    }),
  });
}

function backupsTree() {
  const dated = (day, text, extra = {}) => owned('root', text, { mtime: `2024-03-${day}T03:00:02Z`, ...extra });
  return dir({
    'README.backup': rootFile('NovaCorp backups\n  exports/  finance invoice exports (batch run, 45 files per batch)\n  config/   nightly config copies from nova-backup.sh, name.YYYYMMDD\n  homes/    one-off home directory mirrors\n', { mtime: '2024-01-10T09:00:00Z' }),
    latest: link('/srv/backups/exports/batch-06', { owner: 'root', mtime: '2024-03-01T03:30:00Z' }),
    exports: exportsTree(),
    config: dir({
      'gateway.conf.20240308': dated('08', GATEWAY_BEFORE, { owner: 'root', mode: 0o644 }),
      'gateway.conf.20240309': dated('09', GATEWAY_BEFORE, { owner: 'root', mode: 0o644 }),
      'gateway.conf.20240310': dated('10', GATEWAY_BEFORE, { owner: 'root', mode: 0o644 }),
      'gateway.conf.20240311': dated('11', GATEWAY_AFTER, { owner: 'root', mode: 0o644 }),
      'gateway.conf.20240312': dated('12', GATEWAY_BEFORE, { owner: 'root', mode: 0o644 }),
      'nginx.conf.20240311': dated('11', NGINX_CONF, { owner: 'root', mode: 0o644 }),
      'sshd_config.20240311': dated('11', SSHD_CONFIG, { owner: 'root', mode: 0o644 }),
    }, { owner: 'root', group: 'root', mtime: '2024-03-12T03:00:02Z' }),
    homes: dir({ ghost: ghostMirror() }, { owner: 'root', group: 'root', mtime: '2024-03-11T03:19:30Z' }),
  }, { owner: 'root', group: 'root', mtime: '2024-03-12T03:00:02Z' });
}

const NOVA_BACKUP_SH = [
  '#!/bin/sh',
  '# NovaCorp nightly backup, started by /etc/cron.d/nova-backup at 03:00',
  'set -eu',
  'STAMP=$(date +%Y%m%d)',
  'cp /etc/novapay/gateway.conf /srv/backups/config/gateway.conf.$STAMP',
  'cp /etc/nginx/nginx.conf /srv/backups/config/nginx.conf.$STAMP',
  'cp /etc/ssh/sshd_config /srv/backups/config/sshd_config.$STAMP',
  '',
].join('\n');

const NOVA_SPOOL_CLEANER = [
  '#!/bin/sh',
  '# removes processed escrow entries older than N days from the spool',
  '# entries whose state is "held" are never touched (an operator parked them on purpose)',
  'SPOOL=/var/lib/novapay/.spool',
  'echo "cleaning $SPOOL" | logger -t nova-spool-cleaner',
  '',
].join('\n');

const fsRoot = dir({
  bin: link('/usr/bin', { owner: 'root', mtime: LONG_AGO }),
  etc: etcTree(),
  home: root({ guest: guestHome(), alice: aliceHome(), bob: bobHome(), ghost: ghostHome() }),
  opt: optTree(),
  root: root({
    '.bash_history': rootFile('vault-rotate --all\nexit\n', { mode: 0o600 }),
    'todo.txt': rootFile('rotate the vault keys after the reorg\n', { mode: 0o600 }),
  }, { mode: 0o700 }),
  srv: root({ backups: backupsTree() }),
  tmp: dir({
    '.nova-rotate.lock': file('', { owner: 'novapay', group: 'novapay', mtime: '2024-03-14T03:15:01Z' }),
    '.k': file('CTF{wrong_turn_check_the_logs}\n', { owner: 'ghost', group: 'ghost', mtime: '2024-03-11T02:20:10Z' }),
    'cleanup.sh': file('#!/bin/sh\nrm -rf /tmp/nova-*\n', { mode: 0o755, owner: 'bob', group: 'bob', mtime: '2024-03-02T12:00:00Z' }),
  }, { mode: 0o777, owner: 'root', group: 'root', mtime: '2024-03-14T03:15:01Z' }),
  usr: root({
    bin: root({
      sudo: rootExec('#!ELF sudo (stub)\n'),
      passwd: rootExec('#!ELF passwd (stub)\n'),
      env: rootExec('#!ELF env (stub)\n'),
    }),
    local: root({
      bin: root({
        'nova-backup.sh': rootExec(NOVA_BACKUP_SH),
        'nova-healthcheck': rootExec('#!/bin/sh\ncurl -fsS http://127.0.0.1:8080/api/v1/health >/dev/null\n'),
        'nova-spool-cleaner': rootExec(NOVA_SPOOL_CLEANER),
      }),
    }),
  }),
  var: root({
    lib: root({ novapay: dir({ '.spool': spoolTree() }, { owner: 'novapay', group: 'novapay', mtime: '2024-03-11T02:31:07Z' }) }),
    log: root({
      'auth.log': file(authLog(), { owner: 'syslog', group: 'adm', mode: 0o644, mtime: '2024-03-11T06:25:01Z' }),
      syslog: file(syslog(), { owner: 'syslog', group: 'adm', mode: 0o644, mtime: '2024-03-11T06:25:01Z' }),
      nginx: dir({
        'access.log': file(accessLog({ seed: 'novacorp-medium:access', start: '2024-03-10T20:00:00Z', end: '2024-03-11T06:00:00Z', count: 4000, specials: [GHOST_ACCESS] }), { owner: 'www-data', group: 'adm', mtime: '2024-03-11T06:00:00Z' }),
        'access.log.1': file(accessLog({ seed: 'novacorp-medium:access-1', start: '2024-03-09T20:00:00Z', end: '2024-03-10T20:00:00Z', count: 1500 }), { owner: 'www-data', group: 'adm', mtime: '2024-03-10T20:00:00Z' }),
        'error.log': file(errorLog(), { owner: 'www-data', group: 'adm', mtime: '2024-03-11T06:00:00Z' }),
      }, { owner: 'www-data', group: 'adm', mtime: '2024-03-11T06:00:00Z' }),
      novapay: dir({
        'gateway.log': file(gatewayLog(), { owner: 'novapay', group: 'novapay', mtime: '2024-03-14T09:00:00Z' }),
        'audit.log': file(auditLog({ seed: 'novacorp-medium:audit', start: '2024-03-11T06:00:00Z', end: '2024-03-14T09:00:00Z', count: 380 }), { owner: 'novapay', group: 'novapay', mtime: '2024-03-14T09:00:00Z' }),
        'audit.log.1': file(previousAuditLog(), { owner: 'novapay', group: 'novapay', mtime: '2024-03-11T06:00:00Z' }),
        'vault-debug.log': file('vault debug dump (root only)\nCTF{this_log_is_a_dead_end}\n', { mode: 0o600, owner: 'root', group: 'root', mtime: '2024-03-11T02:40:00Z' }),
      }, { owner: 'novapay', group: 'novapay', mtime: '2024-03-14T09:00:00Z' }),
    }),
  }),
}, { owner: 'root', group: 'root', mtime: LONG_AGO });

// ---------------------------------------------------------------------------------------------------------------
// Mode definition
// ---------------------------------------------------------------------------------------------------------------

export default {
  mode: 'medium',
  title: 'NovaCorp Server Room',
  tagline: 'A rogue sysadmin hid five recovery codes on a production server. Dig through the logs.',
  difficulty: 'medium',
  lore: [
    'NOVACORP INCIDENT RESPONSE  //  INC-2024-0311',
    '',
    '02:13  an unauthorised session opens on the NovaPay server room box.',
    '02:14  one request reaches the edge that nobody can explain. one address, one time.',
    '02:31  the session closes. sysadmin "ghost" is gone and his account is locked.',
    '03:02  five vault recovery codes are missing. ghost hid them on this machine.',
    '',
    'You have a read-only guest shell. Nothing here can be changed, only read.',
    'Trust the logs. Distrust the filenames. Ghost knew every trick in the book.',
    'The first rule of incident response: do not panic, grep.',
    '',
    'Type help to begin.',
  ],
  user: 'guest',
  host: 'arena',
  home: '/home/guest',
  fs: fsRoot,
  motd: [
    'NovaCorp Server Room // host arena // PRODUCTION',
    'Authorised incident responders only. Every command is logged.',
    'Incident INC-2024-0311 is open: 5 recovery codes outstanding. Start with ~/briefing.txt',
    '',
    'Last login: Wed Mar 13 17:44:09 2024 from 10.20.0.77',
  ].join('\n'),
  codes: [
    {
      n: 1,
      title: 'Needle in the Invoice Haystack',
      points: 90,
      hints: [
        'Finance exports live under /srv/backups/exports: 270 near-identical files, but one of them is not like the others. Size is a fingerprint.',
        'find can filter by size: -size +3k means bigger than 3 KB. Add -type f to skip directories. (-newer and -mtime find the recently touched file too, and ls -lS sorts by size.) The last line of the odd file is not readable as it is.',
        'find /srv/backups/exports -type f -size +3k, then look at the end of that file with tail -n 1. The value after the comma is written backwards: cut -d, -f2 | rev',
      ],
    },
    {
      n: 2,
      title: 'The Visitor Who Came Once',
      points: 90,
      hints: [
        'The SOC says the intruder used a throwaway address: every normal client shows up many times in /var/log/nginx/access.log, the intruder exactly once. wc -l tells you how big the haystack is.',
        'Pull out the first column (awk \'{print $1}\' or cut -d" " -f1), then sort | uniq -c | sort -n ranks addresses by how often they appear. Then grep -r that address across all of /var/log and look at the lines that mention a receipt.',
        'awk \'{print $1}\' /var/log/nginx/access.log | sort | uniq -c | sort -n | head -n 3, then grep -r <ip> /var/log | grep receipt. The receipt is rot13: awk \'{print $9}\' | tr \'A-Za-z\' \'N-ZA-Mn-za-m\'',
      ],
    },
    {
      n: 3,
      title: 'Spot the Difference',
      points: 90,
      hints: [
        'The nightly backup job keeps one copy of the gateway config per day in /srv/backups/config. Something changed the night ghost left. alice noted when the backup job runs.',
        'diff old new prints only the lines that differ (< old, > new). One changed value is not plain text: it looks like base64 (letters and digits, maybe ending in = or ==).',
        'diff /srv/backups/config/gateway.conf.20240310 /srv/backups/config/gateway.conf.20240311, then take the changed login_banner_b64 value: grep \'^> login\' | awk \'{print $4}\' | base64 -d',
      ],
    },
    {
      n: 4,
      title: 'Held in the Spool',
      points: 90,
      hints: [
        'The diff from code 3 also printed a comment line that is not a setting. Read it: it names a directory and a keyword.',
        'Names that start with a dot are hidden from a plain ls; use ls -la. In that directory look for the entry whose state is held (grep -r held <dir>) or owned by ghost (find <dir> -user ghost, or ls -l shows the owner). grep -A 1 prints the line after a match.',
        'grep payload /var/lib/novapay/.spool/q-7731/0003.entry | awk \'{print $2}\' | base64 -d | tr \'A-Za-z\' \'N-ZA-Mn-za-m\' (the payload was rot13d first, then base64d)',
      ],
    },
    {
      n: 5,
      title: 'Mirror, Mirror on the Wall',
      points: 90,
      hints: [
        'ghost\'s home directory is locked: ls -ld /home/ghost shows why (mode drwx------, owner ghost). But someone may have copied it before the account was locked. Check alice\'s notes.',
        'alice\'s notes mention a mirror reachable through a symlink (ls -l shows ->, find / -type l lists symlinks, find / -user ghost lists everything ghost owns). Dotfiles such as .bash_history show what he did and where.',
        'cat /home/alice/notes/audit-todo.txt, then cat /home/alice/ghost-mirror/.bash_history. The sealed value is hex: cat /home/alice/ghost-mirror/.local/share/nova/receipts/seal.hex | xxd -r -p',
      ],
    },
  ],
  sudoers: [],
  processes: [
    'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
    'root           1  0.0  0.1 167772 11432 ?        Ss   Mar08   0:11 /sbin/init',
    'root         389  0.0  0.1  31956  9120 ?        Ss   Mar08   0:03 /lib/systemd/systemd-journald',
    'root         471  0.0  0.0   6744  2840 ?        Ss   Mar08   0:00 /usr/sbin/cron -f',
    'syslog       478  0.0  0.0 222404  5188 ?        Ssl  Mar08   0:02 /usr/sbin/rsyslogd -n -iNONE',
    'root         512  0.0  0.1  15432  7600 ?        Ss   Mar08   0:01 /lib/systemd/systemd-logind',
    'root         601  0.0  0.1  15852  8412 ?        Ss   Mar08   0:00 sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups',
    'root        1588  0.0  0.1  55216  5296 ?        Ss   Mar08   0:00 nginx: master process /usr/sbin/nginx -g daemon on; master_process on;',
    'www-data    1604  0.2  0.2  55960  9372 ?        S    Mar08   3:48 nginx: worker process',
    'www-data    1605  0.2  0.2  55960  9368 ?        S    Mar08   3:51 nginx: worker process',
    'novapay     2210  1.3  2.4 1284532 98240 ?       Ssl  Mar08  41:07 /opt/apps/novapay/bin/novapay-gateway --config /etc/novapay/gateway.conf',
    'novapay     2231  0.0  0.3  71124 12288 ?        S    Mar08   0:22 /usr/local/bin/nova-spool-cleaner --older-than 3d --skip-held',
    'bob         3340  0.0  0.5 724012 21980 ?        Sl   Mar13   0:14 node /home/bob/projects/novadash/server.js',
    'alice       4188  0.0  0.0  10236  5120 pts/0    Ss   08:58   0:00 -bash',
    'guest       4410  0.0  0.0  10236  5088 pts/1    Ss   09:24   0:00 -bash',
    'guest       4467  0.0  0.0  12120  3412 pts/1    R+   09:30   0:00 ps aux',
  ].join('\n'),
  extraCommands: {
    crontab: [
      '# NovaCorp guest crontab (read-only incident account)',
      '# m h  dom mon dow   command',
      '*/15 * * * * /usr/local/bin/nova-healthcheck >/dev/null 2>&1',
    ].join('\n'),
    last: [
      'alice    pts/0        10.20.0.31       Thu Mar 14 08:58   still logged in',
      'guest    pts/1        10.20.0.77       Thu Mar 14 09:24   still logged in',
      'bob      pts/0        10.20.0.45       Wed Mar 13 17:02 - 18:40  (01:38)',
      'guest    pts/1        10.20.0.77       Wed Mar 13 17:44 - 17:52  (00:08)',
      'alice    pts/2        10.20.0.31       Mon Mar 11 03:02 - 04:15  (01:13)',
      'ghost    pts/2        10.99.0.2        Mon Mar 11 02:13 - 02:31  (00:17)',
      'ghost    pts/2        10.20.0.14       Sun Mar 10 16:48 - 18:05  (01:17)',
      'bob      pts/0        10.20.0.45       Fri Mar  8 09:12 - 17:30  (08:18)',
      '',
      'wtmp begins Fri Mar  1 00:00:11 2024',
    ].join('\n'),
    who: [
      'alice    pts/0        2024-03-14 08:58 (10.20.0.31)',
      'guest    pts/1        2024-03-14 09:24 (10.20.0.77)',
    ].join('\n'),
    w: [
      ' 09:30:00 up 6 days,  9:30,  2 users,  load average: 0.12, 0.09, 0.08',
      'USER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT',
      'alice    pts/0    10.20.0.31       08:58    0.00s  0.04s  0.00s -bash',
      'guest    pts/1    10.20.0.77       09:24    0.00s  0.01s  0.00s w',
    ].join('\n'),
    uptime: ' 09:30:00 up 6 days,  9:30,  2 users,  load average: 0.12, 0.09, 0.08',
    df: [
      'Filesystem      Size  Used Avail Use% Mounted on',
      '/dev/sda1        40G   17G   21G  45% /',
      'tmpfs           1.9G     0  1.9G   0% /dev/shm',
      '/dev/sdb1       100G   34G   61G  36% /srv/backups',
    ].join('\n'),
  },
};
