// The four plots of OSINT Trail. A plot takes the generic world (cast, feed, pages, registry, map...), places the clues of
// one case in it, and returns { pub, ans, chain }: `pub` is what the briefing and the questions may show, `ans` holds the secret
// answers (never sent to the browser); `chain` lists the evidence links of the case board (osint/board.js). Clues live in the same public data a player can browse, so every question is
// answerable from the served corpus alone; the tests re-solve each one with an independent solver.
import { int, pick } from '../terminal/gen.js';
import { ev } from './evidence.js';
import { WORDS } from '../terminal/seedwords.js';
import {
  DAY, addDoc, addDomain, addPaste, addPost, cellOf, clockAt, dateAt, distinct, docIp, finalize, landmarkAt,
  privacy, personRegistrant, removePosts, staffOf,
} from './world.js';

const local = (c) => `${c.first.toLowerCase()}.${c.last.toLowerCase()}`;
const midnight = (w) => Math.floor(w.baseMs / DAY) * DAY;
// The instant at which a wall clock in zone `off` reads hh:mm, `daysAgo` days before the case date.
const at = (w, daysAgo, hh, mm, off = 0) => midnight(w) - daysAgo * DAY + (hh * 60 + mm - off) * 60_000;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const freshDomain = (w, r) => {
  const taken = new Set(w.domains.map((d) => d.name));
  let name;
  do { name = `${pick(r, WORDS)}${pick(r, WORDS)}.example`; } while (taken.has(name));
  return name;
};
const CODE_CHARS = '0123456789abcdefghjkmnpqrstvwxyz';
const code = (r, n = 5) => Array.from({ length: n }, () => CODE_CHARS[int(r, 0, CODE_CHARS.length - 1)]).join('');

// Filler domains must never be registered to a person a question is about.
function clearRegistrant(w, r, person) {
  const others = staffOf(w).filter((c) => c.id !== person.id);
  for (const domain of w.domains) {
    if (domain.filler && domain.whois.registrant.name === person.name) { domain.whois.registrant = personRegistrant(pick(r, others)); }
  }
}

// Moves a landmark onto an intersection when nothing stands there yet, so a "walk N blocks" clue always ends at a building.
function ensureLandmarkAt(w, r, ci, cj, keep) {
  const present = landmarkAt(w.map, ci, cj);
  if (present) { return present; }
  const mover = pick(r, w.map.landmarks.filter((lm) => !keep.includes(lm.id)));
  mover.ci = ci; mover.cj = cj;
  mover.x = w.map.cols[ci].x + int(r, -40, 40);
  mover.y = w.map.rows[cj].y + int(r, -40, 40);
  return mover;
}

// ---- EASY: "Ledger at Low Tide" ----------------------------------------------------------------------------
export function plotEasy(w) {
  const r = w.rs('plot');
  const [T, C, D, E] = distinct(r, staffOf(w), 4);
  const [L, L1, L2] = distinct(r, w.map.landmarks, 3);
  clearRegistrant(w, r, T);
  removePosts(w, (p) => p.author === T.id && Math.abs(p.ms - at(w, 3, 12, 0)) < 2.5 * DAY);
  const evening = addPost(w, { author: T, ms: at(w, 3, 20, 12), off: w.meta.tz, text: 'Evening stroll. Good light tonight.', place: L, tags: [] });
  addPost(w, { author: T, ms: at(w, 4, 20, 5), off: w.meta.tz, text: 'Another evening, another walk.', place: L1, tags: [] });
  addPost(w, { author: T, ms: at(w, 2, 19, 40), off: w.meta.tz, text: 'Quiet night in.', place: L2, tags: [] });
  const dd = freshDomain(w, r);
  const created = addDomain(w, { name: dd, registrant: personRegistrant(T), createdMs: at(w, 400 + int(r, 0, 900), 14, 33) });
  addDomain(w, { name: freshDomain(w, r), registrant: personRegistrant(C) });
  addDomain(w, { name: freshDomain(w, r), registrant: privacy(w) });
  const t = (hh, mm) => clockAt(at(w, 1, hh, mm), 0);
  const chat = addPaste(w, {
    title: 'depot-chat.txt',
    ms: at(w, 1, 9, 0),
    body: [
      `[${t(8, 41)}] @${T.handle}: did anyone pick up the ledger from the depot office?`,
      `[${t(8, 43)}] @${D.handle}: not me, i never touched it`,
      `[${t(8, 47)}] @${C.handle}: i have the ledger. it is safe with me`,
      `[${t(8, 52)}] @${E.handle}: you two are being weird`,
    ].join('\n'),
  });
  finalize(w);
  return {
    pub: { handle: T.handle, date: dateAt(at(w, 3, 12, 0)), company: w.meta.company.name },
    ans: { 1: T.name, 2: L.name, 3: dd, 4: dateAt(created.createdMs), 5: C.name },
    // The suspect and the lead meet in the depot chat; the lead's evening post ties them to a place.
    chain: [
      [ev('cast', C.id), ev('pastes', chat.id), 'posted'],
      [ev('cast', T.id), ev('pastes', chat.id), 'posted'],
      [ev('cast', T.id), ev('feed', evening.id), 'posted'],
      [ev('feed', evening.id), ev('map', L.id), 'at'],
    ],
  };
}

