// Per-team puzzle values (docs/TERMINAL_GAME.md section 16): seedValue, {{seed:...}} tokens, the wide and md5
// filters, {{md5file:...}}, vault passphrases with tokens, and "flag tokens behave exactly as before".
import { createHash, createHmac } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, SEED_KINDS, seedValue } from '../../src/terminal/seed.js';
import { NAMES, WORDS } from '../../src/terminal/seedwords.js';
import {
  dir, file, binary, gzipDeterministic, readFileBytes, renderTokens, tokenSource, vault,
} from '../../src/terminal/vfs.js';
import { makeTestCtx, out, run } from './_helpers.js';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const md5 = (data) => createHash('md5').update(data).digest('hex');
const SEEDS = Array.from({ length: 200 }, (_, i) => sha(`seed-test-${i}`));
const REFERENCE = sha('reference-seed');
const ZEROS = '0'.repeat(32);

describe('word lists', () => {
  it('are fixed-size, distinct, lowercase ASCII and free of reserved names', () => {
    expect(WORDS).toHaveLength(256);
    expect(NAMES).toHaveLength(64);
    expect(new Set(WORDS).size).toBe(256);
    expect(new Set(NAMES).size).toBe(64);
    for (const item of [...WORDS, ...NAMES]) expect(item).toMatch(/^[a-z]{3,12}$/);
    for (const reserved of ['guest', 'root', 'admin', 'ctf', 'flag']) {
      expect(WORDS).not.toContain(reserved);
      expect(NAMES).not.toContain(reserved);
    }
    expect(WORDS.filter((word) => NAMES.includes(word))).toEqual([]);
  });
});

