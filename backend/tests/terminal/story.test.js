// The living story (docs/ARENA_TERMINAL.md section 18): mail unlocks with progress, names are per team, nothing leaks.
import { describe, expect, it } from 'vitest';
import { MODE_NAMES, MODES } from '../../src/terminal/modes/index.js';
import { seedValue } from '../../src/terminal/seed.js';
import { complete, execute } from '../../src/terminal/shell.js';
import {
  castFor, mailboxText, mailsFor, storyContext, withStory,
} from '../../src/terminal/story.js';
import { makeTestCtx, stripAnsi } from './_helpers.js';

const flagFor = (mode) => (n) => `CTF{real_${mode}_${n}_deadbeefcafe}`;
const seedOf = (label) => `team-seed-${label}`;

function ctxFor(mode, { solved = [], storySeed = seedOf('A'), seed = seedOf('puzzle-A'), mailSeen } = {}) {
  const ctx = makeTestCtx({ mode: MODES[mode], flags: flagFor(mode), solved, seed, cwd: MODES[mode].home });
  return { ...ctx, storySeed, ...(mailSeen === undefined ? {} : { mailSeen }) };
}

const LOGS = { easy: 'novi.log', medium: 'incident-desk.log', hard: 'soc-escalation.log' };
const say = async (line, ctx) => stripAnsi((await execute(line, ctx)).output);
const subsets = (codes) => [[], [codes[0]], [codes[codes.length - 1]], codes.slice(0, 2), [codes[1], codes[0]], codes];

