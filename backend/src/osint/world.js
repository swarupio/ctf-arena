// The fictional world of OSINT Trail (docs/OSINT_TRAIL.md). Everything here is invented: names come from syllables, towns
// and companies from word lists, domains end in .example / .invalid / .test, IP addresses sit in the three reserved
// documentation ranges and phone numbers in the 555-01xx block. Nothing is fetched and nothing is stored: the same
// (secret, team, case) gives the same world on every replica, and each stream of random numbers is labelled so that adding a
// field never moves the others. No Math.random(), no clock reads.
import { createHmac } from 'node:crypto';
import { int, pick, rng } from '../terminal/gen.js';
import { WORDS } from '../terminal/seedwords.js';
import { sceneFor } from './scenes.js';

export const TRACK_IDS = ['easy', 'medium', 'hard', 'insane'];
export const PREVIEW_TEAM = 'admin-preview';

// HMAC(FLAG_SECRET, 'osint:' + teamId + ':' + caseId): the only input of every generator. Never sent to the browser.
export const caseSeed = (secret, teamId, caseId) => createHmac('sha256', secret).update(`osint:${teamId}:${caseId}`).digest('hex');
export const rngFor = (seed, label) => rng(`${seed}|${label}`);

// Corpus size per track (cast includes alias accounts). Constant, so every request does bounded work.
export const CONFIG = {
  easy: { cast: 10, posts: 36, docs: 5, decoyDomains: 3, pastes: 2, zone: false, travel: false, landmarks: 12 },
  medium: { cast: 11, posts: 56, docs: 7, decoyDomains: 4, pastes: 3, zone: false, travel: false, landmarks: 14 },
  hard: { cast: 12, posts: 84, docs: 9, decoyDomains: 5, pastes: 4, zone: true, travel: false, landmarks: 15 },
  insane: { cast: 14, posts: 120, docs: 11, decoyDomains: 6, pastes: 5, zone: true, travel: true, landmarks: 16 },
};

