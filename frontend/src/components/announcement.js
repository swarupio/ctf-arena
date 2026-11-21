// Logic of the public announcement banner. Kept tiny and free of admin code: it ships in the main layout.
export const ANNOUNCEMENT_POLL_MS = 60_000;
export const DISMISS_KEY = 'ctf.announcement.dismissed';
const LEVELS = ['info', 'warning', 'critical'];

export const bannerLevel = (level) => (LEVELS.includes(level) ? level : 'info');

// Critical messages interrupt screen readers; everything else is announced politely.
export const bannerRole = (level) => (bannerLevel(level) === 'critical' ? 'alert' : 'status');

// What identifies a message for dismissal: a changed text or level shows the banner again.
export const bannerSignature = (announcement) => `${bannerLevel(announcement?.level)}:${String(announcement?.text ?? '').trim()}`;

export function isDismissed(announcement, storage = globalThis.sessionStorage) {
  try { return storage?.getItem(DISMISS_KEY) === bannerSignature(announcement); } catch { return false; }
}

export function dismiss(announcement, storage = globalThis.sessionStorage) {
  try { storage?.setItem(DISMISS_KEY, bannerSignature(announcement)); } catch { /* storage blocked: dismiss lasts until reload */ }
}

// API payload -> { text, level } to show, or null when there is nothing (empty text, missing or odd payload).
export function visibleAnnouncement(payload) {
  const text = typeof payload?.announcement?.text === 'string' ? payload.announcement.text.trim() : '';
  return text ? { text, level: bannerLevel(payload.announcement.level) } : null;
}
