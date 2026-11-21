import { compileSafeRegex } from './safeRegex.js';

export const MAX_LINE_LENGTH = 400;
export const MAX_RESULTS = 5000;

// Builds a line matcher from the viewer controls. Returns { ok, test(line), error }.
// mode 'text' = plain substring (several words must all appear), 'regex' = safe regular expression.
export function makeLineMatcher({ query = '', mode = 'text', caseSensitive = false, invert = false } = {}) {
  const wrap = (test) => ({ ok: true, test: invert ? (line) => !test(line) : test });
  if (query === '') { return { ok: true, test: () => true, empty: true }; }
  if (mode === 'regex') {
    const compiled = compileSafeRegex(query, { caseSensitive });
    if (!compiled.ok) { return compiled; }
    return wrap((line) => compiled.regex.test(line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line));
  }
  const words = (caseSensitive ? query : query.toLowerCase()).split(/\s+/).filter(Boolean);
  return wrap((line) => {
    const hay = caseSensitive ? line : line.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

// Filters `lines` ({ n, text }) and stops at `limit` results, so a broad query stays cheap.
export function filterLines(lines, matcher, limit = MAX_RESULTS) {
  const out = [];
  for (const line of lines) {
    if (matcher.test(line.text)) {
      out.push(line);
      if (out.length >= limit) { break; }
    }
  }
  return out;
}

// Builds the highlighter once per search (the viewer calls it for every visible row on every scroll step, so the
// regular expression must not be compiled and analysed per row). Returns text => [{ text, hit }], never more than 20 parts.
export function makeHighlighter({ query = '', mode = 'text', caseSensitive = false } = {}) {
  const plain = (text) => [{ text, hit: false }];
  if (query === '') { return plain; }
  let regex;
  if (mode === 'regex') {
    const compiled = compileSafeRegex(query, { caseSensitive });
    if (!compiled.ok) { return plain; }
    regex = new RegExp(compiled.regex.source, `${compiled.regex.flags}g`);
  } else {
    const first = query.split(/\s+/).filter(Boolean)[0];
    if (!first) { return plain; }
    regex = new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  }
  return (text) => splitParts(text, regex);
}

// Splits a line into [{ text, hit }] around matches, for highlighting. Never more than 20 parts.
export const highlightParts = (text, options) => makeHighlighter(options)(text);

function splitParts(text, regex) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(regex)) {
    if (match[0] === '') { break; }
    if (parts.length >= 19) { break; }
    if (match.index > last) { parts.push({ text: text.slice(last, match.index), hit: false }); }
    parts.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) { parts.push({ text: text.slice(last), hit: false }); }
  return parts.length > 0 ? parts : [{ text, hit: false }];
}

// Rows to render for a scroll position (fixed row height), with a little overscan on both sides.
export function windowRange({ scrollTop, viewport, rowHeight, total, overscan = 6 }) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { first, last };
}
