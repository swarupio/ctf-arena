// Which skills each flag teaches (docs/SKILLS_MAP.md). One entry per flag, grouped category -> track -> level.
//
// Ids mirror the real definitions (tests/skills.test.js cross-checks them against the backend modules):
//   terminal   track = mode (easy, medium, hard), level = code number
//   cipherlab  track = track id, level = level id (e1, m2, ...)
//   weblab     track = track id, level = lab id (sqli-login, ...)
//   forensics  track = case id, level = stage number
//   crackme    track = track id, level = level id
//   osint      track = case id, level = question number
//   challenges track = challenge type (static, docker), level = challenge slug
//
// Rules: 1 to 3 skills per flag, only what the flag really exercises. A flag we cannot judge carries just its
// plain CTF skill area. When three tags are not enough the NICE category is dropped first.

const A = {
  crypto: 'area-crypto', reverse: 'area-reverse', forensics: 'area-forensics', web: 'area-web', osint: 'area-osint',
  linux: 'area-linux', network: 'area-network',
};
const OW = (n) => `owasp-a${String(n).padStart(2, '0')}`;
const T = (id) => `attack-${id.toLowerCase().replace('.', '-')}`;
const N = (code) => `nice-${code.toLowerCase()}`;

const lv = (id, title, ...skills) => ({ id, title, skills });
const track = (id, title, ...levels) => ({ id, title, levels });

