// Static data for the Arena Terminal UI: command names for Tab completion, quick chips, cheat sheet, key hints.

export const MODES = ['easy', 'medium', 'hard'];
export const isMode = (mode) => MODES.includes(mode);

// Commands the engine understands (docs/TERMINAL_GAME.md section 7) plus the four the browser handles itself.
// Tab completion offers these without a network call; the server fills in paths (and any extra commands).
export const CLIENT_COMMANDS = ['clear', 'history', 'submit', 'exit'];
export const COMMANDS = [...new Set([
  'help', 'man', 'whoami', 'id', 'hostname', 'uname', 'date', 'pwd', 'cd', 'echo', 'env', 'true', 'false', 'motd', 'hint',
  'status', 'codes',
  'ls', 'cat', 'tac', 'head', 'tail', 'less', 'more', 'nl', 'wc', 'file', 'stat', 'tree', 'find', 'du', 'ln', 'cp', 'mv',
  'rm', 'mkdir', 'touch',
  'grep', 'sort', 'uniq', 'cut', 'tr', 'rev', 'sed', 'awk', 'diff', 'comm', 'paste', 'column', 'xargs',
  'base64', 'xxd', 'hexdump', 'od', 'strings', 'gzip', 'gunzip', 'zcat', 'md5sum', 'sha1sum', 'sha256sum', 'factor',
  'ps', 'crontab', 'last', 'who', 'w', 'uptime', 'df', 'ss', 'netstat', 'ping', 'curl', 'wget', 'ssh', 'nc',
  'sudo', 'vault',
  ...CLIENT_COMMANDS,
])].sort();

// Chips under the terminal. Text is inserted into the input, never sent on its own.
export const QUICK_CHIPS = [
  { label: 'ls', text: 'ls' },
  { label: 'cd ..', text: 'cd ..' },
  { label: 'cat', text: 'cat ' },
  { label: 'help', text: 'help' },
  { label: 'hint', text: 'hint' },
];

export const CHEAT_SHEET = [
  { cmd: 'ls -la', note: 'list everything, including hidden files' },
  { cmd: 'cd <dir>', note: 'enter a folder (cd .. goes up, cd goes home)' },
  { cmd: 'cat <file>', note: 'print a file' },
  { cmd: 'head -n 5 <file>', note: 'first lines (tail shows the last ones)' },
  { cmd: 'grep -r word .', note: 'search every file below here' },
  { cmd: "find . -name '*.txt'", note: 'find files by name, size or type' },
  { cmd: 'sort f | uniq -c', note: 'count repeated lines' },
  { cmd: 'base64 -d', note: 'decode base64 text (pipe it in)' },
  { cmd: 'xxd <file>', note: 'hex dump of a binary file' },
  { cmd: 'strings <file>', note: 'readable text inside a binary' },
  { cmd: 'file <name>', note: 'what kind of file is this?' },
  { cmd: 'wc -l <file>', note: 'count lines (-w words, -c bytes)' },
  { cmd: 'hint', note: 'a nudge for the next code' },
  { cmd: 'submit CTF{...}', note: 'hand in a code you found' },
];

export const KEY_HINTS = [
  { keys: ['Tab'], note: 'complete a command or path (twice lists the options)' },
  { keys: ['↑', '↓'], join: ' / ', note: 'walk through your command history' },
  { keys: ['Ctrl', 'L'], note: 'clear the screen' },
  { keys: ['Ctrl', 'C'], note: 'cancel the current line' },
  { keys: ['Esc', 'Tab'], join: ' then ', note: 'leave the terminal (keyboard focus)' },
];

export const EFFECTS = ['clear', 'matrix', 'confetti', 'reboot'];
