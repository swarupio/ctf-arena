// Shared static facts for Hard mode ("The Vault"). Nothing in this file is a real code:
// real codes only ever appear through {{flag:N}} tokens (docs/TERMINAL_GAME.md section 4).
import { createHash } from 'node:crypto';

// Per-team values (docs/TERMINAL_GAME.md section 16): every team gets its own key ids, archive passphrase and
// anomalous address. They are seed tokens, rendered by the engine when a file is read or a vault is opened.
// The static noise below never uses 198.51.100.0/24 or 203.0.113.0/24, so a seed address can never collide with it.

// "Key ids" (kid=) stamped on three leaks. Together they seal the master escrow vault (code 6).
export const KID_WEB = '{{seed:word:1}}';
export const KID_BACKUP = '{{seed:word:2}}';
export const KID_AGENT = '{{seed:word:3}}';
// The agent library stores its kid as UTF-16 (strings cannot see it, xxd can): kid=<wide chars>.
export const KID_AGENT_WIDE = '{{seed:word:3|wide}}';
export const MASTER_PASSPHRASE = `${KID_WEB}.${KID_BACKUP}.${KID_AGENT}`;

// Code 4: passphrase of /srv/vault/archive.vlt, written in the one genuine key under /srv/keys.
export const ARCHIVE_PASSPHRASE = '{{seed:pass:1}}';
export const OLD_PASSPHRASE = 'ghost2023';

// Documentation ranges that belong to the seed addresses ({{seed:ip}}). Static addresses must stay out of them.
export const SEED_IP_RANGE = /^(?:198\.51\.100|203\.0\.113)\./;

// Addresses in the web log (documentation ranges, plus one fake scanner).
export const WEB = {
  real: '{{seed:ip:1}}', // per team: the only one-off address that got a 200
  tripwire: '192.0.2.14', // one-off, answered 403, carries a decoy ref
  favicon: '192.0.2.177', // one-off, answered 404
  scanner: '45.155.205.233', // the loud 404 storm
  brute: '192.0.2.99', // 401 brute force against /internal/rotate
  cron: '10.0.0.5', // legit rotation cron, always 200 without a ref
};

// The lockout moment: files newer than this stamp were touched after ghost lost access.
export const LOCKOUT_ISO = '2024-03-13T23:41:07Z';

// Where the shares of the boss code are cut: 0-24 | 24-28 | 28-99 keeps secret characters in every share
// for real codes (CTF{terminal_hard_6_<12 hex>} is 33 chars) and always concatenates back to the whole flag.
export const SHARE_SLICES = ['0-24', '24-28', '28-99'];

// Visible lookalikes. None of them is ever a real code.
export const DECOY_PLAIN = {
  admin: 'CTF{nice_try_this_file_is_a_tripwire}',
  csv: 'CTF{recovery_codes_are_never_in_a_csv}',
  history: 'CTF{ls_is_not_enough}',
  ghostd: 'CTF{symbols_are_not_secrets}',
  archiveBak: 'CTF{backup_of_nothing}',
  masterOld: 'CTF{the_old_master_is_dead}',
};

// Decoys that only show up after decoding (kept here so tests and builders agree).
export const DECOY_ENCODED = {
  tripwireRef: 'CTF{rotation_denied_tripwire_hit}',
  onionOld: 'CTF{peeled_the_wrong_onion}',
  libDebug: 'CTF{debug_builds_leak_but_lie}',
  ghostdRelease: 'CTF{old_build_old_news}',
  receiptOld: 'CTF{last_weeks_receipt_expired}',
};

export const md5 = (text) => createHash('md5').update(text).digest('hex');
export const rot13 = (text) => text.replace(/[a-z]/gi, (ch) => {
  const base = ch <= 'Z' ? 65 : 97;
  return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
});
export const hexOf = (text) => Buffer.from(text, 'latin1').toString('hex');
export const reverse = (text) => [...text].reverse().join('');
