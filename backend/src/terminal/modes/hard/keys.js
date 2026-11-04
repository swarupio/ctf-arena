// Code 4 support: forty NovaCorp keys, exactly one of which is the genuine archive key.
// The genuine one is identified by md5 (/etc/ghost/trusted.md5 lists its fingerprint without a path).
import { rng, int, pick, hex } from '../../gen.js';
import { ARCHIVE_PASSPHRASE } from './constants.js';

const WORDS = ['copper', 'meridian', 'cobalt', 'falcon', 'saffron', 'granite', 'willow', 'ember', 'quartz', 'tundra',
  'marble', 'raven', 'cinder', 'velvet', 'pepper', 'orchid', 'basalt', 'thistle', 'cedar', 'nimbus', 'onyx', 'sparrow',
  'amber', 'zephyr', 'pewter', 'maple', 'delta', 'comet', 'slate', 'harvest'];

export const KEY_COUNT = 40;
const GENUINE_INDEX = 23;

const keyText = (id, issued, secret) => `-----BEGIN NOVA KEY-----\nid: ${id}\nowner: ghost\nissued: ${issued}\nsecret: ${secret}\n-----END NOVA KEY-----\n`;

// Returns { files: { 'nk-xxxx.key': text }, genuineName }. The genuine key holds the per team {{seed:pass:1}} secret,
// so its fingerprint is only known once rendered: trusted.md5 uses a {{md5file:...}} token for it.
export function buildKeys() {
  const r = rng('hard-keys');
  const files = {};
  const seenSecrets = new Set([ARCHIVE_PASSPHRASE]);
  const seenIds = new Set();
  let genuineName = '';
  for (let i = 0; i < KEY_COUNT; i += 1) {
    let id = `nk-${hex(r, 4)}`;
    while (seenIds.has(id)) { id = `nk-${hex(r, 4)}`; }
    seenIds.add(id);
    const issued = `2023-${String(int(r, 1, 12)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}`;
    let secret = `${pick(r, WORDS)}-${pick(r, WORDS)}-${int(r, 1000, 9999)}`;
    while (seenSecrets.has(secret)) { secret = `${pick(r, WORDS)}-${pick(r, WORDS)}-${int(r, 1000, 9999)}`; }
    seenSecrets.add(secret);
    if (i === GENUINE_INDEX) {
      secret = ARCHIVE_PASSPHRASE;
      genuineName = `${id}.key`;
    }
    files[`${id}.key`] = keyText(id, issued, secret);
  }
  return { files, genuineName };
}
