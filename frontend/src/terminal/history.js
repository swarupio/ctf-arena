// Command history: pure helpers plus tolerant localStorage persistence (one list per mode, newest last).

export const HISTORY_LIMIT = 200;
export const historyKey = (mode) => `arena-terminal:history:${mode}`;

// `submit <flag>` lines stay in memory (so a typo can be fixed with the up arrow) but are never written to storage.
export const isSubmitLine = (line) => /^\s*submit(\s|$)/.test(String(line));

/** Append a line. Blank lines and an exact repeat of the previous line are skipped; the list is capped. */
export function pushHistory(list, line, limit = HISTORY_LIMIT) {
  const text = typeof line === 'string' ? line.trim() : '';
  if (!text || list[list.length - 1] === text) return list;
  const next = [...list, text];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Navigation state for a list: index === list.length means "the fresh line being typed". */
export const freshNav = (list) => ({ index: list.length, draft: '' });

/**
 * Move through history. direction is 'up' (older) or 'down' (newer); `current` is what the input holds now.
 * Returns { nav, value }; value === null means nothing to change. Going down past the newest entry restores the draft.
 */
export function stepHistory(list, nav, direction, current = '') {
  const length = list.length;
  let index = Math.min(nav.index, length);
  let draft = nav.draft;
  if (direction === 'up') {
    if (length === 0 || index === 0) return { nav: { index, draft }, value: null };
    if (index === length) draft = current;
    index -= 1;
    return { nav: { index, draft }, value: list[index] };
  }
  if (index >= length) return { nav: { index: length, draft }, value: null };
  index += 1;
  return { nav: { index, draft }, value: index === length ? draft : list[index] };
}

const persistable = (list, limit) => list.filter((line) => !isSubmitLine(line)).slice(-limit);

export function loadHistory(storage, mode, limit = HISTORY_LIMIT) {
  try {
    const raw = storage?.getItem(historyKey(mode));
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return persistable(data.filter((line) => typeof line === 'string' && line.trim() !== ''), limit);
  } catch {
    return [];
  }
}

export function saveHistory(storage, mode, list, limit = HISTORY_LIMIT) {
  try {
    storage?.setItem(historyKey(mode), JSON.stringify(persistable(list, limit)));
  } catch { /* storage full or blocked: history just stays in memory */ }
}

/** Text printed by the `history` command: right-aligned numbers like bash. */
export function formatHistory(list) {
  if (list.length === 0) return 'history is empty';
  const width = String(list.length).length + 1;
  return list.map((line, index) => `${String(index + 1).padStart(width)}  ${line}`).join('\n');
}
