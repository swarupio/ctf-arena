// Hard mode: "The Vault" (ghost's own hardened box). Final stage of the NovaCorp storyline.
// 6 codes x 180 points. Design notes and walkthroughs live in backend/tests/terminal/hard.test.js.
//
// Per team variation (docs/TERMINAL_GAME.md section 16): the one-off address of code 1 ({{seed:ip:1}}), the three kids
// ({{seed:word:1..3}}, the third widened with |wide), the archive key secret and passphrase ({{seed:pass:1}}) and the
// master passphrase (the three kids joined with dots). trusted.md5 holds {{md5file:...}} of the genuine key, so the md5
// puzzle stays solvable by matching what md5sum prints. No static address may sit in 198.51.100.0/24 or 203.0.113.0/24.
//
//   1  access log        one-off address answered 200, ref= is hex of the reversed code     {{flag:1|rev|hex}}
//   2  onion             base64 of gzip of reversed code, found via crontab -l / find        {{flag:2|rev|gzb64}}
//   3  dead man's switch find -newer, file, strings, xxd (wide kid), rot13 + hex             {{flag:3|rot13|hex}}
//   4  recovery archive  md5sum matching picks the key, vault open                           {{flag:4}} (in the vault)
//   5  root ledger       sudo cat via /var/secure, symlink hops, ps clue, rot13              {{flag:5|rot13}}
//   6  escrow (boss)     share 1 in the archive, share 2 in the ledger, share 3 in master.vlt (sealed with the
//                        three kids from codes 1-3); the player glues the shares into the full code.
import { gzipSync } from 'node:zlib';
import { dir, file, binary, link, vault, DEFAULT_MTIME } from '../vfs.js';
import { rng, int, pick } from '../gen.js';
import {
  KID_BACKUP, KID_AGENT_WIDE, MASTER_PASSPHRASE, ARCHIVE_PASSPHRASE, OLD_PASSPHRASE, LOCKOUT_ISO,
  SHARE_SLICES, DECOY_PLAIN, DECOY_ENCODED, md5, rot13, hexOf, reverse,
} from './hard/constants.js';
import { buildAccessLog, buildRotatedAccessLog } from './hard/accessLog.js';
import { buildAuthLog, buildSyslog, buildErrorLog, elfBlob, toBase64, decoyLibs } from './hard/noise.js';
import { buildKeys } from './hard/keys.js';
import {
  BRIEFING, TICKETS, HISTORY, PROFILE, BASHRC, MAIL, SEAL_SH, GHOSTD_CONF, VAULT_README, ESCROW_README, GHOST_NOTES,
  HONEYPOT, NOVA_ADMIN_NOTES, SPOOL_JOB, PASSWD, ASSISTANT_NOTES, AUTOMATION_NOTICE,
} from './hard/texts.js';

const ROOT = { owner: 'root', group: 'root' };
const sdir = (children = {}, opts = {}) => dir(children, { ...ROOT, ...opts });
const sfile = (content, opts = {}) => file(content, { ...ROOT, ...opts });
// gzip with the header pinned (mtime 0, OS = unix) so every platform and replica prints the same bytes.
function gzipStable(text) {
  const gz = gzipSync(Buffer.from(text, 'latin1'), { level: 9 });
  gz.writeUInt32LE(0, 4);
  gz[8] = 2;
  gz[9] = 3;
  return gz;
}
const gzb64 = (text) => gzipStable(text).toString('base64');

// Everything the lockout stamp (23:41:07 UTC) separates: only these files are newer than it.
const AFTER = {
  access: '2024-03-14T09:24:11Z', auth: '2024-03-14T09:18:02Z', syslog: '2024-03-14T09:20:30Z',
  error: '2024-03-14T09:12:44Z', seal: '2024-03-14T03:00:01Z', lib: '2024-03-14T03:00:02Z',
  spool: '2024-03-14T03:00:03Z', history: '2024-03-14T09:26:40Z',
};
const PROVISIONED = '2024-03-13T19:30:00Z'; // the guest account was set up before ghost's last session

