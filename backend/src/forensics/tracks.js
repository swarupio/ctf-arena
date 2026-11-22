// The four Forensics Desk tracks: story, artefacts, stages, points and the (server-side) answer of every stage.
// Answers are pure functions of the per-team scenario; this module never touches the database or the network.
import { createHash } from 'node:crypto';
import { int, pick } from '../terminal/gen.js';
import {
  NAMES, SURNAMES, WORDS, buildScenario, fullName, pickDistinct, publicIp, rngFor, trackSeed,
} from './core.js';
import {
  CLUSTERS_PER_REQUEST, STEGO_IMAGES, diskClusters, diskListing, exifTable, hexFilePage, stegoImage,
  HEX_PAGE_MAX,
} from './files.js';
import { LOG_PAGE_MAX, logLevel, logPage, logPlan } from './logs.js';
import { PACKET_PAGE_MAX, packetLevel, packetPage, packetPlan } from './packets.js';

export const TRACK_IDS = ['easy', 'medium', 'hard', 'insane'];

const FORMATS = {
  ip: 'An IPv4 address, for example 203.0.113.9',
  user: 'A username, lower case',
  time: 'HH:MM:SS (UTC), copied from the log',
  file: 'A file name, for example report.tar.gz',
  domain: 'A domain name',
  int: 'A whole number of seconds',
  word: 'A single word',
  pass: 'Words and digits joined by dashes',
  handle: 'A handle: a word followed by two digits',
  key: 'A key such as word-123',
  token: 'Two groups of hex digits joined by a dash',
  name: 'A suspect\'s full name, for example Maya Okafor',
};

const stage = (n, kind, title, prompt, points, answer, hint) => ({ n, kind, title, prompt, points, answer, hint });

// ---- stage banks -----------------------------------------------------------------------------------------
const EASY = [
  stage(1, 'ip', 'The intruder', 'One address hammered the SSH login and then got in. Which IP address is the attacker?', 20, (c) => c.scn.attackerIp,
    'Failed password lines come in bursts. Search for "Failed password" and look at who keeps appearing, then see who finally got "Accepted".'),
  stage(2, 'user', 'First victim', 'Which account did the attacker compromise first?', 20, (c) => c.scn.victim,
    'Filter the log by the attacker\'s IP. The first "Accepted password" line names the account.'),
  stage(3, 'time', 'Time of breach', 'At what time did that first successful login happen?', 30, (c) => c.log().breachTime,
    'Every line starts with a timestamp (UTC). Copy the HH:MM:SS of the first Accepted line.'),
  stage(4, 'file', 'The stolen goods', 'Which file did the attacker download in the end? Look for a very large 200 response.', 30, (c) => c.scn.exfilFile,
    'Try the regex download\\?file= together with the attacker\'s IP. The size is the number after the status code.'),
];
const MEDIUM = [
  stage(1, 'ip', 'Patient zero', 'One workstation phones home to an outside server again and again. What is its IP address?', 40, (c) => c.packet().host,
    'Filter on proto == http and look for a POST /beacon repeated at a steady rhythm.'),
  stage(2, 'domain', 'The C2 name', 'Which domain name does the infected host look up right before the first beacon?', 50, (c) => c.scn.c2Domain,
    'Use the filter: proto == dns && ip.src == <infected host>. The lookup that precedes the beacons is yours.'),
  stage(3, 'int', 'Heartbeat', 'How many seconds pass between two beacons of the implant to its server?', 60, (c) => String(c.scn.interval),
    'Filter on the C2 address and subtract the timestamps of consecutive POST /beacon packets.'),
  stage(4, 'word', 'Codename', 'The implant was tasked to steal a file and sent it to a drop server. What CODENAME is inside the stolen data?', 70, (c) => c.scn.codename,
    'Follow the stream to the drop server (port 9001). The payload is base64; the decoder tool can read it.'),
];
const HARD = [
  stage(1, 'pass', 'Trailing bytes', 'Something was glued to the end of evidence_a.jpg after its end-of-image marker (FF D9). What passphrase does it hold?', 80, (c) => c.scn.hexPass,
    'Jump to the end of the file in the hex editor. The trailer is encoded.'),
  stage(2, 'handle', 'Metadata slip', 'evidence_b.jpg carries a user comment the owner forgot about. Which handle does it reveal?', 90, (c) => c.scn.handle, null),
  stage(3, 'key', 'Hidden in the pixels', 'The least significant bits of one colour channel of the image hide a short message. What is the KEY?', 110, (c) => c.scn.stegoKey, null),
  stage(4, 'token', 'Deleted, not gone', 'The suspect deleted a scratch note shortly before the seizure. Recover it from the disk. What TOKEN does it contain?', 120, (c) => c.scn.deletedToken, null),
];
const INSANE = [
  stage(1, 'user', 'Back door', 'Someone opened a persistent back door on the server after getting in. Which account did they create?', 150, (c) => c.scn.backdoor, null),
  stage(2, 'int', 'Same attacker, other cable', 'The attacker\'s server also appears in the packet capture. How many seconds between its beacons?', 170, (c) => String(c.scn.interval), null),
  stage(3, 'token', 'What was deleted?', 'The implant was told which file to steal. A deleted copy of that file left a note on the disk. What TOKEN does it hold?', 190, (c) => c.scn.deletedToken, null),
  stage(4, 'key', 'The right picture', 'The note points to one of the images. What KEY is hidden in it?', 210, (c) => c.scn.stegoKey, null),
];

