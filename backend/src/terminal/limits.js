// Bounded-work guards for the terminal shell. See docs/TERMINAL_GAME.md section 6.
// Nothing here is time based: limits count units of work so every replica behaves identically.

export const LIMITS = Object.freeze({
  MAX_LINE: 300, // characters in one command line
  MAX_STAGES: 8, // commands in one pipeline
  MAX_SUBST_DEPTH: 3, // nested $( )
  MAX_XARGS_DEPTH: 2, // xargs inside xargs
  MAX_WORK: 250_000, // work units per command line
  MAX_OUTPUT: 16 * 1024, // characters returned to the client
  MAX_OUT_LINE: 2000, // characters on one output line
  MAX_PATTERN: 64, // characters in a regex pattern
  MAX_QUANTIFIERS: 12, // unbounded repeats in one pattern
  MAX_MATCH_SUBJECT: 4096, // longest subject a "risky" pattern is run against
  GLOB_CAP: 200, // matches of one glob
  BRACE_CAP: 100, // words from one {a,b} expansion
  MAX_STREAM: 4 * 1024 * 1024, // bytes between two stages of a pipeline
  LOOP_COST: 50, // work units charged per xargs batch / for iteration
});

export class ResourceLimitError extends Error {
  constructor(message = 'resource limit exceeded') {
    super(message);
    this.name = 'ResourceLimitError';
  }
}

// Counts file reads, lines, tree nodes and loop iterations. Throws once the budget is spent.
export class Budget {
  constructor(max = LIMITS.MAX_WORK) {
    this.max = max;
    this.used = 0;
  }

  tick(units = 1) {
    this.used += units;
    if (this.used > this.max) throw new ResourceLimitError();
  }

  // Line oriented filters are charged one unit per four lines.
  tickLines(count) {
    this.tick(Math.ceil(count / 4));
  }
}

export const TRUNCATED_NOTE = '... (output truncated)';
export const LINE_TRUNCATED_NOTE = '... (line truncated)';

const ANSI_TAIL = /\x1b(\[[0-9;]*)?$/;
const hasAnsi = (text) => text.includes('\x1b[');

function clipLine(line) {
  if (line.length <= LIMITS.MAX_OUT_LINE) return line;
  const clipped = line.slice(0, LIMITS.MAX_OUT_LINE).replace(ANSI_TAIL, '');
  return `${clipped}${hasAnsi(clipped) ? '\x1b[0m' : ''}${LINE_TRUNCATED_NOTE}`;
}

// Applies the single-line cap (2000 chars) and the total cap (16 KB). Never splits an escape sequence.
export function capOutput(text) {
  if (text.length <= LIMITS.MAX_OUT_LINE && text.length <= LIMITS.MAX_OUTPUT) return { text, truncated: false };
  let out = '';
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const line = clipLine(text.slice(pos, end));
    if (out.length + line.length + 1 > LIMITS.MAX_OUTPUT) {
      return { text: `${out}${TRUNCATED_NOTE}`, truncated: true };
    }
    out += nl === -1 ? line : `${line}\n`;
    if (nl === -1) break;
    pos = nl + 1;
  }
  return { text: out, truncated: false };
}

export { PatternError, compilePattern, globalRegExp, matchesLine } from './regex.js';
