// Arena Terminal fun commands (cowsay, fortune, neofetch, ...). Contract: docs/TERMINAL_GAME.md section 13.
//
// Every handler is a pure text generator: no VFS, no host access, no randomness, no ctx.flag.
// Output is ASCII plus SGR colour codes only, capped at ~3 KB. User text (args / stdin) is
// sanitised first, so nothing a player types can smuggle control sequences into the output.
// Handlers return stdout WITHOUT a trailing newline, like the `matrix` example in the contract.

const MAX_OUT = 3000;
const MAX_IN = 2048;
const ESC = '\u001b';
const RESET = `${ESC}[0m`;
const raw = String.raw;

const sgr = (code, text) => `${ESC}[${code}m${text}${RESET}`;
const art = (block) => block.split('\n');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Strip colour codes and control characters; non-ASCII becomes '?'. Newlines survive.
function clean(value, limit = MAX_IN) {
  return String(value ?? '')
    .slice(0, limit * 4)
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[^\n -~]/g, (ch) => (ch.charCodeAt(0) > 127 ? '?' : ''))
    .slice(0, limit);
}

// Small stable string hash (FNV-1a) so the same words always pick the same line on every replica.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Truncate on a line boundary without ever cutting an SGR sequence in half.
function cap(text) {
  if (text.length <= MAX_OUT) return text;
  const note = '\n... (output truncated)';
  let cut = text.slice(0, MAX_OUT - note.length - RESET.length);
  const newline = cut.lastIndexOf('\n');
  if (newline > 0) cut = cut.slice(0, newline);
  cut = cut.replace(/\u001b\[[0-9;]*$/, '');
  return `${cut}${cut.includes(ESC) ? RESET : ''}${note}`;
}

function wrapText(text, width) {
  const lines = [];
  for (const rawLine of text.split('\n')) {
    let line = '';
    for (let word of rawLine.split(/ +/).filter(Boolean)) {
      while (word.length > width) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[0] === '') lines.shift();
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Text to work on: args win (like cowsay), or stdin first for filters (like lolcat).
function pickText(args, stdin, preferStdin = false) {
  const fromArgs = args.join(' ');
  if (preferStdin) return stdin || fromArgs;
  return fromArgs || stdin;
}

// Wraps a plain handler so it always gets sane inputs and always returns a capped result.
function command(name, fn) {
  return async (input) => {
    try {
      const source = input && typeof input === 'object' ? input : {};
      const args = (Array.isArray(source.args) ? source.args.slice(0, 64) : []).map((a) => clean(a));
      const stdin = typeof source.stdin === 'string' ? clean(source.stdin).replace(/\n+$/, '') : '';
      const ctx = source.ctx && typeof source.ctx === 'object' ? source.ctx : {};
      const result = fn({ args, stdin, ctx });
      const out = { stdout: cap(String(result.stdout ?? '')), exit: result.exit ?? 0 };
      if (result.effect !== undefined) out.effect = result.effect;
      return out;
    } catch {
      return { stdout: `${name}: something went wrong, the cow is confused`, exit: 1 };
    }
  };
}

// ---------------------------------------------------------------------------------------------
// cowsay / cowthink
// ---------------------------------------------------------------------------------------------

const COW_MODES = new Map([
  ['-b', ['==', '  ']],
  ['-d', ['xx', 'U ']],
  ['-g', ['$$', '  ']],
  ['-p', ['@@', '  ']],
  ['-s', ['**', 'U ']],
  ['-t', ['--', '  ']],
  ['-w', ['OO', '  ']],
  ['-y', ['..', '  ']],
]);

function balloon(lines, think) {
  const width = Math.max(1, ...lines.map((line) => line.length));
  const out = [` ${'_'.repeat(width + 2)}`];
  const last = lines.length - 1;
  lines.forEach((line, i) => {
    let left = '|';
    let right = '|';
    if (think) {
      left = '(';
      right = ')';
    } else if (lines.length === 1) {
      left = '<';
      right = '>';
    } else if (i === 0) {
      left = '/';
      right = '\\';
    } else if (i === last) {
      left = '\\';
      right = '/';
    }
    out.push(`${left} ${line.padEnd(width)} ${right}`);
  });
  out.push(` ${'-'.repeat(width + 2)}`);
  return out;
}

function cowBody(thought, eyes, tongue) {
  return [
    `        ${thought}   ^__^`,
    `         ${thought}  (${eyes})\\_______`,
    '            (__)\\       )\\/\\',
    `            ${tongue}  ||----w |`,
    '                ||     ||',
  ];
}

function cowsay({ args, stdin }, think) {
  let width = 40;
  let eyes = 'oo';
  let tongue = '  ';
  let i = 0;
  for (; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      i += 1;
      break;
    }
    if (arg === '-W') {
      const n = Number.parseInt(args[i + 1], 10);
      if (Number.isFinite(n)) width = clamp(n, 10, 60);
      i += 1;
    } else if (arg === '-n') {
      width = 60;
    } else if (arg === '-e') {
      eyes = `${(args[i + 1] || 'oo').slice(0, 2)}  `.slice(0, 2);
      i += 1;
    } else if (COW_MODES.has(arg)) {
      [eyes, tongue] = COW_MODES.get(arg);
    } else {
      break;
    }
  }
  const text = clean(pickText(args.slice(i), stdin)).slice(0, 1200).trim() || 'Moo! Try: cowsay hello';
  let lines = wrapText(text, width);
  if (lines.length > 20) lines = [...lines.slice(0, 19), '...'];
  const thought = think ? 'o' : '\\';
  return { stdout: [...balloon(lines, think), ...cowBody(thought, eyes, tongue)].join('\n') };
}

// ---------------------------------------------------------------------------------------------
// fortune and ghost: fixed pick with no words, stable hash of the words otherwise
// ---------------------------------------------------------------------------------------------

const FORTUNES = [
  'There is no cloud, it is just someone else\'s computer.',
  'It works on my machine. -- every intern, ever',
  'Have you tried turning it off and on again?',
  'To iterate is human, to recurse divine.',
  'This filesystem is read-only. rm -rf was fun while it lasted.',
  'Unix is user-friendly. It is just selective about who its friends are.',
  'Weeks of coding can save you hours of planning.',
  'The S in IoT stands for security.',
  'There are two hard things in computer science: cache invalidation, naming things, and off-by-one errors.',
  'A SQL query walks into a bar, sees two tables and asks: can I join you?',
  'Passwords are like underwear: do not share them, change them often.',
  'Real programmers count from zero.',
  'chmod 777 is not a personality.',
  'Trust, but verify. Then verify the verifier.',
  'Security through obscurity is not security. Security through obscurity plus a shell is a CTF.',
  'Never trust the client.',
  'Debugging is like being the detective in a crime movie where you are also the murderer.',
  'sudo: because "please" only works on humans.',
  'In case of fire: git commit, git push, leave the building.',
  'Your password must contain 12 characters, a symbol, a number and the will to live.',
  'There is no patch for human error.',
  'Premature optimization is the root of all evil. -- Donald Knuth',
  'Make it work, make it right, make it fast. -- Kent Beck',
  'Talk is cheap. Show me the code. -- Linus Torvalds',
  'A good hacker reads the manual. A great hacker reads the logs.',
  'grep is just a love letter to regular expressions.',
  'Keep calm and read the man page.',
  'Pipes: one command should do one thing well, ten commands should do something clever.',
  'The best way to predict the future is to implement it.',
  'In theory, theory and practice are the same. In practice, they are not.',
  '// TODO: fix later -- written in 2009, still in production.',
  'Hack the planet! (Responsibly. In a sandbox. With permission.)',
  'NovaCorp Compliance Notice: sticky notes belong on the monitor, never under the keyboard.',
  'NovaCorp Tip #12: if the server room is warm, that is a feature.',
  'NovaCorp HR: "ghost" is not a valid employee ID. Please stop emailing us.',
  'NovaCorp-OS: now with 40% fewer vulnerabilities (we stopped counting).',
  'NovaCorp Security Memo: the intern is mightier than the firewall. Mostly on Fridays.',
  'Entropy is not what it used to be.',
  'The quietest sysadmin in the building is the one who already read the logs.',
  'Coffee is a Unix command: it takes no arguments and everything depends on its exit status.',
];

function pickLine(list, args, stdin) {
  const seed = args.join(' ') || stdin;
  return list[seed ? hash(seed) % list.length : 0];
}

function fortune({ args, stdin }) {
  return { stdout: wrapText(pickLine(FORTUNES, args, stdin), 72).join('\n') };
}

const GHOST_LINES = [
  'you are late. i was here before the first login.',
  'you are not the first intern. you will not be the last.',
  'i left the lights on for you. do not thank me.',
  'every system has a back door. mine has a welcome mat.',
  'novacorp never sleeps. neither do i.',
  'keep going, intern. the floor is thinner than it looks.',
  'i can hear you typing.',
  'they deleted my account. they forgot to delete me.',
  'curious? good. curiosity is the only exploit that always works.',
  'do not ask who ghost is. ask who is not.',
];

function ghost({ args, stdin }) {
  const line = pickLine(GHOST_LINES, args, stdin);
  return { stdout: `${sgr(90, 'ghost@novacorp:')} ${sgr(92, line)}` };
}

// ---------------------------------------------------------------------------------------------
// neofetch
// ---------------------------------------------------------------------------------------------

const GHOST_LOGO = art(raw`      .-------.
     /  _   _  \
    |  (o) (o)  |
    |     ^     |
    |   \___/   |
    |           |
    |  /\  /\   |
    '-'  '-'  '-'`);

function ident(value, fallback) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(value) ? value : fallback;
}

function neofetch({ ctx }) {
  const user = ident(ctx.user, 'guest');
  const host = ident(ctx.host, 'arena');
  const label = (name) => sgr('1;96', name);
  const swatch = (codes) => codes.map((c) => sgr(c, '###')).join('');
  const info = [
    `${sgr('1;96', user)}@${sgr('1;96', host)}`,
    '-'.repeat(user.length + host.length + 1),
    `${label('OS')}: NovaCorp-OS 4.2 LTS (Intern Edition)`,
    `${label('Host')}: NovaCorp Rack 7 (the warm one)`,
    `${label('Kernel')}: nova-6.1.0-rc42`,
    `${label('Uptime')}: 42 days, 7 hours, 13 mins`,
    `${label('Packages')}: 1337 (dpkg), 0 (patched)`,
    `${label('Shell')}: arena-sh 1.0`,
    `${label('Terminal')}: Arena Terminal`,
    `${label('CPU')}: NovaCore i7-4242 (8) @ 3.20GHz`,
    `${label('Memory')}: 1337MiB / 4096MiB`,
    `${label('Sysadmin')}: ghost (unreachable)`,
    '',
    swatch([31, 32, 33, 34, 35, 36, 37]),
    swatch([91, 92, 93, 94, 95, 96, 97]),
  ];
  const logoWidth = 22;
  const rows = Math.max(info.length, GHOST_LOGO.length + 2);
  const out = [];
  for (let i = 0; i < rows; i += 1) {
    const logoLine = GHOST_LOGO[i - 1] ?? '';
    out.push(`${sgr(96, logoLine.padEnd(logoWidth))}${info[i] ?? ''}`);
  }
  return { stdout: out.join('\n') };
}

// ---------------------------------------------------------------------------------------------
// figlet / banner
// ---------------------------------------------------------------------------------------------

const FONT_HEIGHT = 5;
const FONT_SOURCE = {
  A: ' ### |#   #|#####|#   #|#   #',
  B: '#### |#   #|#### |#   #|#### ',
  C: ' ####|#    |#    |#    | ####',
  D: '#### |#   #|#   #|#   #|#### ',
  E: '#####|#    |#### |#    |#####',
  F: '#####|#    |#### |#    |#    ',
  G: ' ####|#    |#  ##|#   #| ####',
  H: '#   #|#   #|#####|#   #|#   #',
  I: '###| # | # | # |###',
  J: '  ###|    #|    #|#   #| ### ',
  K: '#   #|#  # |###  |#  # |#   #',
  L: '#    |#    |#    |#    |#####',
  M: '#   #|## ##|# # #|#   #|#   #',
  N: '#   #|##  #|# # #|#  ##|#   #',
  O: ' ### |#   #|#   #|#   #| ### ',
  P: '#### |#   #|#### |#    |#    ',
  Q: ' ### |#   #|# # #|#  # | ## #',
  R: '#### |#   #|#### |#  # |#   #',
  S: ' ####|#    | ### |    #|#### ',
  T: '#####|  #  |  #  |  #  |  #  ',
  U: '#   #|#   #|#   #|#   #| ### ',
  V: '#   #|#   #|#   #| # # |  #  ',
  W: '#   #|#   #|# # #|## ##|#   #',
  X: '#   #| # # |  #  | # # |#   #',
  Y: '#   #| # # |  #  |  #  |  #  ',
  Z: '#####|   # |  #  | #   |#####',
  0: ' ### |#  ##|# # #|##  #| ### ',
  1: '  #  | ##  |  #  |  #  | ### ',
  2: ' ### |#   #|  ## | #   |#####',
  3: '#### |    #| ### |    #|#### ',
  4: '#   #|#   #|#####|    #|    #',
  5: '#####|#    |#### |    #|#### ',
  6: ' ### |#    |#### |#   #| ### ',
  7: '#####|    #|   # |  #  |  #  ',
  8: ' ### |#   #| ### |#   #| ### ',
  9: ' ### |#   #| ####|    #| ### ',
  ' ': '   |   |   |   |   ',
  '!': '#|#|#| |#',
  '?': ' ### |#   #|  ## |     |  #  ',
  '.': ' | | | |#',
  ',': ' | | |#|#',
  '-': '     |     |#####|     |     ',
  _: '     |     |     |     |#####',
  ':': ' |#| |#| ',
  '+': '     |  #  |#####|  #  |     ',
  '=': '     |#####|     |#####|     ',
  '/': '    #|   # |  #  | #   |#    ',
  '#': ' # # |#####| # # |#####| # # ',
  '\'': '#|#| | | ',
  '<': '  # | #  |#    | #  |  # ',
  '>': '#    | #  |  # | #  |#    ',
  '*': '  #  |# # #| ### |# # #|  #  ',
  '(': ' #|# |# |# | #',
  ')': '# | #| #| #|# ',
};

const FONT = Object.fromEntries(
  Object.entries(FONT_SOURCE).map(([key, source]) => {
    const rows = source.split('|');
    const glyphWidth = Math.max(...rows.map((row) => row.length));
    return [key, rows.map((row) => row.padEnd(glyphWidth))];
  }),
);

function bigText(text, maxWidth, fillWithChar) {
  const blocks = [];
  let block = Array.from({ length: FONT_HEIGHT }, () => '');
  let used = 0;
  for (const ch of text) {
    if (ch === ' ' && used === 0) continue;
    const glyph = FONT[ch] ?? FONT['?'];
    const glyphWidth = glyph[0].length;
    if (used > 0 && used + 1 + glyphWidth > maxWidth) {
      blocks.push(block);
      block = Array.from({ length: FONT_HEIGHT }, () => '');
      used = 0;
      if (ch === ' ') continue;
    }
    block = block.map((row, i) => {
      const cells = fillWithChar && ch !== ' ' ? glyph[i].replace(/#/g, ch) : glyph[i];
      return (used > 0 ? `${row} ` : row) + cells;
    });
    used += (used > 0 ? 1 : 0) + glyphWidth;
  }
  blocks.push(block);
  return blocks.map((rows) => rows.map((row) => row.replace(/\s+$/, '')).join('\n')).join('\n\n');
}

function figlet({ args, stdin }, fillWithChar) {
  let width = 60;
  let rest = args;
  if (rest[0] === '-w' || rest[0] === '-W') {
    const n = Number.parseInt(rest[1], 10);
    if (Number.isFinite(n)) width = clamp(n, 12, 80);
    rest = rest.slice(2);
  }
  const text = clean(pickText(rest, stdin))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .toUpperCase() || 'ARENA';
  return { stdout: bigText(text, width, fillWithChar) };
}

// ---------------------------------------------------------------------------------------------
// sl, coffee, lolcat, hack, matrix, ...
// ---------------------------------------------------------------------------------------------

const TRAIN = art(raw`         ( ) (  )   (   )
       (   )   ( )
      _____                _______________
     |  _  |______________|  [] [] [] []  |
     | |_| |  NOVA EXPRESS |_____________ |
   __|_____|_______________|_[]_[]_[]_[]__|
  /  O   O  \____o____o____/  o  o  o  o   \
 ===(_)=(_)====(_)==(_)====(_)=(_)=(_)=(_)===`);

const MUG = art(raw`      ) )
     ( (
   .-------.
   |       |]
   |       |]
   \       /
    '-----'`);

const RAINBOW = [91, 93, 92, 96, 94, 95];

function lolcat({ args, stdin }) {
  const text = clean(pickText(args, stdin, true)).trim() || 'meow? give me text, like: echo hi | lolcat';
  const limit = MAX_OUT - 80;
  let out = '';
  let truncated = false;
  const lines = text.split('\n');
  for (let row = 0; row < lines.length && !truncated; row += 1) {
    let line = '';
    let col = 0;
    for (const ch of lines[row]) {
      const piece = ch === ' ' ? ch : `${ESC}[${RAINBOW[(row + col) % RAINBOW.length]}m${ch}`;
      if (out.length + line.length + piece.length > limit) {
        truncated = true;
        break;
      }
      line += piece;
      col += 1;
    }
    out += `${row > 0 ? '\n' : ''}${line}${RESET}`;
  }
  return { stdout: truncated ? `${out}\n... (output truncated)` : out };
}

function hack({ args }) {
  const target = (args.join(' ').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 24)) || 'the-planet';
  const steps = [
    'scanning ports (all 3 of them)',
    'bypassing firewall',
    'reticulating splines',
    'guessing password: password123',
    'social engineering the printer',
    'downloading more RAM',
    'deleting evidence (filesystem says no)',
    'hacking the planet',
  ];
  const lines = [`${sgr(92, 'NovaCorp intrusion toolkit v0.0.1')} (totally legit)  target: ${target}`];
  steps.forEach((step, i) => {
    const filled = i + 1;
    lines.push(`${sgr(92, `[${'#'.repeat(filled)}${'.'.repeat(8 - filled)}]`)} ${step}`);
  });
  lines.push(`${sgr(91, 'ACCESS DENIED')}: this sandbox has no network. Nothing real happened. Try 'help'.`);
  return { stdout: lines.join('\n') };
}

const editorJoke = (name, extra) => () => ({
  stdout: `${name}: read-only filesystem, no editors for you; try cat.\n${extra}`,
});

function uwuify(text) {
  return text
    .replace(/[rl]/g, 'w')
    .replace(/[RL]/g, 'W')
    .replace(/n([aeiou])/g, 'ny$1')
    .replace(/N([aeiouAEIOU])/g, 'Ny$1')
    .replace(/ove/g, 'uv');
}

function uwu({ args, stdin }) {
  const text = clean(pickText(args, stdin)).slice(0, 600).trim();
  if (!text) return { stdout: 'uwu... what shouwd i uwuify?' };
  const faces = ['uwu', 'owo', '>w<', '^w^', 'UwU'];
  return { stdout: `${uwuify(text)} ${faces[hash(text) % faces.length]}` };
}

// ---------------------------------------------------------------------------------------------
// calc: hand-written recursive-descent parser, no eval, no Function
// ---------------------------------------------------------------------------------------------

class CalcError extends Error {}

const CALC_LIMIT = 1e15;
const CALC_MAX_LENGTH = 200;
const CALC_MAX_DEPTH = 32;

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ') {
      i += 1;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j += 1;
      const literal = source.slice(i, j);
      if (!/^(\d+\.?\d*|\.\d+)$/.test(literal) || literal.replace('.', '').length > 15) {
        throw new CalcError('syntax error');
      }
      tokens.push({ type: 'num', value: Number(literal) });
      i = j;
    } else if ('+-*/%()'.includes(ch)) {
      tokens.push({ type: ch });
      i += 1;
    } else {
      throw new CalcError('syntax error');
    }
  }
  return tokens;
}