// ---- MEDIUM: "The Leaked Route Plan" -------------------------------------------------------------------------
export function plotMedium(w) {
  const r = w.rs('plot');
  const [T, Cm, X, Y] = distinct(r, staffOf(w), 4);
  const [L3, L4, D1, D2] = distinct(r, w.map.landmarks, 4);
  clearRegistrant(w, r, T);
  // 1. the work address: hidden on the staff page, pattern visible for everybody else, confirmed in a memo
  w.pages.find((p) => p.id === 'staff').staff.find((s) => s.id === T.id).email = null;
  addDoc(w, { title: 'Route change notice', date: dateAt(w.baseMs - 12 * DAY), author: local(Y), lastModifiedBy: local(Y), body: `Route R42 moves to the night shift. cc: ${T.email}, ${Y.email}` });
  addPaste(w, { title: 'newsletter.txt', ms: at(w, 20, 10, 0), body: `${T.first.toLowerCase()}${int(r, 10, 99)}@postbox.example subscribed to the harbour newsletter` });
  // 2. a verification code in the profile, published in exactly one domain's DNS
  const siteCode = `vf-${code(r)}`;
  T.bio = `${T.bio} Site code: ${siteCode}`;
  const codes = [siteCode, `${siteCode.slice(0, -1)}${siteCode.endsWith('x') ? 'y' : 'x'}`, `vf-${code(r)}`];
  const names = codes.map(() => freshDomain(w, r));
  names.forEach((name, i) => {
    const d = addDomain(w, { name, registrant: privacy(w) });
    d.dns.push({ host: name, type: 'TXT', value: `site-verify=${codes[i]}`, ttl: 300 });
  });
  // 3. a photo without a place tag: the cell comes from its GPS tags
  removePosts(w, (p) => p.author === T.id && Math.abs(p.ms - at(w, 6, 12, 0)) < 3.5 * DAY);
  const photoPost = addPost(w, { author: T, ms: at(w, 6, 12, 40), off: 0, text: 'Nice light today.', place: null, tags: [], photoLandmark: L3, photo: { gps: true } });
  addPost(w, { author: T, ms: at(w, 4, 12, 10), off: 0, text: 'Same walk, other light.', place: D1, tags: [], photo: { gps: true } });
  addPost(w, { author: T, ms: at(w, 8, 11, 20), off: 0, text: 'Weekend wandering.', place: D2, tags: [], photo: { gps: true } });
  // 4. a colleague's photo that tags T
  removePosts(w, (p) => p.filler && p.tags.includes(T.id) && Math.abs(p.ms - at(w, 9, 12, 0)) < 3.5 * DAY);
  addPost(w, { author: Cm, ms: at(w, 9, 18, 5), off: 0, text: 'Team dinner. Somebody ordered twice.', place: L4, tags: [T], photo: { gps: false } });
  addPost(w, { author: X, ms: at(w, 11, 18, 5), off: 0, text: 'Quiz night.', place: D1, tags: [T], photo: { gps: false } });
  addPost(w, { author: Y, ms: at(w, 7, 18, 5), off: 0, text: 'Pub lunch.', place: D2, tags: [T], photo: { gps: false } });
  // final: who created the leaked document
  const leak = addDoc(w, { title: 'Q3 Route Plan', date: dateAt(w.baseMs - 7 * DAY), author: local(X), lastModifiedBy: local(T), body: 'Route plan draft for the third quarter. Internal only. Do not circulate.' });
  addDoc(w, { title: 'Q2 Route Plan', date: dateAt(w.baseMs - 90 * DAY), author: local(T), lastModifiedBy: local(X), body: 'Route plan for the second quarter. Internal only.' });
  finalize(w);
  const spot = w.photos.find((p) => p.id === photoPost.photo).spot;
  return {
    pub: { name: T.name, role: T.role, photoDate: dateAt(photoPost.ms), tagDate: dateAt(at(w, 9, 18, 5)), company: w.meta.company.name },
    ans: { 1: T.email, 2: names[0], 3: cellOf(spot.x, spot.y), 4: Cm.name, 5: X.name },
    chain: [
      [ev('cast', X.id), ev('docs', leak.id), 'posted'],
      [ev('cast', T.id), ev('docs', leak.id), 'posted'],
      [ev('cast', T.id), ev('registry', names[0]), 'linked'],
      [ev('cast', T.id), ev('feed', photoPost.id), 'posted'],
      [ev('feed', photoPost.id), ev('map', L3.id), 'at'],
    ],
  };
}

