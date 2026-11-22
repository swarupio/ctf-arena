// The living story of Arena Terminal (docs/TERMINAL_GAME.md section 18).
//
// A team's mailbox (/var/mail/<user>) and a short log grow with the codes the team has solved. Everything here is a pure
// function of (story seed, solved code numbers, mode definition): no state, no clock, no randomness, no database. Any
// replica builds the same bytes for the same team and progress.
//
// Hard rules for this file:
//  * Nothing here may contain a code, a flag token ({{flag:...}}) or the place where an unsolved code is hidden. Mails
//    reflect what the team already found (titles of solved codes are shown to them anyway) and add atmosphere.
//  * Names come from `storySeed` (HMAC of the team id, the same in all three modes, so the cast stays one cast), never
//    from the puzzle seed, so no puzzle value (a kid, a passphrase, the one-off address) can ever show up in a mail.
//  * Mail ids are stable: 1 = welcome, n + 1 = the reaction to code n, N + 2 = the epilogue once every code is solved.
import { MAIL as HARD_BRIEFING } from './modes/hard/texts.js';
import { DEFAULT_SEED, seedValue } from './seed.js';
import { dir, file } from './vfs.js';

const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// ---- cast ----------------------------------------------------------------------------------------------------------

// Slots are far away from anything a puzzle uses (puzzles use 1..9), and the three names are always distinct.
export function castFor(storySeed) {
  const seed = typeof storySeed === 'string' && storySeed !== '' ? storySeed : DEFAULT_SEED;
  const taken = new Set();
  const person = (first) => {
    for (let slot = first; slot < first + 64; slot += 1) {
      const name = seedValue(seed, 'user', slot);
      if (!taken.has(name)) { taken.add(name); return cap(name); }
    }
    return cap(seedValue(seed, 'user', first));
  };
  const intern = person(901);
  const boss = person(931);
  const analyst = person(961);
  const alias = `${seedValue(seed, 'word', 991)}${seedValue(seed, 'num4', 992)}`;
  return {
    intern,
    boss,
    analyst,
    ticket: seedValue(seed, 'num4', 993),
    ghost: `g+${alias}@h.ost`,
  };
}

const addr = (name) => `${name.toLowerCase()}@novacorp.example`;

// Senders: a function of the cast so every team sees its own names.
const SENDERS = {
  novi: () => ({ name: 'NOVI', address: 'novi@novacorp.example' }),
  boss: (c) => ({ name: c.boss, address: addr(c.boss) }),
  analyst: (c) => ({ name: c.analyst, address: addr(c.analyst) }),
  ghost: (c) => ({ name: '???', address: c.ghost }),
  priya: () => ({ name: 'Priya Raman', address: 'priya.raman@novacorp.example' }),
  alice: () => ({ name: 'alice', address: 'alice@novacorp.example' }),
  bob: () => ({ name: 'bob', address: 'bob@novacorp.example' }),
  soc: () => ({ name: 'NovaCorp SOC', address: 'soc@novacorp.example' }),
  adm: () => ({ name: 'nova-adm', address: 'nova-adm@novacorp.example' }),
};

// ---- chapters ------------------------------------------------------------------------------------------------------
// `body` receives the cast `c` and the title `t` of the code it reacts to. Plain ASCII only, lines <= 72 chars.

