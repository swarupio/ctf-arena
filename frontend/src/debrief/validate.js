// Pure checks for debrief entries (schema in docs/DEBRIEF.md). No React, no network: tests run them on every entry.

export const LIMITS = Object.freeze({
  what: [20, 220],
  how: [60, 600],
  defend: [40, 400],
  next: [0, 160],
  toolsMax: 5,
  toolMax: 40,
});
export const FIELDS = Object.freeze(['what', 'how', 'defend', 'tools', 'next']);

/** Schema problems of one entry as readable strings; an empty array means valid. */
export function validateEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { return ['entry must be an object']; }
  const problems = [];
  for (const key of Object.keys(entry)) {
    if (!FIELDS.includes(key)) { problems.push(`unknown field "${key}"`); }
  }
  for (const field of ['what', 'how', 'defend', 'next']) {
    const value = entry[field];
    const [min, max] = LIMITS[field];
    if (typeof value !== 'string') { problems.push(`${field} must be a string`); continue; }
    if (value.length < min || value.length > max) { problems.push(`${field} must be ${min}-${max} characters (is ${value.length})`); }
    if (value !== value.trim()) { problems.push(`${field} has leading or trailing whitespace`); }
  }
  if (!Array.isArray(entry.tools)) {
    problems.push('tools must be an array');
  } else {
    if (entry.tools.length > LIMITS.toolsMax) { problems.push(`tools has more than ${LIMITS.toolsMax} items`); }
    entry.tools.forEach((tool, index) => {
      if (typeof tool !== 'string' || tool.trim() === '') { problems.push(`tools[${index}] must be a non-empty string`); }
      else if (tool.length > LIMITS.toolMax) { problems.push(`tools[${index}] is longer than ${LIMITS.toolMax} characters`); }
    });
  }
  return problems;
}

// A run of token characters that looks like a secret: 24+ chars with a digit, or one long unbroken word.
// Words joined by - _ / + = made of letters only (for example Strict-Transport-Security) are ordinary prose.
const TOKEN_RUN = /[A-Za-z0-9+/=_-]{24,}/g;
const PROSE_RUN = /^[A-Za-z]+(?:[-_/+=][A-Za-z]+)+$/;
const looksLikeToken = (run) => /\d/.test(run) || !PROSE_RUN.test(run);

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const URL_RUN = /(?:https?:\/\/|www\.)[^\s)]+/gi;
const TEAM_URL = /team|squad|player|[?&](?:user|uid|token|key|flag)=/i;
const FORBIDDEN_WORD = /\bgames?\b|\bgaming\b/i;

/** Content-safety problems of one entry: flags, secret-looking tokens, emails, team-specific URLs, banned wording. */
export function entryLeaks(entry) {
  if (!entry || typeof entry !== 'object') { return []; }
  const texts = [];
  for (const field of ['what', 'how', 'defend', 'next']) { if (typeof entry[field] === 'string') { texts.push([field, entry[field]]); } }
  if (Array.isArray(entry.tools)) { entry.tools.forEach((tool, index) => { if (typeof tool === 'string') { texts.push([`tools[${index}]`, tool]); } }); }
  const problems = [];
  for (const [where, text] of texts) {
    if (/CTF\{/i.test(text)) { problems.push(`${where}: contains a flag pattern (CTF{)`); }
    for (const run of text.match(TOKEN_RUN) ?? []) {
      if (looksLikeToken(run)) { problems.push(`${where}: long hex/base64-looking token "${run.slice(0, 12)}..."`); }
    }
    if (EMAIL.test(text)) { problems.push(`${where}: contains an email address`); }
    for (const url of text.match(URL_RUN) ?? []) {
      if (TEAM_URL.test(url)) { problems.push(`${where}: URL looks team-specific (${url.slice(0, 40)})`); }
    }
    if (FORBIDDEN_WORD.test(text)) { problems.push(`${where}: uses a word banned by docs/VOCABULARY.md`); }
  }
  return problems;
}