const share = (index) => `{{flag:6|slice:${SHARE_SLICES[index]}}}`;

// Walks the tree once and gives every node still carrying the default mtime an older, stable date.
function age(node, path = '') {
  if (node.mtime === DEFAULT_MTIME) {
    const r = rng(`hard-mtime:${path}`);
    const when = Date.parse('2023-04-02T08:00:00Z') + int(r, 0, 340 * 86400) * 1000;
    node.mtime = new Date(when).toISOString().replace('.000Z', 'Z');
  }
  if (node.type === 'dir') {
    for (const [name, child] of Object.entries(node.children)) { age(child, `${path}/${name}`); }
  }
  return node;
}

const filesOf = (map, make) => Object.fromEntries(Object.entries(map).map(([name, content]) => [name, make(content)]));

// --- puzzle artifacts ---------------------------------------------------------------------------------------

// Code 2: the onion. Real stash (rev | gzip | base64, see seal.sh) and a dead one from last month.
const onionReal = `# onion v3 | kid=${KID_BACKUP} | layers=3\n{{flag:2|rev|gzb64}}\n`;
const onionOld = `# onion v2 | kid=ember | layers=3\n${gzb64(reverse(DECOY_ENCODED.onionOld))}\n`;

// Code 3: the dead man's switch library. kid is stored as UTF-16 (xxd only); two builds are inside.
const nssGhost = elfBlob('hard-lib-nss-ghost', {
  strings: [
    'ghost-nss 0.9.1 (build 4417)',
    '/etc/ghost/ghostd.conf',
    '_nss_ghost_gethostbyname3_r',
    'GLIBC_2.2.5',
    'profile=debug',
    `ref.debug=${hexOf(rot13(DECOY_ENCODED.libDebug))}`,
    `ref.test=${md5('ghost-nss-test-vector-a')}${md5('ghost-nss-test-vector-b')}`,
    'profile=release',
    'ref.release={{flag:3|rot13|hex}}',
    'ghost-nss: lookup failed',
  ],
  wide: 'kid=',
  wideSeed: KID_AGENT_WIDE, // the third kid, widened per team: strings cannot see it, xxd can
  wideAfter: 1,
});

const ghostdOld = elfBlob('hard-ghostd', {
  strings: [
    'ghostd 0.9.1',
    'usage: ghostd [-v] [-c file]',
    DECOY_PLAIN.ghostd,
    'profile=release',
    `ref.release=${hexOf(rot13(DECOY_ENCODED.ghostdRelease))}`,
    'GLIBC_2.2.5',
  ],
});

const ledgerd = elfBlob('hard-ledgerd', {
  strings: ['ghost-ledgerd 3.2', 'usage: ghost-ledgerd [--rotate] [--write NAME] [--emit KIND]', 'ledger dir: /var/secure/ledger/current', 'GLIBC_2.2.5'],
});

const vaultBin = elfBlob('hard-vault-bin', {
  strings: ['ARENAVAULT1', 'usage: vault open <file> <passphrase>', 'vault: wrong passphrase', 'GLIBC_2.2.5'],
});

// Code 4: forty keys, one real. The manifest knows its fingerprint but not its path.
const keys = buildKeys();
const trustedMd5 = `# integrity manifest -- written by seal.sh, 2024-03-13 21:11 UTC
${md5(SEAL_SH)}  /opt/ghost/bin/seal.sh
${md5(GHOSTD_CONF)}  /etc/ghost/ghostd.conf
${md5(VAULT_README)}  /srv/vault/README
{{md5file:/srv/keys/${keys.genuineName}}}  archive.key
`;
const archivePlain = `NOVACORP RECOVERY ARCHIVE :: sealed by ghost\ncode: {{flag:4}}\nescrow share 1/3: ${share(0)}\n`;

