// The case board: the evidence a team may pin, and the check of its links against the hidden chain of the case.
// Everything is a pure function of the per-team world. The chain (the required links) never leaves the server.
import { EVIDENCE_KINDS, RELATION_IDS, ev } from './evidence.js';
import { mapView, views } from './sources.js';

export const MAX_PINS = 40;
export const BOARD_SIZE = 1000;
// A board may hold at most this many links per required link. A valid chain needs M links, so spamming candidate pairs
// is cut off at 2 x M, far below the number of plausible pairs in a world of about 200 evidence items.
export const LINKS_PER_REQUIRED = 2;
export const linkCap = (required) => required * LINKS_PER_REQUIRED;

const clip = (text, n) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 3)}...` : flat;
};

// Every pinnable item of a world, with the short label the board shows. Only public fields are used.
export function evidenceOf(world) {
  const v = views(world);
  const items = [];
  for (const p of v.feed) { items.push({ id: ev('feed', p.id), kind: 'feed', label: `Post by ${p.author.handle}, ${p.time.slice(0, 16).replace('T', ' ')}: ${clip(p.text, 60)}` }); }
  for (const c of v.cast) { items.push({ id: ev('cast', c.id), kind: 'cast', label: `Profile ${c.handle} (${c.display})` }); }
  for (const p of v.pages) { items.push({ id: ev('pages', p.id), kind: 'pages', label: `Page: ${clip(p.title, 40)} (${p.snapshot})` }); }
  for (const d of v.docs) { items.push({ id: ev('docs', d.id), kind: 'docs', label: `Document: ${clip(d.title, 50)}` }); }
  for (const d of v.registry) { items.push({ id: ev('registry', d.name), kind: 'registry', label: `Domain ${d.name}` }); }
  for (const ph of v.photos) { items.push({ id: ev('photos', ph.id), kind: 'photos', label: `Photo ${ph.id}: ${clip(ph.alt, 50)}` }); }
  for (const p of v.pastes) { items.push({ id: ev('pastes', p.id), kind: 'pastes', label: `Paste: ${clip(p.title, 40)}` }); }
  for (const lm of mapView(world).landmarks) { items.push({ id: ev('map', lm.id), kind: 'map', label: `Place: ${lm.name}` }); }
  return items;
}

export const evidenceIndex = (world) => new Map(evidenceOf(world).map((item) => [item.id, item]));
export { EVIDENCE_KINDS };

// A link is an unordered pair plus a relation type: "A posted B" and "B posted A" are the same link.
export const linkKey = (a, b, rel) => `${rel}|${[a, b].sort().join('|')}`;

// Structural checks that need the world: real ids, pinned endpoints, no duplicates, caps. Returns an error or null.
export function boardProblem({ index, pins, links, required }) {
  if (pins.length > MAX_PINS) { return { code: 'BOARD_LIMIT', message: `A board holds at most ${MAX_PINS} pins.` }; }
  const cap = linkCap(required);
  if (links.length > cap) { return { code: 'BOARD_LIMIT', message: `A board holds at most ${cap} links. Keep only the connections you can defend.` }; }
  const pinned = new Set();
  for (const pin of pins) {
    if (!index.has(pin.id)) { return { code: 'BAD_EVIDENCE', message: 'A pin points at evidence that is not part of this case.' }; }
    if (pinned.has(pin.id)) { return { code: 'BAD_BOARD', message: 'The same evidence is pinned twice.' }; }
    pinned.add(pin.id);
  }
  const seen = new Set();
  for (const link of links) {
    if (!RELATION_IDS.includes(link.rel)) { return { code: 'BAD_BOARD', message: 'Unknown relation type.' }; }
    if (link.a === link.b) { return { code: 'BAD_BOARD', message: 'A link needs two different pieces of evidence.' }; }
    if (!pinned.has(link.a) || !pinned.has(link.b)) { return { code: 'BAD_BOARD', message: 'Links can only join pinned evidence.' }; }
    const key = linkKey(link.a, link.b, link.rel);
    if (seen.has(key)) { return { code: 'BAD_BOARD', message: 'The same link is drawn twice.' }; }
    seen.add(key);
  }
  return null;
}

// How many of the required links the board contains. Only ids and relation types are compared.
export function chainProgress(chain, links) {
  const have = new Set(links.map((l) => linkKey(l.a, l.b, l.rel)));
  const found = chain.filter(([a, b, rel]) => have.has(linkKey(a, b, rel))).length;
  return { found, total: chain.length };
}

// Coarse progress shown after every save. It is deliberately NOT the number of links that hold: an exact count would let a
// caller test sets of links against the hidden chain (group testing). Levels:
//   complete  the chain held at some save (sticky `unlocked`)
//   close     all but at most one required link hold (found >= total - 1)
//   started   at least half of the required links hold (found * 2 >= total)
//   none      fewer than half hold, including zero
// "started" starts at HALF, not at one link, so that none -> started is not a "does this set contain any chain link" test.
// The exact count only comes from the rate limited explicit check (POST .../board/check).
export function progressLevel({ found, total, unlocked = false }) {
  if (unlocked || (total > 0 && found >= total)) { return 'complete'; }
  if (total >= 3 && found >= total - 1) { return 'close'; }
  if (total > 0 && found * 2 >= total) { return 'started'; }
  return 'none';
}

// Short, generic and the same for every partial state: it never says how far the board is or what is missing.
export function nudge({ unlocked }) {
  if (unlocked) { return 'The chain holds. The final question is open.'; }
  return 'Keep following how the suspect connects to the crime, and check each link against its source. Link only what you can defend.';
}