describe('seedValue', () => {
  it('is HMAC-SHA256 keyed by the seed over "kind:slot", reading the first 6 bytes', () => {
    const digest = (seed, kind, slot) => createHmac('sha256', seed).update(`${kind}:${slot}`).digest();
    const seed = 'some-team-seed';
    expect(seedValue(seed, 'word', 1)).toBe(WORDS[digest(seed, 'word', 1)[0]]);
    expect(seedValue(seed, 'user', 3)).toBe(NAMES[digest(seed, 'user', 3)[0] & 63]);
    expect(seedValue(seed, 'hex8', 2)).toBe(digest(seed, 'hex8', 2).subarray(0, 4).toString('hex'));
    const pass = digest(seed, 'pass', 1);
    expect(seedValue(seed, 'pass', 1)).toBe(`${WORDS[pass[0]]}-${WORDS[pass[1]]}-${1000 + (pass.readUInt16BE(2) % 9000)}`);
  });

  it('is deterministic and defaults the slot to 1', () => {
    for (const kind of SEED_KINDS) {
      expect(seedValue('abc', kind, 1)).toBe(seedValue('abc', kind, 1));
      expect(seedValue('abc', kind)).toBe(seedValue('abc', kind, 1));
      expect(seedValue('abc', kind, '01')).toBe(seedValue('abc', kind, 1));
    }
  });

  it('uses the default seed when none is given', () => {
    expect(DEFAULT_SEED).toBe('arena-default-seed');
    for (const seed of [undefined, null, '', 42]) {
      expect(seedValue(seed, 'pass', 1)).toBe(seedValue(DEFAULT_SEED, 'pass', 1));
    }
  });

  it('returns null for unknown kinds and bad slots', () => {
    for (const kind of ['bogus', 'WORD', '', 'constructor', '__proto__', 'toString', undefined, 5]) {
      expect(seedValue('abc', kind, 1)).toBeNull();
    }
    for (const slot of [-1, 1.5, 'x', NaN]) expect(seedValue('abc', 'word', slot)).toBeNull();
  });

  it('offers exactly the six documented kinds', () => {
    expect([...SEED_KINDS].sort()).toEqual(['hex8', 'ip', 'num4', 'pass', 'user', 'word']);
  });

  it('produces the documented formats and ranges', () => {
    const seen = { prefixes: new Set(), minIp: 999, maxIp: 0, minNum: 99999, maxNum: 0, words: new Set(), names: new Set() };
    for (let i = 0; i < 4000; i += 1) {
      const seed = sha(`format-${i}`);
      const word = seedValue(seed, 'word');
      expect(WORDS).toContain(word);
      seen.words.add(word);

      const pass = seedValue(seed, 'pass');
      const [first, second, digits] = pass.split('-');
      expect(WORDS).toContain(first);
      expect(WORDS).toContain(second);
      expect(digits).toMatch(/^[1-9]\d{3}$/);

      const ip = /^(198\.51\.100|203\.0\.113)\.(\d{1,3})$/.exec(seedValue(seed, 'ip'));
      expect(ip).not.toBeNull();
      seen.prefixes.add(ip[1]);
      seen.minIp = Math.min(seen.minIp, Number(ip[2]));
      seen.maxIp = Math.max(seen.maxIp, Number(ip[2]));

      const num = seedValue(seed, 'num4');
      expect(num).toMatch(/^[1-9]\d{3}$/);
      seen.minNum = Math.min(seen.minNum, Number(num));
      seen.maxNum = Math.max(seen.maxNum, Number(num));

      expect(seedValue(seed, 'hex8')).toMatch(/^[0-9a-f]{8}$/);
      const user = seedValue(seed, 'user');
      expect(NAMES).toContain(user);
      seen.names.add(user);
    }
    expect([...seen.prefixes].sort()).toEqual(['198.51.100', '203.0.113']);
    expect(seen.minIp).toBeGreaterThanOrEqual(2);
    expect(seen.maxIp).toBeLessThanOrEqual(250);
    expect(seen.minIp).toBeLessThanOrEqual(5);
    expect(seen.maxIp).toBeGreaterThanOrEqual(247);
    expect(seen.minNum).toBeGreaterThanOrEqual(1000);
    expect(seen.maxNum).toBeLessThanOrEqual(9999);
    expect(seen.minNum).toBeLessThanOrEqual(1010);
    expect(seen.maxNum).toBeGreaterThanOrEqual(9990);
    expect(seen.words.size).toBeGreaterThan(240); // every list entry is reachable, not just a few
    expect(seen.names.size).toBe(64);
  });

  it.each(SEED_KINDS)('%s: at least 95% of 200 other seeds give a different value than the reference seed', (kind) => {
    const reference = seedValue(REFERENCE, kind, 1);
    const different = SEEDS.filter((seed) => seedValue(seed, kind, 1) !== reference).length;
    expect(different).toBeGreaterThanOrEqual(190);
  });

  it.each(SEED_KINDS)('%s: slots are independent of each other', (kind) => {
    const different = SEEDS.filter((seed) => seedValue(seed, kind, 1) !== seedValue(seed, kind, 2)).length;
    expect(different).toBeGreaterThanOrEqual(190);
    // the same slot of the same seed never changes
    expect(seedValue(SEEDS[0], kind, 7)).toBe(seedValue(SEEDS[0], kind, 7));
  });

  it('kinds do not share a value stream (word and user of one slot are unrelated)', () => {
    const same = SEEDS.filter((seed) => WORDS.indexOf(seedValue(seed, 'word')) === NAMES.indexOf(seedValue(seed, 'user'))).length;
    expect(same).toBeLessThan(20);
  });
});

const flagFn = (n) => (n === 77 ? undefined : n === 78 ? '' : n === 79 ? (() => { throw new Error('boom'); })() : `CTF{test_${n}}`);
const sourceFor = (seed, extra = {}) => tokenSource(flagFn, { seed, ...extra });