const STORIES = {
  easy: {
    log: 'novi.log',
    logHead: (c) => [
      '2024-03-14 08:55:02 novi[412]: boot ok, host laptop-17, owner guest',
      `2024-03-14 08:58:00 novi[412]: mailbox for guest created, manager on file: ${c.boss}`,
    ],
    logCode: (c, n, t) => `novi[412]: recovery desk: code ${n} "${t}" confirmed, ${c.boss} notified`,
    intro: {
      from: 'novi', date: '14 Mar 2024 08:58:00', subject: 'Your mailbox works!',
      body: (c) => [
        `Hi ${c.intern}!`,
        '',
        `${c.boss}, your manager, asked me to test your mailbox before you`,
        'got here, so this is the test. It worked. Hooray.',
        '',
        'This mailbox is alive. Whenever your team recovers a code, new',
        'mail may arrive. Read it with:',
        '',
        '    mail          list your messages',
        '    mail 2        read message number 2',
        '',
        'Nothing in here is a secret, and nothing in here is a puzzle.',
        'The puzzles are on the laptop. Go and look around.',
        '',
        '-- NOVI, your onboarding bot',
      ],
    },
    codes: {
      1: {
        from: 'boss', date: '14 Mar 2024 09:30:00', subject: 'Re: you found the welcome kit',
        body: (c, t) => [
          `${c.intern},`,
          '',
          `Priya tells me you got through the welcome kit ("${t}").`,
          'Good start. Between us: this laptop used to be Jordan\'s, and',
          'Jordan was ghost\'s favourite apprentice. I do not believe',
          'Jordan knew what ghost was planning. I do believe ghost used',
          'Jordan\'s habits as camouflage.',
          '',
          'So read what people leave behind. Then read it again.',
          '',
          `-- ${c.boss}`,
        ],
      },
      2: {
        from: 'priya', date: '14 Mar 2024 09:30:00', subject: 'Dotfiles!! (and lunch)',
        body: (c, t) => [
          `Ha, "${t}"! I knew you would be quick, ${c.intern}.`,
          '',
          'People hide things in plain sight because they assume nobody',
          'looks. Jordan did it with stickers and dot-folders. Ghost did',
          'it with, well, everything.',
          '',
          'Still on for 12:30? I am buying, you owe me a taco.',
          '',
          'Priya',
        ],
      },
      3: {
        from: 'ghost', date: '14 Mar 2024 09:30:00', subject: 'hello again',
        body: (c, t) => [
          `hello ${c.intern.toLowerCase()},`,
          '',
          `so you sat through jordan's shopping list ("${t}") and came`,
          'out the other side. jordan never managed that.',
          '',
          'i am enjoying this more than i expected. keep going.',
          'the last one is the one i am proudest of.',
          '',
          '-- g',
          '',
          'P.S. do not reply. this address eats replies.',
        ],
      },
      4: {
        from: 'novi', date: '14 Mar 2024 09:30:00', subject: 'All four! (I may have squeaked)',
        body: (c, t) => [
          `${c.intern}!!`,
          '',
          `"${t}" was the last of the four. My records say that has not`,
          'happened on day one since I was installed. I have written it',
          'down. In permanent ink. (My ink is a text file.)',
          '',
          'One more thing, quietly: I looked at the setup log again.',
          'Somebody asked it about the ghost account long after the',
          'account was switched off. I told my manager. Look out for',
          'a message from them.',
          '',
          '-- NOVI',
        ],
      },
    },
    finale: {
      from: 'boss', date: '14 Mar 2024 09:30:00', subject: 'Next stop: the server room',
      body: (c) => [
        `${c.intern},`,
        '',
        'Four codes in one morning. Thank you, and tell Jordan none of',
        'this was Jordan\'s fault.',
        '',
        'The account "ghost" was disabled on 12 January. Yet on 11 March',
        'a session opened under that name on the NovaPay server room box',
        'and closed 18 minutes later. Somebody kept the key.',
        '',
        `Security has opened incident ${c.ticket}. They want a second pair`,
        'of eyes in the server room. You are it. Pick the next mode when',
        'you are ready; Priya will cover your desk.',
        '',
        `-- ${c.boss}`,
      ],
    },
  },

  medium: {
    log: 'incident-desk.log',
    logHead: (c) => [
      '2024-03-14 08:40:11 incident-desk: INC-2024-0311 open, owner guest, lead: ' + c.boss,
      `2024-03-14 08:40:12 incident-desk: ticket ${c.ticket} linked (follow-up from the laptop case)`,
    ],
    logCode: (c, n, t) => `incident-desk: code ${n} "${t}" recovered, ${c.analyst} (SOC) updated the timeline`,
    intro: {
      from: 'boss', date: '14 Mar 2024 08:40:00', subject: 'INC-2024-0311: you are on the rota',
      body: (c) => [
        `${c.intern},`,
        '',
        'After the laptop I am putting you on the incident. The box you',
        'are logged into is the NovaPay server room machine, and you have',
        'a read-only guest shell on purpose. alice and bob own the box;',
        `${c.analyst} is the SOC analyst on the timeline. Be nice to all`,
        'of them, in that order of grumpiness.',
        '',
        'Ghost\'s account was disabled in January. Somebody has been',
        'wearing it since. Find out what he left behind.',
        '',
        'This mailbox grows as you recover codes. mail lists it,',
        'mail 2 reads message 2.',
        '',
        `-- ${c.boss}`,
      ],
    },
    codes: {
      1: {
        from: 'alice', date: '14 Mar 2024 09:30:00', subject: 'Finance is calling (again)',
        body: (c, t) => [
          'Heard you cracked "' + t + '". Finance has been on the phone,',
          'they would like a word about that export.',
          '',
          'I told them an oversized file is only suspicious until you read',
          'the end of it. They did not find that funny. I did.',
          '',
          '-- alice',
        ],
      },
      2: {
        from: 'analyst', date: '14 Mar 2024 09:30:00', subject: 'one visitor, one time',
        body: (c, t) => [
          `${c.intern},`,
          '',
          `"${t}" is now in the timeline. A visitor who appears once is`,
          'invisible to every dashboard we own, because dashboards look',
          'for crowds. Ghost always liked being a rounding error.',
          '',
          `I added a note to ticket ${c.ticket}. If you find another oddity,`,
          'send it my way before you chase it alone.',
          '',
          `-- ${c.analyst}, SOC`,
        ],
      },
      3: {
        from: 'bob', date: '14 Mar 2024 09:30:00', subject: 'for the record: I did not touch the config',
        body: (c, t) => [
          `"${t}" - nice. For the record, I only restart nginx.`,
          'I have never edited that config in my life and I will say so',
          'under oath, or at least under HR.',
          '',
          'Whoever did it knew the format by heart. That narrows it',
          'down to about one person, and he has a locked account.',
          '',
          '-- bob',
        ],
      },
      4: {
        from: 'ghost', date: '14 Mar 2024 09:30:00', subject: 're: held',
        body: (c, t) => [
          'you opened "' + t + '". bold.',
          '',
          'held things are patient. so am i.',
          `tell ${c.boss.toLowerCase()} the coffee was good, whoever made it.`,
          '',
          '-- g',
        ],
      },
      5: {
        from: 'analyst', date: '14 Mar 2024 09:30:00', subject: 'the mirror',
        body: (c, t) => [
          `${c.intern},`,
          '',
          `"${t}": ghost kept a copy of himself where only a tidy`,
          'sysadmin would think to keep one. I am not sure whether that',
          'is vanity or a backup strategy. With him, both.',
          '',
          'All five are recovered. Check your inbox for the boss.',
          '',
          `-- ${c.analyst}`,
        ],
      },
    },
    finale: {
      from: 'boss', date: '14 Mar 2024 09:30:00', subject: 'The Vault',
      body: (c) => [
        `${c.intern},`,
        '',
        'Five of five, and the timeline for INC-2024-0311 is complete.',
        '',
        'Overnight the SOC imaged ghost\'s own hardened box. Everything',
        'he did not want us to read is in it, behind layers he spent',
        'months building. It is called the Vault. It is the hardest',
        'thing we have ever asked a guest account to do.',
        '',
        `${c.analyst} will brief you. Whenever you are ready.`,
        '',
        `-- ${c.boss}`,
      ],
    },
  },

  hard: {
    log: 'soc-escalation.log',
    logHead: (c) => [
      `2024-03-14 08:55:12 soc-escalation: vault image mounted read-only, analyst ${c.analyst}`,
      `2024-03-14 08:55:30 soc-escalation: incident 0231 escalated to ${c.boss}, ticket ${c.ticket}`,
    ],
    logCode: (c, n, t) => `soc-escalation: code ${n} "${t}" recovered, ${c.analyst} annotated the image`,
    // The briefing that already lives in /var/mail/guest stays message 1, word for word.
    intro: { text: HARD_BRIEFING },
    codes: {
      1: {
        from: 'analyst', date: '14 Mar 2024 09:30:00', subject: 'one in eight thousand',
        body: (c, t) => [
          `${c.intern},`,
          '',
          `"${t}": the address that came once, in a crowd that never`,
          'stopped. Ghost hid in the noise again. I would not be',
          'surprised if he enjoyed picking the number.',
          '',
          `-- ${c.analyst}`,
        ],
      },
      2: {
        from: 'adm', date: '14 Mar 2024 09:30:00', subject: 'layers',
        body: (c, t) => [
          `Saw "${t}" go through. He layered his files the way`,
          'he layered his sarcasm: one more than you expect, and',
          'always in the order that hurts.',
          '',
          '-- nova-adm',
        ],
      },
      3: {
        from: 'ghost', date: '14 Mar 2024 09:30:00', subject: 'you pulled a string',
        body: (c, t) => [
          `"${t}". yes. i left that for the curious.`,
          '',
          'curiosity is how you got here, ' + c.intern.toLowerCase() + '.',
          'it is also how i did.',
          '',
          '-- g',
        ],
      },
      4: {
        from: 'boss', date: '14 Mar 2024 09:30:00', subject: 'right key',
        body: (c, t) => [
          `${c.intern},`,
          '',
          `"${t}" - the right key among forty wrong ones. I will`,
          'remember how that felt the next time I print a spare key.',
          '',
          `The board has asked me for a status twice already. I told`,
          'them the guest is working. They asked which guest.',
          '',
          `-- ${c.boss}`,
        ],
      },
      5: {
        from: 'analyst', date: '14 Mar 2024 09:30:00', subject: 'root said yes',
        body: (c, t) => [
          `${c.intern},`,
          '',
          `"${t}". I opened a review on that sudo rule (ticket ${c.ticket}):`,
          'it will be removed once the image is archived. A rule that',
          'says yes once is a rule that said yes to the wrong person.',
          '',
          `-- ${c.analyst}`,
        ],
      },
      6: {
        from: 'ghost', date: '14 Mar 2024 09:30:00', subject: 'well done',
        body: (c, t) => [
          `so you put me back together ("${t}"). fine.`,
          '',
          'i locked the door at 23:41 and i would do it again.',
          'it was never about the money. it was about being read.',
          '',
          '-- g',
        ],
      },
    },
    finale: {
      from: 'boss', date: '14 Mar 2024 09:30:00', subject: 'Closing incident 0231',
      body: (c) => [
        `${c.intern},`,
        '',
        'Every code is recovered and the vault is ours again. The',
        `board has its status, ${c.analyst} has their weekend back, and`,
        'bob has been told to stop asking whether he is a suspect.',
        '',
        'One thing remains unanswered: who held the "ghost" key in',
        'March, long after the account was switched off? The last',
        'message arrived at the minute the door locked. We did not',
        'find the sender.',
        '',
        'Thank you. Truly. Take a day.',
        '',
        `-- ${c.boss}`,
      ],
    },
  },
};

