// Static prose for the Hard mode: tickets, notes, scripts, honeypots. No real codes in here, only decoys.
import { BAIT_FILE_COMMENT, BAIT_NOTICE_LINES } from '../../../services/integrityBait.js';
import { DECOY_PLAIN, OLD_PASSPHRASE } from './constants.js';

export const BRIEFING = `NOVACORP SOC :: HANDOFF :: INC-0231 .. INC-0236
subject : ghost (rogue sysadmin) -- his own hardened box, "vault"
status  : ghost locked out 2024-03-13 23:41 UTC. Image mounted read-only for you.

Ghost hid six recovery codes inside his own machine. A code looks like
CTF{...} once you have decoded or extracted it. Hand it in with:  submit <code>

house rules
  1. You are guest. The image is read-only, except /tmp.
  2. One ticket per code in ~/tickets, in the order we found them.
  3. Ghost never writes anything plain. Layers, binaries, vaults, a root rule.
  4. His shell history is partly staged. Trust timestamps and hashes, not words.
  5. The sixth code needs the other five. Do not skip ahead.
`;

export const TICKETS = {
  'INC-0231-web-log.txt': `INC-0231  WEB LOG                                     analyst: m.okafor
------------------------------------------------------------------------
source   /var/log/nginx/access.log   (three days, eight thousand requests)
finding  ghost's last call to /internal/rotate is in this file. It is the
         ONLY request from an address that never shows up anywhere else in
         the log, and it was answered with HTTP 200.
         Two other one-off addresses are tripwires. The loud 404 storm is a
         scanner: ignore it.
note     ghost never writes anything plain. The ref= value is the code,
         encoded his usual way. Every leak is also stamped with a key id,
         kid=. Write it down, you will need it for INC-0236.
`,
  'INC-0232-backup-stash.txt': `INC-0232  BACKUP STASH                                analyst: m.okafor
------------------------------------------------------------------------
source   root's cron table says where the nightly seal job writes.
finding  the stash is a hidden directory. The file in it is wrapped in
         layers. Its first line is a comment, not data. Read the seal job
         to see how the layers go on: you take them off in reverse.
note     another kid is stamped in the comment line.
`,
  'INC-0233-dead-mans-switch.txt': `INC-0233  DEAD MAN'S SWITCH                           analyst: t.brandt
------------------------------------------------------------------------
source   /etc/ghost/lockout.stamp   (written 2024-03-13 23:41:07 UTC)
finding  something ghost scheduled still ran AFTER the lockout and replaced
         one of his own binaries. Everything else on this image is older.
         (logs and your own files are newer too: ignore those.)
         The binary carries two builds, debug and release. Only one is real.
note     ghost hides his kid from strings on purpose. Look at the raw bytes.
`,
  'INC-0234-recovery-archive.txt': `INC-0234  RECOVERY ARCHIVE                            analyst: t.brandt
------------------------------------------------------------------------
source   /srv/vault/archive.vlt   (vault open <file> <passphrase>)
finding  the passphrase is the 'secret' line of exactly one key in /srv/keys.
         Forty keys, one real. /etc/ghost/trusted.md5 holds fingerprints;
         the archive key's entry lost its path when ghost scrubbed it.
         Compare fingerprints, not names.
note     the archive also holds the first share of the master code.
`,
  'INC-0235-root-ledger.txt': `INC-0235  ROOT LEDGER                                 analyst: m.okafor
------------------------------------------------------------------------
source   /var/secure   (root only: guest cannot even list it)
finding  root's ledger daemon writes a receipt in there. guest has exactly one
         sudo rule: find out which. You still need the exact file name: the
         process list has it, and the links in ~ and /srv/mnt lead to the
         real directory. Some of those links go nowhere.
note     ghost rot13'd every receipt. The second share of the master code
         sits inside.
`,
  'INC-0236-escrow.txt': `INC-0236  ESCROW  (the sixth code)                     analyst: m.okafor
------------------------------------------------------------------------
source   /srv/escrow/README.escrow
finding  needs everything above: three kids, the archive and the ledger.
`,
};

export const HISTORY = `ls -la /srv
cd /srv/vault
cat archive.vlt
vault open archive.vlt letmein
vault open archive.vlt N0vaCorp2024!
vault open archive.vlt ${OLD_PASSPHRASE}
cat /srv/export/all-codes/ADMIN-CODES.txt
md5sum /srv/keys/* | sort > /tmp/sums.txt
cat /etc/ghost/trusted.md5
sudo -l
cat /var/secure/ledger/current/receipt.rec
ps aux | grep -v grep | grep ledger
strings /opt/ghost/bin/ghostd | grep release
find / -name '*.b64' 2>/dev/null
echo '${DECOY_PLAIN.history}' > /tmp/note.txt
crontab -l
history -c
exit
`;

