// Per-user browser storage keys. A key is only built from a usable identity (the lowercased email), so a second account
// in the same browser never reads or overwrites the first account's cosmetic data. Signed out means no key, no storage.

/** Lowercased, trimmed email, or '' when there is no usable identity. */
export const scopeId = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

/** `prefix + id + suffix`, or '' when signed out. */
export function scopedKey(prefix, email, suffix = '') {
  const id = scopeId(email);
  return id ? `${prefix}${id}${suffix}` : '';
}
