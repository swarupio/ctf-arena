// Tiny helpers shared by the labs. Pure functions: no I/O, no regular expressions with nested quantifiers.
import { LIMITS, clip } from './limits.js';

export const dict = () => Object.create(null);

export function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function parseParams(text) {
  const out = dict();
  let count = 0;
  for (const pair of clip(text, LIMITS.BODY).split('&')) {
    if (!pair) { continue; }
    count += 1;
    if (count > LIMITS.QUERY_PARAMS) { break; }
    const eq = pair.indexOf('=');
    const key = safeDecode((eq === -1 ? pair : pair.slice(0, eq)).replaceAll('+', ' '));
    const value = safeDecode((eq === -1 ? '' : pair.slice(eq + 1)).replaceAll('+', ' '));
    if (key !== '__proto__') { out[clip(key, LIMITS.FIELD)] = clip(value, LIMITS.BODY); }
  }
  return out;
}

// Splits "/path?a=1&b=2" by hand. Query values are percent-decoded; '+' is a space.
export function parseTarget(target) {
  const text = clip(target, LIMITS.PATH);
  const cut = text.indexOf('?');
  const pathname = cut === -1 ? text : text.slice(0, cut);
  const query = cut === -1 ? dict() : parseParams(text.slice(cut + 1));
  return { pathname, query };
}

// JSON object or urlencoded form -> flat string map (non-string values are ignored).
export function bodyParams(body) {
  const text = String(body ?? '').trim();
  const out = dict();
  if (!text) { return out; }
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && key !== '__proto__') { out[key] = value; }
      }
    } catch { /* not JSON: treated as empty */ }
    return out;
  }
  return parseParams(text);
}

export function parseJsonObject(text) {
  if (typeof text !== 'string' || text.length > LIMITS.BODY) { return null; }
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

export function bearer(req) {
  const value = req.headers.authorization ?? '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export const escapeHtml = (text) => String(text)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// Fake HTML source for the inspector's "Raw" tab. Everything is escaped, and the UI shows it as plain text.
function renderBlock(block) {
  switch (block.t) {
    case 'heading': return `<h1>${escapeHtml(block.text)}</h1>`;
    case 'notice': return `<div class="notice ${escapeHtml(block.tone ?? 'info')}">${escapeHtml(block.text)}</div>`;
    case 'code': return `<pre>${escapeHtml(block.text)}</pre>`;
    case 'table': return `<table>${(block.rows ?? []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</table>`;
    case 'kv': return `<dl>${(block.items ?? []).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;
    default: return `<p>${escapeHtml(block.text ?? '')}</p>`;
  }
}

// Page blocks: { t: 'heading'|'text'|'notice'|'code'|'table'|'kv', ... }. The UI renders them as React text nodes.
export function page(status, title, blocks, extra = {}) {
  const body = `<html><head><title>${escapeHtml(title)}</title></head><body>${blocks.map(renderBlock).join('')}</body></html>`;
  return { status, contentType: 'text/html', body, page: { title, blocks }, ...extra };
}

export const json = (status, value, extra = {}) => ({
  status, contentType: 'application/json', body: JSON.stringify(value, null, 2), ...extra,
});

export const notFound = () => page(404, 'Not found', [
  { t: 'heading', text: '404' }, { t: 'text', text: 'Nothing lives at this address.' },
]);

export const strField = (value, max = LIMITS.FIELD) => (typeof value === 'string' ? value : '').slice(0, max);
