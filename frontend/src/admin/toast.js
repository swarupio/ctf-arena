// Pure helpers behind the toast stack.
export const MAX_TOASTS = 5;
export const TOAST_MS = { success: 5000, info: 5000, error: 9000 };
export const toastDuration = (kind) => TOAST_MS[kind] ?? TOAST_MS.info;

// Appends a toast and keeps only the newest `max`. Identical consecutive messages are merged (count goes up),
// so a failing poll cannot flood the screen.
export function pushToast(list, toast, max = MAX_TOASTS) {
  const last = list[list.length - 1];
  if (last && last.kind === toast.kind && last.message === toast.message) {
    return [...list.slice(0, -1), { ...last, id: toast.id, count: (last.count ?? 1) + 1 }];
  }
  return [...list, { ...toast, count: 1 }].slice(-max);
}

export const dropToast = (list, id) => list.filter((toast) => toast.id !== id);
