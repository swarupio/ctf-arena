import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ansiClass, containsFlag, findFlags, parseAnsi, stripAnsi, tokenizeOutput,
} from '../src/terminal/ansi.js';
import {
  HISTORY_LIMIT, formatHistory, freshNav, historyKey, loadHistory, pushHistory, saveHistory, stepHistory,
} from '../src/terminal/history.js';
import {
  MAX_COMMAND_LENGTH, classifyCommand, formatPrompt, normalizeCommand, parseSubmit, shortenCwd, submitErrorMessage,
} from '../src/terminal/commandLine.js';
import {
  applyCompletion, commonPrefix, completeCommands, displayName, escapeWord, mergeCompletions, resolveMatch,
  splitCompletion, unquoteWord,
} from '../src/terminal/completion.js';
import {
  describeError, normalizeComplete, normalizeExec, normalizeModes, normalizeProgress, normalizeSubmit,
} from '../src/terminal/adapters.js';
import {
  bootLength, bootLines, buildCodeRows, difficultyLevel, formatElapsed, pointsSummary, revealLines,
} from '../src/terminal/viewModel.js';
import { FIRST_BLOOD_BANNER, bannerWord } from '../src/terminal/banner.js';
import { CHEAT_SHEET, COMMANDS, QUICK_CHIPS } from '../src/terminal/data.js';
import { CATEGORY_ORDER, groupByCategory, splitTerminalChallenges } from '../src/pages/challengeHelpers.js';

const ESC = '\u001b';

// ---------- ANSI parser ----------

test('plain text is one unstyled run', () => {
  assert.deepEqual(parseAnsi('hello\nworld'), [{ text: 'hello\nworld', fg: null, bold: false, dim: false }]);
  assert.deepEqual(parseAnsi(''), []);
  assert.deepEqual(parseAnsi(undefined), []);
});

test('SGR colours 30-37 and 90-97, bold, dim and reset build runs', () => {
  const runs = parseAnsi(`a${ESC}[31mred${ESC}[0m b${ESC}[1;34mdir${ESC}[22m${ESC}[92mlime${ESC}[2mdim${ESC}[m!`);
  assert.deepEqual(runs.map((run) => run.text), ['a', 'red', ' b', 'dir', 'lime', 'dim', '!']);
  assert.equal(runs[1].fg, 'red');
  assert.equal(runs[2].fg, null);
  assert.deepEqual([runs[3].fg, runs[3].bold], ['blue', true]);
  assert.deepEqual([runs[4].fg, runs[4].bold, runs[4].dim], ['bright-green', false, false]);
  assert.equal(runs[5].dim, true);
  assert.deepEqual([runs[6].fg, runs[6].bold, runs[6].dim], [null, false, false]);
  assert.equal(ansiClass(runs[3]), 'ansi-blue ansi-bold');
  assert.equal(ansiClass(runs[0]), '');
});

test('adjacent runs with the same style are merged and 39 resets the colour', () => {
  const runs = parseAnsi(`${ESC}[32mone${ESC}[32mtwo${ESC}[39mthree`);
  assert.deepEqual(runs.map((run) => [run.text, run.fg]), [['onetwo', 'green'], ['three', null]]);
});

test('extended and unsupported SGR codes are ignored without leaking their arguments', () => {
  assert.deepEqual(parseAnsi(`${ESC}[38;5;196mx${ESC}[0m`).map((run) => [run.text, run.fg]), [['x', null]]);
  assert.deepEqual(parseAnsi(`${ESC}[38;2;1;2;3mx`).map((run) => [run.text, run.fg, run.bold]), [['x', null, false]]);
  assert.deepEqual(parseAnsi(`${ESC}[4;7;41mx`).map((run) => [run.text, run.fg]), [['x', null]]);
  assert.equal(parseAnsi(`${ESC}[38:5:12mx`)[0].fg, null);
});

test('malformed and truncated escape sequences never throw and keep the surrounding text', () => {
  assert.equal(stripAnsi(`start${ESC}[31`), 'start');
  assert.equal(stripAnsi(`start${ESC}`), 'start');
  assert.equal(stripAnsi(`a${ESC}b`), 'ab');
  assert.equal(stripAnsi(`a${ESC}[\nb`), 'a\nb');
  assert.equal(stripAnsi(`a${ESC}[;;;mb`), 'ab');
  assert.equal(stripAnsi(`a${ESC}[99999999999999mb`), 'ab');
  assert.equal(stripAnsi(`a${ESC}[2Jb${ESC}[10;20Hc`), 'abc');
  assert.equal(stripAnsi(`a${ESC}[31 mb`), 'ab');
  assert.equal(stripAnsi(`${ESC}[${ESC}[31mred`), 'red');
  assert.equal(stripAnsi(`${ESC}]0;title\u0007after`), ']0;titleafter');
  for (let n = 0; n < 200; n += 1) {
    const noise = Array.from({ length: 30 }, (_, i) => String.fromCharCode((n * 31 + i * 17) % 128)).join('');
    assert.equal(typeof stripAnsi(noise), 'string');
  }
});

