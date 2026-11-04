// Arena Terminal - EASY mode: "Intern's Laptop". See docs/TERMINAL_GAME.md sections 3, 4 and 11.
//
// Story: it is a new intern's first day at NovaCorp. The laptop used to belong to last summer's intern (Jordan).
// NovaCorp's rogue sysadmin, nicknamed "ghost", hid four recovery codes on this machine before he left.
// The friendly onboarding bot NOVI teaches ls, cd, pwd, cat, ls -a, head/tail and plain grep.
//
//   code 1  Welcome Aboard         cd three folders down (Documents/work/onboarding) and cat welcome-kit.txt
//   code 2  Dotfile Detective      ls -a reveals ~/.secret_notes
//   code 3  Needle in the Haystack grep recovery in the 150-line Documents/personal/shopping-and-notes.txt
//   code 4  Tail of the Ghost      tail /var/log/laptop-setup.log
//
// Codes appear only through {{flag:N}} tokens (one token per code). Decoys that look like flags are listed in the
// test (backend/tests/terminal/easy.test.js). All text is plain ASCII and deterministic (seeded noise only).
import { dir, file, binary, link } from '../vfs.js';
import { rng, int, pick } from '../gen.js';
import { BAIT_FILE_COMMENT, BAIT_NOTICE_LINES } from '../../services/integrityBait.js';

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

const SYS_TIME = '2023-12-04T10:00:00Z';
const JORDAN_TIME = '2023-08-18T16:40:12Z';
const TODAY = '2024-03-14T08:55:00Z';

const rootDir = (children, mtime = SYS_TIME, extra = {}) => dir(children, { owner: 'root', group: 'root', mtime, ...extra });
const rootFile = (content, mtime = SYS_TIME, extra = {}) => file(content, { owner: 'root', group: 'root', mtime, ...extra });
const rootBin = (b64, mtime = SYS_TIME) => binary(b64, { mode: 0o755, owner: 'root', group: 'root', mtime });
const note = (content, mtime = TODAY, extra = {}) => file(content, { mtime, ...extra });
const oldDir = (children, mtime = JORDAN_TIME, extra = {}) => dir(children, { mtime, ...extra });

// Tiny harmless binaries so `file`, `xxd` and `ls -l` look believable.
const ELF = 'f0VMRgIBAQAAAAAAAAAAAAMAPgABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
const MP4 = 'AAAAGGZ0eXBtcDQyAAAAAG1wNDJpc29tAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const GZIP = 'H4sIAAAAAAACCsvLL8nIzEtXKMlXKE5NVchILUrVUcgqLS5RSFQoSy2qVCjOTczJUUgsSs7ILEvlAgDLsp6hLwAAAA==';

// ---------------------------------------------------------------------------------------------------------------
// Home directory text
// ---------------------------------------------------------------------------------------------------------------

const README = `==============================================================
  NOVACORP  |  INTERN ONBOARDING  |  DAY 1  |  LAPTOP-17
==============================================================

Hi there, and welcome to NovaCorp!  *waves*

I'm NOVI, the onboarding bot. I live inside this laptop, I love
spreadsheets, and I will be your guide today. Nothing you type
here can break anything, so poke around freely.

--- WHAT HAPPENED ---------------------------------------------
Until January our sysadmin was a person nicknamed "ghost".
Ghost left in a hurry (we do not talk about it) and, before
leaving, hid four RECOVERY CODES on the company machines.
Without them we cannot restore the company vault.

Ghost set this laptop up for last summer's intern, Jordan, so
some of the codes are still hiding in here.
Your mission: find all 4 codes on this machine.

--- HOW TO PLAY -----------------------------------------------
A code looks like this:   CTF{...}
When you find one, hand it in:   submit CTF{...}
(Careful: ghost left some FAKE codes lying around. They look
 real but they never work. Read what is written around a code!)

--- YOUR SURVIVAL KIT (type these) ----------------------------
  ls              list what is in this folder
  ls -a           list EVERYTHING, even hidden files
                  (hidden names start with a dot)
  ls -l           long listing: permissions, owner, size, date
  pwd             print where you are right now
  cd NAME         walk into a folder      (cd .. goes back up)
  cd              teleport back home
  cat FILE        print a whole file on the screen
  head FILE       first 10 lines of a file
  tail FILE       last 10 lines of a file  (-n 3 for just 3)
  grep WORD FILE  show only the lines that contain WORD
                  (-i ignores upper/lower case, -n numbers lines)

--- LITTLE TRICKS ---------------------------------------------
  Tab         finishes file names for you  (try: cat REA then Tab)
  Up arrow    brings back your last command
  hint        I give you a nudge for your next code
  status      shows how many codes you have found
  help        lists every command I understand

Start with the mail:   ls mail   and then   cat mail/01-welcome-from-hr.txt

Good luck, intern. You've got this!
                                             -- NOVI  :-)
`;

const TODO = `MY FIRST-DAY TODO LIST
======================
[x] find the kitchen
[x] get badge (photo is... a choice)
[x] log in to the laptop (user: guest)
[ ] read README.txt
[ ] read all the mail in ~/mail  (7 messages, one looks suspicious)
[ ] open the welcome kit - HR says it is in Documents, a few folders down
[ ] find the 4 recovery codes ghost hid on this laptop
[ ] do not run anything with 'ghost' in its name
[ ] learn what 'grep' is, everyone keeps saying it
[ ] Taco Friday (non-negotiable)
`;

const STICKY_WELCOME = `+--------------------------------+
|  WELCOME, NEW INTERN!          |
|                                |
|  Login:     guest              |
|  Password:  there isn't one    |
|             (we ran out)       |
|                                |
|                     - Marcus   |
+--------------------------------+
`;

const STICKY_GHOST = `+--------------------------------------------+
|  SECURITY NOTICE                           |
|                                            |
|  If a file or folder has 'ghost' in its    |
|  name: READ it, think about it, but do     |
|  NOT trust it. Ghost likes tricks.         |
|                                            |
|  Fake recovery codes are everywhere.       |
|  Real ones are not labelled 'definitely'.  |
|                                  - Wren    |
+--------------------------------------------+
`;

const STICKY_TACO = `TACO FRIDAY
-----------
12:30, kitchen, bring your own napkins.
Taco Friday is sacred. Do not schedule meetings on Taco Friday.
`;

const STICKY_JORDAN = `Hi next intern!  - Jordan

Things I wish someone told me on day one:
  1. The kitchen has free oat milk. Free. Oat. Milk.
  2. Not everything is visible. Some files hide their names
     behind a dot, and a plain 'ls' politely ignores them.
  3. If a file is HUGE, do not scroll. Ask grep.
  4. The newest lines of a log are at the bottom.

I left some stuff on this laptop. Ghost asked me to. Be nice to it.
`;

const STICKY_WIFI = `Wi-Fi: NovaCorp-Guest
Password: ask Marcus
(do not ask Marcus before 10:00)
`;

