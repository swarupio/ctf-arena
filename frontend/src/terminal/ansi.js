// ANSI SGR parser for terminal output. It only ever produces styled text runs (plain strings), so the UI renders
// them as React text nodes and nothing here can inject HTML. Supported: reset (0), bold (1), dim (2), normal
// intensity (22), foreground 30-37 / 90-97 / 39. Every other escape sequence is consumed and ignored.

const COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const ESC = '\u001b';

// The flag shape players look for. Kept as a source string so every caller gets a fresh stateful RegExp.
export const FLAG_SOURCE = 'CTF\\{[^}\\s]{1,120}\\}';

export const plainStyle = () => ({ fg: null, bold: false, dim: false });

function applySgr(style, paramText) {
  // Only plain digits and semicolons are SGR parameters; anything else (for example 38:5:12) is left alone.
  if (!/^[0-9;]*$/.test(paramText)) return style;
  const next = { ...style };
  const params = paramText === '' ? [0] : paramText.split(';').map((p) => (p === '' ? 0 : Number(p)));
  for (let i = 0; i < params.length; i += 1) {
    const code = params[i];
    if (code === 0) { next.fg = null; next.bold = false; next.dim = false; }
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 22) { next.bold = false; next.dim = false; }
    else if (code >= 30 && code <= 37) next.fg = COLORS[code - 30];
    else if (code >= 90 && code <= 97) next.fg = `bright-${COLORS[code - 90]}`;
    else if (code === 39) next.fg = null;
    else if (code === 38 || code === 48) {
      // extended colour: skip its arguments so they are not mistaken for other codes (and do not apply the colour)
      if (params[i + 1] === 5) i += 2;
      else if (params[i + 1] === 2) i += 4;
    }
  }
  return next;
}

const sameStyle = (a, b) => a.fg === b.fg && a.bold === b.bold && a.dim === b.dim;

// Control characters other than newline and tab, C1 controls, DEL and bidirectional overrides are dropped.
const DROPPED = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/**
 * Parse text with ANSI escapes into runs: [{ text, fg, bold, dim }].
 * Malformed or truncated sequences never throw: they are removed and the text around them is kept.
 */
export function parseAnsi(input) {
  const text = typeof input === 'string' ? input : input == null ? '' : String(input);
  const runs = [];
  let style = plainStyle();
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, style)) last.text += buffer;
    else runs.push({ text: buffer, ...style });
    buffer = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ESC) {
      if (text[i + 1] === '[') {
        // CSI: parameter bytes 0x30-0x3F, intermediate bytes 0x20-0x2F, one final byte 0x40-0x7E.
        let j = i + 2;
        while (j < text.length && text.charCodeAt(j) >= 0x30 && text.charCodeAt(j) <= 0x3f) j += 1;
        const paramEnd = j;
        while (j < text.length && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x2f) j += 1;
        const final = j < text.length ? text.charCodeAt(j) : -1;
        if (final >= 0x40 && final <= 0x7e) {
          if (text[j] === 'm' && j === paramEnd) {
            flush();
            style = applySgr(style, text.slice(i + 2, paramEnd));
          }
          i = j + 1;
        } else {
          i = j; // truncated or broken: drop what was consumed, keep the byte that stopped us
        }
        continue;
      }
      i += 1; // a lone ESC (or an unsupported two-byte escape): drop the ESC itself
      continue;
    }
    if (DROPPED.test(ch)) { i += 1; continue; }
    buffer += ch;
    i += 1;
  }
  flush();
  return runs;
}

export const stripAnsi = (input) => parseAnsi(input).map((run) => run.text).join('');

/** Class names for a run, for example "ansi-red ansi-bold". Empty string for unstyled text. */
export function ansiClass(run) {
  const names = [];
  if (run.fg) names.push(`ansi-${run.fg}`);
  if (run.bold) names.push('ansi-bold');
  if (run.dim) names.push('ansi-dim');
  return names.join(' ');
}

/** Positions of flag-looking strings: [{ start, end, flag }]. */
export function findFlags(text) {
  const found = [];
  if (typeof text !== 'string' || !text.includes('CTF{')) return found;
  for (const match of text.matchAll(new RegExp(FLAG_SOURCE, 'g'))) {
    found.push({ start: match.index, end: match.index + match[0].length, flag: match[0] });
  }
  return found;
}

export const containsFlag = (text) => findFlags(text).length > 0;

/**
 * Parse output and mark flag-looking strings, even when ANSI colours split one across several runs.
 * Tokens: { type: 'text', text, fg, bold, dim } or { type: 'flag', flag, parts: [{ text, fg, bold, dim }] }.
 */
export function tokenizeOutput(input) {
  const runs = parseAnsi(input);
  const plain = runs.map((run) => run.text).join('');
  const ranges = findFlags(plain);
  if (ranges.length === 0) return runs.map((run) => ({ type: 'text', ...run }));

  const tokens = [];
  const flagTokens = new Map();
  let base = 0; // offset of the current run inside `plain`
  let rangeIndex = 0;
  for (const run of runs) {
    let offset = 0;
    while (offset < run.text.length) {
      const absolute = base + offset;
      while (rangeIndex < ranges.length && ranges[rangeIndex].end <= absolute) rangeIndex += 1;
      const range = ranges[rangeIndex];
      const style = { fg: run.fg, bold: run.bold, dim: run.dim };
      if (!range || absolute < range.start) {
        const stop = range ? Math.min(run.text.length, range.start - base) : run.text.length;
        tokens.push({ type: 'text', text: run.text.slice(offset, stop), ...style });
        offset = stop;
      } else {
        const stop = Math.min(run.text.length, range.end - base);
        let token = flagTokens.get(rangeIndex);
        if (!token) {
          token = { type: 'flag', flag: range.flag, parts: [] };
          flagTokens.set(rangeIndex, token);
          tokens.push(token);
        }
        token.parts.push({ text: run.text.slice(offset, stop), ...style });
        offset = stop;
      }
    }
    base += run.text.length;
  }
  return tokens;
}
