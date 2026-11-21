// Independent solvers: they read ONLY what the browser can read (the paged sources and the question prompts' public facts),
// reason the way a player would, and never look at the plot. If they agree with the server's answers, the case is solvable.
import { SOURCES, listSource, searchCorpus } from '../../src/osint/sources.js';
import { buildCase } from '../../src/osint/cases.js';

export const SECRET = 'f'.repeat(40);

export function caseFor(track, teamId = 'team-a') {
  return buildCase(SECRET, teamId, track);
}

// Pulls every page of one source through the same function the API uses.
export function allOf(world, id) {
  const spec = SOURCES.find((s) => s.id === id);
  const items = [];
  for (let offset = 0; ; offset += spec.max) {
    const page = listSource(world, id, { offset, limit: spec.max });
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) { return items; }
  }
}

const load = (world) => Object.fromEntries(SOURCES.map((s) => [s.id, allOf(world, s.id)]));
const staffPage = (v, id = 'staff') => v.pages.find((p) => p.id === id);
const staffByHandle = (v, handle) => staffPage(v).staff.find((s) => s.social === handle) ?? staffPage(v, 'staff-archive')?.staff.find((s) => s.social === handle);
const nameOfHandle = (v, handle) => staffByHandle(v, handle)?.name;
const handleOfName = (v, name) => (staffPage(v).staff.find((s) => s.name === name) ?? staffPage(v, 'staff-archive')?.staff.find((s) => s.name === name)).social;
const castOf = (v, handle) => v.cast.find((c) => c.handle === handle);
const xyFromGps = (exif) => ({ x: Math.round((Number(exif.GPSLongitude) - 0.5) * 10_000), y: Math.round(1000 - (Number(exif.GPSLatitude) - 0.5) * 10_000) });
const cellFromXy = ({ x, y }) => `${'ABCDEFGH'[Math.min(7, Math.floor(x / 125))]}${Math.min(8, Math.floor(y / 125) + 1)}`;
const nearest = (map, p) => [...map.landmarks].sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
const gpsInstant = (exif) => Date.parse(`${exif.GPSDateStamp.replaceAll(':', '-')}T${exif.GPSTimeStamp}+00:00`);
const hhmm = (ms, offMin = 0) => new Date(ms + offMin * 60_000).toISOString().slice(11, 16);
const photoOf = (v, post) => v.photos.find((p) => p.id === post.photo);
const handleOfAuthor = (post) => post.author.handle;
const only = (list, what) => { if (list.length !== 1) { throw new Error(`${what}: expected exactly one, found ${list.length}`); } return list[0]; };

export function solveEasy(world, pub) {
  const v = load(world);
  const name = only(staffPage(v).staff.filter((s) => s.social === `@${pub.handle}`), 'staff entry').name;
  const evening = only(v.feed.filter((p) => handleOfAuthor(p) === `@${pub.handle}` && p.time.startsWith(pub.date) && Number(p.time.slice(11, 13)) >= 17), 'evening post');
  const domain = only(v.registry.filter((d) => d.whois.registrant.name === name), 'domain of the person');
  const chat = v.pastes.flatMap((p) => p.body.split('\n')).map((l) => /\] (\S+): i have the ledger/.exec(l)).filter(Boolean);
  return {
    1: name, 2: evening.place.name, 3: domain.name, 4: domain.whois.created.slice(0, 10), 5: nameOfHandle(v, only(chat, 'ledger claim')[1]),
  };
}

export function solveMedium(world, pub) {
  const v = load(world);
  const staff = staffPage(v).staff;
  const entry = only(staff.filter((s) => s.name === pub.name), 'target entry');
  const domain = staff.find((s) => s.email).email.split('@')[1];
  const [first, last] = pub.name.toLowerCase().split(' ');
  const email = `${first}.${last}@${domain}`;
  // the memo (found by searching the surname) confirms the pattern
  const hits = searchCorpus(world, `${first}.${last}`, { limit: 20 }).results.filter((r) => r.source === 'docs');
  if (hits.length === 0) { throw new Error('no memo found by search'); }
  const profile = castOf(v, entry.social);
  const siteCode = /Site code: (\S+)/.exec(profile.bio)[1];
  const txt = v.registry.filter((d) => d.dns.some((r) => r.type === 'TXT' && r.value === `site-verify=${siteCode}`));
  const photoPost = only(v.feed.filter((p) => handleOfAuthor(p) === entry.social && p.time.startsWith(pub.photoDate) && p.photo), 'photo post');
  const cell = cellFromXy(xyFromGps(photoOf(v, photoPost).exif));
  const tagged = only(v.feed.filter((p) => p.time.startsWith(pub.tagDate) && p.photo && p.tags.some((t) => t.handle === entry.social)), 'tagging post');
  const doc = only(v.docs.filter((d) => d.title === 'Q3 Route Plan'), 'leaked doc');
  const creator = only(staff.filter((s) => s.email && s.email.split('@')[0] === doc.author), 'creator');
  return { 1: email, 2: only(txt, 'verified domain').name, 3: cell, 4: nameOfHandle(v, handleOfAuthor(tagged)), 5: creator.name };
}