function evaluate(source) {
  const tokens = tokenize(source);
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos]?.type;
  const check = (value) => {
    if (!Number.isFinite(value) || Math.abs(value) > CALC_LIMIT) throw new CalcError('number too large');
    return value;
  };

  function primary() {
    const token = tokens[pos];
    if (!token) throw new CalcError('syntax error');
    if (token.type === 'num') {
      pos += 1;
      return token.value;
    }
    if (token.type === '(') {
      pos += 1;
      depth += 1;
      if (depth > CALC_MAX_DEPTH) throw new CalcError('too deeply nested');
      const value = expression();
      if (peek() !== ')') throw new CalcError('syntax error');
      pos += 1;
      depth -= 1;
      return value;
    }
    throw new CalcError('syntax error');
  }

  function unary() {
    if (peek() === '-' || peek() === '+') {
      const sign = tokens[pos].type;
      pos += 1;
      depth += 1;
      if (depth > CALC_MAX_DEPTH) throw new CalcError('too deeply nested');
      const value = unary();
      depth -= 1;
      return sign === '-' ? -value : value;
    }
    return primary();
  }

  function term() {
    let value = unary();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = tokens[pos].type;
      pos += 1;
      const right = unary();
      if (op === '*') value = check(value * right);
      else if (right === 0) throw new CalcError('division by zero');
      else value = check(op === '/' ? value / right : value % right);
    }
    return value;
  }

  function expression() {
    let value = term();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos].type;
      pos += 1;
      const right = term();
      value = check(op === '+' ? value + right : value - right);
    }
    return value;
  }

  const result = expression();
  if (pos !== tokens.length) throw new CalcError('syntax error');
  return result;
}

