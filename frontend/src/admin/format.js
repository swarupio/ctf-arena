// Display formatters shared by the admin sections. Everything returns plain text (React escapes it).
export { formatNumber, formatPercent } from '../pages/adminHelpers.js';
export { timeAgo } from '../pages/integrityHelpers.js';

const timeOf = (iso) => {
  if (iso === null || iso === undefined || iso === '') return null;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
};

// "2026-11-22 10:00 UTC", or a dash for a missing date.
export function formatDate(iso) {
  const time = timeOf(iso);
  return time === null ? '–' : `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// "2026-11-22 10:00" (UTC, no suffix) for narrow table cells whose header already says UTC.
export const formatDateCompact = (iso) => formatDate(iso).replace(/ UTC$/, '');

// '2026-11-22' -> 'Nov 22' (UTC, so every admin sees the same day).
export function formatDay(day) {
  const time = timeOf(`${day}T00:00:00Z`);
  if (time === null) return String(day ?? '');
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Signed points: 110 -> "+110", -20 -> "-20" (a real minus sign), 0 -> "0".
export function formatSigned(points) {
  const value = Math.trunc(Number(points));
  if (!Number.isFinite(value) || value === 0) return '0';
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

export const orDeleted = (value) => (value ? value : '(deleted)');
export const orDash = (value) => (value === null || value === undefined || value === '' ? '–' : String(value));

export function truncate(text, max = 80) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

// One-line text for an audit before/after value (primitives and short strings per the API contract).
export function summarizeValue(value) {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'object') {
    try { return truncate(JSON.stringify(value), 120); } catch { return '[object]'; }
  }
  return truncate(String(value), 120);
}

// Rows for the before/after view of an audit entry: one per key of either side, flagged when the value changed.
export function diffRows(before, after) {
  const left = before && typeof before === 'object' ? before : {};
  const right = after && typeof after === 'object' ? after : {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.map((key) => ({
    key,
    before: summarizeValue(left[key]),
    after: summarizeValue(right[key]),
    changed: JSON.stringify(left[key]) !== JSON.stringify(right[key]),
  }));
}

// Only http(s) links from the API are clickable; anything else (javascript:, data:) is shown as text.
export function safeHref(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch { return ''; }
}

export const challengeName = (challenge) => orDeleted(challenge?.title ?? challenge?.slug);
