import { describe, expect, it } from 'vitest';
import {
  LIMITS, PatternError, compilePattern, globalRegExp,
} from '../../src/terminal/limits.js';
import { dir, file } from '../../src/terminal/vfs.js';
import { rng, int, pick } from '../../src/terminal/gen.js';
import { makeTestCtx, run } from './_helpers.js';

// Regression tests for the ReDoS in the Arena Terminal regex engine (patterns like `.*.*.*.*.*.*Z` used to
// take 20+ seconds on V8's backtracking RegExp). Every command below must now finish well under a second,
// returning either a correct result or the standard resource-limit message.
const LIMIT_MS = 500;
const HOSTILE = 'a'.repeat(40);

function ctxWithFiles() {
  const lines = `${HOSTILE}\n${'ab'.repeat(20)}\n`;
  return makeTestCtx({
    fs: dir({
      home: dir({ guest: dir({ evil: file(lines.repeat(4)), 'a.txt': file(`${HOSTILE}\n`) }) }),
      etc: dir({
        passwd: file('root:x:0:0:root:/root:/bin/bash\n'.repeat(30)),
        hosts: file('127.0.0.1 localhost\n'.repeat(30)),
        'os-release': file('NAME="Arena"\n'.repeat(30)),
      }),
    }, { owner: 'root', group: 'root' }),
  });
}

async function timed(line) {
  const started = performance.now();
  const result = await run(line, ctxWithFiles());
  return { ms: performance.now() - started, ...result };
}

const repeat = (unit, n) => unit.repeat(n);