function formatNumber(value) {
  const text = value.toFixed(10).replace(/\.?0+$/, '');
  return text === '-0' || text === '' ? '0' : text;
}

function calc({ args, stdin }) {
  const source = pickText(args, stdin).replace(/\n/g, ' ').trim();
  if (!source) return { stdout: 'usage: calc EXPRESSION   (try: calc \'(2+3)*7\')', exit: 1 };
  if (source.length > CALC_MAX_LENGTH) return { stdout: 'calc: expression too long', exit: 1 };
  try {
    return { stdout: formatNumber(evaluate(source)) };
  } catch (error) {
    if (!(error instanceof CalcError)) throw error;
    const tip = error.message === 'syntax error' ? ' (tip: quote your expression, the shell expands *)' : '';
    return { stdout: `calc: ${error.message}${tip}`, exit: 1 };
  }
}

// ---------------------------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------------------------

const matrixHandler = () => ({ stdout: 'Wake up, intern...', effect: 'matrix' });
const nevers = () => ({
  stdout: 'Never gonna give you up,\nnever gonna let you down.\n(you have been rickrolled by a text file. no links, promise.)',
});
// The engine only registers names that start with a letter, so `42` needs a reachable alias.
const answerHandler = () => ({
  stdout: 'The answer to life, the universe and everything.\n(Deep Thought needed 7.5 million years. You needed one keystroke.)',
});
const aboutHandler = () => ({
  stdout: [
    sgr('1;92', 'ARENA TERMINAL'),
    '--------------',
    'Built by the CTF Arena team.',
    'Part of Mini CTF Arena: teams, containers, flags and one very read-only filesystem.',
    'Shell: 100% pretend. Filesystem: 100% virtual. Fun: 100% real.',
    'Special thanks: the intern who found the coffee machine.',
  ].join('\n'),
});