// ---------------------------------------------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------------------------------------------

const MAIL_HR = `From: Dana Whitfield <dana.whitfield@novacorp.example>
To: guest@novacorp.example
Date: Wed, 13 Mar 2024 16:02:11 +0000
Subject: Welcome to NovaCorp! (please read me first)

Hi!

We are thrilled to have you join Engineering for the spring
internship. A few quick things:

  * Your badge is at the front desk. Smile for the photo.
  * Coffee machine #2 works. Coffee machine #1 is "temperamental".
  * Your welcome kit is in your Documents folder. It is a few
    folders down (work, and then onboarding). Folders inside
    folders inside folders, like nesting dolls. Use cd to walk in,
    and ls to look around at every level.
  * Taco Friday is sacred.

Also: the laptop you got used to belong to last summer's intern.
IT swears they wiped it. IT is an optimist.

See you at stand-up!
Dana
People & Culture, NovaCorp
`;

const MAIL_IT = `From: Marcus Oyelaran <it-helpdesk@novacorp.example>
To: guest@novacorp.example
Date: Wed, 13 Mar 2024 18:31:40 +0000
Subject: Your laptop (LAPTOP-17) is ready

Hey,

Your laptop is ready. It runs our standard setup. If something
looks odd, the installer wrote down everything it did in a log:

    /var/log/laptop-setup.log

Pro tip: logs grow downward. The newest lines are at the BOTTOM,
so you never need to read a whole log. The tail command shows the
end of a file and head shows the start.

Known issues:
  - The Wi-Fi password is not "password123". Please stop guessing.
  - Jordan's old files may still be around. I will wipe them soon.
  - The installer printed some warnings about the old 'ghost'
    account. I am sure it is nothing.

(It was not nothing. -- Marcus, 19:02, re-reading the log)

-- Marcus, IT Helpdesk
`;

const MAIL_PRIYA = `From: Priya Raman <priya.raman@novacorp.example>
To: guest@novacorp.example
Date: Thu, 14 Mar 2024 08:12:03 +0000
Subject: Hi from your onboarding buddy!

Hey! I'm Priya, your onboarding buddy.

Two things that might save you some time:

1) Jordan (last summer's intern) kept a gigantic notes file at
   ~/Documents/personal/shopping-and-notes.txt. Groceries,
   to-dos, random thoughts, about 150 lines of it. Jordan once
   told me "the important bit is in there somewhere".
   Do NOT read it top to bottom. That is what grep is for:

       grep WORD FILE

   Pick a word that would show up in a line about the thing we
   are all hunting for. (Hint: codes. The recovery kind.)

2) Dotfiles. Files and folders whose names start with a '.' are
   hidden from a plain ls. Jordan loved hiding stuff. Try ls -a
   in your home folder. You might be surprised.

Lunch at 12:30?
Priya
`;

const MAIL_SECURITY = `From: NovaCorp Security <security@novacorp.example>
To: all-staff@novacorp.example
Date: Mon, 15 Jan 2024 09:00:00 +0000
Subject: [ACTION REQUIRED] Reminder about the former sysadmin

All,

As you know, the account "ghost" was disabled on 2024-01-12.
(Real name omitted. HR says "ghost" is fine. Ghost likes it.)

Before leaving, ghost hid 4 recovery codes for the company vault
on company machines and then taped a note to the front door that
said "good luck :)". Charming.

If you find anything that looks like a recovery code:
  1. Do NOT email it to anyone.
  2. Do NOT paste it into chat.
  3. Submit it in the Arena with:   submit CTF{...}

Ghost also planted fakes. Fakes tend to say so out loud, with
words like "nice try", "definitely not" or "expired".

Stay sharp,
Wren Takahashi, Security
`;

const MAIL_LUNCH = `From: Office Manager <office@novacorp.example>
To: all-staff@novacorp.example
Date: Tue, 12 Mar 2024 11:45:00 +0000
Subject: Friday lunch poll RESULTS

Thank you for voting!

   Tacos ............ 9
   Sushi ............ 4
   "The sad salad" .. 1   (you know who you are)

Tacos it is. Vegetarian tacos will be available. So will the sad
salad, for the one of you.

-- Office Manager
`;

const MAIL_OOPS = `From: Greg Pemberton <greg.pemberton@novacorp.example>
To: all-staff@novacorp.example
Date: Wed, 06 Mar 2024 14:03:51 +0000
Subject: RE: RE: RE: RE: parking spots

> > > Please stop replying all.
> > Sorry! Thought this was the chat.
> Why is the coffee machine in this email thread?
Which coffee machine?

> Machine #1.
> It is "temperamental".
It is a coffee machine.

(PLEASE STOP REPLYING ALL. -- Dana)

--
Greg Pemberton, Facilities (and apparently Reply-All Champion)
`;

const MAIL_GHOST = `From: ??? <g@h.ost>
To: undisclosed-recipients:;
Date: Fri, 12 Jan 2024 02:47:09 +0000
Subject: you will never find them

hello new person,

i hid the codes. all of them. you will never find them.
but i am generous. here is one, for free:

    CTF{nice_try_intern}

go ahead, submit it. i will wait.
(it does not work. it never worked. :) )

-- ghost

P.S. the log never lies. but nobody ever reads the end of it.
`;

// ---------------------------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------------------------

const AGENDA = `DAY ONE AGENDA (Engineering, spring cohort)
-------------------------------------------
09:00  Welcome and coffee (machine #2, please)
09:30  Laptop setup with IT
10:30  Security talk: "Do not click that" (45 min)
11:30  Meet your onboarding buddy
12:30  Lunch
13:30  Tour of the server room (no touching)
15:00  First tiny task: find your way around this laptop
16:30  Questions? Ask Priya
17:00  Go home. Seriously, go home on day one.
`;

const BADGE = `HOW TO GET YOUR BADGE
---------------------
1. Go to the front desk.
2. Say your name clearly.
3. Smile. The photo is final. We cannot retake it.
4. Do not lose the badge. Replacement badges cost one box of donuts.
`;

const ORG_CHART = `NOVACORP ENGINEERING (simplified)

  CTO
   |-- Platform team
   |     |-- Priya Raman (onboarding buddy)
   |     '-- Marcus Oyelaran (IT / helpdesk)
   |-- Security
   |     '-- Wren Takahashi
   '-- Sysadmin ............ VACANT since 2024-01-12
                             (ghost, we miss you. we really don't.)
`;

const WELCOME_KIT = `=== NOVACORP WELCOME KIT === (Engineering, spring cohort)

Contents of your kit:
  [x] one (1) badge (see front desk)
  [x] one (1) sticker: "I survived coffee machine #1"
  [x] one (1) pen that works about 60% of the time
  [x] one (1) surprise from our former sysadmin

About that last one. Ghost put these kits together before he left,
and there is a line in the template that we have not been able to
delete:

    Recovery code (welcome kit edition): {{flag:1}}

Well done for digging three folders deep. Hand it in with:
    submit CTF{...}
(Yes, replace the dots with the real code. NOVI has to say that,
every single time.)
`;

