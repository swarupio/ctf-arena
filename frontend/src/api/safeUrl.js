// Links that come from the API are only clickable when they are http(s) or relative. javascript:, data: and the like
// give '' so the caller can show plain text instead.
export function safeLink(url) {
  if (typeof url !== 'string' || url.trim() === '') return '';
  try {
    const parsed = new URL(url.trim(), 'http://relative.invalid');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url.trim() : '';
  } catch { return ''; }
}