// ---- time helpers ----------------------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
export function offsetLabel(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
// ISO-8601 with an explicit offset, e.g. 2031-03-14T22:10:00+05:30, for the instant `ms` shown in a zone of `offMin`.
export function isoAt(ms, offMin = 0) {
  const d = new Date(ms + offMin * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${offsetLabel(offMin)}`;
}
export const dateAt = (ms, off = 0) => isoAt(ms, off).slice(0, 10);
export const clockAt = (ms, off = 0) => isoAt(ms, off).slice(11, 16);
export const exifStamp = (ms, off = 0) => isoAt(ms, off).slice(0, 19).replace('T', ' ').replaceAll('-', ':');
export const DAY = 86_400_000;

// ---- names and places ------------------------------------------------------------------------------------
const F_A = ['Ma', 'Te', 'Li', 'Ro', 'Sa', 'Vi', 'No', 'Ka', 'Jo', 'Bri', 'Ila', 'Os', 'Ana', 'Tor', 'Dar', 'Eli', 'Fen', 'Gwy', 'Hes', 'Ivo', 'Lun', 'Mir', 'Nia', 'Pau', 'Rhe', 'Sol', 'Ty', 'Una', 'Wil', 'Zo'];
const F_B = ['ren', 'la', 'mon', 'vik', 'dra', 'nel', 'sa', 'ric', 'to', 'mir', 'thea', 'lan', 'ven', 'dis', 'bel', 'ra', 'sen', 'tin', 'mar', 'na'];
const L_A = ['Dov', 'Hal', 'Quin', 'Vel', 'Mar', 'Osk', 'Tarn', 'Brin', 'Cask', 'Fen', 'Garr', 'Lund', 'Pell', 'Rosk', 'Sav', 'Wick', 'Ash', 'Bel', 'Cor', 'Dun', 'Els', 'Fall', 'Gren', 'Holt', 'Ing', 'Jarl', 'Kest', 'Lor', 'Moss', 'Nor'];
const L_B = ['ik', 'ane', 'ford', 'mere', 'son', 'ley', 'row', 'stad', 'ova', 'wen', 'hart', 'lin', 'by', 'dal', 'wick', 'ton', 'er', 'sen', 'ski', 'den'];
const TOWN_A = ['Mar', 'Tern', 'Ash', 'Wren', 'Kel', 'Sorrel', 'Pike', 'Dun', 'Hob', 'Osper'];
const TOWN_B = ['wick', 'holm', 'mouth', 'haven', 'ford', 'stead', 'port', 'by', 'combe', 'ness'];
const CO_ADJ = ['Quillfeather', 'Brightvale', 'Copperlark', 'Hollowpine', 'Saltmoor', 'Ivywick', 'Larkmoor', 'Fennbrook', 'Ashlander', 'Greywren'];
const CO_NOUN = ['Freight', 'Provisions', 'Haulage', 'Couriers', 'Cargo', 'Dispatch', 'Carriers'];
const NETWORKS = ['Glimmerline', 'Chatterwick', 'Pinfeather', 'Tidebook', 'Hearthloop'];
const HOSTS = ['Lanternhost', 'Gullnet', 'Cairnhost', 'Ropewalk'];
const REGISTRARS = ['Quillnames Registry', 'Harbour Registrar Ltd', 'Cobble Domains', 'Ninepin Naming'];
const ROLES = [['Dispatch Lead', 'Operations'], ['Route Planner', 'Operations'], ['Accounts Clerk', 'Finance'], ['Procurement Lead', 'Finance'],
  ['Warehouse Supervisor', 'Warehouse'], ['Forklift Driver', 'Warehouse'], ['Fleet Mechanic', 'Fleet'], ['Courier', 'Operations'],
  ['IT Support', 'IT'], ['Customer Desk', 'Support'], ['Safety Officer', 'Compliance'], ['Billing Analyst', 'Finance'],
  ['Depot Manager', 'Operations'], ['Night Dispatcher', 'Operations'], ['Quality Inspector', 'Compliance'], ['Marketing Lead', 'Marketing']];
const HOBBIES = ['kites', 'sourdough', 'chess', 'rowing', 'birdwatching', 'vinyl', 'pottery', 'cycling', 'knitting', 'astronomy', 'crosswords', 'sketching'];
const STREETS_H = ['Lantern Row', 'Quarry Lane', 'Mill Street', 'Cobbler Walk', 'Harbour Road', 'Orchard Way', 'Fenn Street', 'Bellfounder Lane'];
const STREETS_V = ['Kettle Street', 'Rope Walk', 'Chandler Road', 'Weaver Lane', 'Gull Street', 'Anchor Way', 'Tannery Row', 'Pepper Lane'];
const LM_ADJ = ['Saltgrass', 'Copperleaf', 'Larkspur', 'Fogbell', 'Ember', 'Tidewick', 'Gorse', 'Pennywhistle', 'Hollowmere', 'Wrenfield', 'Cinder',
  'Maplethorn', 'Quillon', 'Sparrowgate', 'Thistledown', 'Ashgrove', 'Driftwood', 'Lanternfall', 'Ironbark', 'Mistral'];
export const LM_KINDS = [
  { kind: 'clock tower', nouns: ['Clock Tower', 'Bell Tower'], draw: 'tower' },
  { kind: 'pier', nouns: ['Pier', 'Jetty'], draw: 'pier' },
  { kind: 'cafe', nouns: ['Cafe', 'Tea Room'], draw: 'shop' },
  { kind: 'bakery', nouns: ['Bakery'], draw: 'shop' },
  { kind: 'park', nouns: ['Gardens', 'Green'], draw: 'park' },
  { kind: 'library', nouns: ['Library', 'Reading Room'], draw: 'columns' },
  { kind: 'museum', nouns: ['Museum'], draw: 'columns' },
  { kind: 'station', nouns: ['Station', 'Halt'], draw: 'station' },
  { kind: 'bridge', nouns: ['Bridge', 'Footbridge'], draw: 'bridge' },
  { kind: 'market', nouns: ['Market', 'Bazaar'], draw: 'market' },
  { kind: 'chapel', nouns: ['Chapel'], draw: 'chapel' },
  { kind: 'observatory', nouns: ['Observatory'], draw: 'dome' },
  { kind: 'lighthouse', nouns: ['Lighthouse'], draw: 'lighthouse' },
  { kind: 'schoolhouse', nouns: ['Schoolhouse'], draw: 'columns' },
  { kind: 'bookshop', nouns: ['Bookshop'], draw: 'shop' },
  { kind: 'fish market', nouns: ['Fish Hall'], draw: 'market' },
];

const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);
// Draws `count` distinct items.
function distinct(r, items, count) {
  const pool = [...items];
  const out = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) { out.push(pool.splice(int(r, 0, pool.length - 1), 1)[0]); }
  return out;
}
export { distinct };

// ---- map -------------------------------------------------------------------------------------------------
export const MAP_SIZE = 1000;
export const CELLS = 8;
const CELL = MAP_SIZE / CELLS;
export const cellOf = (x, y) => `${'ABCDEFGH'[Math.min(CELLS - 1, Math.max(0, Math.floor(x / CELL)))]}${Math.min(CELLS, Math.max(1, Math.floor(y / CELL) + 1))}`;
// Fictional survey bounds: a point (x, y) in map units has latitude 0.5 + (1000 - y) / 10000 and longitude 0.5 + x / 10000.
export const gpsOf = (x, y) => ({ lat: (0.5 + (MAP_SIZE - y) / 10_000).toFixed(5), lon: (0.5 + x / 10_000).toFixed(5) });
export const BOUNDS = { south: 0.5, north: 0.6, west: 0.5, east: 0.6 };

function buildMap(r, count) {
  const spots = [100, 300, 500, 700, 900];
  const colX = spots.map((s) => s + int(r, -30, 30));
  const rowY = spots.map((s) => s + int(r, -30, 30));
  const hNames = distinct(r, STREETS_H, 5);
  const vNames = distinct(r, STREETS_V, 5);
  const corners = distinct(r, Array.from({ length: 25 }, (_, i) => i), count);
  const adjectives = distinct(r, LM_ADJ, count);
  const kinds = distinct(r, [...LM_KINDS, ...LM_KINDS].map((k, i) => ({ ...k, k: i })), count);
  const landmarks = corners.map((corner, index) => {
    const ci = corner % 5;
    const cj = Math.floor(corner / 5);
    const type = kinds[index];
    return {
      id: `lm${pad(index + 1)}`,
      name: `${adjectives[index]} ${pick(r, type.nouns)}`,
      kind: type.kind,
      draw: type.draw,
      x: colX[ci] + int(r, -40, 40),
      y: rowY[cj] + int(r, -40, 40),
      ci,
      cj,
    };
  });
  return {
    cols: colX.map((x, i) => ({ name: vNames[i], x })),
    rows: rowY.map((y, i) => ({ name: hNames[i], y })),
    landmarks,
  };
}

// The landmark nearest to a point (the generator guarantees a unique nearest one for GPS and street-corner clues).
export function nearestLandmark(map, x, y) {
  let best = null;
  let bestDistance = Infinity;
  for (const lm of map.landmarks) {
    const d = Math.hypot(lm.x - x, lm.y - y);
    if (d < bestDistance) { best = lm; bestDistance = d; }
  }
  return best;
}
export const landmarkAt = (map, ci, cj) => map.landmarks.find((lm) => lm.ci === ci && lm.cj === cj) ?? null;

// ---- the world -------------------------------------------------------------------------------------------
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const docIp = (r) => `${pick(r, ['203.0.113', '198.51.100', '192.0.2'])}.${int(r, 2, 250)}`;
export { docIp };

function makeCast(r, count, company, mainTown, otherTowns, aliases) {
  const cast = [];
  const used = { first: new Set(), last: new Set(), handle: new Set() };
  const roles = distinct(r, ROLES, Math.min(count, ROLES.length));
  while (cast.length < count) {
    const first = pick(r, F_A) + pick(r, F_B);
    const last = pick(r, L_A) + pick(r, L_B);
    const handle = `${first.toLowerCase()}_${last[0].toLowerCase()}${int(r, 10, 99)}`;
    if (used.first.has(first) || used.last.has(last) || used.handle.has(handle)) { continue; }
    used.first.add(first); used.last.add(last); used.handle.add(handle);
    const index = cast.length;
    const [role, dept] = roles[index % roles.length];
    const hobbies = distinct(r, HOBBIES, 2);
    const staff = index < count - 2;
    const isAlias = aliases && !staff;
    cast.push({
      id: `c${pad(index + 1)}`,
      first,
      last,
      name: isAlias ? null : `${first} ${last}`,
      display: isAlias ? 'Night Jar' : first,
      handle: isAlias ? `nightjar_${index === count - 2 ? 47 : 74}` : handle,
      staff,
      alias: isAlias,
      role: staff ? role : 'Freelance',
      dept: staff ? dept : '-',
      email: staff ? `${first.toLowerCase()}.${last.toLowerCase()}@${company.domain}` : null,
      phone: staff ? `555-01${pad(int(r, 0, 99))}` : null,
      city: staff || isAlias || r() < 0.5 ? mainTown : pick(r, otherTowns),
      bio: isAlias ? (index === count - 2 ? 'Night owl. Posts rarely, sleeps never.' : 'Also a night owl. Not the same one.') : `${cap(hobbies[0])}, ${hobbies[1]} and bad puns.`,
      joinedMs: 0,
      joinedOff: 0,
    });
  }
  return cast;
}

export function buildBase(seed, track) {
  const cfg = CONFIG[track];
  const r = rngFor(seed, 'meta');
  const baseMs = Date.UTC(2031 + int(r, 0, 3), int(r, 0, 11), int(r, 4, 24), 12, 0, 0);
  const tz = cfg.zone ? pick(r, [-420, -180, 120, 180, 330, 480, 540]) : 0;
  const town = pick(r, TOWN_A) + pick(r, TOWN_B);
  const others = distinct(r, TOWN_A.map((a) => cap(a.toLowerCase()) + pick(r, TOWN_B)).filter((t) => t !== town), 3);
  const adj = pick(r, CO_ADJ);
  const noun = pick(r, CO_NOUN);
  const company = { name: `${adj} ${noun}`, domain: `${slug(adj + noun)}.example` };
  const network = { name: pick(r, NETWORKS) };
  network.domain = `${slug(network.name)}.example`;
  const host = pick(r, HOSTS);
  const hostco = { name: host, domain: `${slug(host)}.example` };
  const registrar = distinct(r, REGISTRARS, 2);
  const map = buildMap(rngFor(seed, 'map'), cfg.landmarks);
  const cast = makeCast(rngFor(seed, 'cast'), cfg.cast, company, town, others, track === 'insane');
  const w = {
    track,
    cfg,
    seed,
    baseMs,
    meta: { town, tz, tzLabel: tz === 0 ? 'UTC' : `UTC${offsetLabel(tz)}`, company, network, hostco, registrars: registrar, otherTowns: others },
    map,
    cast,
    posts: [],
    photos: [],
    pages: [],
    docs: [],
    domains: [],
    pastes: [],
    rs: (label) => rngFor(seed, label),
  };
  for (const person of cast) {
    person.joinedMs = baseMs - int(rngFor(seed, `join${person.id}`), 40, 1500) * DAY;
  }
  fillPosts(w);
  fillPages(w);
  fillDocs(w);
  fillDomains(w);
  fillPastes(w);
  return w;
}

export const realCast = (w) => w.cast.filter((c) => !c.alias);
export const staffOf = (w) => w.cast.filter((c) => c.staff);
export const byId = (w, id) => w.cast.find((c) => c.id === id);
export const landmarkById = (w, id) => w.map.landmarks.find((lm) => lm.id === id);

// ---- adding things (used by the filler below and by the plots) -------------------------------------------
// opts: { landmark, gps: true | {x,y} | false, takenMs, clockOff (minutes the camera clock runs ahead of UTC), offsetTag,
//         people, signs, software, artist, comment, gpsStampMs }
export function addPhoto(w, opts) {
  w.photoSeq = (w.photoSeq ?? 0) + 1;
  const id = `ph${pad(w.photoSeq)}`;
  const r = w.rs(`photo${id}`);
  const lm = opts.landmark;
  const jitter = () => int(r, -18, 18);
  const spot = opts.gps === true ? { x: lm.x + jitter(), y: lm.y + jitter() } : (opts.gps || null);
  const clockOff = opts.clockOff ?? 0;
  const cameraNames = [['Lumora', 'L2'], ['Fenwick', 'FX-9'], ['Pinhole Co', 'P40']];
  const [make, model] = cameraNames[int(r, 0, cameraNames.length - 1)];
  const localHour = new Date(opts.takenMs + (opts.localOff ?? 0) * 60_000).getUTCHours();
  const exif = {
    Make: make,
    Model: model,
    DateTimeOriginal: exifStamp(opts.takenMs, clockOff),
    ...(opts.offsetTag === false ? {} : { OffsetTimeOriginal: offsetLabel(clockOff) }),
    ...(spot ? {
      GPSLatitude: gpsOf(spot.x, spot.y).lat,
      GPSLongitude: gpsOf(spot.x, spot.y).lon,
      GPSDateStamp: exifStamp(opts.gpsStampMs ?? opts.takenMs, 0).slice(0, 10),
      GPSTimeStamp: exifStamp(opts.gpsStampMs ?? opts.takenMs, 0).slice(11),
    } : {}),
    Software: opts.software ?? (spot ? 'PhotoPrep 2.1' : 'MetaScrub 1.4 (location removed)'),
    ...(opts.artist ? { Artist: opts.artist } : {}),
    ...(opts.comment ? { UserComment: opts.comment } : {}),
  };
  const people = opts.people ?? 0;
  const signs = opts.signs ?? [];
  const scene = sceneFor(r, { draw: lm.draw, hour: localHour, people, signs });
  const photo = {
    id,
    post: null,
    landmarkId: lm.id,
    alt: `A ${lm.kind} in the ${scene.tod}, ${people === 0 ? 'nobody in frame' : `${people} ${people === 1 ? 'person' : 'people'} in the foreground`}.${signs.length > 0 ? ' A street sign is visible.' : ''}`,
    scene,
    signs,
    exif,
    spot,
  };
  w.photos.push(photo);
  return photo;
}

// o: { author, ms, off, text, place (landmark|null), tags (cast[]), photo (addPhoto opts without landmark) | null }
export function addPost(w, o) {
  const photo = o.photo ? addPhoto(w, { landmark: o.photoLandmark ?? o.place, takenMs: o.ms - int(w.rs(`pt${w.posts.length}`), 60, 900) * 1000, localOff: o.off, people: (o.tags ?? []).length, ...o.photo }) : null;
  const post = {
    id: null,
    author: o.author.id,
    ms: o.ms,
    off: o.off,
    time: isoAt(o.ms, o.off),
    text: o.text,
    place: o.place ? o.place.id : null,
    tags: (o.tags ?? []).map((c) => c.id),
    photo: photo ? photo.id : null,
    filler: Boolean(o.filler),
    _photo: photo,
  };
  w.posts.push(post);
  return post;
}

export function addDoc(w, o) {
  const doc = { id: `d${pad(w.docs.length + 1)}`, title: o.title, date: o.date, author: o.author, lastModifiedBy: o.lastModifiedBy, body: o.body };
  w.docs.push(doc);
  return doc;
}

export function addPaste(w, o) {
  const paste = { id: `x${w.pastes.length + 1}`, title: o.title, posted: isoAt(o.ms, o.off ?? 0), postedMs: o.ms, author: o.author ?? 'anonymous', body: o.body };
  w.pastes.push(paste);
  return paste;
}

// o: { name, registrant: {name, org, city, email}, createdMs, createdOff, dns (replaces defaults), ns, registrar }
export function addDomain(w, o) {
  const r = w.rs(`dom${o.name}`);
  const created = o.createdMs ?? w.baseMs - int(r, 400, 2500) * DAY;
  const off = o.createdOff ?? 0;
  const ip = docIp(r);
  const domain = {
    name: o.name,
    whois: {
      domain: o.name,
      registrar: o.registrar ?? pick(r, w.meta.registrars),
      created: isoAt(created, off),
      updated: isoAt(created + int(r, 30, 300) * DAY, off),
      expires: isoAt(created + int(r, 400, 900) * DAY, off),
      status: ['clientTransferProhibited'],
      registrant: o.registrant,
      nameservers: o.ns ?? [`ns1.${w.meta.hostco.domain}`, `ns2.${w.meta.hostco.domain}`],
    },
    createdMs: created,
    dns: o.dns ?? [
      { host: o.name, type: 'A', value: ip, ttl: 3600 },
      { host: `www.${o.name}`, type: 'CNAME', value: o.name, ttl: 3600 },
      { host: o.name, type: 'MX', value: `10 mail.${o.name}`, ttl: 3600 },
      { host: o.name, type: 'TXT', value: 'v=spf1 mx -all', ttl: 3600 },
    ],
  };
  w.domains.push(domain);
  return domain;
}

export const privacy = (w) => ({ name: 'Redacted for privacy', org: 'Privacy Shield (fictional)', city: '-', email: `contact@${w.meta.hostco.domain}` });
export const personRegistrant = (c) => ({ name: c.name, org: null, city: c.city, email: c.email ?? `${c.handle}@mailbox.example` });

// ---- filler ----------------------------------------------------------------------------------------------
const TEXTS = [
  'Coffee run at {place}. Worth the queue.',
  'Anyone else watching the boats from {place}?',
  'Long shift. Dreaming of {hobby}.',
  'New week, same {hobby} plans.',
  'Lost a glove near {place}, shout if you find it.',
  'Big thanks to {tag} for covering my route today.',
  'Rain again. {hobby} is cancelled.',
  'Sunset at {place} never gets old.',
  'Lunch with {tag}, soup of the day was suspicious.',
  'Early start, empty roads, good music.',
];

function fillPosts(w) {
  const r = w.rs('posts');
  const people = realCast(w);
  for (let i = 0; i < w.cfg.posts; i += 1) {
    const author = pick(r, people);
    const ms = w.baseMs - int(r, 3600, 40 * 86400) * 1000;
    const place = r() < 0.55 ? pick(r, w.map.landmarks) : null;
    const others = people.filter((c) => c.id !== author.id);
    const tags = r() < 0.3 ? [pick(r, others)] : [];
    const hobby = author.bio.split(',')[0].toLowerCase();
    const text = pick(r, TEXTS).replace('{place}', place ? place.name : 'the depot').replace('{hobby}', hobby).replace('{tag}', tags[0] ? tags[0].display : 'a friend');
    const travelling = w.cfg.travel && r() < 0.2;
    addPost(w, {
      author, ms, off: travelling ? pick(r, [-480, -300, 60, 540]) : w.meta.tz, text, place, tags, filler: true,
      photo: place && r() < 0.3 ? { gps: r() < 0.7 ? true : false } : null,
    });
  }
}

function fillPages(w) {
  const { company, town } = w.meta;
  const staff = staffOf(w).map((c) => ({ id: c.id, name: c.name, title: c.role, dept: c.dept, email: c.email, social: c.handle }));
  w.pages.push(
    { id: 'home', path: '/', title: company.name, snapshot: 'current', kind: 'page', body: `${company.name} moves parcels around ${town} and beyond. Fast, careful, and always on time. This is a fictional company in a fictional town.` },
    { id: 'about', path: '/about', title: 'About us', snapshot: 'current', kind: 'page', body: `Founded in a garage near the harbour of ${town}, ${company.name} now runs a small fleet and a busy depot. Our motto: nothing gets lost twice.` },
    { id: 'news', path: '/news', title: 'News', snapshot: 'current', kind: 'page', body: 'Spring timetable published. New night shift started. Our depot cat has been officially adopted.' },
    { id: 'contact', path: '/contact', title: 'Contact', snapshot: 'current', kind: 'page', body: `Write to info@${company.domain} or call the front desk on 555-0100.` },
    { id: 'staff', path: '/staff', title: 'Our people', snapshot: 'current', kind: 'staff', body: 'The people who keep the vans moving.', staff },
  );
}

const DOC_TEMPLATES = [
  (a, b, lm) => ['Route memo', `Route R${int(a.r, 10, 99)} now passes ${lm.name}. Drivers please confirm with ${b.name}.`],
  (a, b, lm) => ['Fuel invoice', `Invoice INV-${int(a.r, 1000, 9999)}: ${int(a.r, 80, 400)} litres for the depot near ${lm.name}. Approved by ${b.name}.`],
  (a, b, lm) => ['Meeting minutes', `Present: ${a.who.name}, ${b.name}. Agreed to move the pickup point to ${lm.name}. Next review in two weeks.`],
  (a, b) => ['Depot roster', `Week ${int(a.r, 1, 52)} roster. Early: ${a.who.name}. Late: ${b.name}. Spare keys are with the front desk.`],
  (a, b, lm) => ['Incident note', `A pallet was dropped outside ${lm.name}. Nobody hurt. Reported by ${a.who.name}, witnessed by ${b.name}.`],
];

function fillDocs(w) {
  const r = w.rs('docs');
  const staff = staffOf(w);
  const local = (c) => `${c.first.toLowerCase()}.${c.last.toLowerCase()}`;
  for (let i = 0; i < w.cfg.docs; i += 1) {
    const who = pick(r, staff);
    const other = pick(r, staff.filter((c) => c.id !== who.id));
    const [title, body] = pick(r, DOC_TEMPLATES)({ r, who }, other, pick(r, w.map.landmarks));
    addDoc(w, { title: `${title} ${i + 1}`, date: dateAt(w.baseMs - int(r, 5, 300) * DAY), author: local(who), lastModifiedBy: local(who), body });
  }
}

function fillDomains(w) {
  const r = w.rs('domains');
  const people = staffOf(w);
  addDomain(w, {
    name: w.meta.company.domain,
    registrant: { name: 'Domain Office', org: w.meta.company.name, city: w.meta.town, email: `info@${w.meta.company.domain}` },
  });
  addDomain(w, { name: w.meta.hostco.domain, registrant: { name: 'Hosting Desk', org: w.meta.hostco.name, city: pick(r, w.meta.otherTowns), email: `hostmaster@${w.meta.hostco.domain}` }, dns: [] });
  const taken = new Set(w.domains.map((d) => d.name));
  for (let i = 0; i < w.cfg.decoyDomains; i += 1) {
    let name;
    do { name = `${pick(r, WORDS)}${pick(r, WORDS)}.example`; } while (taken.has(name));
    taken.add(name);
    const owner = pick(r, people);
    addDomain(w, { name, registrant: personRegistrant(owner) }).filler = true;
  }
}

function fillPastes(w) {
  const r = w.rs('pastes');
  const people = realCast(w);
  const kinds = [
    () => ['mailing-list.txt', people.slice(0, 4).map((c) => `${c.first.toLowerCase()}${int(r, 10, 99)}@mailbox.example : ${pick(r, WORDS)}${int(r, 10, 99)}`).join('\n')],
    () => ['build.log', Array.from({ length: 4 }, (_, i) => `[job ${100 + i}] step ${int(r, 1, 9)} finished ok in ${int(r, 2, 90)}s`).join('\n')],
    () => ['lunch-chat.txt', `@${pick(r, people).handle}: who ordered the soup?\n@${pick(r, people).handle}: not me\n@${pick(r, people).handle}: it was the depot cat`],
    () => ['todo.txt', `- buy rope\n- return the ladder to ${pick(r, w.map.landmarks).name}\n- ask ${pick(r, people).first} about the timetable`],
  ];
  for (let i = 0; i < w.cfg.pastes; i += 1) {
    const [title, body] = kinds[i % kinds.length]();
    addPaste(w, { title, ms: w.baseMs - int(r, 2, 60) * DAY, body });
  }
}

// Sorts the feed newest first, gives posts their ids and links each photo to its post.
export function finalize(w) {
  w.posts.sort((a, b) => b.ms - a.ms);
  w.posts.forEach((post, index) => {
    post.id = `p${String(index + 1).padStart(3, '0')}`;
    if (post._photo) { post._photo.post = post.id; }
    delete post._photo;
  });
  w.pastes.sort((a, b) => a.title.localeCompare(b.title));
  w.pastes.forEach((paste, index) => { paste.id = `x${index + 1}`; });
  w.pages.sort((a, b) => a.id.localeCompare(b.id));
  return w;
}

export const removePosts = (w, predicate) => {
  const keep = [];
  for (const post of w.posts) {
    if (predicate(post)) {
      if (post.photo) { w.photos = w.photos.filter((p) => p.id !== post.photo); }
    } else { keep.push(post); }
  }
  w.posts = keep;
};