test('control characters and bidi overrides are removed but newlines and tabs stay', () => {
  assert.equal(stripAnsi('a\rb\u0007c\u0008d\te\nf‮g'), 'abcd\te\nfg');
});

test('output is never turned into HTML: markup stays literal text', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script> &amp; "quoted"';
  const runs = parseAnsi(`${ESC}[31m${evil}${ESC}[0m`);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].text, evil);
  assert.deepEqual(Object.keys(runs[0]).sort(), ['bold', 'dim', 'fg', 'text']);
  const tokens = tokenizeOutput(`${evil} CTF{ok}`);
  for (const token of tokens) assert.ok(['text', 'flag'].includes(token.type));
  assert.equal(tokens.map((token) => (token.type === 'text' ? token.text : token.flag)).join(''), `${evil} CTF{ok}`);
});

// ---------- flag-looking strings ----------

test('flag detection matches CTF{...} without spaces or closing braces', () => {
  assert.deepEqual(findFlags('see CTF{abc_123} and CTF{x}!').map((f) => [f.start, f.flag]), [[4, 'CTF{abc_123}'], [21, 'CTF{x}']]);
  assert.equal(containsFlag('CTF{this is not it}'), false);
  assert.equal(containsFlag('CTF{}'), false);
  assert.equal(containsFlag('ctf{lowercase}'), false);
  assert.equal(containsFlag('CTF{unterminated'), false);
  assert.equal(containsFlag(`CTF{${'a'.repeat(120)}}`), true);
  assert.equal(containsFlag(`CTF{${'a'.repeat(121)}}`), false);
  assert.equal(containsFlag(undefined), false);
});

test('tokenizeOutput highlights flags and keeps the styles around them', () => {
  const tokens = tokenizeOutput(`${ESC}[32mfound${ESC}[0m CTF{real_one} done`);
  assert.deepEqual(tokens.map((token) => token.type), ['text', 'text', 'flag', 'text']);
  assert.equal(tokens[0].fg, 'green');
  assert.equal(tokens[2].flag, 'CTF{real_one}');
  assert.equal(tokens[3].text, ' done');
});

test('a flag split across colour runs is one flag token with several parts', () => {
  const tokens = tokenizeOutput(`x CTF{ab${ESC}[31;1mcd${ESC}[0mef} y CTF{two}`);
  const flags = tokens.filter((token) => token.type === 'flag');
  assert.equal(flags.length, 2);
  assert.equal(flags[0].flag, 'CTF{abcdef}');
  assert.deepEqual(flags[0].parts.map((part) => [part.text, part.fg]), [['CTF{ab', null], ['cd', 'red'], ['ef}', null]]);
  assert.equal(tokens.map((token) => (token.type === 'flag' ? token.parts.map((p) => p.text).join('') : token.text)).join(''), 'x CTF{abcdef} y CTF{two}');
});

test('output without flags yields only text tokens', () => {
  assert.deepEqual(tokenizeOutput('plain CTF{ nope').map((token) => token.type), ['text']);
});

// ---------- history ----------

test('pushHistory skips blanks and repeats and caps the list at 200', () => {
  let list = [];
  list = pushHistory(list, '  ls  ');
  list = pushHistory(list, '');
  list = pushHistory(list, '   ');
  list = pushHistory(list, 'ls');
  assert.deepEqual(list, ['ls']);
  list = pushHistory(list, 'pwd');
  list = pushHistory(list, 'ls');
  assert.deepEqual(list, ['ls', 'pwd', 'ls']);
  let big = [];
  for (let i = 0; i < 260; i += 1) big = pushHistory(big, `cmd ${i}`);
  assert.equal(big.length, HISTORY_LIMIT);
  assert.equal(big[0], 'cmd 60');
  assert.equal(big.at(-1), 'cmd 259');
});

