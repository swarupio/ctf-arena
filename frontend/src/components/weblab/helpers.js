// Pure helpers of the Web Exploit Lab UI (no React, no network): request drafts, encoders, diff, copy, wording.
import { eventMessage } from '../../event/messages.js';
export const LIMITS = Object.freeze({ path: 300, body: 2000, headers: 20, cookies: 10, name: 40, value: 500 });
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const HISTORY_MAX = 20;

const trimLine = (line) => line.trim();

// "Name: value" per line -> object. Bad lines are reported, not guessed at.
export function parseHeaderLines(text) {
  const headers = {};
  const errors = [];
  for (const line of String(text ?? '').split('\n').map(trimLine).filter(Boolean)) {
    const cut = line.indexOf(':');
    const name = cut > 0 ? line.slice(0, cut).trim() : '';
    if (!name || name === '__proto__') { errors.push(`Header line needs "Name: value": ${line.slice(0, 40)}`); continue; }
    headers[name.toLowerCase()] = line.slice(cut + 1).trim();
  }
  return { value: headers, errors };
}

export const formatHeaderLines = (headers) => Object.entries(headers ?? {}).map(([name, value]) => `${name}: ${value}`).join('\n');

// "name=value" per line (or "a=1; b=2" on one line) -> object. Values may contain '='.
export function parseCookieLines(text) {
  const cookies = {};
  const errors = [];
  const pieces = String(text ?? '').split(/[\n;]/).map(trimLine).filter(Boolean);
  for (const piece of pieces) {
    const cut = piece.indexOf('=');
    const name = cut > 0 ? piece.slice(0, cut).trim() : '';
    if (!name || name === '__proto__') { errors.push(`Cookie needs "name=value": ${piece.slice(0, 40)}`); continue; }
    cookies[name] = piece.slice(cut + 1).trim();
  }
  return { value: cookies, errors };
}

export const formatCookieLines = (cookies) => Object.entries(cookies ?? {}).map(([name, value]) => `${name}=${value}`).join('\n');

export function draftFromRequest(request) {
  return {
    method: request?.method ?? 'GET',
    path: request?.path ?? '/',
    headers: formatHeaderLines(request?.headers),
    cookies: formatCookieLines(request?.cookies),
    body: request?.body ?? '',
  };
}

// Validates a draft against the same limits the API enforces. Returns { ok, payload } or { ok: false, error }.
export function buildPayload(draft) {
  const method = String(draft.method ?? '').toUpperCase();
  if (!METHODS.includes(method)) { return { ok: false, error: 'Pick a method from the list.' }; }
  const path = String(draft.path ?? '').trim();
  if (!path.startsWith('/')) { return { ok: false, error: 'The path must start with "/".' }; }
  if (path.length > LIMITS.path) { return { ok: false, error: `The path is longer than ${LIMITS.path} characters.` }; }
  const body = String(draft.body ?? '');
  if (body.length > LIMITS.body) { return { ok: false, error: `The body is longer than ${LIMITS.body} characters.` }; }
  const headers = parseHeaderLines(draft.headers);
  const cookies = parseCookieLines(draft.cookies);
  const problem = headers.errors[0] ?? cookies.errors[0];
  if (problem) { return { ok: false, error: problem }; }
  if (Object.keys(headers.value).length > LIMITS.headers) { return { ok: false, error: `At most ${LIMITS.headers} headers.` }; }
  if (Object.keys(cookies.value).length > LIMITS.cookies) { return { ok: false, error: `At most ${LIMITS.cookies} cookies.` }; }
  const tooLong = [...Object.entries(headers.value), ...Object.entries(cookies.value)]
    .find(([name, value]) => name.length > LIMITS.name || value.length > LIMITS.value);
  if (tooLong) { return { ok: false, error: `"${tooLong[0].slice(0, 20)}" is too long.` }; }
  return { ok: true, payload: { method, path, headers: headers.value, cookies: cookies.value, body } };
}

