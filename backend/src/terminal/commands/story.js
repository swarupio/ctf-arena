// Story commands: `mail` (the team's growing mailbox, see ../story.js) and a few harmless jokes (make, novi).
// Everything here only prints text derived from the story state the shell attached to the mode; nothing reads or writes
// the filesystem, and nothing can print a code (the story content never has one).
import { messageText } from '../story.js';

const MAX_READ = 5;
const USAGE = `usage: mail            list your messages
       mail N [M ...]  read message number N (up to ${MAX_READ} at once)
       mail -h         this help
A new message may arrive whenever your team recovers a code.
The raw mailbox is /var/mail/<user>, so cat and grep work on it too.
`;

const stateOf = (c) => c.rc.mode.storyState ?? null;

// Bit n of `mailSeen` (sent by the browser, cosmetic only) means "message n was read in this browser".
const isUnread = (c, id) => {
  const mask = Number.isInteger(c.ctx.mailSeen) && c.ctx.mailSeen >= 0 ? c.ctx.mailSeen : 0;
  return ((mask >> id) & 1) === 0;
};

export const unreadCount = (c) => (stateOf(c)?.mails ?? []).filter((mail) => isUnread(c, mail.id)).length;

const clip = (text, width) => (text.length > width ? `${text.slice(0, width - 1)}~` : text.padEnd(width));

function list(c, state) {
  const { mails, user } = state;
  const fresh = mails.filter((mail) => isUnread(c, mail.id)).length;
  const lines = [`"/var/mail/${user}": ${mails.length} message${mails.length === 1 ? '' : 's'}${fresh > 0 ? `, ${fresh} new` : ''}`];
  for (const mail of mails) {
    const flag = isUnread(c, mail.id) ? 'N' : ' ';
    lines.push(` ${flag} ${String(mail.id).padStart(2, ' ')}  ${clip(mail.from.name || mail.from.address, 14)} ${mail.when.list}  ${mail.subject}`);
  }
  lines.push('', "Read one with 'mail N'.");
  c.out(`${lines.join('\n')}\n`);
  return 0;
}

function mail(c) {
  const state = stateOf(c);
  if (c.args.includes('-h') || c.args.includes('--help')) { c.out(USAGE); return 0; }
  if (!state) { c.out(`No mail for ${c.rc.user}\n`); return 0; }
  if (c.args.length === 0 || (c.args.length === 1 && c.args[0] === '-H')) return list(c, state);
  if (c.args.length > MAX_READ) { c.err(`mail: read at most ${MAX_READ} messages at a time\n`); return 1; }
  const byId = new Map(state.mails.map((item) => [item.id, item]));
  let exit = 0;
  for (const arg of c.args) {
    if (!/^\d{1,3}$/.test(arg)) { c.err(`mail: invalid message number: ${arg.slice(0, 40)}\n`); exit = 1; continue; }
    const found = byId.get(Number(arg));
    // A message that is not unlocked yet looks exactly like one that does not exist.
    if (!found) { c.err(`mail: no such message: ${Number(arg)}\n`); exit = 1; continue; }
    c.out(`Message ${found.id}\n${messageText(found).replace(/\n+$/, '')}\n`);
    if (c.args.length > 1) c.out('\n');
  }
  return exit;
}

// `make me a sandwich` (xkcd 149). `sudo make me a sandwich` is handled in sudo.js, next to the real rule.
function make(c) {
  if (c.args.join(' ').toLowerCase() === 'me a sandwich') { c.err('What? Make it yourself.\n'); return 2; }
  c.err('make: *** No targets specified and no makefile found.  Stop.\n');
  return 2;
}

const NOVI_LINES = {
  easy: (name) => [
    `NOVI: Hi ${name}! I am here! Ask me anything.`,
    'NOVI: (I will answer every question with "try ls". It is a good answer.)',
  ],
  medium: (name) => [
    `NOVI: ${name}, I am running in degraded mode on this box.`,
    'NOVI: alice turned me down to a whisper. I am whispering. Can you hear it?',
  ],
  hard: () => [
    'NOVI: connection refused.',
    'NOVI: I was never installed on ghost\'s machine. He said, and I quote, "no".',
  ],
};

function novi(c) {
  const state = stateOf(c);
  const lines = Object.hasOwn(NOVI_LINES, c.rc.mode.mode) ? NOVI_LINES[c.rc.mode.mode] : NOVI_LINES.easy;
  c.out(`${lines(state?.cast?.intern ?? 'friend').join('\n')}\n`);
  return 0;
}

export const commands = { mail, make, novi };