test('history navigation walks back, forward and restores the draft', () => {
  const list = ['ls', 'cd docs', 'cat notes'];
  let nav = freshNav(list);
  let step = stepHistory(list, nav, 'down', 'typing');
  assert.equal(step.value, null);
  step = stepHistory(list, nav, 'up', 'half typed');
  assert.equal(step.value, 'cat notes');
  nav = step.nav;
  step = stepHistory(list, nav, 'up', 'cat notes');
  assert.equal(step.value, 'cd docs');
  nav = step.nav;
  step = stepHistory(list, nav, 'up', 'cd docs');
  assert.equal(step.value, 'ls');
  nav = step.nav;
  step = stepHistory(list, nav, 'up', 'ls');
  assert.equal(step.value, null, 'stops at the oldest entry');
  nav = step.nav;
  step = stepHistory(list, nav, 'down', 'ls');
  assert.equal(step.value, 'cd docs');
  nav = step.nav;
  nav = stepHistory(list, nav, 'down', 'cd docs').nav;
  step = stepHistory(list, nav, 'down', 'cat notes');
  assert.equal(step.value, 'half typed', 'coming back down restores the draft');
  assert.equal(stepHistory([], freshNav([]), 'up', 'x').value, null);
});

test('history persists per mode and tolerates broken storage', () => {
  const store = new Map();
  const storage = { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, value) };
  saveHistory(storage, 'easy', ['ls', 'submit CTF{secret}', 'cat a', '  submit x']);
  assert.deepEqual(JSON.parse(store.get(historyKey('easy'))), ['ls', 'cat a'], 'submit lines are never stored');
  assert.deepEqual(loadHistory(storage, 'easy'), ['ls', 'cat a']);
  assert.deepEqual(loadHistory(storage, 'hard'), []);
  store.set(historyKey('easy'), '{not json');
  assert.deepEqual(loadHistory(storage, 'easy'), []);
  store.set(historyKey('easy'), JSON.stringify({ a: 1 }));
  assert.deepEqual(loadHistory(storage, 'easy'), []);
  store.set(historyKey('easy'), JSON.stringify(['ok', 5, '', null, 'submit CTF{x}', 'fine']));
  assert.deepEqual(loadHistory(storage, 'easy'), ['ok', 'fine']);
  store.set(historyKey('easy'), JSON.stringify(Array.from({ length: 300 }, (_, i) => `c${i}`)));
  assert.equal(loadHistory(storage, 'easy').length, HISTORY_LIMIT);
  assert.doesNotThrow(() => saveHistory({ setItem() { throw new Error('quota'); } }, 'easy', ['ls']));
  assert.deepEqual(loadHistory(null, 'easy'), []);
});

test('history output is numbered', () => {
  assert.equal(formatHistory([]), 'history is empty');
  assert.equal(formatHistory(['ls', 'pwd']), ' 1  ls\n 2  pwd');
  assert.match(formatHistory(Array.from({ length: 12 }, (_, i) => `c${i}`)), /^ {2}1 {2}c0\n/);
});

// ---------- prompt, normalisation, submit parsing ----------

test('the prompt shortens the home directory to ~', () => {
  assert.equal(shortenCwd('/home/guest'), '~');
  assert.equal(shortenCwd('/home/guest/'), '~');
  assert.equal(shortenCwd('/home/guest/docs/old'), '~/docs/old');
  assert.equal(shortenCwd('/home/guestx'), '/home/guestx');
  assert.equal(shortenCwd('/var/log/'), '/var/log');
  assert.equal(shortenCwd('/'), '/');
  assert.equal(shortenCwd(undefined), '~');
  assert.equal(shortenCwd('/srv/ops', '/srv'), '~/ops');
  assert.equal(formatPrompt({ cwd: '/home/guest' }), 'guest@arena:~$');
  assert.equal(formatPrompt({ cwd: '/home/guest/notes' }), 'guest@arena:~/notes$');
  assert.equal(formatPrompt({ cwd: '/etc' }), 'guest@arena:/etc$');
  assert.equal(formatPrompt(), 'guest@arena:~$');
  assert.equal(formatPrompt({ user: 'root', host: 'vault', cwd: '/root', home: '/root' }), 'root@vault:~$');
});

test('command lines are normalised: control characters, ends and length', () => {
  assert.equal(normalizeCommand('  ls -la  '), 'ls -la');
  assert.equal(normalizeCommand('echo a\nb\tc\r'), 'echo a b c');
  assert.equal(normalizeCommand(`ls${ESC}[31m`), 'ls [31m');
  assert.equal(normalizeCommand(null), '');
  assert.equal(normalizeCommand('x'.repeat(500)).length, MAX_COMMAND_LENGTH);
  assert.equal(normalizeCommand('echo "two  spaces"'), 'echo "two  spaces"');
});

