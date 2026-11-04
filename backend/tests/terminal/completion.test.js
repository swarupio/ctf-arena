import { describe, expect, it } from 'vitest';
import { COMMAND_NAMES, complete } from '../../src/terminal/shell.js';
import { dir, file } from '../../src/terminal/vfs.js';
import { makeTestCtx } from './_helpers.js';

const ctx = () => makeTestCtx();

describe('Tab completion', () => {
  it('completes command names at the start of a line', () => {
    expect(complete('ech', ctx())).toContain('echo');
    expect(complete('gre', ctx())).toEqual(['grep']);
    expect(complete('', ctx()).length).toBeGreaterThan(30);
    expect(complete('zzz', ctx())).toEqual([]);
    expect(COMMAND_NAMES).toContain('ls');
    expect(COMMAND_NAMES).toEqual([...COMMAND_NAMES].sort());
  });

  it('completes command names after pipes, semicolons and &&', () => {
    expect(complete('cat notes.txt | gre', ctx())).toEqual(['grep']);
    expect(complete('echo hi; sor', ctx())).toEqual(['sort']);
    expect(complete('true && uni', ctx())).toContain('uniq');
    expect(complete('A=1 gre', ctx())).toEqual(['grep']);
  });

  it('completes paths relative to the working directory', () => {
    expect(complete('cat READ', ctx())).toEqual(['README.txt']);
    expect(complete('cat no', ctx())).toEqual(['noread.txt', 'notes.txt']);
    expect(complete('ls docs/s', ctx())).toEqual(['docs/sub/']);
    expect(complete('ls docs/', ctx())).toEqual(['docs/a.txt', 'docs/b.txt', 'docs/old.txt', 'docs/sub/']);
    expect(complete('cat nothing', ctx())).toEqual([]);
    expect(complete('cat ../../etc/pa', ctx())).toEqual(['../../etc/passwd']);
    expect(complete('cat /et', ctx())).toEqual(['/etc/']);
    expect(complete('ls ./do', ctx())).toEqual(['./docs/']);
  });

  it('marks directories with a slash, including symlinks to directories', () => {
    expect(complete('ls dir', ctx())).toEqual(['dirlink/']);
    expect(complete('ls li', ctx())).toEqual(['link']);
  });

  it('only offers directories for cd', () => {
    expect(complete('cd d', ctx())).toEqual(['dirlink/', 'docs/']);
    expect(complete('cd no', ctx())).toEqual([]);
    expect(complete('cat d', ctx())).toEqual(['data.csv', 'dirlink/', 'docs/', 'dangling'].sort());
  });

  it('hides dotfiles unless the fragment starts with a dot', () => {
    expect(complete('cat ', ctx())).not.toContain('.hidden');
    expect(complete('cat .h', ctx())).toEqual(['.hidden']);
    expect(complete('cat .', ctx())).toEqual(['.hidden']);
  });

  it('expands ~ and keeps it in the result', () => {
    expect(complete('ls ~/do', ctx())).toEqual(['~/docs/']);
    expect(complete('cat ~/READ', ctx())).toEqual(['~/README.txt']);
  });

  it('escapes spaces and honours open quotes', () => {
    expect(complete('cat spa', ctx())).toEqual(['spaces\\ here.txt']);
    expect(complete("cat 'spa", ctx())).toEqual(["'spaces here.txt"]);
    expect(complete('cat "spa', ctx())).toEqual(['"spaces here.txt']);
    expect(complete('cat spaces\\ h', ctx())).toEqual(['spaces\\ here.txt']);
  });

  it('does not list unreadable directories', () => {
    expect(complete('ls private/', ctx())).toEqual([]);
    expect(complete('ls /root/', ctx())).toEqual([]);
    expect(complete('ls /var/secure/', ctx())).toEqual([]);
  });

  it('returns at most 50 matches and never throws', () => {
    const files = {};
    for (let i = 0; i < 80; i += 1) files[`file${String(i).padStart(2, '0')}`] = file('x');
    const many = makeTestCtx({ fs: dir({ home: dir({ guest: dir(files) }) }) });
    expect(complete('cat f', many)).toHaveLength(50);
    expect(complete('cat file7', many)).toHaveLength(10);
    expect(complete(undefined, ctx())).toBeInstanceOf(Array);
    expect(complete('cat \\', ctx())).toBeInstanceOf(Array);
    expect(complete('ls a'.repeat(100), ctx())).toEqual([]);
    expect(complete('cat x', {})).toEqual([]);
    expect(complete('cat x', null)).toEqual([]);
  });

  it('works from another directory', () => {
    expect(complete('cat a', makeTestCtx({ cwd: '/home/guest/docs' }))).toEqual(['a.txt']);
    expect(complete('cat s', makeTestCtx({ cwd: '/home/guest/docs' }))).toEqual(['sub/']);
  });
});