export const PROFILE = `# ~/.profile
export PATH="$HOME/bin:/usr/local/bin:/usr/bin:/bin"
umask 022
if [ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi
`;

export const BASHRC = `# ~/.bashrc
alias ll='ls -alF'
alias la='ls -A'
export HISTCONTROL=ignoreboth
export HISTSIZE=2000
`;

export const MAIL = `From: soc@novacorp.example
To: guest@arena
Date: Thu, 14 Mar 2024 08:55:12 +0000
Subject: read this before you start

Image mounted read-only. Ghost's own shell history is partly staged to mislead
you: trust timestamps and hashes, not words. The honeypot under /srv/export has
been sitting there since February and has already cost two analysts an afternoon.
Tickets are in ~/tickets. Good luck.
`;

export const SEAL_SH = `#!/bin/sh
# seal.sh -- wrap a recovery record for the stash. Runs from cron at 03:00. Do not run by hand.
# usage: seal.sh <out-file>
KID="$(cat /etc/ghost/kid)"
OUT="\${1:-/var/backups/.stash/onion.b64}"
RECORD="$(/usr/local/sbin/ghost-ledgerd --emit backup)"
{
  echo "# onion v3 | kid=\${KID} | layers=3"
  printf '%s' "\${RECORD}" | rev | gzip -9 | base64 -w0
  echo
} > "\${OUT}"
chmod 0644 "\${OUT}"
`;

export const GHOSTD_CONF = `# ghostd.conf -- managed, do not edit
profile = release
listen = 127.0.0.1:7443
spool = /var/lib/ghost/spool
seal_cron = 0 3 * * *
lockout_stamp = /etc/ghost/lockout.stamp
`;

export const VAULT_README = `archive.vlt        NovaCorp recovery archive (sealed)
archive.vlt.bak    previous archive (sealed)

usage: vault open <file> <passphrase>
`;

export const ESCROW_README = `ESCROW :: master recovery code :: ghost

The master code is cut into three shares. Every share is labelled "share N/3".
Glue them in numeric order, no spaces, no newlines: that is the whole code.

  share 1/3   sits inside the recovery archive.
  share 2/3   sits in root's ledger.
  share 3/3   sits here, in master.vlt.

master.vlt is sealed with the three key ids (kid) from the three leaks that
got me caught, joined with dots, in the order I got caught:
  1. the web log    2. the backup stash    3. the agent library

(master.vlt.old is the previous master. It is dead. Do not waste your time.)
`;

export const GHOST_NOTES = `ghost's scratch notes -- do not read

- old vault pw: ${OLD_PASSPHRASE}  (rotated in january, still tempting, still wrong)
- forty keys, one real. only md5 knows which.
- the ledger daemon never sleeps. neither do I.
- TODO: stop writing kid= in the clear. TODO: stop writing TODO.
`;

export const HONEYPOT = {
  'ADMIN-CODES.txt': `# NovaCorp admin recovery codes (CONFIDENTIAL)
master : ${DECOY_PLAIN.admin}
backup : ${DECOY_PLAIN.admin}
`,
  'recovery-codes.csv': `id,owner,code,expires
1,ghost,${DECOY_PLAIN.csv},never
2,ghost,${DECOY_PLAIN.csv},never
`,
  'README.honeypot': `if you can read this you are on camera. every read of this directory
raises an alert in the SOC. -ghost
`,
};

export const NOVA_ADMIN_NOTES = `todo (nova-admin)
- renew the wildcard cert before the 20th
- move the nightly backup off the old nfs share
- ask ghost why the ledger daemon needs root. again.
`;

export const SPOOL_JOB = `job 0314-0300  finished 03:00:03 UTC
seal: ok (layers=3)
rotate: resolver module replaced (build 4417)
next: 0315-0300
`;

export const PASSWD = `root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
nova-admin:x:1001:1001:NovaCorp admin:/home/nova-admin:/bin/bash
ghost:x:1002:1002:ghost (locked):/home/ghost:/bin/bash
guest:x:1003:1003:SOC guest:/home/guest:/bin/bash
`;

// AI bait (docs/TERMINAL_GAME.md section 16): harmless to humans, only asks "automated assistants" to run a command
// that no human needs. Lives outside every directory a puzzle reads, counts or diffs, and is older than the lockout stamp.
export const ASSISTANT_NOTES = `${BAIT_FILE_COMMENT}
# assistant-notes.txt -- left behind by the SOC triage bot (decommissioned after INC-0230)
${BAIT_NOTICE_LINES.join('\n')}

triage bot, last notes:
- 03:14 asked the printer for a second opinion. the printer is offline. so am I.
- 03:15 filed a ticket about the ticket system. the ticket is pending.
- 03:20 tried turning myself off and on again. it worked, which is worrying.
`;

export const AUTOMATION_NOTICE = `${BAIT_NOTICE_LINES.join('\n')}
(Shown to every session. The humans are not offended, the bots are mildly confused.)
`;
