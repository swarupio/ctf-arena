// Scrollback cap for the terminal window: at most `maxEntries` entries AND at most `maxChars` characters of text in
// total, so a few huge outputs (the server allows 16 KB per command) cannot grow the DOM and the heap without bound.
// The newest entry is always kept, even when it alone is larger than the budget.

export const MAX_ENTRIES = 600;
export const MAX_CHARS = 300_000;

/** Characters an entry puts on the screen (approximate, only used for the budget). */
export function entrySize(entry) {
  if (!entry) return 0;
  let size = 20 + (typeof entry.text === 'string' ? entry.text.length : 0);
  if (typeof entry.headline === 'string') size += entry.headline.length;
  if (Array.isArray(entry.lines)) for (const line of entry.lines) size += typeof line === 'string' ? line.length : 0;
  if (Array.isArray(entry.items)) for (const item of entry.items) size += typeof item === 'string' ? item.length : 0;
  return size;
}

/** Returns `list` unchanged when it fits, otherwise the newest entries that fit. */
export function capEntries(list, { maxEntries = MAX_ENTRIES, maxChars = MAX_CHARS } = {}) {
  let start = Math.max(0, list.length - maxEntries);
  let total = 0;
  for (let i = list.length - 1; i >= start; i -= 1) {
    total += entrySize(list[i]);
    if (total > maxChars && i < list.length - 1) { start = i + 1; break; }
  }
  return start === 0 ? list : list.slice(start);
}