describe('mail unlocks exactly with progress', () => {
  for (const name of MODE_NAMES) {
    const codes = MODES[name].codes.map((code) => code.n);
    const total = codes.length;
    it(`${name}: ids are 1, n + 1 for every solved code n, and ${total + 2} only when all are solved`, () => {
      for (const solved of subsets(codes)) {
        const ids = mailsFor(MODES[name], { storySeed: seedOf('A'), solved }).map((mail) => mail.id);
        const expected = [1, ...[...solved].sort((a, b) => a - b).map((n) => n + 1), ...(solved.length === total ? [total + 2] : [])];
        expect(ids, JSON.stringify(solved)).toEqual(expected);
      }
    });

    it(`${name}: the mail command lists exactly the unlocked messages and refuses the locked ones`, async () => {
      const solved = [codes[0]];
      const ctx = ctxFor(name, { solved });
      const list = await say('mail', ctx);
      expect(list).toContain(`"/var/mail/guest": 2 messages, 2 new`);
      expect(list).toMatch(/\n N {2}1 /);
      expect(list).toMatch(/\n N {2}2 /);
      expect(list).not.toMatch(/\n . {2}3 /);
      const locked = await execute('mail 3', ctx);
      expect(locked.output).toBe('mail: no such message: 3');
      expect(locked.exit).toBe(1);
      // A message that does not exist at all looks exactly the same as one that is locked.
      expect((await execute('mail 99', ctx)).output).toBe('mail: no such message: 99');
      expect(await say('mail 2', ctx)).toContain('Message 2');
    });

    it(`${name}: the mailbox file and the log grow with the same progress`, async () => {
      const none = ctxFor(name, { solved: [] });
      const some = ctxFor(name, { solved: [codes[0], codes[1]] });
      const count = async (ctx) => Number(await say("grep -c '^From ' /var/mail/guest", ctx));
      expect(await count(none)).toBe(1);
      expect(await count(some)).toBe(3);
      const logOf = async (ctx) => (await say(`cat /var/log/${LOGS[name]}`, ctx)).split('\n').filter((line) => / code [0-9] "/.test(line));
      expect(await logOf(none)).toEqual([]);
      const lines = await logOf(some);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain(`"${MODES[name].codes[0].title}"`);
    });
  }

  it('ignores junk in the progress list and survives a failing progress()', async () => {
    const odd = mailsFor(MODES.easy, { storySeed: seedOf('A'), solved: [1, 1, 'x', null, 77, 2.5] });
    expect(odd.map((mail) => mail.id)).toEqual([1, 2]);
    const ctx = { ...ctxFor('easy'), progress: async () => { throw new Error('db down'); } };
    expect(await say('mail', ctx)).toContain('1 message');
    const noProgress = { ...ctxFor('easy') };
    delete noProgress.progress;
    expect(await say('mail', noProgress)).toContain('1 message');
  });

  it('shows read and unread messages from the cosmetic marker', async () => {
    const ctx = ctxFor('easy', { solved: [1, 2], mailSeen: (1 << 1) | (1 << 3) });
    const list = await say('mail', ctx);
    expect(list).toContain('3 messages, 1 new');
    expect(list).toMatch(/\n {3} 1 /);
    expect(list).toMatch(/\n N {2}2 /);
    expect(await say('mail', { ...ctx, mailSeen: 4096 })).toContain('3 messages, 3 new'); // out of range counts as nothing read
    expect(await say('motd', ctx)).toContain('You have 1 unread message. Type mail to read it.');
    expect(await say('motd', { ...ctx, mailSeen: 0b1110 })).not.toContain('unread');
  });
});

describe('the cast is per team and consistent across modes', () => {
  it('gives every team its own names, always three different people', () => {
    const casts = Array.from({ length: 300 }, (_, i) => castFor(`seed-${i}`));
    for (const cast of casts) {
      expect(new Set([cast.intern, cast.boss, cast.analyst]).size).toBe(3);
      expect(cast.ghost).toMatch(/^g\+[a-z]+\d{4}@h\.ost$/);
      expect(cast.ticket).toMatch(/^\d{4}$/);
    }
    expect(new Set(casts.map((cast) => cast.intern)).size).toBeGreaterThan(30);
    expect(new Set(casts.map((cast) => cast.boss)).size).toBeGreaterThan(30);
    expect(new Set(casts.map((cast) => cast.ghost)).size).toBeGreaterThan(250);
    expect(castFor('seed-1')).toEqual(castFor('seed-1'));
  });

  it('shows team A and team B different names in the same mail, and the same names in every mode', async () => {
    const a = ctxFor('easy', { storySeed: seedOf('A'), solved: [1] });
    const b = ctxFor('easy', { storySeed: seedOf('B'), solved: [1] });
    const mailA = await say('mail 2', a);
    const mailB = await say('mail 2', b);
    expect(mailA).not.toBe(mailB);
    expect(mailA).toContain(castFor(seedOf('A')).boss);
    expect(mailB).toContain(castFor(seedOf('B')).boss);
    expect(mailA).not.toContain(castFor(seedOf('B')).intern);
    for (const mode of MODE_NAMES) {
      const text = await say('cat /var/mail/guest', ctxFor(mode, { storySeed: seedOf('A'), solved: [] }));
      expect(text, mode).toContain(mode === 'hard' ? 'soc@novacorp.example' : castFor(seedOf('A')).intern);
    }
    const medium = await say('mail 1', ctxFor('medium', { storySeed: seedOf('A') }));
    expect(medium).toContain(castFor(seedOf('A')).boss);
    expect(medium).toContain(castFor(seedOf('A')).analyst);
  });

  it('is the same on every replica (same input, same bytes)', async () => {
    const first = await say('cat /var/mail/guest', ctxFor('medium', { solved: [1, 3] }));
    const second = await say('cat /var/mail/guest', ctxFor('medium', { solved: [3, 1] }));
    expect(second).toBe(first);
    expect(mailboxText(mailsFor(MODES.hard, { storySeed: 's', solved: [2] }))).toBe(mailboxText(mailsFor(MODES.hard, { storySeed: 's', solved: [2] })));
  });

  it('falls back to the puzzle seed and then the default seed when no story seed is given', () => {
    expect(castFor(undefined)).toEqual(castFor(''));
    expect(castFor(undefined).intern).toMatch(/^[A-Z][a-z]+$/);
  });
});

// Puzzle values of a team (seed tokens with the small slots the puzzles use) must never show up in a mail or log.
const puzzleValues = (seed) => ['pass', 'ip', 'hex8', 'num4'].flatMap((kind) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => seedValue(seed, kind, slot)));

