// Regex search for the log viewer, with limits so a pattern typed by a player cannot freeze the tab.
// The log lines are short (under 300 characters) and the pattern is length-limited and screened for the
// classic catastrophic-backtracking shapes (nested quantifiers, quantified alternations, back-references).
export const MAX_PATTERN_LENGTH = 80;
const MAX_GROUPS = 6;
const MAX_BOUNDED = 100;

// A group that contains a quantifier and is itself quantified, e.g. (a+)+  (.*)*  (a|aa)+  ([a-z]+){2,}
const NESTED = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,?\d*\})(?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,?\d*\})/;
const ALTERNATION = /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)\s*[+*]/;
const BACKREF = /\\[1-9]|\\k</;

export function checkPattern(pattern) {
  if (typeof pattern !== 'string' || pattern === '') { return { ok: false, error: 'Type a pattern.' }; }
  if (pattern.length > MAX_PATTERN_LENGTH) { return { ok: false, error: `Pattern too long (max ${MAX_PATTERN_LENGTH} characters).` }; }
  if (BACKREF.test(pattern)) { return { ok: false, error: 'Back-references are not allowed.' }; }
  if (NESTED.test(pattern) || ALTERNATION.test(pattern)) {
    return { ok: false, error: 'That pattern could take too long (nested repetition). Simplify it.' };
  }
  if ((pattern.match(/\(/g) ?? []).length > MAX_GROUPS) { return { ok: false, error: `Too many groups (max ${MAX_GROUPS}).` }; }
  for (const bound of pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
    if (Number(bound[1]) > MAX_BOUNDED || Number(bound[2] || 0) > MAX_BOUNDED) { return { ok: false, error: `Repeat counts are limited to ${MAX_BOUNDED}.` }; }
  }
  if (/\(\?<?[=!]/.test(pattern)) { return { ok: false, error: 'Lookaround is not allowed.' }; }
  return { ok: true };
}

// Returns { ok: true, regex } or { ok: false, error }. Never the global/sticky flag, so test() is stateless.
export function compileSafeRegex(pattern, { caseSensitive = false } = {}) {
  const checked = checkPattern(pattern);
  if (!checked.ok) { return checked; }
  try {
    return { ok: true, regex: new RegExp(pattern, caseSensitive ? '' : 'i') };
  } catch {
    return { ok: false, error: 'That is not a valid regular expression.' };
  }
}