// The target "browser" keeps its cookies: Set-Cookie answers update the cookie box of the next request.
export function applySetCookies(cookieText, setCookies) {
  if (!Array.isArray(setCookies) || setCookies.length === 0) { return cookieText; }
  const jar = parseCookieLines(cookieText).value;
  for (const cookie of setCookies) { if (cookie?.name) { jar[cookie.name] = String(cookie.value ?? ''); } }
  return formatCookieLines(jar);
}

export function formatRawRequest(payload, host = 'target.lab') {
  const lines = [`${payload.method} ${payload.path} HTTP/1.1`, `Host: ${host}`];
  for (const [name, value] of Object.entries(payload.headers)) { lines.push(`${name}: ${value}`); }
  const cookies = Object.entries(payload.cookies).map(([name, value]) => `${name}=${value}`).join('; ');
  if (cookies) { lines.push(`Cookie: ${cookies}`); }
  return payload.body ? `${lines.join('\n')}\n\n${payload.body}` : lines.join('\n');
}

const shellQuote = (text) => `'${String(text).replaceAll("'", "'\\''")}'`;

// A curl command for a (simulated) target: purely a copy helper, the UI never runs it.
export function toCurl(payload, host = 'https://target.lab') {
  const parts = ['curl', '-i', '-X', payload.method, shellQuote(`${host}${payload.path}`)];
  for (const [name, value] of Object.entries(payload.headers)) { parts.push('-H', shellQuote(`${name}: ${value}`)); }
  const cookies = Object.entries(payload.cookies).map(([name, value]) => `${name}=${value}`).join('; ');
  if (cookies) { parts.push('-b', shellQuote(cookies)); }
  if (payload.body) { parts.push('--data-raw', shellQuote(payload.body)); }
  return parts.join(' ');
}

// ---- encoders for the Decoder tool -------------------------------------------------------------------------------
export function base64Encode(text, { url = false } = {}) {
  const bytes = new TextEncoder().encode(String(text));
  let binary = '';
  for (const byte of bytes) { binary += String.fromCharCode(byte); }
  const out = btoa(binary);
  return url ? out.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') : out;
}

export function base64Decode(text) {
  try {
    const normal = String(text).trim().replaceAll('-', '+').replaceAll('_', '/');
    const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
    const binary = atob(padded);
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))) };
  } catch {
    return { ok: false, value: '' };
  }
}

export const urlEncode = (text) => encodeURIComponent(String(text));
export function urlDecode(text) {
  try { return { ok: true, value: decodeURIComponent(String(text)) }; } catch { return { ok: false, value: '' }; }
}

// ---- site form -> request ----------------------------------------------------------------------------------------
// Applies the values typed into the fake site's form to a request draft (the inspector then shows the result).
export function applyForm(form, values, draft) {
  if (!form) { return draft; }
  const { submit } = form;
  if (submit.encoding === 'json') {
    const object = {};
    for (const field of form.fields) { object[field.name] = String(values[field.name] ?? ''); }
    return { ...draft, method: submit.method, path: submit.path, body: JSON.stringify(object) };
  }
  const query = form.fields.map((field) => `${encodeURIComponent(field.name)}=${encodeURIComponent(String(values[field.name] ?? ''))}`).join('&');
  return { ...draft, method: submit.method, path: `${submit.path}?${query}`, body: '' };
}

export function formDefaults(form) {
  return Object.fromEntries((form?.fields ?? []).map((field) => [field.name, field.default ?? '']));
}

// ---- diff of two response bodies ---------------------------------------------------------------------------------
// Line diff by longest common subsequence, capped so a huge body cannot freeze the page.
export function diffLines(before, after, cap = 120) {
  const a = String(before ?? '').split('\n').slice(0, cap);
  const b = String(after ?? '').split('\n').slice(0, cap);
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i += 1; }
    else { out.push({ type: 'add', text: b[j] }); j += 1; }
  }
  while (i < a.length) { out.push({ type: 'del', text: a[i] }); i += 1; }
  while (j < b.length) { out.push({ type: 'add', text: b[j] }); j += 1; }
  return out;
}