// The suspect board: every clue is the answer of an earlier stage (`stage`) shown as a card attribute.
const CLUES = {
  easy: [['Logs in from', 1, 'ip'], ['Sits next to account', 2, 'user'], ['Seen online at', 3, 'time'], ['Had access to', 4, 'file']],
  medium: [['Workstation', 1, 'ip'], ['Frequently visits', 2, 'domain'], ['Scheduled job every (s)', 3, 'int'], ['Working on project', 4, 'word']],
  hard: [['Notebook passphrase', 1, 'pass'], ['Online handle', 2, 'handle'], ['Locker key', 3, 'key'], ['Access token', 4, 'token']],
  insane: [['Account created', 1, 'user'], ['Beacon every (s)', 2, 'int'], ['Access token', 3, 'token'], ['Locker key', 4, 'key']],
};

const BANKS = {
  easy: EASY, medium: MEDIUM, hard: HARD, insane: INSANE,
};
const WHO_POINTS = {
  easy: 60, medium: 130, hard: 200, insane: 480,
};
const WHO_PROMPT = {
  easy: 'Case closed? The suspect board lists everyone with access. Exactly one person matches ALL the evidence cards. Who did it?',
  medium: 'Match the evidence cards against the suspect board. Only one suspect fits every clue. Who is the culprit?',
  hard: 'Every confirmed clue is on your evidence board. Several suspects match two or three of them. Name the one who matches all four.',
  insane: 'You have everything. The suspects are good at looking innocent. Name the person who matches every clue.',
};

const TRACK_META = {
  easy: {
    title: 'Log Detective', caseTitle: 'The Midnight Login', difficulty: 'easy', level: 'easy', hints: true,
    tagline: 'Read the server log. Find who broke in.',
    briefing: [
      'CASE FILE FD-001. CLASSIFICATION: TRAINEE.',
      'At 01:00 the night watch noticed the shared web server acting strangely. Nothing crashed. Nothing was defaced. That is what bothers us.',
      'You have the combined web-server and SSH log of the whole night. Somewhere in it a stranger knocked on the door until it opened.',
      'Use the log viewer: search, filter and regex are all on your side. The suspects are on the board, but you will only know them once the evidence says so.',
    ],
  },
  medium: {
    title: 'Packet Hunt', caseTitle: 'Operation Quiet Beacon', difficulty: 'medium', level: 'medium', hints: true,
    tagline: 'A workstation is calling home. Follow the wire.',
    briefing: [
      'CASE FILE FD-002. CLASSIFICATION: ANALYST.',
      'The log review found nothing, yet the network team swears something is talking to the outside at odd hours.',
      'You have twenty minutes of capture from the office switch: every packet has a timestamp, addresses, a protocol and a payload.',
      'Filter the table, follow a stream, decode what you find. Honest services are chatty too, so do not trust the first periodic thing you see.',
    ],
  },
  hard: {
    title: 'Artefact Lab', caseTitle: 'The Photographer\'s Alibi', difficulty: 'hard', level: 'hard', hints: false,
    tagline: 'Two photos and a seized disk. Dig under the surface.',
    briefing: [
      'CASE FILE FD-003. CLASSIFICATION: SENIOR ANALYST.',
      'A freelance photographer swears he never touched the leaked documents. Police seized two photographs and a disk image from his studio.',
      'Hex editor, metadata table, pixel grid, disk listing: the lab has every tool. The suspect was careless, not stupid.',
      'No hints on this one. The artefacts are all you get.',
    ],
  },
  insane: {
    title: 'The Long Night', caseTitle: 'The Long Night', difficulty: 'insane', level: 'insane', hints: false,
    tagline: 'Logs, packets and files. One story. No help.',
    briefing: [
      'CASE FILE FD-004. CLASSIFICATION: EYES ONLY.',
      'Hours of noisy logs. A busy network capture. A disk that has been used and abused. All three belong to the same incident.',
      'There are decoys everywhere: a VPN login that is innocent, a beacon that is a red herring, deleted files that mean nothing.',
      'Nothing here answers a question on its own. The answer to one stage is the key to the next. No hints, no mercy.',
    ],
  },
};