describe('{{seed:KIND[:SLOT]}} tokens', () => {
  it('renders the value of seedValue for the source seed; no slot means slot 1', () => {
    const source = sourceFor('team-A');
    expect(renderTokens('{{seed:word}}', source)).toBe(seedValue('team-A', 'word', 1));
    expect(renderTokens('{{seed:word:1}}', source)).toBe(seedValue('team-A', 'word', 1));
    expect(renderTokens('{{seed:word:2}}', source)).toBe(seedValue('team-A', 'word', 2));
    expect(renderTokens('{{seed:pass:12}} / {{seed:ip}} / {{seed:num4:3}} / {{seed:hex8}} / {{seed:user:9}}', source))
      .toBe(`${seedValue('team-A', 'pass', 12)} / ${seedValue('team-A', 'ip', 1)} / ${seedValue('team-A', 'num4', 3)} / ${seedValue('team-A', 'hex8', 1)} / ${seedValue('team-A', 'user', 9)}`);
  });

  it('gives other teams other values and the same team the same value every time', () => {
    const a = renderTokens('{{seed:pass}}', sourceFor('team-A'));
    expect(renderTokens('{{seed:pass}}', sourceFor('team-A'))).toBe(a);
    expect(renderTokens('{{seed:pass}}', sourceFor('team-B'))).not.toBe(a);
  });

  it('falls back to the default seed for a plain function, no source or an empty seed', () => {
    const expected = seedValue(DEFAULT_SEED, 'pass', 1);
    expect(renderTokens('{{seed:pass}}', flagFn)).toBe(expected);
    expect(renderTokens('{{seed:pass}}', undefined)).toBe(expected);
    expect(renderTokens('{{seed:pass}}', null)).toBe(expected);
    expect(renderTokens('{{seed:pass}}', tokenSource(flagFn, { seed: '' }))).toBe(expected);
    expect(renderTokens('{{seed:pass}}', tokenSource(undefined, {}))).toBe(expected);
  });

  it('prints unknown kinds, bad slots and bad filters literally', () => {
    const source = sourceFor('team-A');
    for (const literal of [
      '{{seed:bogus}}', '{{seed:bogus:2}}', '{{seed:WORD}}', '{{seed:}}', '{{seed}}', '{{seed:word:x}}', '{{seed:word:1:2}}',
      '{{seed:word:1234567}}', '{{seed:word:-1}}', '{{seed:word|nope}}', '{{seed:word|slice:x}}', '{{seed:word|xor}}',
      '{{ seed:word }}', '{{seed:word }}', '{{seedling}}', '{{seed:__proto__}}', '{{seed:constructor}}',
    ]) {
      expect(renderTokens(literal, source), literal).toBe(literal);
    }
  });

  it('accepts every flag filter, in chains', () => {
    const source = sourceFor('team-A');
    const word = seedValue('team-A', 'word');
    const pass = seedValue('team-A', 'pass');
    expect(renderTokens('{{seed:pass|b64}}', source)).toBe(Buffer.from(pass).toString('base64'));
    expect(renderTokens('{{seed:pass|hex}}', source)).toBe(Buffer.from(pass).toString('hex'));
    expect(renderTokens('{{seed:word|rot13}}', source)).toBe(word.replace(/[a-z]/g, (ch) => String.fromCharCode(((ch.charCodeAt(0) - 97 + 13) % 26) + 97)));
    expect(renderTokens('{{seed:pass|rev}}', source)).toBe([...pass].reverse().join(''));
    expect(renderTokens('{{seed:word|upper}}', source)).toBe(word.toUpperCase());
    expect(renderTokens('{{seed:word|upper|lower}}', source)).toBe(word);
    expect(renderTokens('{{seed:pass|slice:0-3}}', source)).toBe(pass.slice(0, 3));
    expect(renderTokens('{{seed:pass|slice:2-}}', source)).toBe(pass.slice(2));
    expect(renderTokens('{{seed:pass|rev|b64}}', source)).toBe(Buffer.from([...pass].reverse().join('')).toString('base64'));
    const key = Buffer.from('K');
    expect(renderTokens('{{seed:word|xor:K}}', source)).toBe(Buffer.from(word).map((byte) => byte ^ key[0]).toString('hex'));
    const gz = renderTokens('{{seed:pass|gzb64}}', source);
    expect(gunzipSync(Buffer.from(gz, 'base64')).toString()).toBe(pass);
    expect(gz).toBe(gzipDeterministic(Buffer.from(pass)).toString('base64'));
  });

  it('adds the wide filter: UTF-16LE look, every char followed by a NUL byte', () => {
    const source = sourceFor('team-A');
    const value = seedValue('team-A', 'hex8');
    const wide = renderTokens('{{seed:hex8|wide}}', source);
    expect(wide).toHaveLength(value.length * 2);
    expect([...wide].every((ch, i) => (i % 2 === 0 ? ch === value[i / 2] : ch === '\u0000'))).toBe(true);
    expect(Buffer.from(wide, 'utf8').equals(Buffer.from(value, 'utf16le'))).toBe(true);
    expect(renderTokens('{{seed:hex8|wide|b64}}', source)).toBe(Buffer.from(value, 'utf16le').toString('base64'));
    expect(renderTokens('k={{seed:word|wide}}', source)).toBe(`k=${[...seedValue('team-A', 'word')].map((ch) => `${ch}\u0000`).join('')}`);
  });

  it('adds the md5 filter: md5 hex of the string', () => {
    const source = sourceFor('team-A');
    expect(renderTokens('{{seed:pass|md5}}', source)).toBe(md5(seedValue('team-A', 'pass')));
    expect(renderTokens('{{seed:pass|upper|md5}}', source)).toBe(md5(seedValue('team-A', 'pass').toUpperCase()));
    expect(renderTokens('{{seed:pass|md5|slice:0-8}}', source)).toBe(md5(seedValue('team-A', 'pass')).slice(0, 8));
    expect(renderTokens('{{flag:1|md5}}', source)).toBe(md5('CTF{test_1}'));
    expect(renderTokens('{{flag:1|wide}}', source)).toBe([...'CTF{test_1}'].map((ch) => `${ch}\u0000`).join(''));
  });

  it('mixes with flag tokens and plain text in one string', () => {
    const source = sourceFor('team-A');
    expect(renderTokens('a {{flag:2}} b {{seed:word}} c {{seed:word|upper}} d {{flag:3|rev}}', source))
      .toBe(`a CTF{test_2} b ${seedValue('team-A', 'word')} c ${seedValue('team-A', 'word').toUpperCase()} d }3_tset{FTC`);
  });
});