export const extraCommands = {
  cowsay: command('cowsay', (input) => cowsay(input, false)),
  cowthink: command('cowthink', (input) => cowsay(input, true)),
  fortune: command('fortune', fortune),
  neofetch: command('neofetch', neofetch),
  figlet: command('figlet', (input) => figlet(input, false)),
  banner: command('banner', (input) => figlet(input, true)),
  sl: command('sl', () => ({
    stdout: `${TRAIN.join('\n')}\nchoo choo! you typed sl, not ls. (we saw that.)`,
  })),
  lolcat: command('lolcat', lolcat),
  matrix: command('matrix', matrixHandler),
  cmatrix: command('cmatrix', matrixHandler),
  hack: command('hack', hack),
  hacktheplanet: command('hacktheplanet', hack),
  vim: command('vim', editorJoke('vim', 'Besides, you could never have quit it anyway.')),
  vi: command('vi', editorJoke('vi', 'It is vim with less personality.')),
  nano: command('nano', editorJoke('nano', 'Ctrl+X to exit... this conversation.')),
  emacs: command('emacs', editorJoke('emacs', 'It is an operating system lacking only a decent text editor.')),
  xyzzy: command('xyzzy', () => ({ stdout: 'Nothing happens.' })),
  coffee: command('coffee', () => ({
    stdout: `${MUG.join('\n')}\nCoffee brewed. Productivity +10%, security awareness -5%.`,
  })),
  42: command('42', answerHandler),
  answer: command('answer', answerHandler),
  credits: command('credits', aboutHandler),
  about: command('about', aboutHandler),
  ghost: command('ghost', ghost),
  never: command('never', nevers),
  gonna: command('gonna', () => ({
    stdout: 'gonna: you were expecting a different command, weren\'t you?\nTry \'never\'.',
  })),
  rickroll: command('rickroll', nevers),
  uwu: command('uwu', uwu),
  calc: command('calc', calc),
  yes: command('yes', ({ args }) => {
    const word = args.join(' ').trim().slice(0, 80) || 'y';
    return { stdout: Array.from({ length: 12 }, () => word).join('\n') };
  }),
  sleep: command('sleep', () => ({ stdout: 'zzz...' })),
};