// ---- HARD: "Tidewatch" -------------------------------------------------------------------------------------
export function plotHard(w) {
  const r = w.rs('plot');
  const [E, N, K] = distinct(r, staffOf(w), 3);
  const tz = w.meta.tz;
  // 1. two archived copies of the staff page
  const current = w.pages.find((p) => p.id === 'staff');
  const everyone = current.staff;
  const snapshotDate = dateAt(w.baseMs - 40 * DAY);
  const oldTitle = K.role === 'Courier' ? 'Night Dispatcher' : 'Courier';
  const archive = everyone.filter((s) => s.id !== N.id).map((s) => (s.id === K.id ? { ...s, title: oldTitle } : { ...s }));
  w.pages.push({ id: 'staff-archive', path: '/staff', title: 'Our people', snapshot: snapshotDate, kind: 'staff', body: 'The people who keep the vans moving.', staff: archive });
  current.staff = everyone.filter((s) => s.id !== E.id);
  // 2. the blog and the domain on the same address
  clearRegistrant(w, r, E);
  const [blog, twin, sibling, mention] = [0, 1, 2, 3].map(() => freshDomain(w, r));
  const used = new Set(w.domains.flatMap((d) => d.dns.map((rec) => rec.value)));
  let ip;
  do { ip = docIp(r); } while (used.has(ip));
  const near = `${ip.slice(0, ip.lastIndexOf('.'))}.${(Number(ip.split('.')[3]) % 200) + 20}`;
  E.bio = `${E.bio} Kite notes: ${blog}`;
  const zone = (name, address, extra = []) => addDomain(w, { name, registrant: privacy(w), dns: [{ host: name, type: 'A', value: address, ttl: 600 }, ...extra] });
  zone(blog, ip);
  zone(twin, ip);
  zone(sibling, near);
  zone(mention, [docIp(r), docIp(r)].find((a) => a !== ip && a !== near) ?? '192.0.2.250', [{ host: mention, type: 'TXT', value: `v=spf1 ip4:${ip} -all`, ttl: 600 }]);
  // 3. the last photo: the camera writes UTC, the town lives in its own zone
  removePosts(w, (p) => p.author === E.id);
  const [A1, A2, A3, LD] = distinct(r, w.map.landmarks, 4);
  // the sign photo stands in the upper-left part of the grid, so a walk east and south always stays on the map
  let L4 = pick(r, w.map.landmarks.filter((lm) => lm.ci <= 3 && lm.cj <= 3 && ![A1, A2, A3, LD].includes(lm)));
  if (!L4) { L4 = ensureLandmarkAt(w, r, 1, 1, [A1.id, A2.id, A3.id, LD.id]); }
  const kk = int(r, 1, Math.min(2, 4 - L4.ci));
  const mm = int(r, 1, Math.min(2, 4 - L4.cj));
  // the target corner must hold a building: move another one there when it is empty
  const target = ensureLandmarkAt(w, r, L4.ci + kk, L4.cj + mm, [L4.id, LD.id, A1.id, A2.id, A3.id]);
  [[A1, 30, 11, 20], [A2, 20, 15, 5], [A3, 12, 9, 45]].forEach(([lm, days, hh, mi]) => {
    addPost(w, { author: E, ms: at(w, days, hh, mi, tz), off: tz, text: 'Wind is up, kite is out.', place: lm, tags: [], photo: { gps: true, clockOff: 0, comment: 'Camera clock runs on UTC.' } });
  });
  const lastTaken = at(w, 1, 9, 10 + int(r, 0, 40), tz);
  addPost(w, { author: E, ms: lastTaken + int(r, 20, 45) * 60_000, off: tz, text: 'Last light over the water. Goodbye for now.', place: null, tags: [], photoLandmark: LD, photo: { gps: true, takenMs: lastTaken, clockOff: 0, comment: 'Camera clock runs on UTC.' } });
  // 4. the corner photo: location stripped, a street sign left in the picture
  const sign = `${w.map.rows[L4.cj].name} / ${w.map.cols[L4.ci].name}`;
  const signPost = addPost(w, { author: E, ms: at(w, 3, 17, 30, tz), off: tz, text: 'Found the old corner again.', place: null, tags: [], photoLandmark: L4, photo: { gps: false, signs: [sign], takenMs: at(w, 3, 17, 20, tz), clockOff: 0, comment: 'Camera clock runs on UTC.' } });
  const other = pick(r, w.cast.filter((c) => c.id !== E.id && !c.alias));
  addPost(w, { author: other, ms: at(w, 5, 14, 0, tz), off: tz, text: 'Lost again. Which way is the harbour?', place: null, tags: [], photoLandmark: A1, photo: { gps: false, signs: [`${w.map.rows[A1.cj].name} / ${w.map.cols[A1.ci].name}`] } });
  // 5. a dead drop in base64, and the final instruction
  const word = pick(r, WORDS);
  addPaste(w, { title: 'dead-drop.txt', ms: at(w, 2, 6, 0, tz), author: 'anonymous', body: [`drop-1: ${b64('sorry, wrong number')}`, `drop-2: ${b64(`codeword: ${word}`)}`, `drop-3: ${b64('nothing to see here')}`].join('\n') });
  const reminder = addPaste(w, { title: 'reminder.txt', ms: at(w, 2, 6, 5, tz), author: 'anonymous', body: `From the corner in my last street-sign photo, walk ${kk} blocks east and ${mm} blocks south (a block is the distance to the next street). Be at the building on that corner at dawn.` });
  const old = distinct(r, w.map.landmarks.filter((lm) => lm.id !== L4.id), 1)[0];
  addPaste(w, { title: 'old-plan.txt', ms: at(w, 9, 6, 5, tz), author: 'anonymous', body: `OLD PLAN, cancelled: from ${old.name} walk 1 block east and 1 block south.` });
  finalize(w);
  return {
    pub: { snapshotDate, town: w.meta.town, tzLabel: w.meta.tzLabel, company: w.meta.company.name },
    ans: { 1: E.name, 2: twin, 3: clockAt(lastTaken, tz), 4: L4.name, 5: word, 6: target.name },
    chain: [
      [ev('cast', E.id), ev('registry', blog), 'linked'],
      [ev('registry', blog), ev('registry', twin), 'linked'],
      [ev('cast', E.id), ev('feed', signPost.id), 'posted'],
      [ev('feed', signPost.id), ev('map', L4.id), 'at'],
      [ev('pastes', reminder.id), ev('feed', signPost.id), 'mentions'],
    ],
  };
}