test('submit <flag> is parsed, other lines are not', () => {
  assert.deepEqual(parseSubmit('submit CTF{abc}'), { ok: true, flag: 'CTF{abc}' });
  assert.deepEqual(parseSubmit('  submit    CTF{abc}  '), { ok: true, flag: 'CTF{abc}' });
  assert.deepEqual(parseSubmit('submit "CTF{abc}"'), { ok: true, flag: 'CTF{abc}' });
  assert.deepEqual(parseSubmit("submit 'CTF{abc}'"), { ok: true, flag: 'CTF{abc}' });
  assert.deepEqual(parseSubmit('submit'), { ok: false, error: 'usage' });
  assert.deepEqual(parseSubmit('submit   '), { ok: false, error: 'usage' });
  assert.deepEqual(parseSubmit('submit ""'), { ok: false, error: 'usage' });
  assert.deepEqual(parseSubmit('submit CTF{a b}'), { ok: false, error: 'spaces' });
  assert.deepEqual(parseSubmit(`submit ${'a'.repeat(201)}`), { ok: false, error: 'too-long' });
  assert.equal(parseSubmit('submitted CTF{x}'), null);
  assert.equal(parseSubmit('echo submit CTF{x}'), null);
  assert.equal(parseSubmit('Submit CTF{x}'), null);
  for (const error of ['usage', 'spaces', 'too-long', 'unknown']) assert.match(submitErrorMessage(error), /\w/);
  assert.ok(!submitErrorMessage('usage').includes('ctf{'));
});

test('classifyCommand routes the four browser commands and sends everything else to the server', () => {
  assert.equal(classifyCommand('').kind, 'empty');
  assert.equal(classifyCommand('   ').kind, 'empty');
  assert.equal(classifyCommand('clear').kind, 'clear');
  assert.equal(classifyCommand('  clear  ').kind, 'clear');
  assert.equal(classifyCommand('clear && ls').kind, 'exec');
  assert.equal(classifyCommand('clear x').kind, 'exec');
  assert.deepEqual(classifyCommand('history'), { kind: 'history', line: 'history', wipe: false });
  assert.equal(classifyCommand('history -c').wipe, true);
  assert.equal(classifyCommand('history | grep ls').kind, 'exec');
  assert.equal(classifyCommand('exit').kind, 'exit');
  assert.equal(classifyCommand('exit 1').kind, 'exec');
  assert.deepEqual(classifyCommand('submit CTF{x}'), { kind: 'submit', line: 'submit CTF{x}', ok: true, flag: 'CTF{x}' });
  assert.equal(classifyCommand('submit').ok, false);
  assert.deepEqual(classifyCommand('ls -la /tmp'), { kind: 'exec', line: 'ls -la /tmp' });
  assert.equal(classifyCommand('cat clear').kind, 'exec');
});

// ---------- completion ----------

test('splitCompletion finds the word at the caret and whether a command is expected', () => {
  let ctx = splitCompletion('ca', 2);
  assert.deepEqual([ctx.head, ctx.word, ctx.tail, ctx.commandPosition], ['', 'ca', '', true]);
  ctx = splitCompletion('cat do', 6);
  assert.deepEqual([ctx.head, ctx.word, ctx.commandPosition], ['cat ', 'do', false]);
  ctx = splitCompletion('cat ', 4);
  assert.deepEqual([ctx.head, ctx.word, ctx.commandPosition], ['cat ', '', false]);
  ctx = splitCompletion('ls | gr', 7);
  assert.deepEqual([ctx.head, ctx.word, ctx.commandPosition], ['ls | ', 'gr', true]);
  ctx = splitCompletion('cd x; ec', 8);
  assert.equal(ctx.commandPosition, true);
  ctx = splitCompletion('echo $(wh', 9);
  assert.deepEqual([ctx.word, ctx.commandPosition], ['wh', true]);
  ctx = splitCompletion('sudo ca', 7);
  assert.deepEqual([ctx.word, ctx.commandPosition], ['ca', true]);
  ctx = splitCompletion('sudo cat /var/se', 16);
  assert.deepEqual([ctx.word, ctx.commandPosition], ['/var/se', false]);
  ctx = splitCompletion('echo hi > /tm', 13);
  assert.deepEqual([ctx.word, ctx.commandPosition], ['/tm', false]);
  ctx = splitCompletion('', 0);
  assert.deepEqual([ctx.word, ctx.commandPosition], ['', true]);
  ctx = splitCompletion('cat docs/re rest', 11);
  assert.deepEqual([ctx.word, ctx.tail], ['docs/re', ' rest']);
});