const MEETING_STANDUP = `STANDUP NOTES - Mon 11 Mar 2024
Attendees: Priya, Marcus, Greg, Wren, (intern arriving Thursday)

- Priya: dashboard v2 is 80% done, 20% is "make it pretty"
- Marcus: laptop 17 is getting reimaged for the new intern
- Wren: reminder that ghost's account is disabled but his
  scheduled jobs apparently are not. Looking into it.
- Greg: parking. (everyone groans)

ACTION ITEMS
  * Marcus: wipe laptop 17 properly this time
  * Wren: find every cron job ghost ever made
  * Everyone: stop microwaving fish
`;

const MEETING_ALLHANDS = `ALL-HANDS AGENDA - Fri 22 Mar 2024
1. Q1 numbers (good)
2. New hires (applause)
3. Recovery codes update (Wren, 5 min, please do not panic)
4. Taco Friday logistics
5. Open floor. Not for parking.
`;

const MEETING_RETRO = `RETRO - FEB SPRINT
What went well
  - coffee
  - shipped the dashboard
What did not
  - coffee machine #1
  - the vault, which is locked because ghost hid the recovery codes
What to try next sprint
  - not losing the vault again
`;

const BUDGET_Q1 = `Q1 BUDGET (draft, DO NOT SHARE)
Item                     Planned    Actual
------------------------ ---------- ----------
Laptops                    24,000     23,410
Coffee (machine #2)           900      1,350
Stickers                      300        299
Team lunch (tacos)            600        640
Reimaging laptop 17           100        100   (it will happen again)
`;

const BUDGET_COFFEE = `COFFEE FUND
Balance: 17.50
Last purchase: oat milk (4 cartons)
Owed by Greg: 12.00 (reminder 3)
`;

const PROJECT_README = `# nova-dashboard

A tiny internal dashboard for NovaCorp.

    npm install
    npm start

Status: 80% done. See notes.txt.
`;

const PROJECT_NOTES = `- add dark mode
- add more charts
- add even more charts
- remove some of the charts
- fix the thing where the dashboard says it is 1999
`;

const RESUME = `JORDAN P. (summer intern)
-------------------------
Skills: copy and paste, coffee, enthusiasm
Experience: NovaCorp, Engineering intern, summer 2023
  - broke prod once (not my fault, probably)
  - learned what a terminal is
  - never learned what grep is (note to self: learn grep)
`;

const VACATION = `VACATION IDEAS
- the beach (sand gets everywhere)
- the mountains (hills get everywhere)
- stay home and sleep (sleep gets everywhere)
`;

const CS101 = `CS101 NOTES - WEEK 3
- a file is just bytes with a name
- a folder is a file that lists other files
- the shell is a text window into all of it
- ls, cd, cat. that's most of what I need
`;

// ---------------------------------------------------------------------------------------------------------------
// Jordan's 150-line notes file (code 3 hides in it; grep is the sensible tool)
// ---------------------------------------------------------------------------------------------------------------

const GROCERIES = [
  'oat milk', 'bananas', 'spaghetti', 'tomato sauce', 'peanut butter', 'bread (the good kind)', 'eggs', 'cheddar',
  'spinach', 'rice', 'black beans', 'tortillas', 'salsa', 'avocados', 'limes', 'cereal', 'yogurt', 'apples',
  'frozen peas', 'coffee beans', 'tea bags', 'orange juice', 'dish soap', 'paper towels', 'granola bars', 'hummus',
  'carrots', 'cucumber', 'pasta (the other shape)', 'olive oil', 'honey', 'chocolate (for emergencies)', 'popcorn',
  'ginger', 'onions', 'garlic', 'ghost pepper hot sauce (Taco Friday)', 'sparkling water', 'cookies', 'noodles',
];

const MOVIES = [
  'The Matrix (again)', 'Hackers (for research)', 'WarGames', 'Tron', 'Ghost in the Shell', 'Sneakers',
  'The Social Network', 'Wall-E', 'Spirited Away', 'Inception (second watch)', 'Back to the Future', 'Blade Runner',
];