// The original renderer (before seed tokens existed), kept as the reference for "byte-identical".
const LEGACY_RE = /\{\{flag:(\d+)((?:\|[^|{}]*)*)\}\}/g;
function legacyFilter(value, spec) {
  const [name, ...rest] = spec.split(':');
  const arg = rest.join(':');
  switch (name) {
    case 'b64': return Buffer.from(value, 'utf8').toString('base64');
    case 'hex': return Buffer.from(value, 'utf8').toString('hex');
    case 'rot13': return value.replace(/[a-z]/gi, (ch) => {
      const base = ch <= 'Z' ? 65 : 97;
      return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
    });
    case 'rev': return Array.from(value).reverse().join('');
    case 'upper': return value.toUpperCase();
    case 'lower': return value.toLowerCase();
    case 'slice': {
      const match = /^(\d+)-(\d*)$/.exec(arg);
      if (!match) return null;
      return value.slice(Number(match[1]), match[2] === '' ? undefined : Number(match[2]));
    }
    case 'gzb64': return gzipDeterministic(Buffer.from(value, 'utf8')).toString('base64');
    case 'xor': {
      if (!arg) return null;
      const key = Buffer.from(arg, 'utf8');
      const bytes = Buffer.from(value, 'utf8');
      const result = Buffer.alloc(bytes.length);
      for (let i = 0; i < bytes.length; i += 1) result[i] = bytes[i] ^ key[i % key.length];
      return result.toString('hex');
    }
    default: return null;
  }
}
function legacyRender(text, flag) {
  if (typeof text !== 'string' || !text.includes('{{flag:') || typeof flag !== 'function') return text;
  return text.replace(LEGACY_RE, (whole, n, chain) => {
    let value;
    try { value = flag(Number(n)); } catch { return whole; }
    if (typeof value !== 'string' || value === '') return whole;
    for (const spec of chain.split('|').filter(Boolean)) {
      const next = legacyFilter(value, spec);
      if (next === null) return whole;
      value = next;
    }
    return value;
  });
}

