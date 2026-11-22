import { scopedKey } from '../storage/userScope.js';

// "Capture your first flag" is one line once every first flag is captured and a long list before. The overview data that
// decides it arrives after the first paint, so the last known state is remembered per user and the card is drawn in that
// shape from the start. Cosmetic only: a wrong hint costs one shift, the server never reads it.
export const CHECKLIST_HINT_PREFIX = 'ctf.range.checklist.v1:';

const defaultStorage = () => {
  try { return globalThis.localStorage; } catch { return undefined; }
};

/** 'open' (the step list was showing), 'cleared' (one line) or '' (unknown, signed out, corrupt or blocked storage). */
export function readChecklistHint(email, storage = defaultStorage()) {
  const key = scopedKey(CHECKLIST_HINT_PREFIX, email);
  if (!key || !storage) return '';
  try {
    const value = storage.getItem(key);
    return value === 'open' || value === 'cleared' ? value : '';
  } catch {
    return '';
  }
}

/** Remember the state. Returns false when it could not be stored (signed out, blocked storage, quota, odd state). */
export function writeChecklistHint(email, state, storage = defaultStorage()) {
  const key = scopedKey(CHECKLIST_HINT_PREFIX, email);
  if (!key || !storage || (state !== 'open' && state !== 'cleared')) return false;
  try {
    if (storage.getItem(key) !== state) storage.setItem(key, state);
    return true;
  } catch {
    return false;
  }
}