const ARTEFACTS = {
  log: { id: 'log', title: 'Server log', kind: 'log' },
  capture: { id: 'capture', title: 'Packet capture', kind: 'packets' },
  hexfile: { id: 'hexfile', title: 'evidence_a.jpg (hex)', kind: 'hex' },
  exif: { id: 'exif', title: 'evidence_b.jpg (metadata)', kind: 'exif' },
  stego: { id: 'stego', title: 'Pixel grid', kind: 'stego' },
  disk: { id: 'disk', title: 'Seized disk', kind: 'disk' },
};
const TRACK_ARTEFACTS = {
  easy: ['log'], medium: ['capture'], hard: ['hexfile', 'exif', 'stego', 'disk'], insane: ['log', 'capture', 'stego', 'disk'],
};

function build(id) {
  const meta = TRACK_META[id];
  const stages = [...BANKS[id].map((s) => ({ ...s, hint: meta.hints ? s.hint : null })),
    stage(5, 'name', 'Whodunit', WHO_PROMPT[id], WHO_POINTS[id], (c) => c.culprit().name, null)];
  stages[4].whodunit = true;
  return {
    id, ...meta, stages, clues: CLUES[id], artefacts: TRACK_ARTEFACTS[id].map((a) => ARTEFACTS[a]),
    maxPoints: stages.reduce((total, s) => total + s.points, 0),
  };
}

export const TRACKS = Object.freeze(Object.fromEntries(TRACK_IDS.map((id) => [id, build(id)])));
export const getTrack = (id) => (Object.hasOwn(TRACKS, id) ? TRACKS[id] : null);
export const FORENSICS_MAX_POINTS = TRACK_IDS.reduce((total, id) => total + TRACKS[id].maxPoints, 0);
export const answerFormat = (stageDef) => FORMATS[stageDef.kind];

// ---- answer handling -------------------------------------------------------------------------------------
// Same normalisation for the expected and the submitted text, so format quirks never decide correctness.
export function normalizeAnswer(kind, text) {
  const plain = String(text).trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (kind === 'time') {
    const match = /(\d{1,2}):(\d{2}):(\d{2})/.exec(plain);
    return match ? `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}` : plain;
  }
  if (kind === 'int') {
    const match = /^(\d+)\s*(?:s|sec|secs|second|seconds)?$/.exec(plain);
    return match ? String(Number(match[1])) : plain;
  }
  return plain;
}

// ---- per-request context (everything lazy and memoised for this one request) ------------------------------
export function makeContext(trackId, secret, teamId) {
  const track = getTrack(trackId);
  const seed = trackSeed(secret, teamId, trackId);
  const scn = buildScenario(seed);
  const level = track.level;
  const memo = {};
  const ctx = {
    track, seed, scn, level,
    log: () => (memo.log ??= logPlan(seed, level, scn)),
    packet: () => (memo.packet ??= packetPlan(seed, level, scn)),
    culprit: () => (memo.culprit ??= suspectsFor(ctx).culprit),
  };
  return ctx;
}

export function answerOf(ctx, n) {
  const def = ctx.track.stages.find((s) => s.n === n);
  return def ? def.answer(ctx) : null;
}

// ---- suspects --------------------------------------------------------------------------------------------
function decoyValue(kind, r) {
  switch (kind) {
    case 'ip': return publicIp(r);
    case 'user': return pick(r, [...NAMES, `svc-${pick(r, WORDS)}`]);
    case 'time': return `0${int(r, 1, 5)}:${String(int(r, 0, 59)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}`;
    case 'file': return `${pick(r, ['customer', 'payroll', 'invoices', 'roadmap', 'contracts', 'ledger'])}_${pick(r, WORDS)}.tar.gz`;
    case 'domain': return `cdn-${pick(r, WORDS)}${int(r, 2, 98)}.${pick(r, ['top', 'xyz', 'info'])}`;
    case 'int': return String(int(r, 20, 119));
    case 'word': return pick(r, WORDS);
    case 'pass': return `${pick(r, WORDS)}-${pick(r, WORDS)}-${int(r, 100, 999)}`;
    case 'handle': return `${pick(r, WORDS)}${int(r, 10, 99)}`;
    case 'key': return `${pick(r, WORDS)}-${int(r, 100, 999)}`;
    default: return `${int(r, 0x1000, 0xffff).toString(16)}-${int(r, 0x1000, 0xffff).toString(16)}`;
  }
}
// A decoy that equals the real answer would make the suspect match that clue after all (and could leave two culprits),
// so redraw until it differs. The redraws consume the same seeded rng, so the board stays deterministic per team.
function distinctDecoy(kind, r, answer) {
  const normal = normalizeAnswer(kind, answer);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = decoyValue(kind, r);
    if (normalizeAnswer(kind, value) !== normal) { return value; }
  }
  return `${decoyValue(kind, r)}x`;
}
const ROLES = ['Accountant', 'Sysadmin', 'Intern', 'Courier', 'Photographer', 'Night guard', 'Contractor', 'Analyst'];
export const SUSPECT_COUNT = 8;