describe('no secret ever appears in the story', () => {
  const everything = (mode, storySeed, seed, solved) => {
    const m = withStory({ ...MODES[mode] }, { storySeed, solved });
    const mails = m.storyState.mails;
    return [mailboxText(mails), m.fs.children.var.children.log.children[Object.keys(m.fs.children.var.children.log.children).find((k) => /(novi|incident-desk|soc-escalation)\.log$/.test(k))].content, JSON.stringify(m.storyState.cast), seed];
  };

  it('has no flag token, no code shape, no placeholder and no non-ASCII text for 150 seeds in every mode', () => {
    for (const mode of MODE_NAMES) {
      const all = MODES[mode].codes.map((code) => code.n);
      for (let i = 0; i < 150; i += 1) {
        const solved = i % 3 === 0 ? all : i % 3 === 1 ? [] : all.slice(0, 1 + (i % all.length));
        const text = everything(mode, `story-${i}`, `puzzle-${i}`, solved).slice(0, 2).join('\n');
        expect(text).not.toMatch(/CTF\{/i);
        expect(text).not.toMatch(/\{\{/);
        expect(text).not.toMatch(/\bflag/i);
        expect(text).not.toMatch(/[^\n\x20-\x7e]/);
        for (const value of puzzleValues(`puzzle-${i}`)) expect(text, `${mode} ${i} ${value}`).not.toContain(value);
      }
    }
  });

  it('never prints a real flag, a hash, or a puzzle value through any story command', async () => {
    for (const mode of MODE_NAMES) {
      const all = MODES[mode].codes.map((code) => code.n);
      const ctx = ctxFor(mode, { solved: all });
      const text = [
        await say('mail', ctx),
        await say('mail 1 2 3 4 5', ctx),
        await say('mail 6 7', ctx),
        await say('cat /var/mail/guest', ctx),
        await say(`cat /var/log/${LOGS[mode]}`, ctx),
        await say('whoami -v', ctx),
        await say('novi', ctx),
        await say('motd', ctx),
        await say(`grep -r CTF /var/mail /var/log/${LOGS[mode]}`, ctx),
      ].join('\n');
      for (const n of all) expect(text).not.toContain(flagFor(mode)(n));
      expect(text).not.toMatch(/real_/);
      for (const value of puzzleValues(seedOf('puzzle-A'))) expect(text).not.toContain(value);
    }
  });

  it('never names an unsolved code or the place it hides', () => {
    const pathsIn = (text) => (text.match(/\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/g) ?? []).concat(text.match(/~\/[\w./-]+/g) ?? []);
    for (const mode of MODE_NAMES) {
      const def = MODES[mode];
      const all = def.codes.map((code) => code.n);
      for (const solved of [[], ...all.map((n) => [n]), all.slice(0, all.length - 1)]) {
        const [mailbox, log] = everything(mode, 'story-x', 'puzzle-x', solved);
        const text = `${mailbox}\n${log}`;
        for (const code of def.codes) {
          if (solved.includes(code.n)) continue;
          expect(text, `${mode} ${JSON.stringify(solved)} code ${code.n} title`).not.toContain(code.title);
          // Locations the hints of an unsolved code give away must not appear (the existing hint system stays the only source).
          for (const path of code.hints.flatMap(pathsIn)) {
            if (mode === 'hard' && !solved.length && text.includes(path) && pathsIn(def.codes.flatMap((c) => c.hints).join(' ')).includes(path)) {
              // the hard briefing that already existed names ~/tickets and /srv/export: allowed, it is in the original file
              expect(['~/tickets', '/srv/export']).toContain(path);
              continue;
            }
            expect(text, `${mode} ${JSON.stringify(solved)} code ${code.n} path ${path}`).not.toContain(path);
          }
        }
      }
    }
  });

  it('only mentions titles of codes the team solved', () => {
    for (const mode of MODE_NAMES) {
      const def = MODES[mode];
      const solved = [def.codes[0].n];
      const text = mailboxText(mailsFor(def, { storySeed: 'x', solved }));
      expect(text).toContain(def.codes[0].title);
      for (const code of def.codes.slice(1)) expect(text).not.toContain(code.title);
    }
  });
});

describe('the story cannot reach outside the virtual filesystem', () => {
  it('only reads the unlocked messages, whatever is typed', async () => {
    const ctx = ctxFor('easy', { solved: [] });
    for (const line of ['mail ../../etc/passwd', 'mail -f /etc/passwd', 'mail /etc/passwd', 'mail $(cat /etc/passwd)', 'mail 1e3', 'mail -1', 'mail 0x2', 'mail 2', 'mail 1 2 3 4 5 6']) {
      const result = await execute(line, ctx);
      expect(result.output, line).not.toContain('root:x');
      expect(result.output, line).not.toContain('Message 2');
      expect(result.output, line).not.toContain('internal error');
    }
    expect((await execute('mail ../../etc/passwd', ctx)).exit).toBe(1);
    expect((await execute('mail 1 2 3 4 5 6', ctx)).output).toContain('at most 5');
  });

  it('keeps the mailbox read-only and cannot be written through redirects, rm, mv or tee', async () => {
    const ctx = ctxFor('medium', { solved: [] });
    const before = await say('cat /var/mail/guest', ctx);
    for (const line of ['rm /var/mail/guest', 'mv /var/mail/guest /tmp/x', 'echo hi > /var/mail/guest', 'echo hi >> /var/mail/guest', 'touch /var/mail/new', 'cp /etc/passwd /var/mail/guest', 'chmod 777 /var/mail/guest']) {
      const result = await execute(line, ctx);
      expect(result.exit, line).not.toBe(0);
    }
    expect(await say('cat /var/mail/guest', ctx)).toBe(before);
    expect(await say('ls -l /var/mail', ctx)).toMatch(/-rw------- 1 guest mail/);
  });

  it('tab completion sees the mailbox and the log', async () => {
    const matches = complete('cat /var/mail/', ctxFor('easy'));
    expect(matches).toEqual(['/var/mail/guest']);
    expect(complete('cat /var/log/n', ctxFor('easy'))).toContain('/var/log/novi.log');
  });

  it('leaves modes without a story untouched (no mailbox, no extra files)', async () => {
    const ctx = makeTestCtx();
    expect(await say('mail', ctx)).toBe('No mail for guest');
    expect(await say('ls /var', ctx)).not.toContain('mail');
    expect(storyContext(ctx)).toBeInstanceOf(Promise);
    expect((await storyContext(ctx)).mode).toBe(ctx.mode);
    expect(withStory(ctx.mode, {})).toBe(ctx.mode);
    expect((await storyContext(null))).toBeNull();
  });

  it('keeps the briefing that hard mode already had as message 1', async () => {
    const text = await say('mail 1', ctxFor('hard'));
    expect(text).toContain('From: soc@novacorp.example');
    expect(text).toContain('Subject: read this before you start');
    expect(text).toContain('Tickets are in ~/tickets.');
    expect(text).toContain('Date: Thu, 14 Mar 2024 08:55:12 +0000');
  });
});

describe('easter eggs', () => {
  const ctx = () => ctxFor('easy');

  it('makes a sandwich only with sudo', async () => {
    const plain = await execute('make me a sandwich', ctx());
    expect(plain.output).toBe('What? Make it yourself.');
    expect(plain.exit).toBe(2);
    const sudo = await execute('sudo make me a sandwich', ctx());
    expect(sudo.output).toMatch(/^Okay\./);
    expect(sudo.exit).toBe(0);
    expect((await execute('make', ctx())).output).toContain('No targets specified');
    expect((await execute('sudo make me a pizza', ctx())).output).toContain('not in the sudoers file');
    expect((await execute('sudo cat /etc/shadow', ctx())).exit).not.toBe(0);
  });

  it('answers rm -rf / with a joke and touches nothing', async () => {
    const c = ctx();
    const listing = await say('ls -R / | wc -l', c);
    const joke = await execute('rm -rf --no-preserve-root /', c);
    expect(joke.output).toContain('NOVI: nice try');
    expect(joke.exit).toBe(1);
    expect(await say('ls -R / | wc -l', c)).toBe(listing);
    // without the override the real failsafe text stays
    expect((await execute('rm -rf /', c)).output).toContain('use --no-preserve-root');
    expect((await execute('rm -rf /*', c)).output).toContain('Read-only file system');
    expect(await say('cat /etc/passwd | wc -l', c)).not.toBe('0');
  });

  it('keeps whoami as the user name and adds the story name only with -v', async () => {
    const c = ctxFor('medium', { storySeed: seedOf('A') });
    expect(await say('whoami', c)).toBe('guest');
    const cast = castFor(seedOf('A'));
    expect(await say('whoami -v', c)).toBe(`guest (${cast.intern}, incident responder at NovaCorp, reports to ${cast.boss})`);
    expect(await say('whoami --verbose', makeTestCtx())).toBe('guest');
    expect(await say('novi', ctxFor('hard'))).toContain('connection refused');
    expect(await say('novi', c)).toContain(cast.intern);
  });

  it('lists mail and novi in help and has manual pages for them', async () => {
    const help = await say('help', ctx());
    expect(help).toMatch(/\bmail\b/);
    expect(await say('man mail', ctx())).toContain('MAIL(1)');
    expect(await say('mail -h', ctx())).toContain('usage: mail');
  });
});