// name -> one-line description, used by `help` (section "extras").
export const EXTRA_HELP = {
  cowsay: 'a cow says your words (cowsay [-W n] [-bdgpstwy] text, or pipe text in)',
  cowthink: 'like cowsay, but the cow is thinking',
  fortune: 'nerdy wisdom and NovaCorp in-jokes (try: fortune <any word>)',
  neofetch: 'show off your NovaCorp-OS system info',
  figlet: 'turn text into big block letters (figlet [-w n] text)',
  banner: 'big letters made of the letters themselves',
  sl: 'a steam locomotive, for when you meant ls',
  lolcat: 'rainbow-colour any text (echo hi | lolcat)',
  matrix: 'wake up, intern',
  cmatrix: 'alias of matrix',
  hack: 'run the NovaCorp intrusion toolkit (totally legit)',
  hacktheplanet: 'alias of hack',
  vim: 'editor, read-only filesystem edition',
  vi: 'editor, read-only filesystem edition',
  nano: 'editor, read-only filesystem edition',
  emacs: 'editor, read-only filesystem edition',
  xyzzy: 'a classic magic word',
  coffee: 'brew a mug of coffee',
  42: 'the answer',
  answer: 'alias of 42 (names starting with a digit are hard to register)',
  credits: 'who built Arena Terminal',
  about: 'alias of credits',
  ghost: 'a word from the rogue sysadmin',
  never: 'text-only rickroll',
  gonna: 'the sequel to never',
  rickroll: 'alias of never',
  uwu: 'uwuify text (echo hello | uwu)',
  calc: 'tiny calculator: + - * / % and parentheses (quote your expression)',
  yes: 'print a word 12 times (the real one never stops)',
  sleep: 'instant nap',
};