// Eight suspects. The culprit matches every clue; each decoy matches a strict subset (some match three of four),
// so no single clue identifies anyone. `facts[k].value` holds the real clue text for every suspect.
export function suspectsFor(ctx) {
  const r = rngFor(ctx.seed, 'suspects');
  const { clues } = ctx.track;
  const firsts = pickDistinct(r, NAMES, SUSPECT_COUNT);
  const lasts = pickDistinct(r, SURNAMES, SUSPECT_COUNT);
  const culpritIndex = int(r, 0, SUSPECT_COUNT - 1);
  const roles = pickDistinct(r, ROLES, SUSPECT_COUNT);
  const suspects = firsts.map((first, index) => {
    const matches = index === culpritIndex ? clues.map(() => true) : (() => {
      const count = index % 2 === 0 ? clues.length - 1 : int(r, 0, 2);
      const chosen = new Set(pickDistinct(r, clues.map((_, k) => k), count));
      return clues.map((_, k) => chosen.has(k));
    })();
    return {
      id: `s${index + 1}`,
      name: fullName(first, lasts[index]),
      role: roles[index],
      facts: clues.map(([label, stageNo, kind], k) => ({
        label, stage: stageNo,
        value: matches[k] ? answerOf(ctx, stageNo) : distinctDecoy(kind, r, answerOf(ctx, stageNo)),
      })),
    };
  });
  return { suspects, culprit: suspects[culpritIndex] };
}

// ---- artefact dispatch -----------------------------------------------------------------------------------
export function artefactSummary(ctx, artefact) {
  const base = { ...artefact };
  if (artefact.kind === 'log') { return { ...base, total: logLevel(ctx.level).lines, pageMax: LOG_PAGE_MAX }; }
  if (artefact.kind === 'packets') { return { ...base, total: packetLevel(ctx.level).slots, pageMax: PACKET_PAGE_MAX }; }
  if (artefact.kind === 'hex') { return { ...base, pageMax: HEX_PAGE_MAX }; }
  if (artefact.kind === 'stego') { return { ...base, images: ctx.level === 'insane' ? STEGO_IMAGES : 1 }; }
  if (artefact.kind === 'disk') { return { ...base, clustersPerRequest: CLUSTERS_PER_REQUEST }; }
  return base;
}

// `query` is already validated (integers within range). Returns null for an artefact this track does not have.
export function artefactData(ctx, id, query) {
  if (!ctx.track.artefacts.some((a) => a.id === id)) { return null; }
  const { seed, scn, level } = ctx;
  switch (id) {
    case 'log': return logPage(seed, level, scn, query.offset, query.limit, ctx.log());
    case 'capture': return packetPage(seed, level, scn, query.offset, query.limit, ctx.packet());
    case 'hexfile': return hexFilePage(seed, scn, query.offset, query.limit);
    case 'exif': return exifTable(seed, scn);
    case 'stego': return stegoImage(seed, scn, level, level === 'insane' ? query.image : 1);
    case 'disk': return query.cluster === undefined ? diskListing(seed, scn, level) : diskClusters(seed, scn, level, query.cluster, query.count);
    default: return null;
  }
}

// Playful, deterministic feedback (stateless: the text depends on the answer text only).
const WRONG = ['Not quite. The trail is still warm.', 'Nope. Check your notes and look again.', 'That is a red herring, detective.',
  'The evidence disagrees. Try another angle.', 'Close, but this is not the one.', 'Hmm. The suspect wants you to think that.'];
const RIGHT = ['Case notes updated. Sharp eyes, detective!', 'Confirmed. A pin goes on the board.', 'Elementary. That one is nailed down.',
  'Evidence logged and stamped.'];
const pickByText = (list, text) => list[createHash('sha256').update(text).digest()[0] % list.length];
export const wrongMessage = (text) => pickByText(WRONG, text);
export const rightMessage = (text) => pickByText(RIGHT, text);
export const CASE_CLOSED = 'CASE CLOSED! The culprit is behind bars and the board is yours.';