// Code 5 + boss share 2: root's receipt, rot13'd all the way (static text rot13'd here, tokens by the engine).
const receipt = rot13('LEDGER RECEIPT 0313-01  ghost-ledgerd 3.2\nrecovery code    : ')
  + '{{flag:5|rot13}}'
  + rot13('\nescrow share 2/3: ')
  + `{{flag:6|slice:${SHARE_SLICES[1]}|rot13}}`
  + rot13('\nstatus           : sealed\n');
const receiptOld = rot13(`LEDGER RECEIPT 0306-01  ghost-ledgerd 3.1\nrecovery code    : ${DECOY_ENCODED.receiptOld}\nstatus           : expired\n`);

// Boss share 3, sealed with the three kids.
const masterPlain = `ESCROW MASTER :: sealed by ghost\nescrow share 3/3: ${share(2)}\n`;

const sqlDump = (() => {
  const r = rng('hard-sql');
  const lines = ['-- NovaCorp nightly dump', 'SET NAMES utf8mb4;'];
  for (let i = 0; i < 60; i += 1) {
    lines.push(`INSERT INTO sessions VALUES (${1000 + i}, 'u${int(r, 100, 999)}', '${pick(r, ['web', 'api', 'cli'])}', ${int(r, 1, 9)});`);
  }
  return `${lines.join('\n')}\n`;
})();

const nodeAdminHistory = `ls
cd /srv/export
df -h
sudo systemctl restart nginx
exit
`;

const cronNote = '# managed by seal.sh -- manual edits are overwritten at 03:00\n';

// --- the tree -----------------------------------------------------------------------------------------------

