// What the browser may see of a team's world: paged views of each source and a bounded search over the case corpus.
// Nothing here ever includes an answer: it only maps the public side of the generated world (no secret fields, no
// internal indexes). The corpus has a fixed size per track, so every call does bounded work and nothing is stored.
import { BOUNDS, CELLS, MAP_SIZE, cellOf, isoAt } from './world.js';

export const SOURCES = [
  { id: 'feed', label: 'Social Feed', max: 50, fallback: 25 },
  { id: 'cast', label: 'Profiles', max: 20, fallback: 20 },
  { id: 'pages', label: 'Web Archive', max: 20, fallback: 10 },
  { id: 'docs', label: 'Leaked docs', max: 30, fallback: 15 },
  { id: 'registry', label: 'Registry', max: 20, fallback: 10 },
  { id: 'photos', label: 'Photos', max: 8, fallback: 6 },
  { id: 'pastes', label: 'Paste site', max: 10, fallback: 10 },
  { id: 'map', label: 'Map', max: 1, fallback: 1 },
];
export const SOURCE_IDS = SOURCES.map((s) => s.id);
export const SEARCH_MAX = 20;

const handle = (c) => `@${c.handle}`;
const person = (c) => ({ id: c.id, handle: handle(c), display: c.display });

export function mapView(w) {
  return {
    size: MAP_SIZE,
    cells: CELLS,
    bounds: BOUNDS,
    town: w.meta.town,
    tz: { offsetMin: w.meta.tz, label: w.meta.tzLabel },
    streets: { cols: w.map.cols.map((s) => ({ ...s })), rows: w.map.rows.map((s) => ({ ...s })) },
    landmarks: w.map.landmarks.map((lm) => ({ id: lm.id, name: lm.name, kind: lm.kind, x: lm.x, y: lm.y, cell: cellOf(lm.x, lm.y) })),
  };
}

export function views(w) {
  const castById = new Map(w.cast.map((c) => [c.id, c]));
  const lmById = new Map(w.map.landmarks.map((lm) => [lm.id, lm]));
  const postById = new Map(w.posts.map((p) => [p.id, p]));
  const place = (id) => (id ? { id, name: lmById.get(id).name } : null);
  const post = (p) => ({
    id: p.id, author: person(castById.get(p.author)), time: p.time, text: p.text, place: place(p.place),
    tags: p.tags.map((id) => person(castById.get(id))), photo: p.photo,
  });
  const staffEntry = (s) => ({ name: s.name, title: s.title, dept: s.dept, email: s.email, social: `@${s.social}` });
  return {
    feed: w.posts.map(post),
    cast: w.cast.map((c) => ({
      id: c.id, handle: handle(c), display: c.display, bio: c.bio, city: c.city,
      joined: isoAt(c.joinedMs, c.joinedOff),
    })),
    pages: w.pages.map((p) => ({
      id: p.id, path: p.path, title: p.title, snapshot: p.snapshot, kind: p.kind, body: p.body,
      ...(p.staff ? { staff: p.staff.map(staffEntry) } : {}),
    })),
    docs: w.docs.map((d) => ({ ...d })),
    registry: w.domains.map((d) => ({ name: d.name, whois: { ...d.whois, registrant: { ...d.whois.registrant } }, dns: d.dns.map((r) => ({ ...r })) })),
    photos: w.photos.map((ph) => {
      const p = postById.get(ph.post);
      return {
        id: ph.id, post: ph.post, alt: ph.alt, scene: ph.scene, signs: ph.signs, exif: ph.exif,
        author: p ? person(castById.get(p.author)) : null, time: p ? p.time : null,
      };
    }),
    pastes: w.pastes.map((p) => ({ id: p.id, title: p.title, posted: p.posted, author: p.author, body: p.body })),
  };
}

export function sourceCounts(w) {
  const v = views(w);
  return SOURCES.map((s) => ({ id: s.id, label: s.label, total: s.id === 'map' ? 1 : v[s.id].length, max: s.max, fallback: s.fallback }));
}

