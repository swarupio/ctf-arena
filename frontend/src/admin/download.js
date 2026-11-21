// Saving API responses as files, and reading the challenge import file. DOM objects are injected for tests.

export function safeFilename(name, fallback = 'download') {
  const cleaned = String(name ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 80);
  return cleaned || fallback;
}

function decodeSafe(text) {
  try { return decodeURIComponent(text); } catch { return text; }
}

// Filename from a Content-Disposition header, restricted to a safe character set (no path separators).
export function filenameFromDisposition(header, fallback) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header ?? '');
  return safeFilename(match ? decodeSafe(match[1]) : '', fallback);
}

// Starts a browser download of `blob` through a temporary object URL that is revoked right after the click.
export function saveBlob(blob, filename, { doc = globalThis.document, urls = globalThis.URL, later = setTimeout } = {}) {
  const url = urls.createObjectURL(blob);
  try {
    const link = doc.createElement('a');
    link.href = url;
    link.download = safeFilename(filename);
    link.rel = 'noopener';
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    later(() => urls.revokeObjectURL(url), 1000);
  }
}

export function jsonBlob(value, BlobType = globalThis.Blob) {
  return new BlobType([JSON.stringify(value, null, 2)], { type: 'application/json' });
}

// The four CSV exports and the list filters each one accepts (docs/API_SPEC.md "CSV exports").
export const CSV_EXPORTS = [
  { name: 'users', title: 'Users', description: 'Every user with role, ban state and team. Contains email addresses.' },
  { name: 'teams', title: 'Teams', description: 'Every team with members, score and solves.' },
  { name: 'submissions', title: 'Submissions', description: 'Flag attempts of the last 30 days (never the typed text).' },
  { name: 'leaderboard', title: 'Leaderboard', description: 'The public ranking, banned teams excluded.' },
];

export const CSV_MAX_ROWS = 10_000;
export const csvPath = (name) => `/admin/export/${name}.csv`;

// Import file text -> { challenges }, or an Error with a message fit for the UI. Accepts the export format
// ({ version, challenges: [...] }) or a bare array. The API allows up to 100 items per call.
export const IMPORT_MAX = 100;
export function parseImportFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  const challenges = Array.isArray(data) ? data : data?.challenges;
  if (!Array.isArray(challenges)) throw new Error('Expected a challenges.json export: { "challenges": [ ... ] }.');
  if (challenges.length === 0) throw new Error('The file contains no challenges.');
  if (challenges.length > IMPORT_MAX) throw new Error(`The file has ${challenges.length} challenges; the limit is ${IMPORT_MAX} per import.`);
  if (!challenges.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
    throw new Error('Every challenge must be an object.');
  }
  return { challenges };
}