describe('flag tokens are unchanged', () => {
  const corpus = [
    '', 'plain text', 'no tokens {{ at all }} here {x} {{}}', 'x {{flag:1}} y', '{{flag:1}}{{flag:2}}', '{{flag:1|b64}}', '{{flag:1|hex}}',
    '{{flag:1|rot13}}', '{{flag:1|rev|b64}}', '{{flag:2|slice:0-4}}', '{{flag:2|slice:3-}}', '{{flag:2|slice:x}}', '{{flag:2|slice:5-2}}',
    '{{flag:2|xor:K}}', '{{flag:2|xor}}', '{{flag:2|xor:key|hex}}', '{{flag:2|gzb64}}', '{{flag:2|nope}}', '{{flag:77}}', '{{flag:78}}',
    '{{flag:79}}', '{{flag:}}', '{{flag:x}}', '{{flag:1|}}', '{{flag:1||b64}}', '{{{flag:1}}}', '{{flag:1}', '{flag:1}}', '{{ flag:1 }}',
    '{{flag:1 }}', '{{FLAG:1}}', '{{flag:1|upper|lower}}', '{{flag:01}}', '{{flag:1|slice:0-3|hex}}', 'a{{flag:1|x{{flag:2}}',
    'line1 {{flag:1}}\nline2 {{flag:2|upper}}\nline3 {{flag:3|b64}}\n', '{{flag:1|b64|nope}}', '{{flag:1|slice:1-4|rev|upper}}',
    '{{flag:123456789012345}}', '{{flag:1|xor:a:b}}', '{{flag:2|slice:0-}}', 'CTF{decoy} {{flag:1}} CTF{nice_try}',
    'unicode é中 {{flag:1}} \u{1f600}',
  ];

  it('renders every old-style token and every malformed one exactly as the old renderer did', () => {
    for (const text of corpus) {
      const expected = legacyRender(text, flagFn);
      expect(renderTokens(text, flagFn), JSON.stringify(text)).toBe(expected);
      expect(renderTokens(text, sourceFor('whatever')), JSON.stringify(text)).toBe(expected);
      expect(renderTokens(text, sourceFor('another', { lookup: () => null, tick: () => {} })), JSON.stringify(text)).toBe(expected);
    }
  });

  it('leaves everything untouched when there is no flag function', () => {
    for (const text of corpus.filter((item) => !item.includes('{{seed') && !item.includes('md5file'))) {
      expect(renderTokens(text, undefined), JSON.stringify(text)).toBe(text);
      expect(renderTokens(text, 'nope'), JSON.stringify(text)).toBe(text);
      expect(renderTokens(text, tokenSource(undefined, { seed: 'x' })), JSON.stringify(text)).toBe(text);
    }
  });

  it('returns text without any token as the very same string, and non-strings as they are', () => {
    for (const text of ['abc', '{{ x }}', '{{seedling}}', '{{flagged}}', '{{md5filed}}', '{{md5file}}', '{{seed}}']) {
      expect(renderTokens(text, sourceFor('x'))).toBe(text);
    }
    expect(renderTokens(5, flagFn)).toBe(5);
    expect(renderTokens(undefined, flagFn)).toBeUndefined();
  });

  it('keeps file bytes identical for token-free files and caches only those', () => {
    const plain = file('hello {{ world }}\n');
    expect(readFileBytes(plain).toString()).toBe('hello {{ world }}\n');
    expect(readFileBytes(plain)).toBe(readFileBytes(plain));
    const withFlag = file('flag={{flag:1}}\n');
    expect(readFileBytes(withFlag, { flag: flagFn }).toString()).toBe('flag=CTF{test_1}\n');
    const bin = binary(Buffer.from([1, 2, 3]).toString('base64'));
    expect([...readFileBytes(bin, { flag: flagFn })]).toEqual([1, 2, 3]);
  });

  it('never reuses a rendered file for another seed', () => {
    const node = file('pw={{seed:pass}}\n');
    const a1 = readFileBytes(node, { flag: sourceFor('A') }).toString();
    const b = readFileBytes(node, { flag: sourceFor('B') }).toString();
    const a2 = readFileBytes(node, { flag: sourceFor('A') }).toString();
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toBe(`pw=${seedValue('A', 'pass')}\n`);
  });
});