export const STORY_MODES = Object.freeze(Object.keys(STORIES));
export const hasStory = (mode) => Boolean(mode && typeof mode === 'object' && Object.hasOwn(STORIES, mode.mode)
  && Array.isArray(mode.codes) && mode.fs);

// ---- mails ---------------------------------------------------------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '14 Mar 2024 09:30:00' -> { header: 'Thu, 14 Mar 2024 09:30:00 +0000', list: 'Mar 14 09:30', envelope: 'Thu Mar 14 09:30:00 2024' }
function formatDate(text) {
  const [day, month, year, time] = text.split(' ');
  const when = new Date(Date.UTC(Number(year), MONTHS.indexOf(month), Number(day)));
  const weekday = DAYS[when.getUTCDay()];
  return {
    header: `${weekday}, ${day} ${month} ${year} ${time} +0000`,
    list: `${month} ${day.padStart(2, ' ')} ${time.slice(0, 5)}`,
    envelope: `${weekday} ${month} ${day.padStart(2, ' ')} ${time} ${year}`,
  };
}

function parseBriefing(text) {
  const [head, ...rest] = text.split('\n\n');
  const field = (name) => new RegExp(`^${name}: (.*)$`, 'm').exec(head)?.[1] ?? '';
  const from = field('From');
  const date = field('Date');
  const match = /^\w+, (\d+) (\w+) (\d+) (\d\d:\d\d:\d\d)/.exec(date);
  return {
    from: { name: '', address: from },
    date: match ? `${match[1]} ${match[2]} ${match[3]} ${match[4]}` : '14 Mar 2024 08:55:12',
    subject: field('Subject'),
    body: rest.join('\n\n').replace(/\n+$/, '').split('\n'),
  };
}