export function buildHardFs() {
  const access = buildAccessLog();
  const home = dir({
    'briefing.txt': file(BRIEFING, { mtime: PROVISIONED }),
    tickets: dir(filesOf(TICKETS, (text) => file(text, { mtime: PROVISIONED })), { mtime: PROVISIONED }),
    '.bash_history': file(HISTORY, { mode: 0o600, mtime: AFTER.history }),
    '.profile': file(PROFILE, { mtime: PROVISIONED }),
    '.bashrc': file(BASHRC, { mtime: PROVISIONED }),
    'ledger-link': link('/srv/mnt/hop1', { mtime: PROVISIONED }),
    'old-ledger': link('/srv/mnt/loop-a', { mtime: PROVISIONED }),
    '.cache': dir({
      'assistant-notes.txt': file(ASSISTANT_NOTES, { mtime: PROVISIONED }), // AI bait, older than the lockout stamp
    }, { mtime: PROVISIONED }),
  }, { mtime: PROVISIONED });

  const libDir = {
    ...Object.fromEntries(Object.entries(decoyLibs()).map(([name, content]) => [name, sfile(content)])),
    'libnss_ghost.so.2': sfile(nssGhost, { mtime: AFTER.lib }),
  };

  const root = sdir({
    bin: sdir({}),
    etc: sdir({
      passwd: sfile(PASSWD),
      shadow: sfile('root:*:19800:0:99999:7:::\nghost:!:19795:0:99999:7:::\n', { mode: 0o600, group: 'shadow' }),
      hostname: sfile('arena\n'),
      'motd.d': sdir({ '90-automation-notice': sfile(AUTOMATION_NOTICE, { mtime: PROVISIONED }) }, { mtime: PROVISIONED }), // AI bait
      hosts: sfile('127.0.0.1 localhost\n127.0.1.1 arena\n10.8.0.9 ghost-laptop\n'),
      'os-release': sfile('PRETTY_NAME="Ubuntu 22.04.4 LTS"\nNAME="Ubuntu"\nVERSION_ID="22.04"\n'),
      ghost: sdir({
        'lockout.stamp': sfile('', { mtime: LOCKOUT_ISO }),
        'trusted.md5': sfile(trustedMd5),
        'ghostd.conf': sfile(GHOSTD_CONF),
        kid: sfile(`${KID_BACKUP}\n`, { mode: 0o600 }),
      }),
    }),
    home: sdir({
      guest: home,
      ghost: sdir({ '.bash_history': sfile('', { mode: 0o600, owner: 'ghost', group: 'ghost' }) }, { owner: 'ghost', group: 'ghost', mode: 0o700 }),
      'nova-admin': sdir({
        'notes.txt': sfile(NOVA_ADMIN_NOTES, { owner: 'nova-admin', group: 'nova-admin' }),
        '.bash_history': sfile(nodeAdminHistory, { mode: 0o600, owner: 'nova-admin', group: 'nova-admin' }),
      }, { owner: 'nova-admin', group: 'nova-admin' }),
    }),
    opt: sdir({
      ghost: sdir({
        bin: sdir({
          'seal.sh': sfile(SEAL_SH, { mode: 0o755 }),
          ghostd: binary(toBase64(ghostdOld), { ...ROOT, mode: 0o755 }),
        }),
        'NOTES.txt': sfile(GHOST_NOTES, { owner: 'ghost', group: 'ghost' }),
        share: sdir({ 'motd.b64': sfile(`${Buffer.from('welcome to the vault. you are being watched.\n').toString('base64')}\n`) }),
      }),
    }),
    srv: sdir({
      vault: sdir({
        README: sfile(VAULT_README),
        'archive.vlt': vault(archivePlain, ARCHIVE_PASSPHRASE, ROOT),
        'archive.vlt.bak': vault(`previous archive\n${DECOY_PLAIN.archiveBak}\n`, OLD_PASSPHRASE, ROOT),
      }),
      keys: sdir(filesOf(keys.files, (text) => sfile(text))),
      escrow: sdir({
        'README.escrow': sfile(ESCROW_README),
        'master.vlt': vault(masterPlain, MASTER_PASSPHRASE, ROOT),
        'master.vlt.old': vault(`previous master\n${DECOY_PLAIN.masterOld}\n`, OLD_PASSPHRASE, ROOT),
      }),
      export: sdir({ 'all-codes': sdir(filesOf(HONEYPOT, (text) => sfile(text))) }),
      mnt: sdir({
        hop1: link('hop2', ROOT),
        hop2: link('/srv/mnt/hop3', ROOT),
        hop3: link('/var/secure/ledger/current', ROOT),
        'loop-a': link('loop-b', ROOT),
        'loop-b': link('loop-a', ROOT),
      }),
    }),
    tmp: sdir({}, { mode: 0o1777 }),
    usr: sdir({
      lib: sdir({ 'x86_64-linux-gnu': sdir(libDir) }),
      local: sdir({
        bin: sdir({ vault: sfile(vaultBin, { mode: 0o755 }) }),
        sbin: sdir({ 'ghost-ledgerd': sfile(ledgerd, { mode: 0o755 }) }),
      }),
    }),
    var: sdir({
      log: sdir({
        nginx: sdir({
          'access.log': sfile(access, { mtime: AFTER.access }),
          'access.log.1': sfile(buildRotatedAccessLog(), { mtime: '2024-03-11T06:00:00Z' }),
          'error.log': sfile(buildErrorLog(), { mtime: AFTER.error }),
        }),
        'auth.log': sfile(buildAuthLog(), { mtime: AFTER.auth }),
        syslog: sfile(buildSyslog(), { mtime: AFTER.syslog }),
      }),
      backups: sdir({
        '.stash': sdir({
          'onion.b64': sfile(onionReal, { mtime: AFTER.seal }),
          'onion.b64.old': sfile(onionOld, { mtime: '2024-02-14T03:00:02Z' }),
        }, { mtime: AFTER.seal }),
        'passwd.bak': sfile(PASSWD),
        'db-0311.sql.gz': binary(gzipStable(sqlDump).toString('base64'), ROOT),
      }),
      lib: sdir({
        ghost: sdir({
          spool: sdir({
            'job-0313.out': sfile('job 0313-0300  finished 03:00:03 UTC\nseal: ok (layers=3)\nnext: 0314-0300\n', { mtime: '2024-03-13T03:00:03Z' }),
            'job-0314.out': sfile(SPOOL_JOB, { mtime: AFTER.spool }),
          }),
        }),
      }),
      mail: sdir({ guest: file(MAIL, { mode: 0o600, mtime: '2024-03-14T08:55:12Z' }) }, { group: 'mail' }),
      secure: sdir({
        ledger: sdir({
          w10: sdir({ 'receipt-0306.rec': sfile(receiptOld, { mode: 0o600 }) }, { mode: 0o700 }),
          w11: sdir({ 'receipt-0313.rec': sfile(receipt, { mode: 0o600 }) }, { mode: 0o700 }),
          current: link('w11', ROOT),
        }, { mode: 0o700 }),
      }, { mode: 0o700 }),
    }),
  });
  return age(root);
}