describe('{{md5file:/abs/path}}', () => {
  const nodes = {
    '/data/a.txt': file('hello\n'),
    '/data/tokens.txt': file('flag={{flag:1}} pw={{seed:pass:2}}\n'),
    '/data/blob.bin': binary(Buffer.from([0, 255, 1, 2, 3]).toString('base64')),
    '/data/empty': file(''),
    '/data': dir({}),
  };
  const lookup = (path) => nodes[path] ?? null;
  const source = (seed = 'team-A', extra = {}) => tokenSource(flagFn, { seed, lookup, ...extra });

  it('is the md5 of the rendered bytes of the file', () => {
    expect(renderTokens('{{md5file:/data/a.txt}}', source())).toBe(md5('hello\n'));
    expect(renderTokens('{{md5file:/data/empty}}', source())).toBe(md5(''));
    expect(renderTokens('{{md5file:/data/blob.bin}}', source())).toBe(md5(Buffer.from([0, 255, 1, 2, 3])));
    expect(renderTokens('{{md5file:/data/tokens.txt}}', source('team-A')))
      .toBe(md5(`flag=CTF{test_1} pw=${seedValue('team-A', 'pass', 2)}\n`));
  });

  it('changes with the seed when the file has seed tokens, and not when it has none', () => {
    const a = renderTokens('{{md5file:/data/tokens.txt}}', source('team-A'));
    const b = renderTokens('{{md5file:/data/tokens.txt}}', source('team-B'));
    expect(a).not.toBe(b);
    expect(renderTokens('{{md5file:/data/a.txt}}', source('team-A'))).toBe(renderTokens('{{md5file:/data/a.txt}}', source('team-B')));
  });

  it('prints 32 zeros for unknown paths, directories, relative paths and a missing resolver', () => {
    for (const path of ['/nope', '/data', '/data/', 'data/a.txt', '', '/data/a.txt/x']) {
      expect(renderTokens(`{{md5file:${path}}}`, source()), path).toBe(ZEROS);
    }
    expect(renderTokens('{{md5file:/data/a.txt}}', flagFn)).toBe(ZEROS);
    expect(renderTokens('{{md5file:/data/a.txt}}', undefined)).toBe(ZEROS);
    expect(renderTokens('{{md5file:/data/a.txt}}', tokenSource(flagFn, { seed: 'x' }))).toBe(ZEROS);
  });

  it('accepts filters and ignores a bad one literally', () => {
    expect(renderTokens('{{md5file:/data/a.txt|upper}}', source())).toBe(md5('hello\n').toUpperCase());
    expect(renderTokens('{{md5file:/data/a.txt|slice:0-6}}', source())).toBe(md5('hello\n').slice(0, 6));
    expect(renderTokens('{{md5file:/data/a.txt|nope}}', source())).toBe('{{md5file:/data/a.txt|nope}}');
  });

  it('charges the work budget for the bytes it hashes', () => {
    const big = file('x'.repeat(3000));
    const ticks = [];
    const tick = (units) => ticks.push(units);
    const src = tokenSource(flagFn, { seed: 's', tick, lookup: (path) => (path === '/big' ? big : null) });
    renderTokens('{{md5file:/big}} {{md5file:/big}}', src);
    expect(ticks).toEqual([3, 3]);
  });

  it('cannot recurse: a md5file token inside a hashed file prints zeros', () => {
    const loop = {
      '/A': file('a:{{md5file:/B}}\n'),
      '/B': file('b:{{md5file:/A}}\n'),
      '/S': file('self {{md5file:/S}}\n'),
      '/C': file('c {{md5file:/A}} {{flag:2}}\n'),
    };
    const src = tokenSource(flagFn, { seed: 's', lookup: (path) => loop[path] ?? null });
    const render = (path) => readFileBytes(loop[path], { flag: src }).toString();
    expect(render('/A')).toBe(`a:${md5(`b:${ZEROS}\n`)}\n`);
    expect(render('/B')).toBe(`b:${md5(`a:${ZEROS}\n`)}\n`);
    expect(render('/S')).toBe(`self ${md5(`self ${ZEROS}\n`)}\n`);
    expect(render('/C')).toBe(`c ${md5(`a:${ZEROS}\n`)} CTF{test_2}\n`);
  });

  it('works end to end in the shell and agrees with md5sum, for every seed', async () => {
    const fs = () => dir({
      home: dir({
        guest: dir({
          'ref.txt': file('{{md5file:/home/guest/data.txt}}  data.txt\n'),
          'data.txt': file('secret={{seed:pass:2}} flag={{flag:1}}\n'),
          link: dir({ 'to-data': { type: 'link', mode: 0o777, owner: 'guest', group: 'guest', mtime: '2024-03-14T09:26:53Z', target: '/home/guest/data.txt' } }),
          'viaLink.txt': file('{{md5file:/home/guest/link/to-data}}\n'),
          'hidden.txt': file('{{md5file:/root/secret.txt}}\n'),
          loop: file('a {{md5file:/home/guest/loop}}\n'),
        }),
      }),
      root: dir({ 'secret.txt': file('top secret {{seed:word}}\n', { mode: 0o600, owner: 'root', group: 'root' }) }, { mode: 0o700, owner: 'root', group: 'root' }),
    }, { owner: 'root', group: 'root' });
    const seen = new Set();
    for (const seed of SEEDS.slice(0, 20)) {
      const ctx = () => makeTestCtx({ fs: fs(), seed });
      const ref = await out('cat ref.txt', ctx());
      const sum = await out('md5sum data.txt', ctx());
      expect(ref).toBe(sum);
      expect(await out('cat viaLink.txt', ctx())).toBe(sum.split(' ')[0]);
      // the file is readable by the token even though the player cannot read it, and it is the rendered md5
      expect(await out('cat hidden.txt', ctx())).toBe(md5(`top secret ${seedValue(seed, 'word')}\n`));
      expect(await out('cat loop', ctx())).toBe(`a ${md5(`a ${ZEROS}\n`)}`);
      seen.add(ref);
    }
    expect(seen.size).toBe(20);
  });

  it('only sees the mode tree, never what the player wrote to /tmp during the command line', async () => {
    const fs = dir({ home: dir({ guest: dir({ 'ref.txt': file('{{md5file:/tmp/x}}\n') }) }) }, { owner: 'root', group: 'root' });
    expect(await out('echo hi > /tmp/x; cat ref.txt', makeTestCtx({ fs }))).toBe(ZEROS);
  });
});

