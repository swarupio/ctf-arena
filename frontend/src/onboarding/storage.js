// First-run state in localStorage, one key per signed-in user. It only decides whether to show or hide a
// card: the server never reads it and nothing here grants anything.

export const STORAGE_PREFIX = 'ctf.onboarding.v1:';

/** Storage key for a user, or '' when there is no usable identity (signed out). */
export function storageKey(email) {
  const id = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return id ? `${STORAGE_PREFIX}${id}` : '';
}

const defaultStorage = () => {
  try { return globalThis.localStorage; } catch { return undefined; }
};

/** Read the saved state. Corrupt JSON, wrong types or blocked storage all give the empty state. */
export function readState(email, storage = defaultStorage()) {
  const key = storageKey(email);
  if (!key || !storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(key));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return { welcomeDismissed: parsed.welcomeDismissed === true };
  } catch {
    return {};
  }
}

export const isWelcomeDismissed = (email, storage) => readState(email, storage).welcomeDismissed === true;

/** Remember the dismissal. Returns false when it could not be stored (private mode, quota, signed out). */
export function dismissWelcome(email, storage = defaultStorage()) {
  const key = storageKey(email);
  if (!key || !storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ ...readState(email, storage), welcomeDismissed: true }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Should the "New here?" welcome card show?
 *   user          { email, role } or null
 *   steps         the checklist (see firstLevels.js)
 *   dismissed     boolean from isWelcomeDismissed
 * Never for signed-out users or admins (no team, cannot capture), never once dismissed or once any flag is
 * captured, and never while data is loading or a category failed (we cannot tell that the player is new).
 */
export function showWelcome({ user, steps, dismissed }) {
  if (!user || !storageKey(user.email)) return false;
  if (user.role === 'admin' || dismissed) return false;
  const all = Array.isArray(steps) ? steps : [];
  if (all.length === 0 || all.some((step) => step.status === 'loading' || step.failed)) return false;
  if (all.some((step) => step.status === 'captured')) return false;
  return all.some((step) => step.status === 'open');
}

/** The checklist on The Range shows for players only (admins get a preview note instead). */
export const showChecklist = (user) => Boolean(user) && user.role !== 'admin';
