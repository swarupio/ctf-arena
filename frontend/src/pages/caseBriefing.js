import { useState } from 'react';

// "Start here" copy and the first-visit state of the case briefing (OSINT and Forensics case pages).
// Like the onboarding state it lives in localStorage, one key per signed-in user; it only decides whether a
// panel starts open, the server never reads it and nothing here grants anything.

export const BRIEFING_PREFIX = 'ctf.briefingSeen.v1:';

export const START_HERE = Object.freeze({
  osint: 'Start here: read the case briefing, then pick Question 1 and use the tabs on the desk to find its answer.',
  forensics: 'Start here: read the case file cover page, open the first piece of evidence, then answer Question 1.',
});

const defaultStorage = () => {
  try { return globalThis.localStorage; } catch { return undefined; }
};

/** Storage key for a user and a category ('osint' | 'forensics'), or '' when signed out. */
export function briefingKey(email, kind) {
  const id = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return id && kind ? `${BRIEFING_PREFIX}${id}:${kind}` : '';
}

export function isBriefingSeen(email, kind, storage = defaultStorage()) {
  const key = briefingKey(email, kind);
  if (!key || !storage) { return false; }
  try { return storage.getItem(key) === '1'; } catch { return false; }
}

/** Remember that the briefing was shown. Returns false when it could not be stored. */
export function markBriefingSeen(email, kind, storage = defaultStorage()) {
  const key = briefingKey(email, kind);
  if (!key || !storage) { return false; }
  try { storage.setItem(key, '1'); return true; } catch { return false; }
}

/** Open on the first visit, and always while nothing in the case is captured yet. */
export const briefingOpen = ({ solved = 0, seen = false } = {}) => solved === 0 || !seen;

/** Initial open state for the briefing; the first visit is recorded so later visits start collapsed. */
export function useBriefingOpen(email, kind, solved) {
  const [open] = useState(() => {
    const seen = isBriefingSeen(email, kind);
    if (!seen) { markBriefingSeen(email, kind); }
    return briefingOpen({ solved, seen });
  });
  return open;
}