// ---- INSANE: "Nightjar" --------------------------------------------------------------------------------------
export function plotInsane(w) {
  const r = w.rs('plot');
  const tz = w.meta.tz;
  const real = staffOf(w);
  const [P, Q, R, Cm, Y1, Y2] = distinct(r, real, 6);
  const [a1, a2] = w.cast.filter((c) => c.alias);
  for (const c of [P, Q, R, Cm]) { clearRegistrant(w, r, c); }
  const [L4, LD, LM, M1, M2, LX] = distinct(r, w.map.landmarks, 6);
  const aOff = pick(r, [-480, -300, -240]);
  const dOff = pick(r, [480, 540, 330]);
  // 1. the account and the domain share one instant; look-alike domains miss it by minutes or by time zone
  const joined = at(w, 28, 3, 20 + int(r, 0, 30), aOff);
  a1.joinedMs = joined; a1.joinedOff = aOff;
  a2.joinedMs = joined + 3 * DAY + 41 * 60_000; a2.joinedOff = aOff;
  const [dp, dx, dy, dz] = [0, 1, 2, 3].map(() => freshDomain(w, r));
  addDomain(w, { name: dp, registrant: personRegistrant(P), createdMs: joined, createdOff: dOff });
  addDomain(w, { name: dx, registrant: personRegistrant(Q), createdMs: joined + 4 * 60_000, createdOff: dOff });
  addDomain(w, { name: dy, registrant: personRegistrant(R), createdMs: joined + (aOff - 120) * 60_000, createdOff: 120 });
  addDomain(w, { name: dz, registrant: personRegistrant(Cm), createdMs: joined - 2 * 3_600_000, createdOff: aOff });
  // 2. the mirror host: a CNAME chain with look-alike nodes
  const host = w.domains.find((d) => d.name === w.meta.hostco.domain);
  const hc = w.meta.hostco.domain;
  const [ipTrue, ipA, ipB] = [docIp(r), docIp(r), docIp(r)];
  host.dns.push(
    { host: `edge.${hc}`, type: 'CNAME', value: `node-3.${hc}`, ttl: 60 },
    { host: `node-2.${hc}`, type: 'A', value: ipA, ttl: 60 },
    { host: `node-3.${hc}`, type: 'A', value: ipTrue, ttl: 60 },
    { host: `node-4.${hc}`, type: 'A', value: ipB, ttl: 60 },
    { host: `edge-old.${hc}`, type: 'CNAME', value: `node-4.${hc}`, ttl: 60 },
  );
  const dnsOf = (name) => w.domains.find((d) => d.name === name).dns;
  dnsOf(dp).push({ host: `files.${dp}`, type: 'CNAME', value: `edge.${hc}`, ttl: 60 });
  dnsOf(dx).push({ host: `files.${dx}`, type: 'CNAME', value: `edge-old.${hc}`, ttl: 60 });
  const mirror = addPaste(w, { title: 'mirror-notes.txt', ms: at(w, 5, 2, 10, aOff), off: aOff, author: `@${a1.handle}`, body: `leak mirror is up: files.${dp}\nrotate the keys after the drop` });
  addPaste(w, { title: 'mirror-old.txt', ms: at(w, 14, 2, 10, aOff), off: aOff, author: `@${a2.handle}`, body: `mirror: files.${dx}\n(testing, ignore)` });
  // 3 + 4. the alias claims to be at home; the satellite clock and the GPS tags say otherwise
  const claimed = at(w, 4, 22, 10, aOff);
  const trueMs = claimed - (2 * 60 + int(r, 10, 170)) * 60_000;
  removePosts(w, (p) => p.filler && p.place === L4.id && Math.abs(p.ms - trueMs) < 4 * 3_600_000);
  const aliasPost = addPost(w, {
    author: a1, ms: claimed, off: aOff, text: `Home, bad wifi, ${clockAt(claimed, aOff)} by my clock. Nowhere near anything interesting.`, place: LD, tags: [],
    photoLandmark: L4, photo: { gps: true, takenMs: claimed - 2 * 60_000, clockOff: aOff, gpsStampMs: trueMs },
  });
  addPost(w, { author: a2, ms: at(w, 6, 21, 0, aOff), off: aOff, text: 'Walking home.', place: LX, tags: [], photo: { gps: true, clockOff: aOff } });
  // 5. a companion at the same place at the same instant, seen in another time zone; look-alikes elsewhere
  const cOff = pick(r, [480, 540, -420, 60].filter((o) => o !== tz));
  addPost(w, { author: Cm, ms: trueMs + int(r, -12, 12) * 60_000, off: cOff, text: 'Cold hands, good company.', place: L4, tags: [] });
  addPost(w, { author: Y1, ms: trueMs - tz * 60_000, off: tz, text: 'Quiet corner, warm tea.', place: L4, tags: [] });
  addPost(w, { author: Y2, ms: trueMs + 3 * 60_000, off: 60, text: 'Crowded tonight.', place: LX, tags: [] });
  addPost(w, { author: Q, ms: trueMs - 5 * 3_600_000, off: tz, text: 'Early walk.', place: L4, tags: [] });
  // final: the newest note (by instant) says where the drop is; the one that looks newer on the clock is older
  const tA = at(w, 2, 1, 30, -480);
  const tB = tA - 135 * 60_000;
  addPaste(w, { title: 'kettle-notes.txt', ms: tA, off: -480, author: `@${a1.handle}`, body: `drop: the exact midpoint between the photo spot and ${LM.name}.` });
  addPaste(w, { title: 'courier-plan.txt', ms: tB, off: 180, author: `@${a1.handle}`, body: `drop: the exact midpoint between ${M1.name} and ${M2.name}.` });
  finalize(w);
  const mid = { x: Math.round((L4.x + LM.x) / 2), y: Math.round((L4.y + LM.y) / 2) };
  return {
    pub: { alias: `@${a1.handle}`, town: w.meta.town, company: w.meta.company.name },
    ans: { 1: P.name, 2: ipTrue, 3: clockAt(trueMs, 0), 4: L4.name, 5: Cm.name, 6: `${mid.x},${mid.y}` },
    chain: [
      [ev('cast', a1.id), ev('registry', dp), 'linked'],
      [ev('cast', P.id), ev('registry', dp), 'owns'],
      [ev('cast', a1.id), ev('pastes', mirror.id), 'posted'],
      [ev('pastes', mirror.id), ev('registry', dp), 'mentions'],
      [ev('cast', a1.id), ev('feed', aliasPost.id), 'posted'],
      [ev('feed', aliasPost.id), ev('map', L4.id), 'at'],
    ],
  };
}

export const PLOTS = { easy: plotEasy, medium: plotMedium, hard: plotHard, insane: plotInsane };