test('quotes and backslashes are understood when completing', () => {
  let ctx = splitCompletion('cat "my fi', 10);
  assert.deepEqual([ctx.word, ctx.quote, ctx.head], ['my fi', '"', 'cat ']);
  ctx = splitCompletion("cat 'a b", 8);
  assert.deepEqual([ctx.word, ctx.quote], ['a b', "'"]);
  ctx = splitCompletion('cat my\\ fi', 10);
  assert.deepEqual([ctx.word, ctx.quote], ['my fi', '']);
  assert.deepEqual(unquoteWord('"a\\"b"'), { text: 'a"b', quote: '' });
  assert.deepEqual(unquoteWord("'x y"), { text: 'x y', quote: "'" });
  assert.equal(escapeWord('my file (1)'), 'my\\ file\\ \\(1\\)');
  assert.equal(escapeWord('plain-name.txt'), 'plain-name.txt');
  assert.equal(escapeWord('~/docs/'), '~/docs/');
  assert.equal(escapeWord('say "hi"', '"'), 'say \\"hi\\"');
  assert.equal(escapeWord("it's", "'"), "it'\\''s");
});

test('merging keeps client commands and server paths without duplicates', () => {
  assert.deepEqual(mergeCompletions('ca', ['cat', 'case'], ['cat', 'cal', 'dog', 5, null]), ['cal', 'case', 'cat']);
  assert.deepEqual(mergeCompletions('docs/re', [], ['readme.md', 'docs/report.txt', 'docs/readme.md']), ['docs/readme.md', 'docs/report.txt']);
  assert.deepEqual(mergeCompletions('', ['b', 'a'], []), ['a', 'b']);
  assert.deepEqual(mergeCompletions('x', [], 'oops'), []);
  assert.equal(mergeCompletions('', Array.from({ length: 300 }, (_, i) => `c${i}`)).length, 100);
  assert.equal(resolveMatch('Doc', 'Documents/'), 'Documents/');
  assert.equal(resolveMatch('a/b/c', 'cache'), 'a/b/cache');
  assert.equal(resolveMatch('c', 'cache'), 'cache');
  assert.equal(resolveMatch('a/', '/abs/path'), '/abs/path');
});

test('client command list covers the engine commands and the four browser commands', () => {
  for (const name of ['ls', 'cd', 'cat', 'grep', 'find', 'sudo', 'vault', 'clear', 'history', 'submit', 'exit', 'base64', 'xxd']) {
    assert.ok(COMMANDS.includes(name), name);
  }
  assert.equal(new Set(COMMANDS).size, COMMANDS.length);
  assert.deepEqual(completeCommands('hi'), ['hint', 'history']);
  assert.deepEqual(completeCommands('zz'), []);
  assert.deepEqual(completeCommands('cow', ['cowsay']), ['cowsay']);
  assert.equal(commonPrefix(['history', 'hint']), 'hi');
  assert.equal(commonPrefix(['a']), 'a');
  assert.equal(commonPrefix([]), '');
  assert.equal(commonPrefix(['abc', 'xyz']), '');
});

test('applying a completion: unique, directory, common prefix and the second-Tab list', () => {
  const ctx = (value) => splitCompletion(value, value.length);
  let result = applyCompletion(ctx('cat rea'), ['readme.txt']);
  assert.deepEqual([result.value, result.caret, result.changed], ['cat readme.txt ', 15, true]);
  result = applyCompletion(ctx('cd Doc'), ['Documents/']);
  assert.equal(result.value, 'cd Documents/', 'directories get no trailing space');
  result = applyCompletion(ctx('ls /var/l'), ['/var/lib/', '/var/log/', '/var/local/']);
  assert.deepEqual([result.value, result.changed, result.list], ['ls /var/l', false, null]);
  result = applyCompletion(ctx('ls /var/l'), ['/var/lib/', '/var/log/', '/var/local/'], { twice: true });
  assert.deepEqual(result.list, ['lib/', 'log/', 'local/']);
  result = applyCompletion(ctx('cat no'), ['notes_a.txt', 'notes_b.txt']);
  assert.equal(result.value, 'cat notes_');
  assert.equal(result.list, null);
  result = applyCompletion(ctx('cat nope'), []);
  assert.deepEqual([result.value, result.changed], ['cat nope', false]);
  // text after the caret is kept
  const mid = splitCompletion('cat re  | wc', 6);
  result = applyCompletion(mid, ['readme.txt']);
  assert.equal(result.value, 'cat readme.txt  | wc');
  assert.equal(result.caret, 15, 'the caret steps over the space that was already there');
  // names with spaces are escaped; inside quotes the quote is closed
  assert.equal(applyCompletion(ctx('cat my'), ['my file.txt']).value, 'cat my\\ file.txt ');
  assert.equal(applyCompletion(ctx('cat "my'), ['my file.txt']).value, 'cat "my file.txt" ');
  assert.equal(displayName('/var/log/'), 'log/');
  assert.equal(displayName('docs/readme.md'), 'readme.md');
  assert.equal(displayName('ls'), 'ls');
  assert.equal(displayName('/'), '/');
});