function build(entry, cast, title) {
  const raw = entry.text ? parseBriefing(entry.text) : {
    from: SENDERS[entry.from](cast), date: entry.date, subject: entry.subject, body: entry.body(cast, title).slice(),
  };
  return { ...raw, when: formatDate(raw.date) };
}

// Unlocked mails in id order. `solved` is a list of code numbers (anything else is ignored).
export function mailsFor(mode, { storySeed, solved = [] } = {}) {
  const story = STORIES[mode.mode];
  const cast = castFor(storySeed);
  const codes = [...mode.codes].sort((a, b) => a.n - b.n);
  const done = new Set((Array.isArray(solved) ? solved : []).map(Number));
  const mails = [{ id: 1, ...build(story.intro, cast, '') }];
  for (const code of codes) {
    if (done.has(code.n) && story.codes[code.n]) {
      mails.push({ id: code.n + 1, ...build(story.codes[code.n], cast, String(code.title)) });
    }
  }
  if (codes.length > 0 && codes.every((code) => done.has(code.n))) {
    mails.push({ id: codes.length + 2, ...build(story.finale, cast, '') });
  }
  return mails;
}

const messageText = (mail) => [
  mail.from.name ? `From: ${mail.from.name} <${mail.from.address}>` : `From: ${mail.from.address}`,
  'To: guest@arena',
  `Date: ${mail.when.header}`,
  `Subject: ${mail.subject}`,
  '',
  ...mail.body,
  '',
].join('\n');

