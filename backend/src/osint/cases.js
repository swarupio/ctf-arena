// The four OSINT Trail cases: story, questions, fixed points, hints and answer matching (docs/OSINT_TRAIL.md).
// Answers are pure functions of the per-team world. Nothing here touches the database or the network.
import { createHash, timingSafeEqual } from 'node:crypto';
import { PLOTS } from './plots.js';
import { TRACK_IDS, buildBase, caseSeed } from './world.js';

export { TRACK_IDS };

// The final stage of a case is `final: true`; it stays locked until every other question is solved.
const q = (n, kind, title, prompt, points, hints = [], final = false) => ({ n, kind, title, prompt, points, hints, final });

const POINT_TOLERANCE = 70;

export const TRACKS = {
  easy: {
    id: 'easy',
    title: 'Easy',
    caseTitle: 'Ledger at Low Tide',
    difficulty: 'easy',
    tagline: 'One handle, one town, one missing ledger.',
    hintsAllowed: true,
    story: (pub) => [
      `The depot ledger of ${pub.company} vanished the night before the audit. Your only lead is a social account, @${pub.handle}, that belongs to the courier who was last seen carrying it.`,
      'Everything you need is public: the Social Feed, the company Web Archive, the Registry and the Map. Pin what matters in your Notes, then name who has the ledger.',
      'Nothing here is real: the town, the company and everyone in it are invented for this game.',
    ],
    stages: [
      q(1, 'name', 'Behind the handle', (p) => `Who is the person behind the account @${p.handle}? (full name)`, 20, [
        'Profiles in the Social Feed only show handles and first names. Real names are on the company website.',
        'Open the Web Archive and read the staff page: every entry lists a social handle.',
      ]),
      q(2, 'landmark', 'Evening check-in', (p) => `Which place did that person tag themselves at on the evening of ${p.date}?`, 25, [
        'Filter the Social Feed by that account and look at the dates.',
        'The place under a post is the tag. Match its name with the Map.',
      ]),
      q(3, 'domain', 'The side project', () => 'Which domain in the Registry is registered to that person? (their own name, not a company or a privacy service)', 25, [
        'The Registry lists the registrant of every domain.',
        'Several domains belong to colleagues. Look for the exact full name.',
      ]),
      q(4, 'date', 'Birthday of a domain', () => 'On what date was that domain created? (YYYY-MM-DD)', 30, [
        'Open the WHOIS record of the domain you just found.',
        'The "created" line starts with the date.',
      ]),
      q(5, 'name', 'Who has the ledger?', (p) => `Somebody admits to having ${p.company}'s ledger in the paste dump. Who is it? (full name)`, 50, [
        'Read the pastes. One chat says "i have the ledger".',
        'The speaker is a handle. Map it to a name with the staff page.',
      ], true),
    ],
  },
  medium: {
    id: 'medium',
    title: 'Medium',
    caseTitle: 'The Leaked Route Plan',
    difficulty: 'medium',
    tagline: 'Patterns, codes, photo tags and a document trail.',
    hintsAllowed: true,
    story: (pub) => [
      `A confidential document, the "Q3 Route Plan", has leaked from ${pub.company}. The trail runs through ${pub.name}, ${pub.role}, who is either the leaker or the unlucky last editor.`,
      'Sort the facts from the decoys: look-alike codes, photos from other days and documents with the same title style.',
      'Nothing here is real: the town, the company and everyone in it are invented for this game.',
    ],
    stages: [
      q(1, 'email', 'The work address', (p) => `What is ${p.name}'s work e-mail address?`, 40, [
        'The staff page hides this address, but not those of their colleagues. Look at the pattern.',
        'Search the corpus for the surname. A memo copies people in.',
      ]),
      q(2, 'domain', 'The verification code', () => 'The profile of that person carries a site verification code. Which domain publishes the same code in its DNS records?', 50, [
        'Search the code in the box above. DNS TXT records are searchable.',
      ]),
      q(3, 'cell', 'Where was the photo taken?', (p) => `On ${p.photoDate} they posted a photo without saying where. In which map grid cell (for example C4) was it taken?`, 50, [
        'Open the Photos tab: GPS tags are in the metadata table.',
        'The Map shows the survey bounds and has a converter from latitude and longitude to a cell.',
      ]),
      q(4, 'name', 'Tagged', (p) => `On ${p.tagDate} a colleague posted a photo that tags them. Who posted it? (full name)`, 60, [
        'Filter the feed by date. Posts show who is tagged.',
      ]),
      q(5, 'name', 'Who created the leak?', () => 'Who created (not last edited) the leaked document "Q3 Route Plan"? (full name)', 100, [
        'The Web Archive lists documents with author and last editor as usernames.',
      ], true),
    ],
  },
  hard: {
    id: 'hard',
    title: 'Hard',
    caseTitle: 'Tidewatch',
    difficulty: 'hard',
    tagline: 'Archived pages, shared servers, time zones and street corners.',
    hintsAllowed: false,
    story: (pub) => [
      `Someone left ${pub.company} without saying goodbye, and ${pub.town} has not heard from them since. They left a trail: archived web pages, a blog on shared hosting, photos and a few encoded notes.`,
      `Careful with clocks: the town runs on ${pub.tzLabel}, while their camera does not. No hints for this case.`,
      'Nothing here is real: the town, the company and everyone in it are invented for this game.',
    ],
    stages: [
      q(1, 'name', 'The empty chair', (p) => `One person is on the archived staff page (${p.snapshotDate}) but missing from the current one. Who? (full name)`, 70),
      q(2, 'domain', 'Same roof', () => 'That person\'s profile links to a personal blog. Which OTHER domain in the Registry has an A record with the very same IP address?', 80),
      q(3, 'time', 'The last photo', (p) => `At what local time in ${p.town} (${p.tzLabel}), written HH:MM, was that person's most recent photo taken?`, 90),
      q(4, 'landmark', 'The street sign', () => 'One of their photos has no GPS tags but shows a street sign. Which landmark stands at that corner?', 100),
      q(5, 'word', 'Dead drop', () => 'A dead-drop paste holds three encoded lines. One of them decodes to a codeword. What is it?', 110),
      q(6, 'landmark', 'Dawn rendezvous', () => 'Where will they be at dawn? Name the landmark. (Blocks count streets, as in the paste.)', 200, [], true),
    ],
  },
  insane: {
    id: 'insane',
    title: 'Insane',
    caseTitle: 'Nightjar',
    difficulty: 'insane',
    tagline: 'Three sources per answer, forged clocks and a namesake or two.',
    hintsAllowed: false,
    story: (pub) => [
      `An anonymous account, ${pub.alias}, mirrors stolen files from ${pub.town}. It lies about when and where it posts. Every answer needs at least three sources, and the obvious one is often the decoy.`,
      'Time stamps carry offsets. Camera clocks can be wrong, posters can lie, satellites cannot. Two pastes disagree: only the newest instant counts.',
      'No hints. Nothing here is real: the town, the company and everyone in it are invented for this game.',
    ],
    stages: [
      q(1, 'name', 'Behind the alias', (p) => `Who is behind the alias ${p.alias}? (full name)`, 120),
      q(2, 'ip', 'The mirror', (p) => `${p.alias} announced a mirror host in the paste dump. Follow its DNS records through every hop: which IP address does it finally resolve to?`, 140),
      q(3, 'time', 'The true time', (p) => `At what UTC time, written HH:MM, was the photo of ${p.alias} actually taken?`, 160),
      q(4, 'landmark', 'The true place', (p) => `Where was ${p.alias} really standing for that photo? Name the landmark.`, 180),
      q(5, 'name', 'Company', () => 'Someone else posted from that same landmark within 15 minutes of the photo (compare real instants, not clock faces). Who? (full name)', 200),
      q(6, 'point', 'The drop', () => `Where will the drop be? Click the map or enter map units as x,y (for example 512,430). Anything within ${POINT_TOLERANCE} units counts.`, 400, [], true),
    ],
  },
};

