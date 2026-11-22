// "Remember the last state" for the two site-wide bars (announcement, event). The bars arrive after a fetch and would push
// the page down; the layout reserves the space they had on the last visit from the first paint instead.
// Public data, so one key for everybody (not per user). Cosmetic only: a wrong or missing hint costs one shift at worst.
export const BANNER_HINT_KEY = 'ctf.banner-hint.v1';
export const BANNER_HINT_TTL_MS = 24 * 60 * 60 * 1000;
export const BANNER_HINT_MAX_PX = 240;
export const BANNER_KINDS = ['announcement', 'event'];

const defaultStorage = () => {
  try { return globalThis.localStorage; } catch { return undefined; }
};

// Layout width class: the same text wraps to a different height on another class, so a hint only counts on the same one.
export const widthClass = (width) => (width <= 600 ? 'narrow' : width <= 900 ? 'medium' : 'wide');

const cleanEntry = (entry, now, width) => {
  if (!entry || typeof entry !== 'object') return 0;
  const { px, at, w } = entry;
  if (!Number.isFinite(px) || !Number.isFinite(at) || px <= 0) return 0;
  if (now - at > BANNER_HINT_TTL_MS || at > now + 60_000 || w !== widthClass(width)) return 0;
  return Math.min(Math.round(px), BANNER_HINT_MAX_PX);
};

/** Pixels to reserve for a bar: 0 when nothing was stored, the entry is stale, corrupt or from another width class, or storage is blocked. */
export function readBannerHint(kind, { storage = defaultStorage(), now = Date.now(), width = globalThis.innerWidth ?? 1024 } = {}) {
  if (!BANNER_KINDS.includes(kind) || !storage) return 0;
  try {
    const parsed = JSON.parse(storage.getItem(BANNER_HINT_KEY));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0;
    return cleanEntry(parsed[kind], now, width);
  } catch {
    return 0;
  }
}

/** Remember the height a bar has now (0 = no bar). Returns false when it could not be stored (blocked, quota, unknown kind). */
export function writeBannerHint(kind, px, { storage = defaultStorage(), now = Date.now(), width = globalThis.innerWidth ?? 1024 } = {}) {
  if (!BANNER_KINDS.includes(kind) || !storage) return false;
  try {
    let current = {};
    try {
      const parsed = JSON.parse(storage.getItem(BANNER_HINT_KEY));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
    } catch { /* corrupt value: start again */ }
    const next = { ...current };
    const height = Number.isFinite(px) ? Math.min(Math.round(px), BANNER_HINT_MAX_PX) : 0;
    if (height > 0) next[kind] = { px: height, at: now, w: widthClass(width) };
    else delete next[kind];
    if (Object.keys(next).length === 0) storage.removeItem(BANNER_HINT_KEY);
    else storage.setItem(BANNER_HINT_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