// A small tree full of seed tokens for the end-to-end checks.
const seedFs = () => dir({
  home: dir({
    guest: dir({
      'note.txt': file('pass={{seed:pass}} ip={{seed:ip}} user={{seed:user}} n={{seed:num4:2}} h={{seed:hex8}}\n'),
      'plain.txt': file('nothing here {{ not a token }} {{seedling}}\n'),
      'wide.bin': file('{{seed:hex8|wide}}'),
      'box.vault': vault('plain says {{seed:word}} and {{flag:2}}', '{{seed:pass}}'),
      'upper.vault': vault('second', '{{seed:word|upper}}-{{seed:num4}}'),
    }),
  }),
}, { owner: 'root', group: 'root' });

const seeded = (seed, mode = {}) => makeTestCtx({ fs: seedFs(), seed, mode });
const noteFor = (seed) => `pass=${seedValue(seed, 'pass')} ip=${seedValue(seed, 'ip')} user=${seedValue(seed, 'user')} n=${seedValue(seed, 'num4', 2)} h=${seedValue(seed, 'hex8')}`;

describe('seed tokens in the shell', () => {
  it('render in file content, differently per team and identically on every request', async () => {
    const [a, b] = SEEDS;
    expect(await out('cat note.txt', seeded(a))).toBe(noteFor(a));
    expect(await out('cat note.txt', seeded(a))).toBe(noteFor(a));
    expect(await out('cat note.txt', seeded(b))).toBe(noteFor(b));
    expect(noteFor(a)).not.toBe(noteFor(b));
  });

  it('use the engine default seed when ctx.seed is missing, and leave non-tokens alone', async () => {
    expect(await out('cat note.txt', seeded(undefined))).toBe(noteFor(DEFAULT_SEED));
    expect(await out('cat plain.txt', seeded('x'))).toBe('nothing here {{ not a token }} {{seedling}}');
  });

  it('are seen by grep, wc, strings and xxd as ordinary content', async () => {
    const seed = SEEDS[3];
    expect(await out('grep -o "pass=[a-z0-9-]*" note.txt', seeded(seed))).toBe(`pass=${seedValue(seed, 'pass')}`);
    const length = Buffer.byteLength(noteFor(seed)) + 1;
    expect(await out('wc -c < note.txt', seeded(seed))).toBe(String(length));
    expect(await out('wc -c note.txt', seeded(seed))).toContain(`${length} note.txt`);
    expect(await out('ls -l note.txt', seeded(seed))).toContain(` ${length} `);
  });

  it('render the wide filter into real NUL bytes that strings does not show but xxd does', async () => {
    const seed = SEEDS[4];
    const value = seedValue(seed, 'hex8');
    expect(await out('strings wide.bin', seeded(seed))).toBe('');
    expect(await out('xxd -p wide.bin', seeded(seed))).toBe(Buffer.from(value, 'utf16le').toString('hex'));
  });

  it('render in mode.env, mode.extraCommands, mode.processes and the motd', async () => {
    const seed = SEEDS[5];
    const mode = {
      env: { SESSION_USER: '{{seed:user}}' },
      extraCommands: { crontab: '* * * * * {{seed:user}} /opt/{{seed:word}}.sh', who: '{{seed:user}} pts/0 {{seed:ip}}', mystery: 'ip {{seed:ip:2}}' },
      processes: 'PID USER CMD\n7 {{seed:user}} sleep {{seed:num4}}',
      motd: 'welcome {{seed:user}}',
    };
    const ctx = () => seeded(seed, mode);
    const user = seedValue(seed, 'user');
    expect(await out('printenv SESSION_USER', ctx())).toBe(user);
    expect(await out('echo $SESSION_USER', ctx())).toBe(user);
    expect(await out('crontab -l', ctx())).toBe(`* * * * * ${user} /opt/${seedValue(seed, 'word')}.sh`);
    expect(await out('who', ctx())).toBe(`${user} pts/0 ${seedValue(seed, 'ip')}`);
    expect(await out('mystery', ctx())).toBe(`ip ${seedValue(seed, 'ip', 2)}`);
    expect(await out('ps', ctx())).toContain(`7 ${user} sleep ${seedValue(seed, 'num4')}`);
    expect(await out('motd', ctx())).toBe(`welcome ${user}`);
  });

  it('are not rendered when the player types them (only stored data is a token)', async () => {
    expect(await out('echo "{{seed:word}}"', seeded('x'))).toBe('{{seed:word}}');
    expect(await out('echo "{{seed:word}}" > /tmp/t; cat /tmp/t', seeded('x'))).toBe('{{seed:word}}');
  });
});