export const CATALOGUE = [
  {
    id: 'terminal',
    title: 'Arena Terminal',
    tracks: [
      track('easy', 'Intern\'s Laptop',
        lv('1', 'Welcome Aboard', A.linux, N('OM')),
        lv('2', 'Dotfile Detective', A.linux, T('T1083'), N('OM')),
        lv('3', 'Needle in the Haystack', A.linux, N('OM')),
        lv('4', 'Tail of the Ghost', A.linux, N('OM'))),
      track('medium', 'NovaCorp Server Room',
        lv('1', 'Needle in the Invoice Haystack', A.linux, T('T1083'), N('OM')),
        lv('2', 'The Visitor Who Came Once', A.linux, A.forensics, N('OM')),
        lv('3', 'Spot the Difference', A.linux, T('T1140'), N('OM')),
        lv('4', 'Held in the Spool', A.linux, T('T1083'), N('OM')),
        lv('5', 'Mirror, Mirror on the Wall', A.linux, T('T1083'), N('OM'))),
      track('hard', 'The Vault',
        lv('1', 'One in Eight Thousand', A.linux, A.forensics, N('OM')),
        lv('2', 'Peeling the Onion', A.linux, T('T1140'), N('OM')),
        lv('3', 'Strings Attached', A.linux, A.reverse, N('OM')),
        lv('4', 'Same Hash, Right Key', A.linux, A.crypto, N('OM')),
        lv('5', 'Root Said Yes (Once)', A.linux, T('T1548.003'), OW(5)),
        lv('6', 'Three Shares, One Ghost', A.linux, A.crypto, N('OM'))),
    ],
  },
  {
    id: 'cipherlab',
    title: 'Cipher Lab',
    tracks: [
      track('easy', 'Rookie Desk',
        lv('e1', 'Caesar\'s Coffee Order', A.crypto),
        lv('e2', 'Mirror, Mirror', A.crypto),
        lv('e3', 'Wrapped Twice', A.crypto, T('T1140')),
        lv('e4', 'Boss: The Doorman', A.crypto)),
      track('medium', 'Field Agent',
        lv('m1', 'The Keyed Note', A.crypto),
        lv('m2', 'XOR Marks the Spot', A.crypto),
        lv('m3', 'Zig-Zag Fence', A.crypto),
        lv('m4', 'Boss: The Scrambler', A.crypto)),
      track('hard', 'Cipher Master',
        lv('h1', 'Tiny Primes, Big Secrets', A.crypto, OW(2)),
        lv('h2', 'The Salted Password', A.crypto, OW(2), T('T1110.002')),
        lv('h3', 'Keyed and Hexed', A.crypto, T('T1140')),
        lv('h4', 'Boss: The Onion', A.crypto, T('T1140'))),
      track('insane', 'Black Chamber',
        lv('i1', 'Triple Wrap', A.crypto, T('T1140')),
        lv('i2', 'The Keyed Fence', A.crypto),
        lv('i3', 'Boss: The Black Chamber', A.crypto, T('T1140'))),
    ],
  },
  {
    id: 'weblab',
    title: 'Web Exploit Lab',
    tracks: [
      track('easy', 'RetroBank',
        lv('sqli-login', 'Teller Window', A.web, OW(3), N('PR')),
        lv('cookie-tamper', 'Cookie Jar', A.web, OW(1), N('PR')),
        lv('idor-statements', 'Statement Roulette', A.web, OW(1), N('PR'))),
      track('medium', 'Slice of Life Pizza',
        lv('path-traversal', 'Secret Dough', A.web, OW(1), N('PR')),
        lv('xss-filter', 'Review Rumble', A.web, OW(3), N('PR')),
        lv('jwt-none', 'Kitchen Pass', A.web, OW(7), N('PR'))),
      track('hard', 'Mercy General Hospital',
        lv('sqli-union', 'Patient Lookup', A.web, OW(3), N('PR')),
        lv('jwt-weak-secret', 'Staff SSO', A.web, OW(7), T('T1110.002')),
        lv('race-refill', 'Voucher Rush', A.web, OW(4), N('PR'))),
      track('insane', 'NovaCorp Cloud',
        lv('chain-vault', 'Operation Blackout', A.web, OW(1), OW(7))),
    ],
  },
  {
    id: 'forensics',
    title: 'Forensics Desk',
    tracks: [
      track('easy', 'The Midnight Login',
        lv('1', 'The intruder', A.forensics, T('T1110'), N('IN')),
        lv('2', 'First victim', A.forensics, T('T1078'), N('IN')),
        lv('3', 'Time of breach', A.forensics, N('IN')),
        lv('4', 'The stolen goods', A.forensics, N('IN')),
        lv('5', 'Whodunit', A.forensics, N('IN'))),
      track('medium', 'Operation Quiet Beacon',
        lv('1', 'Patient zero', A.network, A.forensics, T('T1071')),
        lv('2', 'The C2 name', A.network, A.forensics, T('T1071')),
        lv('3', 'Heartbeat', A.network, A.forensics, T('T1071')),
        lv('4', 'Codename', A.network, A.forensics, T('T1048')),
        lv('5', 'Whodunit', A.forensics, N('IN'))),
      track('hard', 'The Photographer\'s Alibi',
        lv('1', 'Trailing bytes', A.forensics, T('T1027'), N('IN')),
        lv('2', 'Metadata slip', A.forensics, N('IN')),
        lv('3', 'Hidden in the pixels', A.forensics, T('T1027.003'), N('IN')),
        lv('4', 'Deleted, not gone', A.forensics, T('T1070.004'), N('IN')),
        lv('5', 'Whodunit', A.forensics, N('IN'))),
      track('insane', 'The Long Night',
        lv('1', 'Back door', A.forensics, T('T1136'), N('IN')),
        lv('2', 'Same attacker, other cable', A.network, A.forensics, T('T1071')),
        lv('3', 'What was deleted?', A.forensics, T('T1070.004'), N('IN')),
        lv('4', 'The right picture', A.forensics, T('T1027.003'), N('IN')),
        lv('5', 'Whodunit', A.forensics, N('IN'))),
    ],
  },
  {
    id: 'crackme',
    title: 'Crackme Arcade',
    tracks: [
      track('easy', 'Coin Slot Corner',
        lv('e1', 'Pong Plus', A.reverse),
        lv('e2', 'Snake Byte', A.reverse, A.crypto),
        lv('e3', 'Galaga Gate', A.reverse),
        lv('e4', 'Boss: Dr. Pixel', A.reverse)),
      track('medium', 'High Score Alley',
        lv('m1', 'Tetris Lock', A.reverse),
        lv('m2', 'Pac-Maze', A.reverse, T('T1110.002')),
        lv('m3', 'Frogger Key', A.reverse),
        lv('m4', 'Boss: Chip Hacker', A.reverse)),
      track('hard', 'Attract Mode Basement',
        lv('h1', 'Fortress Serial', A.reverse),
        lv('h2', 'Anti-Debug Alley', A.reverse, T('T1622')),
        lv('h3', 'Tape Loop', A.reverse),
        lv('h4', 'Boss: The Warden', A.reverse)),
      track('insane', 'Warehouse of Lost ROMs',
        lv('i1', 'Self-Modifying Cabinet', A.reverse),
        lv('i2', 'Two-Face Cabinet', A.reverse, T('T1027.002'), T('T1622')),
        lv('i3', 'Ghost in the Machine', A.reverse),
        lv('i4', 'Final Boss: MEGA-ROM', A.reverse, T('T1027.002'), T('T1622'))),
    ],
  },
  {
    id: 'osint',
    title: 'OSINT Trail',
    tracks: [
      track('easy', 'Ledger at Low Tide',
        lv('1', 'Behind the handle', A.osint, T('T1589'), N('AN')),
        lv('2', 'Evening check-in', A.osint, T('T1593'), N('AN')),
        lv('3', 'The side project', A.osint, T('T1596'), N('AN')),
        lv('4', 'Birthday of a domain', A.osint, T('T1596'), N('AN')),
        lv('5', 'Who has the ledger?', A.osint, T('T1589'), N('AN'))),
      track('medium', 'The Leaked Route Plan',
        lv('1', 'The work address', A.osint, T('T1589'), N('AN')),
        lv('2', 'The verification code', A.osint, T('T1596'), N('AN')),
        lv('3', 'Where was the photo taken?', A.osint, T('T1593'), N('AN')),
        lv('4', 'Tagged', A.osint, T('T1593'), N('AN')),
        lv('5', 'Who created the leak?', A.osint, T('T1594'), N('AN'))),
      track('hard', 'Tidewatch',
        lv('1', 'The empty chair', A.osint, T('T1594'), N('AN')),
        lv('2', 'Same roof', A.osint, T('T1590'), N('AN')),
        lv('3', 'The last photo', A.osint, T('T1593'), N('AN')),
        lv('4', 'The street sign', A.osint, T('T1593'), N('AN')),
        lv('5', 'Dead drop', A.osint, T('T1140'), N('AN')),
        lv('6', 'Dawn rendezvous', A.osint, N('AN'))),
      track('insane', 'Nightjar',
        lv('1', 'Behind the alias', A.osint, T('T1589'), N('AN')),
        lv('2', 'The mirror', A.osint, A.network, T('T1590')),
        lv('3', 'The true time', A.osint, T('T1593'), N('AN')),
        lv('4', 'The true place', A.osint, T('T1593'), N('AN')),
        lv('5', 'Company', A.osint, T('T1593'), N('AN')),
        lv('6', 'The drop', A.osint, N('AN'))),
    ],
  },
  {
    id: 'challenges',
    title: 'Challenges',
    tracks: [
      // sanity-check (the welcome flag) teaches no skill and is left out on purpose.
      track('static', 'Static',
        lv('caesar-says', 'Caesar Says', A.crypto)),
      track('docker', 'Docker',
        lv('cookie-monster', 'Cookie Monster', A.web, OW(1), N('PR')),
        lv('login-bypass', 'Login Bypass', A.web, OW(3), N('PR')),
        lv('robots-rule', 'Robots Rule', A.web, OW(1), N('PR'))),
    ],
  },
];
