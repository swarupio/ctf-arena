// A stable string for a settings slice: object keys sorted, so a reload that returns the same values in another
// order (or as a new object) gives the same key. Forms reset their draft only when their own key changes.
export function stableKey(value) {
  const walk = (item) => {
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, walk(item[key])]));
    }
    return item === undefined ? null : item;
  };
  return JSON.stringify(walk(value));
}

// True when the saved slice really changed, so the unsaved draft has to be replaced by it.
export const sliceChanged = (previous, next) => stableKey(previous) !== stableKey(next);