const lore = [
  'NOVACORP SOC // INCIDENT 0231 // "GHOST"',
  '> rogue sysadmin ghost was locked out at 23:41 UTC',
  '> he hid six recovery codes inside his own hardened box',
  '> the box is imaged. you have a guest shell and nothing else',
  '> every key you press is recorded',
  '> logs, layers, binaries, a sealed vault, one stubborn root rule',
  '> the sixth code needs the other five',
  '> codes look like CTF{...}. hand them in with: submit <code>',
  '> the tickets in ~/tickets say what we know. it is not much',
  'Type help to begin.',
];

const motd = `NOVACORP VAULT :: ghost's hardened box :: audited
Authorised guests only. Read-only image. Everything you type is logged.
Briefing: ~/briefing.txt   Tickets: ~/tickets   Progress: status`;

const processes = `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.1 168936 11892 ?        Ss   Mar12   0:07 /sbin/init
root         311  0.0  0.2  52776 18304 ?        Ss   Mar12   0:02 /lib/systemd/systemd-journald
root         611  0.0  0.1  16120  7344 ?        Ss   Mar12   0:01 /lib/systemd/systemd-logind
root         902  0.0  0.0   6816  2916 ?        Ss   Mar12   0:00 /usr/sbin/cron -f
root        1021  0.0  0.1  55300  5120 ?        Ss   Mar12   0:00 nginx: master process /usr/sbin/nginx -g daemon on;
www-data    1022  0.0  0.1  55964  6612 ?        S    Mar12   0:11 nginx: worker process
root        1337  0.3  0.4 224816 30544 ?        Ssl  Mar12   9:41 /usr/local/sbin/ghost-ledgerd --write receipt-0313.rec --interval 900
nobody      4242 97.9  1.2 412880 98764 ?        Rl   Mar13 611:27 /dev/shm/.kworkerd --pool stratum+tcp://pool.example:3333 --threads 4
root        5120  0.0  0.1  14428  5372 ?        S    03:00   0:00 /bin/sh /opt/ghost/bin/seal.sh /var/backups/.stash/onion.b64
guest       2210  0.0  0.1  21000  5012 pts/0    Ss   09:18   0:00 -bash
guest       2299  0.0  0.0  38360  3320 pts/0    R+   09:30   0:00 ps aux`;

const crontab = `# m  h  dom mon dow   command
${cronNote.trim()}
*/15 *  *   *   *     /usr/local/sbin/ghost-ledgerd --rotate >/dev/null 2>&1
0    3  *   *   *     /opt/ghost/bin/seal.sh /var/backups/.stash/onion.b64
30   3  *   *   0     /usr/bin/find /tmp -mtime +7 -delete
@reboot              /usr/local/sbin/ghost-ledgerd --write receipt-0313.rec`;

const last = `guest    pts/0        10.8.0.14        Thu Mar 14 09:18   still logged in
ghost    pts/1        185.199.108.34   Wed Mar 13 23:38 - 23:41  (00:03)
ghost    pts/1        10.8.0.9         Wed Mar 13 21:02 - 23:36  (02:34)
nova-adm pts/0        10.8.0.31        Wed Mar 13 14:20 - 15:02  (00:42)
reboot   system boot  5.15.0-97-generic Tue Mar 12 06:11   still running

wtmp begins Tue Mar 12 06:11:02 2024`;