// mbox rendering of the mailbox file, with the From_ line that real mbox files start every message with.
export function mailboxText(mails) {
  return mails.map((mail) => `From ${mail.from.address} ${mail.when.envelope}\n${messageText(mail)}`).join('\n');
}

export { messageText };

// ---- overlay on the virtual filesystem -----------------------------------------------------------------------------

// Returns a copy of `root` with `node` at `parts` (clones only the directories on the way; the rest is shared).
function putNode(root, parts, node) {
  const [head, ...rest] = parts;
  const children = { ...(root.children ?? {}) };
  if (rest.length === 0) children[head] = node;
  else {
    const existing = children[head];
    const base = existing && existing.type === 'dir' ? existing : dir({}, { owner: 'root', group: 'root' });
    children[head] = putNode(base, rest, node);
  }
  return { ...root, children };
}

// The mode definition with the story applied for this team and progress: the mailbox, the log and `story` state
// (cast and mails) for the `mail` command. A mode without a story, or a bad definition, comes back untouched.
export function withStory(mode, { storySeed, solved = [] } = {}) {
  if (!hasStory(mode)) return mode;
  const story = STORIES[mode.mode];
  const cast = castFor(storySeed);
  const mails = mailsFor(mode, { storySeed, solved });
  const user = typeof mode.user === 'string' && mode.user !== '' ? mode.user : 'guest';
  const titles = new Map(mode.codes.map((code) => [code.n, String(code.title)]));
  const done = new Set((Array.isArray(solved) ? solved : []).map(Number));
  const logLines = [
    ...story.logHead(cast),
    ...[...titles.keys()].sort((a, b) => a - b).filter((n) => done.has(n))
      .map((n) => `2024-03-14 09:${String(2 + n * 4).padStart(2, '0')}:00 ${story.logCode(cast, n, titles.get(n))}`),
  ];
  const stamp = mode.mode === 'hard' ? '2024-03-14T08:55:12Z' : '2024-03-14T08:58:00Z';
  let root = mode.fs;
  root = putNode(root, ['var', 'mail', user], file(mailboxText(mails), { mode: 0o600, owner: user, group: 'mail', mtime: stamp }));
  root = putNode(root, ['var', 'log', story.log], file(`${logLines.join('\n')}\n`, { mode: 0o644, owner: 'root', group: 'adm', mtime: stamp }));
  return { ...mode, fs: root, storyState: { cast, mails, user } };
}

// Solved codes of the team for this request (progress() may be missing or fail: then the story shows its start only).
export async function storyContext(ctx) {
  if (!ctx || typeof ctx !== 'object' || !hasStory(ctx.mode)) return ctx;
  let solved = [];
  if (typeof ctx.progress === 'function') {
    try {
      const progress = await ctx.progress();
      solved = Array.isArray(progress?.solved) ? progress.solved.map(Number).filter(Number.isInteger) : [];
    } catch { solved = []; }
  }
  return { ...ctx, mode: withStory(ctx.mode, { storySeed: ctx.storySeed ?? ctx.seed, solved }) };
}

// Same overlay without progress, for Tab completion (names only; the mailbox file and the log always exist).
export function storyContextSync(ctx) {
  if (!ctx || typeof ctx !== 'object' || !hasStory(ctx.mode)) return ctx;
  return { ...ctx, mode: withStory(ctx.mode, { storySeed: ctx.storySeed ?? ctx.seed, solved: [] }) };
}
