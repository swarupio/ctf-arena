// Command line helpers: prompt formatting, normalisation and the commands the browser handles itself.

export const MAX_COMMAND_LENGTH = 300;
export const MAX_FLAG_LENGTH = 200;
export const DEFAULT_HOME = '/home/guest';

/** "/home/guest/docs" -> "~/docs", the home directory -> "~", anything else unchanged (no trailing slash). */
export function shortenCwd(cwd, home = DEFAULT_HOME) {
  const clean = (path) => {
    const text = String(path ?? '').trim().replace(/\/{2,}/g, '/');
    return text.length > 1 ? text.replace(/\/+$/, '') : text;
  };
  const homePath = clean(home) || DEFAULT_HOME;
  const path = clean(cwd) || homePath;
  if (path === homePath) return '~';
  if (homePath !== '/' && path.startsWith(`${homePath}/`)) return `~${path.slice(homePath.length)}`;
  return path;
}

/** guest@arena:~/docs$ */
export function formatPrompt({ user = 'guest', host = 'arena', cwd, home = DEFAULT_HOME } = {}) {
  return `${user}@${host}:${shortenCwd(cwd, home)}$`;
}

/** Control characters become spaces, ends are trimmed, and the line is capped at the server limit. */
export function normalizeCommand(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_COMMAND_LENGTH);
}

/**
 * Parse `submit <flag>`. Returns null when the line is not a submit command, otherwise
 * { ok: true, flag } or { ok: false, error: 'usage' | 'spaces' | 'too-long' }.
 */
export function parseSubmit(line) {
  const match = /^submit(?:\s+([\s\S]*))?$/.exec(String(line ?? '').trim());
  if (!match) return null;
  let argument = (match[1] ?? '').trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(argument);
  if (quoted) argument = quoted[2].trim();
  if (!argument) return { ok: false, error: 'usage' };
  if (/\s/.test(argument)) return { ok: false, error: 'spaces' };
  if (argument.length > MAX_FLAG_LENGTH) return { ok: false, error: 'too-long' };
  return { ok: true, flag: argument };
}

const SUBMIT_ERRORS = {
  usage: 'usage: submit <code>   (for example: submit CTF{some_code})',
  spaces: 'a code has no spaces. Copy the whole CTF{...} string and try again.',
  'too-long': 'that is far too long to be a code.',
};
export const submitErrorMessage = (error) => SUBMIT_ERRORS[error] ?? SUBMIT_ERRORS.usage;

/**
 * Decide who handles a line. kinds: empty | submit | clear | history | exit | exec.
 * Only the exact forms are local ("clear && ls" goes to the server like any other pipeline).
 */
export function classifyCommand(raw) {
  const line = normalizeCommand(raw);
  if (!line) return { kind: 'empty', line };
  const submit = parseSubmit(line);
  if (submit) return { kind: 'submit', line, ...submit };
  const [name, ...args] = line.split(/\s+/);
  if (name === 'clear' && args.length === 0) return { kind: 'clear', line };
  if (name === 'history' && (args.length === 0 || (args.length === 1 && args[0] === '-c'))) {
    return { kind: 'history', line, wipe: args[0] === '-c' };
  }
  if (name === 'exit' && args.length === 0) return { kind: 'exit', line };
  return { kind: 'exec', line };
}
