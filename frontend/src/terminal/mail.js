// Pure helpers for the living story (docs/TERMINAL_GAME.md section 18): which mails exist, which are unread, and the
// cosmetic "commands used" badge. Nothing here is sent to the server except the read marker (a small bit mask), and
// nothing here decides anything: the server builds the mails, the browser only counts and remembers what was read.

import { scopedKey } from '../storage/userScope.js';

/** Cosmetic par per mode: solving a code within this many commands since the last solve earns the "Minimalist" line. */
export const PAR = { easy: 6, medium: 10, hard: 14 };

// The server accepts a mask up to 0xfff (bits 0..11), so ids above 11 are never marked.
export const MAX_MAIL_ID = 11;

const toNumbers = (solved) => (Array.isArray(solved) ? solved : [])
  .map((item) => Number(item && typeof item === 'object' ? item.n : item))
  .filter((n) => Number.isInteger(n) && n >= 1);

/**
 * Ids of the unlocked mails: 1 (welcome), n + 1 for every solved code n, and total + 2 (epilogue) when all `total` codes
 * are solved. Mirrors backend/src/terminal/story.js, so no extra request is needed to know how much mail there is.
 */
export function mailIds(solved, total) {
  const count = Number.isInteger(total) && total > 0 ? total : 0;
  const done = new Set(toNumbers(solved).filter((n) => count === 0 || n <= count));
  const ids = [1, ...[...done].sort((a, b) => a - b).map((n) => n + 1)];
  if (count > 0 && done.size === count) ids.push(count + 2);
  return ids;
}

const bit = (id) => (Number.isInteger(id) && id >= 1 && id <= MAX_MAIL_ID ? 2 ** id : 0);
const cleanMask = (mask) => (Number.isInteger(mask) && mask >= 0 && mask <= 0xfff ? mask : 0);

export const isUnread = (mask, id) => bit(id) === 0 || (cleanMask(mask) & bit(id)) === 0;

export const unreadCount = (ids, mask) => ids.filter((id) => isUnread(mask, id)).length;

export const markRead = (mask, ids) => ids.reduce((next, id) => next | bit(id), cleanMask(mask));

/** `mail 2` or `mail 2 3` -> [2, 3]. A plain `mail`, `mail -h` or anything else reads nothing -> []. */
export function parseMailRead(line) {
  const match = /^mail((?:\s+\d{1,3})+)\s*$/.exec(String(line ?? '').trim());
  return match ? match[1].trim().split(/\s+/).map(Number) : [];
}

/** The login banner line, or null when everything is read. */
export function mailNotice(unread) {
  if (!unread) return null;
  return `You have ${unread} unread message${unread === 1 ? '' : 's'}. Type mail to read ${unread === 1 ? 'it' : 'them'}.`;
}

/** The line printed after a correct code: new mail arrived. */
export const newMailNotice = () => 'You have new mail. Type mail to read it.';

export const mailChipLabel = (unread) => (unread > 0 ? `mail, ${unread} unread message${unread === 1 ? '' : 's'}` : 'mail, no unread messages');

// ---- storage (per user and mode, in this browser only; signed out means no key and no persistence) ----

export const mailKey = (email, mode) => scopedKey('arena.terminal.mail.', email, `:${mode}`);
export const countKey = (email, mode) => scopedKey('arena.terminal.commands.', email, `:${mode}`);

function readInt(storage, key) {
  if (!key) return 0;
  try {
    const value = Number.parseInt(storage?.getItem(key) ?? '', 10);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}

function writeInt(storage, key, value) {
  if (!key) return;
  try { storage?.setItem(key, String(value)); } catch { /* private mode or full storage: the badge is cosmetic */ }
}

export const loadMailSeen = (storage, email, mode) => cleanMask(readInt(storage, mailKey(email, mode)));
export const saveMailSeen = (storage, email, mode, mask) => writeInt(storage, mailKey(email, mode), cleanMask(mask));

export const loadCommandCount = (storage, email, mode) => Math.min(readInt(storage, countKey(email, mode)), 99999);
export const saveCommandCount = (storage, email, mode, count) => writeInt(storage, countKey(email, mode), Math.min(Math.max(0, count), 99999));

/**
 * The cosmetic line on the solve screen. `count` is the number of commands sent to the server since the previous solve.
 * Returns null when there is nothing to show (no commands counted).
 */
export function parBadge(mode, count) {
  if (!Number.isInteger(count) || count < 1) return null;
  const noun = count === 1 ? 'command' : 'commands';
  const par = PAR[mode];
  if (par !== undefined && count <= par) return { minimalist: true, text: `Minimalist: captured in ${count} ${noun}` };
  return { minimalist: false, text: `Captured in ${count} ${noun}` };
}