// filters: { author: 'c03', date: 'YYYY-MM-DD' } apply to the feed only.
export function listSource(w, sourceId, { offset = 0, limit, author, date } = {}) {
  const spec = SOURCES.find((s) => s.id === sourceId);
  const size = Math.min(spec.max, limit ?? spec.fallback);
  if (sourceId === 'map') { return { source: 'map', total: 1, offset: 0, limit: 1, items: [mapView(w)] }; }
  let items = views(w)[sourceId];
  if (sourceId === 'feed') {
    if (author) { items = items.filter((p) => p.author.id === author); }
    if (date) { items = items.filter((p) => p.time.startsWith(date)); }
  }
  return { source: sourceId, total: items.length, offset, limit: size, items: items.slice(offset, offset + size) };
}

// ---- search ----------------------------------------------------------------------------------------------
function* corpus(w) {
  const v = views(w);
  for (const p of v.feed) {
    yield { source: 'feed', id: p.id, title: `${p.author.handle} at ${p.time}`, text: `${p.author.handle} ${p.author.display} ${p.text} ${p.place?.name ?? ''} ${p.tags.map((t) => t.handle).join(' ')}` };
  }
  for (const c of v.cast) { yield { source: 'cast', id: c.id, title: c.handle, text: `${c.handle} ${c.display} ${c.bio} ${c.city} joined ${c.joined}` }; }
  for (const page of v.pages) {
    yield { source: 'pages', id: page.id, title: `${page.title} (${page.snapshot})`, text: `${page.title} ${page.path} ${page.body}` };
    for (const s of page.staff ?? []) {
      yield { source: 'pages', id: page.id, title: `${page.title} (${page.snapshot}): ${s.name}`, text: `${s.name} ${s.title} ${s.dept} ${s.email ?? ''} ${s.social}` };
    }
  }
  for (const d of v.docs) { yield { source: 'docs', id: d.id, title: d.title, text: `${d.title} ${d.date} author ${d.author} last modified by ${d.lastModifiedBy} ${d.body}` }; }
  for (const d of v.registry) {
    const x = d.whois;
    yield { source: 'registry', id: d.name, title: `WHOIS ${d.name}`, text: `${d.name} ${x.registrar} created ${x.created} updated ${x.updated} expires ${x.expires} ${x.registrant.name} ${x.registrant.org ?? ''} ${x.registrant.city} ${x.registrant.email} ${x.nameservers.join(' ')}` };
    for (const rec of d.dns) { yield { source: 'registry', id: d.name, title: `DNS ${rec.host}`, text: `${rec.host} ${rec.type} ${rec.value}` }; }
  }
  for (const ph of v.photos) {
    yield { source: 'photos', id: ph.id, title: `Photo ${ph.id}`, text: `${ph.alt} ${ph.signs.join(' ')} ${Object.entries(ph.exif).map(([k, val]) => `${k} ${val}`).join(' ')}` };
  }
  for (const p of v.pastes) { yield { source: 'pastes', id: p.id, title: p.title, text: `${p.title} ${p.author} ${p.posted} ${p.body}` }; }
  const m = mapView(w);
  for (const lm of m.landmarks) { yield { source: 'map', id: lm.id, title: lm.name, text: `${lm.name} ${lm.kind} cell ${lm.cell}` }; }
  for (const s of [...m.streets.cols, ...m.streets.rows]) { yield { source: 'map', id: 'streets', title: s.name, text: `${s.name} street` }; }
}

const snippetOf = (text, index) => {
  const start = Math.max(0, index - 50);
  const slice = text.slice(start, start + 160).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '...' : ''}${slice}${start + 160 < text.length ? '...' : ''}`.slice(0, 190);
};

// Every whitespace-separated token (at most 4) must occur. Returns at most `limit` results after `offset` matches.
export function searchCorpus(w, query, { offset = 0, limit = 10 } = {}) {
  const tokens = String(query).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  const size = Math.min(SEARCH_MAX, limit);
  const results = [];
  let skipped = 0;
  let hasMore = false;
  for (const doc of corpus(w)) {
    const hay = doc.text.toLowerCase();
    if (!tokens.every((token) => hay.includes(token))) { continue; }
    if (skipped < offset) { skipped += 1; continue; }
    if (results.length === size) { hasMore = true; break; }
    results.push({ source: doc.source, id: doc.id, title: doc.title, snippet: snippetOf(doc.text, hay.indexOf(tokens[0])) });
  }
  return { query: String(query), offset, limit: size, results, hasMore };
}