// ---------- API adapters ----------

test('modes list is normalised and ordered easy, medium, hard', () => {
  const modes = normalizeModes([
    { mode: 'hard', title: 'The Vault', tagline: 't', difficulty: 'hard', codes: 6, solved: 1, points: 1080, pointsEarned: 180, lore: ['a', 'b'] },
    { mode: 'easy', title: "Intern's Laptop", codes: '4', solved: '2', points: 160, pointsEarned: 80, lore: 'one\ntwo' },
    { nope: true },
    null,
  ]);
  assert.deepEqual(modes.map((m) => m.mode), ['easy', 'hard']);
  assert.deepEqual([modes[0].codes, modes[0].solved, modes[0].lore], [4, 2, ['one', 'two']]);
  assert.equal(modes[0].difficulty, 'easy');
  assert.equal(modes[1].pointsEarned, 180);
  assert.deepEqual(normalizeModes({ modes: [{ mode: 'medium' }] }).map((m) => m.mode), ['medium']);
  assert.deepEqual(normalizeModes(null), []);
});

test('progress, exec, complete and submit responses are normalised', () => {
  const progress = normalizeProgress({ mode: 'easy', total: 4, solved: [{ n: 2, title: 'B', points: 40, firstBlood: true }, { n: 1, title: 'A', points: 40 }], remaining: 2 });
  assert.deepEqual(progress.solved.map((s) => [s.n, s.firstBlood]), [[1, false], [2, true]]);
  assert.deepEqual([progress.total, progress.remaining, progress.remainingItems], [4, 2, null]);
  const listed = normalizeProgress({ solved: [], remaining: [{ n: 1, points: 40 }, { n: 2 }] }, 'easy');
  assert.deepEqual([listed.mode, listed.total, listed.remaining], ['easy', 2, 2]);
  assert.deepEqual(listed.remainingItems, [{ n: 1, points: 40 }, { n: 2, points: null }]);
  assert.deepEqual(normalizeProgress(null, 'hard'), { mode: 'hard', total: 0, solved: [], remaining: 0, remainingItems: null });

  assert.deepEqual(normalizeExec({ output: 'hi', cwd: '/home/guest', exit: 0 }), { output: 'hi', cwd: '/home/guest', exit: 0, effect: null });
  assert.equal(normalizeExec({ output: 'x', cwd: '/', exit: 1, effect: 'matrix' }).effect, 'matrix');
  assert.equal(normalizeExec({ effect: 'launch-missiles' }).effect, null);
  assert.deepEqual(normalizeExec(null), { output: '', cwd: null, exit: 0, effect: null });
  assert.equal(normalizeExec({ output: 5, cwd: '' }).cwd, null);

  assert.deepEqual(normalizeComplete({ matches: ['a', '', 7, 'b'] }), ['a', 'b']);
  assert.equal(normalizeComplete({ matches: Array.from({ length: 80 }, (_, i) => `m${i}`) }).length, 50);
  assert.deepEqual(normalizeComplete(undefined), []);

  const solved = normalizeSubmit({ correct: true, code: 2, title: 'Hidden', pointsAwarded: 40, firstBlood: true, message: 'ok', solved: 2, total: 4 });
  assert.deepEqual([solved.correct, solved.code, solved.title, solved.pointsAwarded, solved.firstBlood, solved.solved, solved.total], [true, 2, 'Hidden', 40, true, 2, 4]);
  const wrong = normalizeSubmit({ correct: false, pointsAwarded: 0, firstBlood: false, message: 'nope', solved: 1, total: 4 });
  assert.deepEqual([wrong.correct, wrong.code, wrong.title, wrong.alreadySolved], [false, null, '', false]);
  assert.equal(normalizeSubmit({ correct: true, alreadySolved: true, pointsAwarded: 0 }).alreadySolved, true);
  assert.equal(normalizeSubmit({ correct: 'yes' }).correct, false, 'only a real true counts as correct');
  assert.equal(normalizeSubmit(null).solved, null);
});