export const maxPointsOf = (track) => track.stages.reduce((total, stage) => total + stage.points, 0);
for (const id of TRACK_IDS) { TRACKS[id].maxPoints = maxPointsOf(TRACKS[id]); }
export const OSINT_MAX_POINTS = TRACK_IDS.reduce((total, id) => total + TRACKS[id].maxPoints, 0);
export const getTrack = (id) => (Object.hasOwn(TRACKS, id) ? TRACKS[id] : null);

export const FORMATS = {
  name: 'Full name, for example First Last',
  landmark: 'The name of the place, as written on the Map',
  domain: 'A domain name, for example something.example',
  email: 'An e-mail address',
  ip: 'An IPv4 address, for example 203.0.113.9',
  date: 'YYYY-MM-DD',
  time: 'HH:MM (24 hours)',
  cell: 'A map grid cell, for example C4',
  point: 'x,y in map units, for example 512,430',
  word: 'A single word',
};

// The world and the secret answers of one team's case. Pure: same inputs, same output, on every replica.
export function buildCase(secret, teamId, trackId) {
  const seed = caseSeed(secret, teamId, trackId);
  const world = buildBase(seed, trackId);
  const { pub, ans } = PLOTS[trackId](world);
  return { world, pub, ans };
}

// ---- answer matching ------------------------------------------------------------------------------------
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const squash = (text) => String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function normalizeName(raw) {
  let text = squash(raw).replace(/\b(dr|mr|mrs|ms|prof)\b\.?/g, ' ');
  if (text.includes(',')) { text = text.split(',').map((part) => part.trim()).reverse().join(' '); }
  return text.replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeDate(raw) {
  const text = squash(raw).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[t ].*)?$/.exec(text);
  if (m) { return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; }
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/.exec(text);
  if (m && MONTHS.some((name) => name.startsWith(m[2]) && m[2].length >= 3)) {
    return `${m[3]}-${String(MONTHS.findIndex((name) => name.startsWith(m[2])) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(text);
  if (m && MONTHS.some((name) => name.startsWith(m[1]) && m[1].length >= 3)) {
    return `${m[3]}-${String(MONTHS.findIndex((name) => name.startsWith(m[1])) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return `raw:${text}`;
}
function normalizeTime(raw) {
  const m = /^(\d{1,2})[:.h](\d{2})(?::\d{2})?\s*(?:utc|z|local)?$/.exec(squash(raw).trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : `raw:${squash(raw).trim()}`;
}
function normalizeDomain(raw) {
  return squash(raw).trim().replace(/^[a-z]+:\/\//, '').replace(/[/?#:].*$/, '').replace(/^www\./, '').replace(/\.$/, '');
}
function normalizeCell(raw) {
  const m = /^([a-h])\s*[- ]?\s*([1-8])$/.exec(squash(raw).trim());
  return m ? `${m[1].toUpperCase()}${m[2]}` : `raw:${squash(raw).trim()}`;
}
// "x,y" in map units. Inside the tolerance the submission collapses to the true point, so one digest comparison decides.
function normalizePoint(raw, truth) {
  const m = /^\(?\s*(-?\d{1,4})(?:\.\d+)?\s*[,; ]\s*(-?\d{1,4})(?:\.\d+)?\s*\)?$/.exec(String(raw).trim());
  if (!m) { return 'invalid'; }
  const [tx, ty] = String(truth).split(',').map(Number);
  return Math.hypot(Number(m[1]) - tx, Number(m[2]) - ty) <= POINT_TOLERANCE ? String(truth) : 'miss';
}

export function normalizeAnswer(kind, raw, truth = '') {
  switch (kind) {
    case 'name': return normalizeName(raw);
    case 'landmark': return squash(raw).replace(/&/g, ' and ').replace(/^\s*the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
    case 'domain': return normalizeDomain(raw);
    case 'email': return squash(raw).trim().replace(/^mailto:/, '').replace(/^<|>$/g, '');
    case 'ip': return squash(raw).trim();
    case 'date': return normalizeDate(raw);
    case 'time': return normalizeTime(raw);
    case 'cell': return normalizeCell(raw);
    case 'point': return normalizePoint(raw, truth);
    default: return squash(raw).replace(/[^a-z0-9]/g, '');
  }
}

const digest = (text) => createHash('sha256').update(`osint-answer:${text}`).digest();
// Compares fixed-length digests of the normalised values, so neither length nor content leaks through timing.
export function answerMatches(kind, submitted, truth) {
  return timingSafeEqual(digest(normalizeAnswer(kind, submitted, truth)), digest(normalizeAnswer(kind, truth, truth)));
}

export const answerFormat = (stage) => FORMATS[stage.kind];

const WRONG = [
  'The trail goes cold. That is not it.',
  'Not quite. Check the source again.',
  'A decoy, perhaps? Look for what the others missed.',
  'Close the notebook, open it again: something does not fit.',
  'The desk lamp flickers. Wrong answer.',
];
const RIGHT = [
  'Confirmed. Pin it to your board.',
  'The pieces click together. Well found.',
  'Good catch. That fits all the sources.',
  'Verified. The corkboard thanks you.',
];
const pickMessage = (list, text) => list[createHash('sha256').update(text).digest()[0] % list.length];
export const wrongMessage = (text) => pickMessage(WRONG, text);
export const rightMessage = (text) => pickMessage(RIGHT, text);
export const CASE_CLOSED = 'Case closed. The trail ends here.';
