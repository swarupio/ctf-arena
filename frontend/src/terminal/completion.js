// Tab completion helpers (pure). The component asks these where the cursor is, merges client-side command names
// with the server's path matches and applies the result like bash: one match completes, several complete the common
// prefix, and a second Tab lists the options.

import { COMMANDS } from './data.js';

// Words after which the next word is itself a command name.
const COMMAND_PREFIXES = new Set(['sudo', 'man', 'xargs', 'which', 'type', 'help']);

/** Remove shell quoting from one raw word. `quote` is the quote still open at the end of the text ('' when none). */
export function unquoteWord(raw) {
  let text = '';
  let quote = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote === "'") {
      if (ch === "'") quote = ''; else text += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = '';
      else if (ch === '\\' && i + 1 < raw.length && '"\\$`'.includes(raw[i + 1])) { i += 1; text += raw[i]; }
      else text += ch;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '\\' && i + 1 < raw.length) { i += 1; text += raw[i]; }
    else text += ch;
  }
  return { text, quote };
}

/** Escape a completed word for the shell, respecting the quote it is typed inside. */
export function escapeWord(text, quote = '') {
  if (quote === "'") return text.replace(/'/g, "'\\''");
  if (quote === '"') return text.replace(/(["\\$`])/g, '\\$1');
  return text.replace(/([\s\\'"$`&|;<>()*?[\]{}!#])/g, '\\$1');
}

/**
 * Describe the word at the caret.
 * Returns { head, raw, word, quote, tail, commandPosition }: `head`/`tail` are the text before the word and after the
 * caret, `word` is the word without quoting, `commandPosition` says whether a command name is expected here.
 */
export function splitCompletion(value, caret) {
  const text = String(value ?? '');
  const end = Math.max(0, Math.min(caret ?? text.length, text.length));
  const before = text.slice(0, end);
  let words = [];
  let inWord = false;
  let wordStart = end;
  let quote = '';
  const startWord = (index) => { if (!inWord) { inWord = true; wordStart = index; } };
  const closeWord = (index) => { if (inWord) { words.push(before.slice(wordStart, index)); inWord = false; } };

  for (let i = 0; i < before.length; i += 1) {
    const ch = before[i];
    if (quote) {
      if (ch === quote) quote = '';
      else if (quote === '"' && ch === '\\') i += 1;
    } else if (ch === '\\') { startWord(i); i += 1; }
    else if (ch === "'" || ch === '"') { startWord(i); quote = ch; }
    else if (/\s/.test(ch)) closeWord(i);
    else if (ch === '|' || ch === ';' || ch === '&' || ch === '(') { closeWord(i); words = []; }
    else if (ch === '<' || ch === '>') { closeWord(i); words = ['>']; } // a redirect target is a path
    else startWord(i);
  }
  const raw = inWord ? before.slice(wordStart) : '';
  const { text: word, quote: openQuote } = unquoteWord(raw);
  const commandPosition = words.length === 0 || (words.length === 1 && COMMAND_PREFIXES.has(words[0]));
  return {
    head: text.slice(0, inWord ? wordStart : end), raw, word, quote: openQuote, tail: text.slice(end), commandPosition,
  };
}

export function commonPrefix(list) {
  if (list.length === 0) return '';
  let prefix = list[0];
  for (const item of list) {
    let i = 0;
    while (i < prefix.length && i < item.length && prefix[i] === item[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

/** Client-side command names starting with `prefix` (plus optional extras, for example from the server). */
export function completeCommands(prefix, extra = []) {
  return [...new Set([...COMMANDS, ...extra])].filter((name) => name.startsWith(prefix)).sort();
}

/** Servers may answer with full words ("docs/readme") or bare names ("readme"); turn both into full words. */
export function resolveMatch(word, match) {
  if (typeof match !== 'string' || match === '') return '';
  if (match.startsWith(word)) return match;
  const dir = word.slice(0, word.lastIndexOf('/') + 1);
  return dir && !match.startsWith('/') ? dir + match : match;
}

/** Union of client and server candidates for `word`: strings only, prefix-filtered, de-duplicated, sorted, capped. */
export function mergeCompletions(word, local = [], remote = [], limit = 100) {
  const seen = new Set();
  const out = [];
  const add = (match) => {
    if (typeof match !== 'string' || !match.startsWith(word) || seen.has(match)) return;
    seen.add(match);
    out.push(match);
  };
  (Array.isArray(local) ? local : []).forEach(add);
  (Array.isArray(remote) ? remote : []).map((match) => resolveMatch(word, match)).forEach(add);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, limit);
}

/** Name shown in the match list: the last path segment (directories keep their trailing slash). */
export function displayName(candidate) {
  if (candidate === '/') return '/';
  const trailing = candidate.endsWith('/') && candidate.length > 1 ? '/' : '';
  const trimmed = trailing ? candidate.slice(0, -1) : candidate;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) + trailing;
}

/**
 * Apply candidates to the line. Returns { value, caret, changed, list } where `list` (names to print) is only set
 * when the candidates are ambiguous, nothing more could be completed and `twice` says it is the second Tab.
 */
export function applyCompletion(ctx, candidates, { twice = false } = {}) {
  const { head, tail, word, quote } = ctx;
  const unchanged = { value: `${head}${ctx.raw}${tail}`, caret: head.length + ctx.raw.length, changed: false, list: null };
  if (candidates.length === 0) return unchanged;
  const finish = (inserted, skip = 0) => ({
    value: `${head}${inserted}${tail}`, caret: head.length + inserted.length + skip, changed: true, list: null,
  });
  if (candidates.length === 1) {
    const only = candidates[0];
    const isDirectory = only.endsWith('/');
    const spaceAfter = !isDirectory && tail.startsWith(' ');
    const closing = isDirectory ? '' : quote + (spaceAfter ? '' : ' ');
    return finish(quote + escapeWord(only, quote) + closing, spaceAfter ? 1 : 0);
  }
  const prefix = commonPrefix(candidates);
  if (prefix.length > word.length) return finish(quote + escapeWord(prefix, quote));
  return { ...unchanged, list: twice ? candidates.map(displayName) : null };
}