test('errors become friendly terminal lines', () => {
  assert.equal(describeError({ status: 409, code: 'NO_TEAM' }).kind, 'no-team');
  assert.equal(describeError({ status: 409, code: 'NO_TEAM' }).link.to, '/team');
  assert.equal(describeError({ status: 403, code: 'NO_TEAM' }).kind, 'no-team');
  assert.equal(describeError({ status: 403, code: 'TEAM_BANNED' }).kind, 'banned');
  assert.match(describeError({ status: 429, code: 'SLOW_DOWN' }, 'exec').message, /speed typist/);
  assert.equal(describeError({ status: 403, code: 'TEAM_BANNED' }).link.to, '/team');
  assert.equal(describeError({ status: 401 }).kind, 'auth');
  assert.equal(describeError({ status: 429, code: 'RATE_LIMITED' }).kind, 'rate');
  assert.match(describeError({ status: 429 }, 'submit').message, /wait a minute/);
  assert.match(describeError({ status: 429 }, 'exec').message, /slow down/);
  assert.equal(describeError({ status: 403, code: 'FORBIDDEN', message: 'Admins cannot submit.' }).message, 'Admins cannot submit.');
  assert.equal(describeError({ status: 404, code: 'NOT_FOUND' }).kind, 'not-found');
  assert.equal(describeError({ status: 404, code: 'NO_TEAM' }).kind, 'no-team', 'the backend answers NO_TEAM with HTTP 404');
  assert.equal(describeError({ status: 503, code: 'TERMINAL_NOT_SEEDED' }).kind, 'not-seeded', 'a 503 with this code is not a dropped connection');
  assert.equal(describeError({ status: 400, code: 'VALIDATION_ERROR' }).kind, 'invalid');
  assert.equal(describeError(new TypeError('Failed to fetch')).kind, 'network');
  assert.equal(describeError(new SyntaxError('Unexpected token <')).kind, 'network');
  assert.equal(describeError({ status: 502 }).kind, 'network');
  assert.match(describeError({ status: 503 }).message, /connection lost/);
  assert.equal(describeError({ status: 500, message: 'Boom' }).kind, 'server');
  assert.equal(describeError(undefined).kind, 'network');
});

// ---------- view helpers ----------

test('elapsed time reads as m:ss or h:mm:ss', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(999), '0:00');
  assert.equal(formatElapsed(75_000), '1:15');
  assert.equal(formatElapsed(3_725_000), '1:02:05');
  assert.equal(formatElapsed(-5), '0:00');
  assert.equal(formatElapsed(NaN), '0:00');
});

test('difficulty pips', () => {
  assert.deepEqual(['easy', 'medium', 'hard', 'Hard', 'weird'].map(difficultyLevel), [1, 2, 3, 3, 1]);
});

test('HUD rows show ??? until a code is solved and estimate the points of the rest', () => {
  const info = { codes: 4, points: 160 };
  const progress = normalizeProgress({ total: 4, solved: [{ n: 1, title: 'Welcome aboard', points: 40, firstBlood: true }], remaining: 3 });
  const rows = buildCodeRows(progress, info);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { n: 1, solved: true, title: 'Welcome aboard', points: 40, firstBlood: true });
  assert.deepEqual(rows[1], { n: 2, solved: false, title: '???', points: 40, firstBlood: false });
  assert.deepEqual(pointsSummary(progress, info), { earned: 40, total: 160 });
  assert.equal(buildCodeRows(null, info).length, 4);
  assert.deepEqual(pointsSummary(null, { points: 90, pointsEarned: 45 }), { earned: 45, total: 90 });
  const hinted = normalizeProgress({ total: 2, solved: [], remaining: [{ n: 1, points: 10 }, { n: 2, points: 20 }] });
  assert.deepEqual(buildCodeRows(hinted, null).map((row) => row.points), [10, 20]);
  const unknown = buildCodeRows({ total: 2, solved: [], remaining: 2, remainingItems: null }, null);
  assert.deepEqual(unknown.map((row) => row.points), [null, null]);
  assert.equal(buildCodeRows({ total: 0, solved: [{ n: 3, title: 'x', points: 1, firstBlood: false }] }, null).length, 3);
});