describe('regex engine is immune to catastrophic backtracking', () => {
  it('grep -E with six and twelve sequential .* returns quickly and correctly', async () => {
    for (const n of [6, 8, 12]) {
      const { ms, output } = await timed(`grep -E '${repeat('.*', n)}Z' /etc/passwd /etc/hosts /etc/os-release`);
      expect(ms).toBeLessThan(LIMIT_MS);
      expect(output).toBe(''); // there is no Z anywhere
    }
  });

  it('grep -E finds a real match through the same pattern', async () => {
    const { ms, output } = await timed(`grep -c -E '${repeat('.*', 12)}root' /etc/passwd`);
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(output).toBe('30');
  });

  it('sed -E with many .* returns quickly and leaves the line alone', async () => {
    const { ms, output } = await timed(`echo ${HOSTILE} | sed -E 's/${repeat('.*', 8)}Z//'`);
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(output).toBe(HOSTILE);
  });

  it('sed -E substitutes correctly with adjacent repeats and groups', async () => {
    const { output } = await timed("echo 'abcabc' | sed -E 's/(b.*)(c.*)/[\\1|\\2]/'");
    expect(output).toBe('a[bcab|c]');
  });

  it('awk match() and ~ are bounded', async () => {
    const pat = `${repeat('.*', 10)}Z`;
    const first = await timed(`echo ${HOSTILE} | awk '{ print match($0, /${pat}/) }'`);
    expect(first.ms).toBeLessThan(LIMIT_MS);
    expect(first.output).toBe('0');
    const second = await timed(`echo ${HOSTILE} | awk '$0 ~ /${pat}/ { print "hit" }'`);
    expect(second.ms).toBeLessThan(LIMIT_MS);
    expect(second.output).toBe('');
  });

  it('awk gsub and split with hostile patterns are bounded', async () => {
    const pat = `${repeat('.*', 10)}Z`;
    const { ms } = await timed(`echo ${HOSTILE} | awk '{ gsub(/${pat}/, "x"); print }'`);
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  it('find -regex is bounded', async () => {
    const { ms } = await timed(`find / -regex '${repeat('.*', 12)}Z'`);
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  it('alternation variants are bounded', async () => {
    const patterns = [
      `${repeat('(a|b)*', 8)}Z`,
      `${repeat('(a|ab)*', 6)}Z`,
      `${repeat('(a|b)+', 8)}Z`,
      `(${repeat('a?', 20)})${repeat('a', 20)}Z`,
      `(a|aa)+Z`,
      `${repeat('[ab]*', 10)}Z`,
      `${repeat('a?', 25)}${repeat('a', 25)}Z`,
      `.{0,40}.{0,40}.{0,40}.{0,40}Z`,
      `(.{1,10}){1,10}Z`,
    ];
    for (const pattern of patterns) {
      const { ms, output } = await timed(`grep -E '${pattern}' evil`);
      expect(ms, pattern).toBeLessThan(LIMIT_MS);
      expect(output.length === 0 || output === 'bash: resource limit exceeded' || output.startsWith('grep:'), pattern).toBe(true);
    }
  });

  it('nested groups and backreference-like patterns are rejected or bounded', async () => {
    for (const pattern of ['(a+)+Z', '(a*)*Z', '((a+)+)+Z', '(a|a)*Z', '(.*a){12}Z', '(.*)\\1Z']) {
      const { ms, output } = await timed(`grep -E '${pattern}' evil`);
      expect(ms, pattern).toBeLessThan(LIMIT_MS);
      expect(output, pattern).toMatch(/^$|unsupported pattern|resource limit/);
    }
  });

  it('a single match call never exceeds the step cap', () => {
    // Program size 2 * 1000 + stays under MAX_PROGRAM, subject long enough to need more than MAX_REGEX_STEPS.
    const compiled = compilePattern('[a-z]{1000}[a-z]{1000}Z', { flavor: 'ere' });
    const started = performance.now();
    expect(() => compiled.re.test('a'.repeat(50_000))).toThrow(/resource limit/);
    expect(performance.now() - started).toBeLessThan(LIMIT_MS * 2);
  });

  it('oversized repeat expansion is refused at compile time', () => {
    expect(() => compilePattern('(a{1,1000}b){1,5}', { flavor: 'ere' })).toThrow(PatternError);
    expect(LIMITS.MAX_PROGRAM).toBeGreaterThan(1000);
  });

  it('regex work is charged to the command line budget', async () => {
    const lines = `${'x'.repeat(200)}\n`.repeat(3000);
    const ctx = makeTestCtx({ fs: dir({ home: dir({ guest: dir({ big: file(lines) }) }) }) });
    const started = performance.now();
    const result = await run(`for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do grep -E '[a-z]*[a-z]*[a-z]*y' big; done`, ctx);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result.output).toBe('bash: resource limit exceeded');
    expect(result.exit).toBe(137);
  });
});

describe('regex engine semantics (the legitimate cases must stay identical)', () => {
  const cases = [
    ['^.*foo.*$', 'ere', 'xx foo yy', 'xx foo yy'],
    ['[a-z]+@[a-z]+\\.com', 'ere', 'mail bob@site.com now', 'bob@site.com'],
    ['(ab)+', 'ere', 'xababab', 'ababab'],
    ['a|b|c', 'ere', 'zzc', 'c'],
    ['colou?r', 'ere', 'the color', 'color'],
    ['a{2,3}', 'ere', 'caaaat', 'aaa'],
    ['a{2,3}?', 'pcre', 'caaaat', 'aa'],
    ['a+?', 'pcre', 'caaa', 'a'],
    ['\\bcat\\b', 'ere', 'a cat sat', 'cat'],
    ['\\<s', 'ere', 'a sat', 's'],
    ['t\\>', 'ere', 'sat on', 't'],
    ['[[:digit:]]+', 'ere', 'ab123cd', '123'],
    ['([0-9]+\\.){3}[0-9]+', 'ere', 'ip 10.0.0.1!', '10.0.0.1'],
    ['(foo|foobar)', 'ere', 'foobar', 'foo'],
    ['x*', 'ere', 'abc', ''],
  ];
  for (const [pattern, flavor, subject, expected] of cases) {
    it(`${flavor} /${pattern}/ on "${subject}"`, () => {
      const m = compilePattern(pattern, { flavor }).re.exec(subject);
      expect(m && m[0]).toBe(expected);
      const native = new RegExp(pattern.replace(/\[\[:digit:\]\]/g, '[0-9]').replace(/\\</g, '\\b(?=\\w)').replace(/\\>/g, '\\b(?<=\\w)')).exec(subject);
      expect(native && native[0]).toBe(expected);
    });
  }

  it('reports capture groups and match index like RegExp', () => {
    const m = compilePattern('(a+)(x)?(b+)', { flavor: 'ere' }).re.exec('zzaabb');
    expect([...m]).toEqual(['aabb', 'aa', undefined, 'bb']);
    expect(m.index).toBe(2);
  });

  it('numbers groups across multiple patterns and honours ignore case, word and line', () => {
    expect(compilePattern(['a', 'b'], { flavor: 'ere' }).re.test('b')).toBe(true);
    expect(compilePattern('ABC', { ignoreCase: true }).re.test('xabcx')).toBe(true);
    expect(compilePattern('abc', { word: true }).re.test('xabcx')).toBe(false);
    expect(compilePattern('abc', { word: true }).re.test('x abc-y')).toBe(true);
    expect(compilePattern('abc', { line: true }).re.test('abcd')).toBe(false);
    expect(compilePattern('a.c', { fixed: true }).re.test('abc')).toBe(false);
  });

  it('global iteration advances through every match', () => {
    const re = globalRegExp(compilePattern('[0-9]+', { flavor: 'ere' }));
    const found = [];
    for (let m = re.exec('a1 b22 c333'); m; m = re.exec('a1 b22 c333')) found.push(m[0]);
    expect(found).toEqual(['1', '22', '333']);
  });

  it('agrees with RegExp on random safe patterns', () => {
    const rand = rng(7);
    const atoms = ['a', 'b', '.', '[ab]', '[^a]', 'x'];
    const quants = ['', '', '*', '+', '?', '{1,2}'];
    for (let i = 0; i < 300; i += 1) {
      let src = '';
      const parts = int(rand, 1, 4);
      for (let p = 0; p < parts; p += 1) src += pick(rand, atoms) + pick(rand, quants);
      if (int(rand, 0, 3) === 0) src = `(${src})|b`;
      const subject = Array.from({ length: int(rand, 0, 8) }, () => pick(rand, ['a', 'b', 'x', 'c'])).join('');
      let compiled;
      try { compiled = compilePattern(src, { flavor: 'ere' }); } catch (error) {
        if (error instanceof PatternError) continue;
        throw error;
      }
      const expected = new RegExp(src.replace(/\./g, '[^\\n]')).exec(subject);
      const actual = compiled.re.exec(subject);
      expect(actual && [actual.index, actual[0]], `${src} on ${subject}`).toEqual(expected && [expected.index, expected[0]]);
    }
  });
});

describe('fuzz: no pattern shape is slow on a hostile subject', () => {
  it('200 random pattern shapes finish within the time bound', () => {
    const rand = rng(1234);
    const atoms = ['a', '.', '.', '[ab]', '[^b]', '(a|b)', '(ab|b)', 'a?', '\\w', '[a-z]', '\\W', '(a|ab)'];
    const quants = ['', '*', '+', '?', '{0,9}', '{2,}', '{1,30}', '*', '+'];
    let compiledCount = 0;
    const started = performance.now();
    let worst = 0;
    for (let i = 0; i < 200; i += 1) {
      let src = '';
      const parts = int(rand, 2, 14);
      for (let p = 0; p < parts; p += 1) src += pick(rand, atoms) + pick(rand, quants);
      src += pick(rand, ['Z', '$', 'Zq', '']);
      if (src.length > LIMITS.MAX_PATTERN) src = src.slice(0, LIMITS.MAX_PATTERN);
      let compiled;
      try { compiled = compilePattern(src, { flavor: 'ere' }); } catch (error) {
        if (error instanceof PatternError) continue;
        throw error;
      }
      compiledCount += 1;
      const t0 = performance.now();
      try {
        compiled.re.test(HOSTILE);
        const g = globalRegExp(compiled);
        let guard = 0;
        for (let m = g.exec(HOSTILE); m && guard < 100; m = g.exec(HOSTILE)) { guard += 1; if (m[0] === '') g.lastIndex += 1; }
      } catch (error) {
        expect(error.name).toBe('ResourceLimitError');
      }
      const dt = performance.now() - t0;
      worst = Math.max(worst, dt);
      expect(dt, src).toBeLessThan(LIMIT_MS);
    }
    expect(compiledCount).toBeGreaterThan(40);
    expect(performance.now() - started).toBeLessThan(LIMIT_MS * 10);
    expect(worst).toBeLessThan(LIMIT_MS);
  });
});