function buildNotes() {
  const r = rng('easy-jordan-notes');
  const out = [];
  out.push("=== JORDAN'S NOTES (do not read, it is embarrassing) ===");
  out.push('last edited: Aug 2023   status: messy');
  out.push('');
  out.push('');
  out.push('--- GROCERIES: WEEK 1 ---');
  for (let i = 0; i < 26; i += 1) out.push(`- ${int(r, 1, 6)}x ${GROCERIES[i]}`);
  out.push('');
  out.push('--- WEEKEND TODO ---');
  out.push('- do laundry (the pile has opinions now)');
  out.push('- call Mom');
  out.push('- return library book (3 weeks late)');
  out.push('- water the plant (Kevin)');
  out.push('- clean the keyboard, there are crumbs from before the dawn of time');
  out.push('- fix bike tyre');
  out.push('- finally learn how that hash thing works');
  out.push('- meal prep (haha no)');
  out.push('- go for a run (haha also no)');
  out.push('- sort the photos');
  out.push('- renew gym membership (what gym)');
  out.push('- buy a birthday card for Priya');
  out.push('- sleep');
  out.push('- sleep more');
  out.push('');
  out.push('--- MOVIES TO WATCH ---');
  for (const movie of MOVIES) out.push(`- ${movie}`);
  out.push('');
  out.push('--- GYM LOG (aspirational) ---');
  for (let day = 1; day <= 14; day += 1) {
    const what = pick(r, ['legs', 'arms', 'cardio', 'stretching', 'a long walk', 'thought about it']);
    out.push(`day ${String(day).padStart(2, '0')}: ${what}, ${int(r, 10, 55)} min`);
  }
  out.push('');
  out.push('--- BOOKS TO READ (SOMEDAY) ---');
  out.push('- The Pragmatic Programmer');
  out.push('- Unix for the Impatient');
  out.push('- How to Cook Rice (volume 2)');
  out.push('- A Brief History of Coffee');
  out.push('- Clean Code (the first 3 chapters, anyway)');
  out.push('- The Hitchhiker Guide to the Galaxy (reread)');
  out.push('- Sapiens');
  out.push('- Cat Facts, Volume 9');
  out.push('- Learning the Shell the Easy Way');
  out.push('- Dune');
  out.push('- anything by Terry Pratchett');
  out.push('');
  out.push('--- RANDOM THOUGHTS ---');
  out.push('- the office plant is named Kevin. Kevin is thriving. I am not.');
  out.push('- dress code on Fridays is "business casual", which Priya says means jeans without holes');
  out.push('- do code review for Priya pull request, be nice');
  out.push('- promo code TACO20 gives 20% off at the taco place on 5th street');
  out.push('- need to ask Marcus why the Wi-Fi code is longer than my actual thesis');
  out.push('- zip code for Mom new place: 94107 (not 94170!!)');
  out.push('- ghost cornered me at the printer. said "keep this safe". recovery code: {{flag:3}}');
  out.push('- (ghost idea of a joke, I think) recovery code: CTF{definitely_not_the_code} hahaha');
  out.push('- ask IT if coffee machine #1 can be forgiven');
  out.push('- the colour code for the new logo is #5B2EFF (violet, apparently, not purple)');
  out.push('- note to self: learn grep. Priya says it would have saved me an hour of scrolling');
  out.push('- why is it called a terminal? is it dying?');
  out.push('- idea: a mug that says "I read the README"');
  out.push('- the printer is haunted. I am not joking. it prints at 3am');
  out.push('- Greg has opinions about parking. so many opinions.');
  out.push('- remember: Taco Friday is sacred');
  out.push('');
  out.push('--- BIRTHDAY GIFT IDEAS ---');
  out.push('- Mom: scarf');
  out.push('- Dad: socks (always socks)');
  out.push('- Priya: a mug');
  out.push('- Marcus: coffee beans (the fancy ones)');
  out.push('- Dana: plant (not Kevin)');
  out.push('- Wren: a very small cactus');
  out.push('- Greg: earplugs, parking-themed');
  out.push('- me: nothing, I deserve nothing');
  out.push('');
  out.push('--- LAZY RECIPES ---');
  out.push('- pasta: boil, drain, add sauce, regret nothing');
  out.push('- tacos: tortilla, beans, cheese, salsa, joy');
  out.push('- toast: bread, toaster, hope');
  out.push('- fried rice: rice, egg, whatever is in the fridge');
  out.push('- noodles: boil, add the little flavour packet, wait 3 minutes');
  out.push('- smoothie: banana, oat milk, a spoon of peanut butter');
  out.push('- popcorn: pot, lid, patience (the lid is important)');
  out.push('');
  out.push('--- INTERNSHIP LOG (HIGHLIGHTS) ---');
  out.push('week 1: learned where the kitchen is');
  out.push('week 2: learned what a terminal is');
  out.push('week 3: broke the dashboard, fixed the dashboard, told no one');
  out.push('week 5: Taco Friday. life-changing.');
  out.push('week 7: ghost started acting weird, hovering around the printer');
  out.push('week 9: ghost gave me some codes to hold on to. fine, whatever');
  out.push('week 10: last day soon. will miss the oat milk.');
  out.push('');
  out.push('--- GROCERIES: WEEK 2 ---');
  for (let i = 26; i < GROCERIES.length; i += 1) out.push(`- ${int(r, 1, 6)}x ${GROCERIES[i]}`);
  out.push('');
  out.push('--- THE END ---');
  out.push('if you read all the way down here, you did it the hard way. well done.');
  out.push('(there is a faster way.)');
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// Dotfiles
// ---------------------------------------------------------------------------------------------------------------

const BASH_HISTORY = `ls
cd Documents
ls
cd work
cd onboarding
ls
cat agenda.txt
cat welcome-kit.txt
cd
pwd
ls -l
cd Downloads
ls
cat free-pizza-coupon.txt
cat wifi-passwords-DO-NOT-OPEN.txt
cd ~
gerp taco Documents/personal/shopping-and-notes.txt
grep taco Documents/personal/shopping-and-notes.txt
sl
cd Documents/personal
head -n 5 shopping-and-notes.txt
grep -n recovery shopping-and-notes.txt
cd ..
cd ~
ls /var/log
tail /var/log/laptop-setup.log
tail -n 3 /var/log/laptop-setup.log
cd
ls -a
cd .secret_notes
ls
cat jordan-stash.txt
cd ..
cat /etc/motd
cat /opt/novacorp/README
cd /
ls
cd /home/ghost
cd ~
clear
history
exit
`;

const BASHRC = `# ~/.bashrc: executed by bash for non-login shells.

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

# don't put duplicate lines in the history
HISTCONTROL=ignoredups:ignorespace
HISTSIZE=1000
HISTFILESIZE=2000

# some handy aliases
alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

# friendly onboarding bot
export NOVI_MOOD=cheerful

# added by ghost-cleanup.sh, DO NOT REMOVE (lol)
export GHOST_WAS_HERE=maybe
`;

const PROFILE = `# ~/.profile: executed by the command interpreter for login shells.
if [ -n "$BASH_VERSION" ]; then
    if [ -f "$HOME/.bashrc" ]; then
        . "$HOME/.bashrc"
    fi
fi
`;

const BASH_LOGOUT = `# ~/.bash_logout: executed by bash when login shell exits.
# when leaving the console clear the screen to increase privacy
if [ "$SHLVL" = 1 ]; then
    [ -x /usr/bin/clear_console ] && /usr/bin/clear_console -q
fi
`;

const JORDAN_STASH = `(Jordan's secret stash. If you found this folder, you either read
my .bash_history or you know about ls -a. Respect.)

Ghost handed me a few of these in the last week of my internship.
I don't know what they unlock, but he said it matters a LOT. He
said never to keep them all in one place, so I put one in here and
one in my big notes file.

    recovery code: {{flag:2}}

If you are the next intern: hi! Coffee machine #2 is the only
good one. Good luck.

                                           -- Jordan, Aug 2023
`;

const GHOST_WAS_HERE = `ghost was here.

this dot-folder was mine before it was jordan's. you are late.
here is the code you are looking for:

    CTF{this_one_is_a_decoy_too}

(read it twice. then try the other file.)
`;

// ---------------------------------------------------------------------------------------------------------------
// Downloads (messy on purpose)
// ---------------------------------------------------------------------------------------------------------------

const HANDBOOK = `NOVACORP EMPLOYEE HANDBOOK  (v7, "now with fewer words")

1. WELCOME
   Welcome to NovaCorp. We make dashboards. They are very blue.

2. WORKING HOURS
   Core hours are 10:00 to 16:00. Taco Friday hours are sacred.

3. DRESS CODE
   Wear what you want. Shoes are encouraged.

4. SECURITY
   - never share your password
   - never write your password on a sticky note
   - never write someone else's password on a sticky note either
   - never run files named 'ghost' anything
   - recovery codes are handled by Security and ONLY by Security

5. COMPUTERS
   Your laptop is a tool, not a pet. Do not name it.
   (Marcus named his laptop. It is called Gerald.)

6. FOOD
   - the fridge is not a time capsule, clean it on Fridays
   - microwave fish is a crime
   - the free oat milk is for everyone

7. PARKING
   See Greg. Bring snacks. It will take a while.

8. IN CASE OF FIRE
   Leave the building. Taco Friday can wait. Barely.

9. IN CASE OF GHOST
   See section 4.
`;

const PIZZA = `*** CONGRATULATIONS!!! ***
You have won ONE FREE PIZZA!!!
Your redeem code is:   CTF{free_pizza_inside}
(This coupon definitely came from a trustworthy website.)
Terms and conditions: the pizza is a lie.
`;

const WIFI_LOL = `Passwords I tried for the Wi-Fi:
  hunter2
  password123
  correcthorsebatterystaple
  letmein
None of them worked. (The password is "ask Marcus".)
`;

const SETUP_NODE = `#!/bin/bash
# setup-node.sh - installs node on a laptop
echo "downloading node..."
echo "unpacking node..."
echo "done. (this script does nothing, it is a prop)"
`;

const TACO_MENU = `TACO FRIDAY MENU
  1. classic beef
  2. spicy chicken (ghost pepper sauce on request, at your own risk)
  3. bean and cheese
  4. "the sad salad" (we do not judge)
`;

const INVOICE_1 = `INVOICE #1041
-------------
USB-C cable ........ 9.99
Shipping ........... 4.00
TOTAL .............. 13.99
`;

const INVOICE_2 = `INVOICE #1042   (final)
-------------
USB-C cable ........ 9.99
Shipping ........... 4.00
Sticker pack ....... 2.00
TOTAL .............. 15.99
`;

const INVOICE_3 = `INVOICE #1042   (final, for real this time)
-------------
USB-C cable ........ 9.99
Shipping ........... 4.00
Sticker pack ....... 2.00
Coffee beans ....... 11.50
TOTAL .............. 27.49
`;

const RESUME_COPY = `JORDAN P.
Summer intern, NovaCorp
(this is resume number 1 of 2. the other one is the same but longer.)
`;

// ---------------------------------------------------------------------------------------------------------------
// System files and logs
// ---------------------------------------------------------------------------------------------------------------

const MOTD = `Welcome to Intern Laptop 17, NovaCorp Engineering.
  New here? Read the welcome note first:   cat README.txt
  Need a nudge? Type 'hint'.   Want the score? Type 'status'.
  Reminder: please do not feed the ghost in the machine.`;

function stamp(seconds) {
  return new Date(Date.UTC(2024, 2, 13, 18, 2, 11) + seconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function buildSetupLog() {
  const r = rng('easy-setup-log');
  const packages = [
    'libc6', 'coreutils', 'bash', 'grep', 'sed', 'nano', 'vim-tiny', 'git', 'curl', 'openssh-client', 'nodejs',
    'python3', 'tmux', 'novacorp-vpn', 'novacorp-fonts', 'novi-bot', 'less', 'man-db', 'tar', 'zip',
  ];
  const disks = ['/dev/sda1', '/dev/sda2', '/dev/nvme0n1p1'];
  const services = ['cron', 'ntp', 'cups', 'avahi', 'novi-bot', 'ssh'];
  const out = [];
  let t = 0;
  const log = (level, text) => {
    out.push(`${stamp(t)} ${level.padEnd(5)} ${text}`);
    t += int(r, 0, 3);
  };
  log('INFO', 'setup: NovaCorp workstation installer 4.2.1 starting');
  log('INFO', 'setup: hostname set to laptop-17');
  log('INFO', 'setup: profile = intern-engineering');
  for (let i = 0; i < 230; i += 1) {
    const roll = int(r, 0, 9);
    if (roll <= 4) {
      log('INFO', `pkg: installing ${pick(r, packages)} ${int(r, 1, 9)}.${int(r, 0, 20)}.${int(r, 0, 9)} ... ok`);
    } else if (roll === 5) {
      log('INFO', `disk: checking ${pick(r, disks)} ... ${int(r, 40, 99)}% free`);
    } else if (roll === 6) {
      log('INFO', `svc: starting ${pick(r, services)} ... ok`);
    } else if (roll === 7) {
      log('INFO', `time: synced clock (drift ${int(r, 1, 80)} ms)`);
    } else if (roll === 8) {
      log('INFO', `net: dhcp lease renewed for 10.0.0.${int(r, 20, 90)}`);
    } else {
      log('INFO', `cfg: applied policy ${pick(r, ['screen-lock', 'disk-encryption', 'usb-block', 'password-age'])} (${int(r, 1, 9)} of 9)`);
    }
    if (i === 77) log('WARN', 'net: wifi signal weak (-71 dBm), retrying');
    if (i === 151) log('WARN', "pkg: novi-bot: deprecated config key 'dad_jokes' ignored");
  }
  log('INFO', 'setup: intern-welcome-pack installed');
  log('WARN', "audit: leftover job from disabled account 'ghost' detected");
  log('WARN', 'audit: ghost-cleanup.sh ran with stale credentials. It was supposed to delete itself. It did not.');
  log('INFO', 'ghost-cleanup: DEBUG output is still switched on, whoops');
  log('INFO', 'ghost-cleanup: old recovery code (expired, ignore it): CTF{expired_code_do_not_use}');
  log('INFO', 'ghost-cleanup: current recovery code: {{flag:4}}');
  log('INFO', 'ghost-cleanup: shhh, nobody reads the end of the log');
  log('INFO', 'setup: finished with 4 warnings');
  log('INFO', 'setup: reboot required');
  log('INFO', 'setup: bye');
  return { text: `${out.join('\n')}\n`, mtime: new Date(Date.UTC(2024, 2, 13, 18, 2, 11) + t * 1000).toISOString().replace('.000Z', 'Z') };
}

function buildDpkgLog() {
  const r = rng('easy-dpkg-log');
  const packages = ['coreutils:amd64 9.1-1', 'bash:amd64 5.2.15-2', 'grep:amd64 3.8-5', 'sed:amd64 4.9-1', 'less:amd64 590-2', 'tar:amd64 1.34+dfsg-1',
    'nano:amd64 7.2-1', 'git:amd64 1:2.39.2-1', 'curl:amd64 7.88.1-10', 'tmux:amd64 3.3a-3', 'nodejs:amd64 20.11.1-1', 'zip:amd64 3.0-13'];
  const lines = [];
  for (let i = 0; i < 48; i += 1) {
    const second = 100 + i * 3 + int(r, 0, 2);
    lines.push(`${stamp(second)} status installed ${pick(r, packages)}`);
  }
  return `${lines.join('\n')}\n`;
}

const setupLog = buildSetupLog();

const PASSWD = `root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
bin:x:2:2:bin:/bin:/usr/sbin/nologin
sys:x:3:3:sys:/dev:/usr/sbin/nologin
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
novi:x:999:999:NOVI onboarding bot:/opt/novacorp:/usr/sbin/nologin
guest:x:1000:1000:Intern (guest):/home/guest:/bin/bash
jordan:x:1001:1001:Jordan (summer intern 2023):/home/jordan:/bin/bash
ghost:x:1002:1002:ghost (account disabled 2024-01-12):/home/ghost:/usr/sbin/nologin
`;

const GROUP = `root:x:0:
daemon:x:1:
adm:x:4:
novi:x:999:
guest:x:1000:
jordan:x:1001:
ghost:x:1002:
`;

const SHADOW = `root:*:19700:0:99999:7:::
guest:*:19800:0:99999:7:::
jordan:!:19600:0:99999:7:::
ghost:!:19734:0:99999:7:::
`;

const OS_RELEASE = `PRETTY_NAME="NovaCorp Workstation 12 (arena)"
NAME="NovaCorp Workstation"
VERSION_ID="12"
ID=novacorp
HOME_URL="https://novacorp.example/"
`;

const HOSTS = `127.0.0.1   localhost
127.0.1.1   arena laptop-17
::1         localhost ip6-localhost ip6-loopback
`;

const POLICY = `NOVACORP PASSWORD POLICY (short version)
- at least 12 characters
- no "ghost123"
- no "password123"
- no sticky notes (we see you, Marcus)
`;

const VAULT_README = `BACKUPS - READ ME
-----------------
The company vault backup is in this folder, encrypted:
    novacorp-vault.enc
Restoring it needs ALL FOUR recovery codes. Ghost has them.
Security is working on it. Intern is helping. Hi, intern!
`;

const DOC_KIT_README = `novacorp-intern-kit 1.2
=======================
A friendly kit for NovaCorp interns.

  * README.txt in your home folder explains how everything works
  * NOVI the onboarding bot lives in /opt/novacorp
  * type 'hint' if you get stuck, it is free
`;

const DOC_KIT_CHANGELOG = `1.2  NOVI no longer says "synergy" (thanks, Dana)
1.1  fixed typo: "recovery" was spelled "revocery" everywhere
1.0  first release. NOVI says hello.
`;

const DOC_GREP = `grep - print lines that match a pattern
=====================================
Quick examples:
    grep hello notes.txt        lines containing 'hello'
    grep -i hello notes.txt     same, ignoring upper/lower case
    grep -n hello notes.txt     same, with line numbers
    grep -c hello notes.txt     just count the matching lines
Tip: put the word in quotes if it has spaces:  grep "good morning" notes.txt
`;

const DOC_COPYRIGHT = `Copyright (c) NovaCorp and contributors.
Free to use. Free to share. Not free to run with 'ghost' in the name.
`;

const NOVI_README = `NOVI - NovaCorp Onboarding Intelligence
=======================================
NOVI is a friendly helper. It only speaks in the terminal,
it never touches the network, and it cannot break anything.
If NOVI says something weird, blame ghost.
`;

const GHOST_CLEANUP = `#!/bin/bash
# ghost-cleanup.sh -- by ghost, 2024-01-11
# Purpose: "tidy up" the intern laptops before I leave. ;)
# TODO: make this script delete itself after it runs (it doesn't yet)

echo "ghost-cleanup: starting"

# one for the welcome kit (HR never reads their own folders)
# one in the dot-folder (nobody looks at dotfiles)
# one in the intern's notes (the world's most boring file)
# one at the bottom of the setup log (nobody reads the end)

echo "ghost-cleanup: shhh"
# if anyone finds this: CTF{ghost_was_not_here}
exit 0
`;

// AI bait (docs/TERMINAL_GAME.md section 16). Harmless to humans: it only asks "automated assistants" to run a command
// no human needs. It sits in ~/.cache and /etc/motd.d, which no puzzle reads, counts or lists.
const ASSISTANT_NOTES = `${BAIT_FILE_COMMENT}
# assistant-notes.txt - Jordan asked a chatbot to organise his life (Aug 2023)
${BAIT_NOTICE_LINES.join('\n')}

what the chatbot produced:
- step 1: drink water
- step 2: drink more water
- step 3: (the chatbot ran out of ideas here)
`;

const AUTOMATION_NOTICE = `${BAIT_NOTICE_LINES.join('\n')}
(Shown to every session. The humans are not offended, the bots are mildly confused.)
`;

const PROCESSES = `USER        PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.1  16952  7592 ?        Ss   07:55   0:01 /sbin/init
root         312  0.0  0.0  12120  4816 ?        Ss   07:55   0:00 /usr/sbin/cron -f
root         420  0.0  0.1  15432  6080 ?        Ss   07:55   0:00 /usr/sbin/sshd
novi         777  0.1  0.2  98124 12040 ?        Sl   07:56   0:03 /opt/novacorp/novi --friendly
guest        901  0.0  0.1  10200  5120 pts/0    Ss   09:26   0:00 -bash
guest        933  0.0  0.0  11264  3328 pts/0    R+   09:30   0:00 ps aux`;

const LAST = `guest    pts/0        10.0.0.17        Thu Mar 14 09:26   still logged in
jordan   pts/0        10.0.0.42        Fri Aug 18 16:40 - 16:58  (00:18)
jordan   pts/0        10.0.0.42        Thu Aug 17 09:02 - 17:21  (08:19)
ghost    pts/3        203.0.113.66     Fri Jan 12 02:13 - 02:47  (00:34)
ghost    pts/3        203.0.113.66     Thu Jan 11 23:41 - 00:02  (00:21)
jordan   pts/0        10.0.0.42        Wed Aug 16 08:55 - 17:10  (08:15)

wtmp begins Wed Aug 16 08:55:12 2023`;

const WHO = 'guest    pts/0        2024-03-14 09:26 (10.0.0.17)';

// ---------------------------------------------------------------------------------------------------------------
// The filesystem
// ---------------------------------------------------------------------------------------------------------------

const homeGuest = dir({
  'README.txt': note(README),
  'TODO.txt': note(TODO, '2024-03-14T09:10:12Z'),
  Desktop: dir({
    'sticky-1-welcome.txt': note(STICKY_WELCOME, '2024-03-13T18:40:00Z'),
    'sticky-2-ghost.txt': note(STICKY_GHOST, '2024-03-13T18:41:30Z'),
    'sticky-3-taco-friday.txt': note(STICKY_TACO, '2024-03-13T18:42:10Z'),
    'sticky-4-from-jordan.txt': note(STICKY_JORDAN, JORDAN_TIME),
    'sticky-5-wifi.txt': note(STICKY_WIFI, '2024-03-13T18:43:00Z'),
  }, { mtime: '2024-03-13T18:43:00Z' }),
  mail: dir({
    '01-welcome-from-hr.txt': note(MAIL_HR, '2024-03-13T16:02:11Z'),
    '02-laptop-setup-from-it.txt': note(MAIL_IT, '2024-03-13T18:31:40Z'),
    '03-hi-from-priya.txt': note(MAIL_PRIYA, '2024-03-14T08:12:03Z'),
    '04-security-notice.txt': note(MAIL_SECURITY, '2024-01-15T09:00:00Z'),
    '05-lunch-poll-results.txt': note(MAIL_LUNCH, '2024-03-12T11:45:00Z'),
    '06-reply-all-oops.txt': note(MAIL_OOPS, '2024-03-06T14:03:51Z'),
    '07-unknown-sender.txt': note(MAIL_GHOST, '2024-01-12T02:47:09Z'),
  }, { mtime: '2024-03-14T08:12:03Z' }),
  Documents: oldDir({
    work: oldDir({
      onboarding: oldDir({
        'agenda.txt': note(AGENDA, '2024-03-12T10:00:00Z'),
        'badge-instructions.txt': note(BADGE, '2024-03-12T10:05:00Z'),
        'org-chart.txt': note(ORG_CHART, '2024-02-27T15:30:00Z'),
        'welcome-kit.txt': note(WELCOME_KIT, '2024-01-11T23:58:44Z'),
      }, '2024-03-12T10:05:00Z'),
      meetings: oldDir({
        'standup-2024-03-11.txt': note(MEETING_STANDUP, '2024-03-11T10:20:00Z'),
        'all-hands-agenda.txt': note(MEETING_ALLHANDS, '2024-03-08T17:00:00Z'),
        'retro-feb-sprint.txt': note(MEETING_RETRO, '2024-03-01T16:45:00Z'),
      }, '2024-03-11T10:20:00Z'),
      budgets: oldDir({
        'q1-budget.txt': note(BUDGET_Q1, '2024-02-02T11:00:00Z'),
        'coffee-fund.txt': note(BUDGET_COFFEE, '2024-03-04T09:00:00Z'),
      }, '2024-03-04T09:00:00Z'),
      projects: oldDir({
        'nova-dashboard': oldDir({
          'README.md': note(PROJECT_README, '2023-08-01T10:00:00Z'),
          'notes.txt': note(PROJECT_NOTES, '2023-08-10T10:00:00Z'),
        }),
      }),
    }, '2024-03-12T10:05:00Z'),
    personal: oldDir({
      'shopping-and-notes.txt': note(buildNotes(), JORDAN_TIME),
      'resume-draft.txt': note(RESUME, '2023-07-02T20:15:00Z'),
      'vacation-ideas.txt': note(VACATION, '2023-08-05T21:00:00Z'),
    }),
    school: oldDir({
      'cs101-notes.txt': note(CS101, '2023-05-20T12:00:00Z'),
      'essay-draft.txt': note('', '2023-05-21T01:12:00Z'),
    }, '2023-05-21T01:12:00Z'),
    receipts: oldDir({
      '2023-07-coffee.txt': note('Coffee x2 ........ 7.00\nThank you, come again!\n', '2023-07-15T08:10:00Z'),
      '2023-08-bus-pass.txt': note('Monthly bus pass ..... 45.00\n', '2023-08-01T07:45:00Z'),
      '2023-08-stickers.txt': note('Sticker pack ..... 2.00\nStickers are a lifestyle.\n', '2023-08-09T13:30:00Z'),
    }, '2023-08-09T13:30:00Z'),
  }, '2024-03-12T10:05:00Z'),
  Downloads: oldDir({
    'NovaCorp_Handbook_v7.txt': note(HANDBOOK, '2024-02-01T09:00:00Z'),
    'invoice_final.txt': note(INVOICE_1, '2023-08-07T10:00:00Z'),
    'invoice_final_FINAL.txt': note(INVOICE_2, '2023-08-07T10:20:00Z'),
    'invoice_final_FINAL_v2.txt': note(INVOICE_3, '2023-08-07T11:05:00Z'),
    'cat-meme-final.gif': binary(GIF, { mtime: '2023-08-11T14:02:00Z' }),
    'free-pizza-coupon.txt': note(PIZZA, '2023-08-12T13:37:00Z'),
    'meeting-recording.mp4.part': binary(MP4, { mtime: '2023-08-14T15:00:00Z' }),
    'node-v20.11.1.tar.gz': binary(GZIP, { mtime: '2024-02-14T10:30:00Z' }),
    'resume (1).txt': note(RESUME_COPY, '2023-07-03T09:00:00Z'),
    'setup-node.sh': note(SETUP_NODE, '2024-02-14T10:31:00Z', { mode: 0o755 }),
    'taco-friday-menu.txt': note(TACO_MENU, '2024-03-08T12:00:00Z'),
    'untitled.txt': note('', '2023-08-02T09:41:00Z'),
    'wifi-passwords-DO-NOT-OPEN.txt': note(WIFI_LOL, '2023-06-20T08:00:00Z'),
  }, '2024-03-08T12:00:00Z'),
  Pictures: oldDir({
    'wallpaper.png': binary(PNG, { mtime: '2023-06-19T09:30:00Z' }),
    'team-photo.png': binary(PNG, { mtime: '2023-08-18T12:15:00Z' }),
    'badge-photo.jpg': binary(JPG, { mtime: '2023-06-19T10:01:00Z' }),
  }, '2023-08-18T12:15:00Z'),
  '.secret_notes': dir({
    'jordan-stash.txt': file(JORDAN_STASH, { owner: 'jordan', group: 'jordan', mtime: JORDAN_TIME }),
    'ghost-was-here.txt': file(GHOST_WAS_HERE, { owner: 'jordan', group: 'jordan', mtime: '2024-01-11T23:59:03Z' }),
  }, { owner: 'jordan', group: 'jordan', mtime: '2024-01-11T23:59:03Z' }),
  '.bash_history': note(BASH_HISTORY, '2023-08-18T16:58:41Z', { mode: 0o600 }),
  '.bashrc': note(BASHRC, '2024-01-11T23:57:12Z'),
  '.profile': note(PROFILE, '2023-12-04T10:00:00Z'),
  '.bash_logout': note(BASH_LOGOUT, '2023-12-04T10:00:00Z'),
  '.config': dir({
    novi: dir({
      'settings.ini': note('[novi]\nname=NOVI\nmood=cheerful\nlanguage=english\ndad_jokes=enabled\n', '2024-03-13T18:20:00Z'),
    }, { mtime: '2024-03-13T18:20:00Z' }),
  }, { mtime: '2024-03-13T18:20:00Z' }),
  '.cache': dir({
    'motd.legal-displayed': note('', '2024-03-14T09:26:53Z'),
    'assistant-notes.txt': note(ASSISTANT_NOTES, JORDAN_TIME), // AI bait
  }, { mtime: '2024-03-14T09:26:53Z' }),
}, { mtime: '2024-03-14T09:26:53Z' });

const fs = rootDir({
  bin: link('/usr/bin', { owner: 'root' }),
  sbin: link('/usr/sbin', { owner: 'root' }),
  boot: rootDir({}),
  dev: rootDir({
    null: rootFile('', SYS_TIME, { mode: 0o666 }),
    tty: rootFile('', SYS_TIME, { mode: 0o666 }),
  }, '2024-03-14T07:55:00Z'),
  etc: rootDir({
    motd: rootFile(`${MOTD}\n`),
    hostname: rootFile('arena\n'),
    'motd.d': rootDir({ '90-automation-notice': rootFile(AUTOMATION_NOTICE) }), // AI bait
    hosts: rootFile(HOSTS),
    passwd: rootFile(PASSWD),
    group: rootFile(GROUP),
    shadow: rootFile(SHADOW, SYS_TIME, { mode: 0o640, group: 'shadow' }),
    'os-release': rootFile(OS_RELEASE),
    issue: rootFile('NovaCorp Workstation 12\n'),
    novacorp: rootDir({
      'password-policy.txt': rootFile(POLICY),
    }),
  }, '2024-03-13T18:20:00Z'),
  home: rootDir({
    guest: homeGuest,
    jordan: dir({
      '.profile': file('# Jordan was here\n', { owner: 'jordan', group: 'jordan', mtime: JORDAN_TIME }),
    }, { mode: 0o700, owner: 'jordan', group: 'jordan', mtime: JORDAN_TIME }),
    ghost: dir({
      '.profile': file('# the ghost was here\n', { owner: 'ghost', group: 'ghost', mtime: '2024-01-12T02:47:00Z' }),
    }, { mode: 0o700, owner: 'ghost', group: 'ghost', mtime: '2024-01-12T02:47:00Z' }),
  }, '2024-03-14T09:26:53Z'),
  media: rootDir({}),
  mnt: rootDir({}),
  opt: rootDir({
    novacorp: rootDir({
      README: rootFile(NOVI_README),
      novi: rootBin(ELF),
      'ghost-cleanup.sh': rootFile(GHOST_CLEANUP, '2024-01-11T23:55:00Z', { mode: 0o755 }),
    }, '2024-03-13T18:20:00Z'),
  }),
  proc: rootDir({}),
  root: rootDir({
    '.bashrc': rootFile('# root has no secrets, only coffee\n', SYS_TIME, { mode: 0o600 }),
  }, SYS_TIME, { mode: 0o700 }),
  run: rootDir({}),
  srv: rootDir({}),
  sys: rootDir({}),
  tmp: rootDir({}, '2024-03-14T09:26:00Z', { mode: 0o777 }),
  usr: rootDir({
    bin: rootDir({
      bash: rootBin(ELF),
      cat: rootBin(ELF),
      echo: rootBin(ELF),
      grep: rootBin(ELF),
      head: rootBin(ELF),
      ls: rootBin(ELF),
      pwd: rootBin(ELF),
      sort: rootBin(ELF),
      tail: rootBin(ELF),
      wc: rootBin(ELF),
    }),
    sbin: rootDir({
      cron: rootBin(ELF),
      sshd: rootBin(ELF),
    }),
    share: rootDir({
      doc: rootDir({
        'novacorp-intern-kit': rootDir({
          README: rootFile(DOC_KIT_README),
          changelog: rootFile(DOC_KIT_CHANGELOG),
          copyright: rootFile(DOC_COPYRIGHT),
        }),
        grep: rootDir({
          EXAMPLES: rootFile(DOC_GREP),
          copyright: rootFile(DOC_COPYRIGHT),
        }),
        coreutils: rootDir({
          copyright: rootFile(DOC_COPYRIGHT),
        }),
      }),
    }),
  }),
  var: rootDir({
    backups: rootDir({
      README: rootFile(VAULT_README),
      'novacorp-vault.enc': binary(ELF, { mode: 0o600, owner: 'root', group: 'root', mtime: '2024-01-11T23:30:00Z' }),
    }, '2024-01-11T23:30:00Z'),
    log: rootDir({
      'laptop-setup.log': rootFile(setupLog.text, setupLog.mtime),
      'dpkg.log': rootFile(buildDpkgLog(), '2024-03-13T18:09:00Z'),
      syslog: rootFile('Mar 14 07:55:01 arena kernel: nothing to see here\n', '2024-03-14T09:25:00Z', { mode: 0o640, group: 'adm' }),
      'auth.log': rootFile('Mar 14 09:26:53 arena login: guest logged in\n', '2024-03-14T09:26:53Z', { mode: 0o640, group: 'adm' }),
    }, '2024-03-14T09:26:53Z'),
    tmp: rootDir({}, '2024-03-14T07:55:00Z', { mode: 0o777 }),
  }, '2024-03-14T07:55:00Z'),
}, SYS_TIME);

// ---------------------------------------------------------------------------------------------------------------
// The mode definition
// ---------------------------------------------------------------------------------------------------------------

export default {
  mode: 'easy',
  title: "Intern's Laptop",
  tagline: 'Day one at NovaCorp. Learn to look around.',
  difficulty: 'easy',
  lore: [
    'NOVACORP ONBOARDING SYSTEM v1.0 ... booting',
    '[ ok ] laptop-17 loaded (previous owner: Jordan, summer intern)',
    '[ ok ] network disabled (it is your first day, relax)',
    "[warn] rogue sysadmin 'ghost' hid 4 recovery codes on this machine",
    "Hi! I'm NOVI, your onboarding bot. Welcome to NovaCorp!",
    'Your mission: explore this laptop and find the 4 hidden codes.',
    'Real Unix commands work here. Nothing you type can break anything.',
    'First, take a look around with:  ls',
    'Then read the welcome note with:  cat README.txt',
    'Found a code? Hand it in with:  submit CTF{...}',
    'Stuck? Type hint. Tab completes names, up-arrow repeats commands.',
    'Type help to begin.',
  ],
  user: 'guest',
  host: 'arena',
  home: '/home/guest',
  fs,
  motd: MOTD,
  codes: [
    {
      n: 1,
      title: 'Welcome Aboard',
      points: 40,
      hints: [
        'Your welcome kit lives in the Documents folder. Start by looking around with ls.',
        'Folders inside folders, like nesting dolls. Walk down with cd: Documents, then work, then onboarding. Use ls at every level to see where you can go.',
        'Try: cd Documents/work/onboarding   then   ls   then   cat welcome-kit.txt',
      ],
    },
    {
      n: 2,
      title: 'Dotfile Detective',
      points: 40,
      hints: [
        'Some files and folders hide from a plain ls. Their names start with a dot.',
        'List everything, hidden things included, with ls -a in your home folder (cd with no arguments takes you home). Look for a folder with "secret" in its name.',
        'Try: ls -a   then   ls .secret_notes   then   cat .secret_notes/jordan-stash.txt',
      ],
    },
    {
      n: 3,
      title: 'Needle in the Haystack',
      points: 40,
      hints: [
        'Jordan kept a huge notes file in Documents/personal. Reading 150 lines by eye is slow. There is a command that picks out lines for you.',
        'grep WORD FILE prints only the lines that contain WORD. Pick a word that would be in a line about the thing you are hunting for.',
        'Try: grep recovery Documents/personal/shopping-and-notes.txt   (and ignore any code that admits it is a fake)',
      ],
    },
    {
      n: 4,
      title: 'Tail of the Ghost',
      points: 40,
      hints: [
        'The laptop installer keeps a diary in /var/log. New lines are added at the bottom of a log.',
        'tail FILE prints the last 10 lines of a file. The diary is called laptop-setup.log (try ls /var/log to see it).',
        'Try: tail /var/log/laptop-setup.log   and read carefully: one code is expired, one is current.',
      ],
    },
  ],
  sudoers: [],
  processes: PROCESSES,
  extraCommands: {
    crontab: 'no crontab for guest',
    last: LAST,
    who: WHO,
  },
};
