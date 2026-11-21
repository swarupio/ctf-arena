// Pure helpers that build the query strings of the Admin API v2 lists (docs/API_SPEC.md "Conventions").
export const ID_PATTERN = /^[a-f\d]{24}$/i;
export const isObjectId = (value) => typeof value === 'string' && ID_PATTERN.test(value);
export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

const blank = (value) => value === undefined || value === null || value === '' || Number.isNaN(value);

// Drops blank values, writes booleans as the text `true` / `false` and encodes everything. Returns '' or '?a=b'.
export function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!blank(value)) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// `-createdAt` -> { field: 'createdAt', desc: true }. Empty input means "server default".
export function parseSort(sort) {
  if (!sort) return { field: '', desc: false };
  return sort.startsWith('-') ? { field: sort.slice(1), desc: true } : { field: sort, desc: false };
}

export const formatSort = ({ field, desc }) => (field ? `${desc ? '-' : ''}${field}` : '');

// Clicking a header: a new column sorts ascending, the same column flips the direction.
export function nextSort(current, field) {
  const parsed = parseSort(current);
  return parsed.field === field ? formatSort({ field, desc: !parsed.desc }) : field;
}

export function ariaSort(current, field) {
  const parsed = parseSort(current);
  if (parsed.field !== field) return 'none';
  return parsed.desc ? 'descending' : 'ascending';
}

// List state { page, limit, q, sort, filters } -> query string. `filters` are passed through as they are, so a
// caller must only put parameters the endpoint knows (the API rejects unknown ones with 400).
export function listQueryString({ page = 1, limit = DEFAULT_PAGE_SIZE, q = '', sort = '', filters = {} } = {}) {
  return buildQuery({ page, limit, q: String(q).trim(), sort, ...filters });
}

// <input type="date"> value (YYYY-MM-DD) to an ISO instant. `end` gives the last millisecond of that UTC day.
export function dateToIso(value, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return '';
  const time = Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(time) ? '' : new Date(time).toISOString();
}

// Filter form values (date fields `from` / `to` as plain days) to API filters.
export function dateRangeFilters({ from, to }) {
  return { from: dateToIso(from), to: dateToIso(to, true) };
}

// '/admin/users/<id>' from parts, every part encoded.
export const path = (...parts) => `/${parts.map((part) => encodeURIComponent(part)).join('/')}`;