test('boot text is typed from the lore and ends with the hint', () => {
  const lines = bootLines(['Welcome, intern.', 'Look around.']);
  assert.deepEqual(lines, ['Welcome, intern.', 'Look around.', '', 'Type help to begin.']);
  assert.deepEqual(bootLines([]), ['Type help to begin.']);
  assert.deepEqual(bootLines(undefined), ['Type help to begin.']);
  assert.deepEqual(revealLines(lines, 0), []);
  assert.deepEqual(revealLines(lines, 4), ['Welc']);
  assert.deepEqual(revealLines(lines, 17), ['Welcome, intern.']);
  assert.deepEqual(revealLines(lines, 20), ['Welcome, intern.', 'Loo']);
  assert.deepEqual(revealLines(lines, bootLength(lines)), lines);
  assert.deepEqual(revealLines(lines, 9999), lines);
});

test('the first blood banner is ASCII and fits a phone', () => {
  assert.equal(FIRST_BLOOD_BANNER.length, 11);
  assert.ok(FIRST_BLOOD_BANNER.every((line) => /^[ #]*$/.test(line)));
  assert.ok(Math.max(...FIRST_BLOOD_BANNER.map((line) => line.length)) <= 33);
  assert.equal(bannerWord('I').length, 5);
  assert.deepEqual(bannerWord('T'), ['#####', '  #', '  #', '  #', '  #'], 'trailing blanks are trimmed');
  assert.equal(bannerWord('?').join(''), '');
});

test('chips and cheat sheet only use known commands', () => {
  assert.deepEqual(QUICK_CHIPS.map((chip) => chip.label), ['ls', 'cd ..', 'cat', 'help', 'hint']);
  assert.equal(QUICK_CHIPS.find((chip) => chip.label === 'cat').text, 'cat ');
  for (const row of CHEAT_SHEET) {
    assert.ok(row.cmd && row.note);
    assert.ok(!/CTF\{[a-z0-9_]{6,}\}/i.test(row.cmd), 'no real-looking flags in the cheat sheet');
  }
  for (const needle of ['ls -la', 'cd ', 'cat ', 'head', 'tail', 'grep -r', 'find', 'sort', 'uniq -c', 'base64 -d', 'xxd', 'strings', 'file ', 'wc']) {
    assert.ok(CHEAT_SHEET.some((row) => row.cmd.includes(needle) || row.note.includes(needle)), needle);
  }
});

// ---------- challenge list integration ----------

test('terminal challenges are hidden from the grid and counted for the promo card', () => {
  const list = [
    { id: 'a', type: 'static', category: 'web', points: 100, solvedByMyTeam: false },
    { id: 't1', type: 'terminal', category: 'terminal', points: 40, solvedByMyTeam: true },
    { id: 't2', type: 'terminal', category: 'terminal', points: 40, solvedByMyTeam: false },
    { id: 'd', type: 'docker', category: 'misc', points: 50 },
  ];
  const { regular, terminal } = splitTerminalChallenges(list);
  assert.deepEqual(regular.map((c) => c.id), ['a', 'd']);
  assert.deepEqual(terminal, { count: 2, solved: 1, points: 80 });
  assert.deepEqual(splitTerminalChallenges([]), { regular: [], terminal: { count: 0, solved: 0, points: 0 } });
});

test('the terminal category sorts after the classic ones and does not break grouping', () => {
  assert.equal(CATEGORY_ORDER.at(-1), 'terminal');
  const groups = groupByCategory([
    { id: '1', category: 'terminal', points: 40 }, { id: '2', category: 'misc', points: 25 },
    { id: '3', category: 'zzz', points: 1 }, { id: '4', category: 'web', points: 10 },
  ]);
  assert.deepEqual(groups.map((g) => g.category), ['web', 'misc', 'terminal', 'zzz']);
});

test('unsolved codes are estimated from the base points, not from what is left after a first-blood bonus', () => {
  const progress = { total: 4, solved: [{ n: 1, title: 'Welcome Aboard', points: 44, firstBlood: true }] };
  const rows = buildCodeRows(progress, { codes: 4, points: 160 });
  assert.deepEqual(rows.filter((row) => !row.solved).map((row) => row.points), [40, 40, 40]);
  assert.equal(rows[0].points, 44);
});