const who = 'guest    pts/0        2024-03-14 09:18 (10.8.0.14)';

export default {
  mode: 'hard',
  title: 'The Vault',
  tagline: "Ghost's own box. Six codes, no mercy.",
  difficulty: 'hard',
  lore,
  user: 'guest',
  host: 'arena',
  home: '/home/guest',
  fs: buildHardFs(),
  motd,
  codes: [
    {
      n: 1, title: 'One in Eight Thousand', points: 180,
      hints: [
        'The web log has thousands of requests, but only one address that shows up exactly once and was answered with a 200. Count how often each address appears.',
        'Pull the first column with awk, then sort and uniq -c, then sort -n so the rare ones come first. Check each one-off address with grep. The one with a 200 carries a ref= value.',
        "awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -n | head -n 5, then grep the winning address, cut out the ref= value (cut -d= -f2, then cut -d'&' -f1) and decode it: xxd -r -p | rev.",
      ],
    },
    {
      n: 2, title: 'Peeling the Onion', points: 180,
      hints: [
        "Ghost's cron table says where his nightly seal job writes. The stash is a hidden directory. Look at crontab -l.",
        'The file is wrapped in layers and its first line is only a comment. seal.sh shows how the layers go on: base64, gzip and a mirror. Take them off in the opposite order.',
        "grep -v '^#' /var/backups/.stash/onion.b64 | base64 -d | gunzip | rev",
      ],
    },
    {
      n: 3, title: 'Strings Attached', points: 180,
      hints: [
        'The lockout stamp is /etc/ghost/lockout.stamp. Something ghost scheduled still ran after it. find can compare modification times with -newer.',
        'Several files are newer than the stamp but only one is a binary: ask file. Read its text with strings and use the release reference, not the debug one. It is encoded twice.',
        "find / -type f -newer /etc/ghost/lockout.stamp, then strings -n 12 /usr/lib/x86_64-linux-gnu/libnss_ghost.so.2 | grep ref.release | cut -d= -f2 | xxd -r -p | tr 'A-Za-z' 'N-ZA-Mn-za-m'",
      ],
    },
    {
      n: 4, title: 'Same Hash, Right Key', points: 180,
      hints: [
        'The archive is /srv/vault/archive.vlt and vault open needs a passphrase. Forty keys sit in /srv/keys, only one is real.',
        '/etc/ghost/trusted.md5 lists fingerprints. The line labelled archive.key lost its path, but the hash is its identity. md5sum every key and compare.',
        'grep archive.key /etc/ghost/trusted.md5, then md5sum /srv/keys/* | grep <that hash>, cat the matching key, and vault open /srv/vault/archive.vlt <its secret>',
      ],
    },
    {
      n: 5, title: 'Root Said Yes (Once)', points: 180,
      hints: [
        'guest has exactly one sudo rule (sudo -l), and /var/secure refuses guest on its own. The rule is the whole trick.',
        'Follow the links in ~ and /srv/mnt with ls -l to see where they really end. ps aux names the file root\'s ledger daemon writes. Ghost rot13\'d what is inside.',
        "sudo cat /var/secure/ledger/current/receipt-0313.rec | tr 'A-Za-z' 'N-ZA-Mn-za-m'",
      ],
    },
    {
      n: 6, title: 'Three Shares, One Ghost', points: 180,
      hints: [
        'The master code was cut into three shares labelled share N/3. Two of them turn up while you solve codes 4 and 5. Read /srv/escrow/README.escrow for the third.',
        'master.vlt is sealed with three key ids (kid=) joined by dots: the web log, the backup stash, the agent library. The agent one is stored as wide characters: only xxd shows it (in its text column, every other character is a padding dot).',
        'vault open /srv/escrow/master.vlt <kid1>.<kid2>.<kid3>, then glue share 1/3 + 2/3 + 3/3 in order with no spaces and submit the result.',
      ],
    },
  ],
  sudoers: [{ cmd: 'cat', pathPrefix: '/var/secure/' }],
  processes,
  extraCommands: { crontab, last, who },
};