// ---- history -----------------------------------------------------------------------------------------------------
export function pushHistory(history, entry, max = HISTORY_MAX) {
  return [entry, ...history].slice(0, max);
}

// ---- flags -------------------------------------------------------------------------------------------------------
export function findFlags(text) {
  return [...new Set(String(text ?? '').match(/CTF\{[A-Za-z0-9_]{1,80}\}/g) ?? [])];
}

// ---- wording -----------------------------------------------------------------------------------------------------
const SEVERITY = {
  critical: { label: 'CRITICAL', tone: 'critical', stars: 4 },
  high: { label: 'HIGH', tone: 'high', stars: 3 },
  medium: { label: 'MEDIUM', tone: 'medium', stars: 2 },
  low: { label: 'LOW', tone: 'low', stars: 1 },
};
export const severityMeta = (severity) => SEVERITY[severity] ?? null;

export const formatBounty = (amount) => (Number.isFinite(amount) ? `$${amount.toLocaleString('en-US')}` : '');

export function statusQuip(status, exploited) {
  if (exploited) { return 'EXPLOIT LANDED! Something you should not see just fell out of the response.'; }
  if (status >= 200 && status < 300) { return 'Request accepted. Nothing suspicious yet, keep poking.'; }
  if (status === 401) { return 'The server does not know who you are. Credentials, anyone?'; }
  if (status === 403) { return 'Forbidden. Which means there is something worth forbidding.'; }
  if (status === 404) { return 'Nothing here. Try another path.'; }
  if (status === 400) { return 'The server did not understand that. Check the syntax.'; }
  if (status >= 500) { return 'The server choked. Errors like this love to talk too much.'; }
  return 'Interesting. Read the response closely.';
}

export const percent = (done, total) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);

const text = (value, fallback) => (typeof value === 'string' && value ? value : fallback);

export function describeError(error) {
  const status = Number(error?.status);
  const code = text(error?.code, '');
  if (code === 'NO_TEAM') { return { kind: 'no-team', message: 'You need a team first: flags and bounties are scored per team.' }; }
  if (code === 'TEAM_BANNED') { return { kind: 'banned', message: 'Your team has been banned from the arena.' }; }
  if (eventMessage(error)) { return { kind: 'locked', message: eventMessage(error) }; }
  if (code === 'WEBLAB_NOT_SEEDED') { return { kind: 'not-seeded', message: 'The lab is not set up yet. Ask an admin to run npm run seed:weblab.' }; }
  if (code === 'LAB_LOCKED') { return { kind: 'locked', message: text(error?.message, 'This lab is locked.') }; }
  if (status === 401) { return { kind: 'auth', message: 'Your session expired. Please log in again.' }; }
  if (status === 429 || code === 'RATE_LIMITED') { return { kind: 'rate', message: 'Easy there, hacker. Too many requests, wait a minute.' }; }
  if (status === 404) { return { kind: 'not-found', message: 'That lab does not exist.' }; }
  if (status === 400) { return { kind: 'invalid', message: 'That request was rejected as invalid or too long.' }; }
  if (status === 403) { return { kind: 'forbidden', message: text(error?.message, 'That action is not allowed here.') }; }
  return { kind: 'network', message: 'Could not reach the arena. Check your connection and retry.' };
}

export const THEMES = ['retro-bank', 'pizza', 'hospital', 'vault'];
export const themeOf = (theme) => (THEMES.includes(theme) ? theme : 'retro-bank');

// Pretty URL shown in the fake browser bar.
export function displayUrl(site, path) {
  const host = String(site?.path ?? 'target.lab').split('/')[0];
  return `https://${host}${path ?? '/'}`;
}