describe('vault passphrases and plaintext with seed tokens', () => {
  const pass = (seed) => seedValue(seed, 'pass');

  it('open with this team passphrase and print the rendered plaintext', async () => {
    const seed = SEEDS[7];
    expect(await out(`vault open box.vault ${pass(seed)}`, seeded(seed))).toBe(`plain says ${seedValue(seed, 'word')} and CTF{test_2}`);
    const second = `${seedValue(seed, 'word').toUpperCase()}-${seedValue(seed, 'num4')}`;
    expect(await out(`vault open upper.vault ${second}`, seeded(seed))).toBe('second');
  });

  it('refuse the literal token text, another team passphrase and the wrong case', async () => {
    const seed = SEEDS[8];
    const other = SEEDS[9];
    for (const attempt of ['{{seed:pass}}', "'{{seed:pass}}'", pass(other), pass(seed).toUpperCase(), `${pass(seed)} `, '']) {
      const result = await run(`vault open box.vault "${attempt}"`, seeded(seed));
      expect(result.output, attempt).toBe('vault: wrong passphrase');
      expect(result.exit).toBe(1);
    }
    expect(await out(`vault open box.vault ${pass(seed)}`, seeded(other))).toBe('vault: wrong passphrase');
  });

  it('use the default seed passphrase when ctx.seed is missing', async () => {
    expect(await out(`vault open box.vault ${pass(DEFAULT_SEED)}`, seeded(undefined))).toContain('plain says');
  });

  it('show the same ARENAVAULT1 blob to every team, so the file reveals nothing about the passphrase', async () => {
    const a = await out('cat box.vault', seeded(SEEDS[10]));
    const b = await out('cat box.vault', seeded(SEEDS[11]));
    expect(a).toBe(b);
    expect(a.startsWith('ARENAVAULT1\n')).toBe(true);
    expect(a).not.toContain(pass(SEEDS[10]));
  });

  it('keep the usage and permission messages', async () => {
    expect(await out('vault open box.vault', seeded('x'))).toContain('usage: vault open');
    expect(await out('vault open nothing.vault abc', seeded('x'))).toContain('No such file or directory');
    expect(await out('vault open note.txt abc', seeded('x'))).toContain('not a vault file');
  });
});

describe('plain vaults (no tokens) still work as before', () => {
  it('opens opt/box.vault of the sample tree with its fixed passphrase for any seed', async () => {
    for (const seed of [undefined, SEEDS[0], SEEDS[1]]) {
      expect(await out('vault open /opt/box.vault hunter2', makeTestCtx({ seed }))).toBe('vault says CTF{test_4}');
      expect(await out('vault open /opt/box.vault hunter3', makeTestCtx({ seed }))).toBe('vault: wrong passphrase');
    }
  });
});