export function solveHard(world, pub) {
  const v = load(world);
  const now = staffPage(v).staff.map((s) => s.name);
  const exName = only(staffPage(v, 'staff-archive').staff.filter((s) => !now.includes(s.name)), 'vanished person').name;
  const handle = handleOfName(v, exName);
  const blog = /Kite notes: (\S+)/.exec(castOf(v, handle).bio)[1];
  const aOf = (d) => d.dns.filter((r) => r.type === 'A').map((r) => r.value);
  const ip = aOf(v.registry.find((d) => d.name === blog))[0];
  const twin = only(v.registry.filter((d) => d.name !== blog && aOf(d).includes(ip)), 'same-address domain');
  const photoPosts = v.feed.filter((p) => handleOfAuthor(p) === handle && p.photo);
  const last = photoPosts[0]; // feed is newest first
  const exif = photoOf(v, last).exif;
  if (exif.OffsetTimeOriginal !== '+00:00') { throw new Error('unexpected camera offset'); }
  const taken = Date.parse(`${exif.DateTimeOriginal.slice(0, 10).replaceAll(':', '-')}T${exif.DateTimeOriginal.slice(11)}+00:00`);
  const map = v.map[0];
  const local = hhmm(taken, map.tz.offsetMin);
  const signPost = only(photoPosts.filter((p) => photoOf(v, p).signs.length > 0), 'sign photo');
  const [hName, vName] = photoOf(v, signPost).signs[0].split(' / ');
  const ci = map.streets.cols.findIndex((c) => c.name === vName);
  const cj = map.streets.rows.findIndex((r) => r.name === hName);
  const corner = { x: map.streets.cols[ci].x, y: map.streets.rows[cj].y };
  const landmark = nearest(map, corner);
  const lines = v.pastes.find((p) => p.title === 'dead-drop.txt').body.split('\n').map((l) => Buffer.from(l.split(': ')[1], 'base64').toString());
  const word = /^codeword: (\w+)$/.exec(lines.find((l) => l.startsWith('codeword:')))[1];
  const walk = /walk (\d) blocks east and (\d) blocks south/.exec(v.pastes.find((p) => p.title === 'reminder.txt').body);
  const target = nearest(map, { x: map.streets.cols[ci + Number(walk[1])].x, y: map.streets.rows[cj + Number(walk[2])].y });
  return { 1: exName, 2: twin.name, 3: local, 4: landmark.name, 5: word, 6: target.name };
}

export function solveInsane(world, pub) {
  const v = load(world);
  const map = v.map[0];
  const alias = castOf(v, pub.alias);
  const joined = Date.parse(alias.joined);
  const owner = only(v.registry.filter((d) => Date.parse(d.whois.created) === joined), 'domain created at the same instant');
  const pastes = v.pastes.filter((p) => p.author === pub.alias);
  const host = /files\.(\S+)/.exec(pastes.find((p) => p.title === 'mirror-notes.txt').body);
  const dns = v.registry.flatMap((d) => d.dns);
  let name = `files.${host[1]}`;
  let ip = null;
  for (let hops = 0; hops < 8; hops += 1) {
    const rec = dns.find((r) => r.host === name && (r.type === 'CNAME' || r.type === 'A'));
    if (rec.type === 'A') { ip = rec.value; break; }
    name = rec.value;
  }
  const photoPost = only(v.feed.filter((p) => handleOfAuthor(p) === pub.alias && p.photo), 'alias photo');
  const exif = photoOf(v, photoPost).exif;
  const trueMs = gpsInstant(exif);
  const spot = nearest(map, xyFromGps(exif));
  const company = v.feed.filter((p) => handleOfAuthor(p) !== pub.alias && p.place?.id === spot.id && Math.abs(Date.parse(p.time) - trueMs) <= 15 * 60_000);
  const note = [...pastes].sort((a, b) => Date.parse(b.posted) - Date.parse(a.posted))[0];
  const m = /midpoint between (.+) and (.+)\./.exec(note.body);
  const resolve = (text) => (text === 'the photo spot' ? spot : map.landmarks.find((lm) => lm.name === text));
  const [p1, p2] = [resolve(m[1]), resolve(m[2])];
  return {
    1: owner.whois.registrant.name, 2: ip, 3: hhmm(trueMs), 4: spot.name, 5: nameOfHandle(v, handleOfAuthor(only(company, 'companion'))),
    6: `${Math.round((p1.x + p2.x) / 2)},${Math.round((p1.y + p2.y) / 2)}`,
  };
}

export const SOLVERS = { easy: solveEasy, medium: solveMedium, hard: solveHard, insane: solveInsane };
