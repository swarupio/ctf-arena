// Pure helpers of the OSINT Trail pages: time zones, map maths, the evidence notebook, safe scene drawing and messages.
// Nothing here touches the network; the notebook lives in this browser (localStorage) and never reaches the server.
export const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', insane: 'Insane' };
export const DIFFICULTY_LEVEL = { easy: 1, medium: 2, hard: 3, insane: 4 };

export const progressPercent = (done, total) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);

export function describeOsintError(error) {
  const code = error?.code;
  if (code === 'NO_TEAM') { return 'Join or create a team first: cases are scored per team.'; }
  if (code === 'TEAM_BANNED') { return 'Your team has been banned from the arena.'; }
  if (code === 'OSINT_NOT_SEEDED') { return 'OSINT Trail is not set up yet. Ask an admin to run npm run seed:osint.'; }
  if (code === 'STAGE_LOCKED') { return 'Answer the other questions of this case before the final one.'; }
  if (code === 'NO_MORE_HINTS') { return 'No more hints for this question.'; }
  if (code === 'NO_HINTS') { return 'This case gives no hints.'; }
  if (code === 'RATE_LIMITED' || error?.status === 429) { return 'Too many attempts on this question. Take a break and think it over.'; }
  if (error?.status === 403) { return error.message || 'That action is not allowed here.'; }
  return error?.message || 'Something went wrong. Try again.';
}

// ---- time ------------------------------------------------------------------------------------------------
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');
export const offsetText = (minutes) => `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;

// "2031-03-14T22:10:00+05:30" -> { ms (UTC instant), offsetMin, wall: '2031-03-14 22:10:00' } or null when not ISO with offset.
export function parseStamp(iso) {
  const m = ISO.exec(String(iso));
  if (!m) { return null; }
  const offsetMin = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return { ms: wall - offsetMin * 60_000, offsetMin, wall: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` };
}

// The same instant as the poster's own wall clock ("local") or as UTC.
export function formatStamp(iso, mode = 'local') {
  const parsed = parseStamp(iso);
  if (!parsed) { return String(iso); }
  if (mode === 'utc') {
    const d = new Date(parsed.ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  }
  return `${parsed.wall.slice(0, 16)} (UTC${offsetText(parsed.offsetMin)})`;
}

// Minutes between two stamps (b - a), by instant: wall clocks in different zones are not comparable.
export function minutesBetween(a, b) {
  const pa = parseStamp(a);
  const pb = parseStamp(b);
  return pa && pb ? Math.round((pb.ms - pa.ms) / 60_000) : null;
}

// ---- map -------------------------------------------------------------------------------------------------
export const MAP_SIZE = 1000;
export const MAP_CELLS = 8;
export const CELL_SIZE = MAP_SIZE / MAP_CELLS;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function toCell(x, y) {
  return `${'ABCDEFGH'[clamp(Math.floor(x / CELL_SIZE), 0, MAP_CELLS - 1)]}${clamp(Math.floor(y / CELL_SIZE) + 1, 1, MAP_CELLS)}`;
}

// Survey bounds (south, north, west, east) <-> map units. Latitude grows northwards, y grows downwards.
export function latLonToXY(lat, lon, bounds) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) { return null; }
  const x = ((lo - bounds.west) / (bounds.east - bounds.west)) * MAP_SIZE;
  const y = ((bounds.north - la) / (bounds.north - bounds.south)) * MAP_SIZE;
  if (x < 0 || x > MAP_SIZE || y < 0 || y > MAP_SIZE) { return null; }
  return { x: Math.round(x), y: Math.round(y) };
}
export function xyToLatLon(x, y, bounds) {
  return {
    lat: (bounds.north - (y / MAP_SIZE) * (bounds.north - bounds.south)).toFixed(5),
    lon: (bounds.west + (x / MAP_SIZE) * (bounds.east - bounds.west)).toFixed(5),
  };
}

// A click inside a rendered square map (its bounding box) -> map units, clamped to the map.
export function pointFromClick(rect, clientX, clientY) {
  if (!rect || rect.width <= 0 || rect.height <= 0) { return null; }
  return {
    x: Math.round(clamp(((clientX - rect.left) / rect.width) * MAP_SIZE, 0, MAP_SIZE)),
    y: Math.round(clamp(((clientY - rect.top) / rect.height) * MAP_SIZE, 0, MAP_SIZE)),
  };
}

export const gpsToXY = (exif, bounds) => (exif?.GPSLatitude && exif?.GPSLongitude ? latLonToXY(exif.GPSLatitude, exif.GPSLongitude, bounds) : null);

// ---- scenes (procedural photos) ----------------------------------------------------------------------------
const COLOUR = /^(#[0-9a-f]{3,8}|none)$/i;
export const safeColour = (value, fallback = '#888888') => (typeof value === 'string' && COLOUR.test(value) ? value : fallback);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const POINTS = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?: -?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?){0,15}$/;
export const MAX_SHAPES = 80;

// Normalises server shapes into plain values React can draw as SVG elements: unknown kinds, bad colours or points are dropped.
export function sceneShapes(scene) {
  const out = [];
  for (const shape of (scene?.shapes ?? []).slice(0, MAX_SHAPES)) {
    if (shape.t === 'r') { out.push({ t: 'r', x: num(shape.x), y: num(shape.y), w: num(shape.w), h: num(shape.h), f: safeColour(shape.f) }); }
    else if (shape.t === 'c') { out.push({ t: 'c', x: num(shape.x), y: num(shape.y), r: num(shape.r), f: safeColour(shape.f) }); }
    else if (shape.t === 'p' && POINTS.test(String(shape.pts))) { out.push({ t: 'p', pts: String(shape.pts), f: safeColour(shape.f) }); }
    else if (shape.t === 'l') { out.push({ t: 'l', x1: num(shape.x1), y1: num(shape.y1), x2: num(shape.x2), y2: num(shape.y2), s: safeColour(shape.s, '#222222'), w: num(shape.w) || 2 }); }
    else if (shape.t === 't') { out.push({ t: 't', x: num(shape.x), y: num(shape.y), s: String(shape.s ?? '').slice(0, 40), sz: num(shape.sz) || 8, f: safeColour(shape.f, '#ffffff'), anchor: shape.anchor === 'end' ? 'end' : shape.anchor === 'start' ? 'start' : 'middle' }); }
  }
  return out;
}

// ---- evidence notebook (localStorage) ---------------------------------------------------------------------
export const NOTES_PREFIX = 'osint-notes:';
export const MAX_NOTES = 100;
export const MAX_NOTE_TEXT = 400;
const clip = (text, n) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function loadNotes(storage, track) {
  try {
    const parsed = JSON.parse(storage?.getItem(`${NOTES_PREFIX}${track}`) ?? '[]');
    if (!Array.isArray(parsed)) { return []; }
    return parsed.filter((n) => n && typeof n.id === 'string' && typeof n.text === 'string' && (n.kind === 'pin' || n.kind === 'note'))
      .slice(0, MAX_NOTES)
      .map((n) => ({ id: n.id, kind: n.kind, source: clip(n.source, 20), title: clip(n.title, 80), text: clip(n.text, MAX_NOTE_TEXT), at: Number(n.at) || 0 }));
  } catch { return []; }
}

export function saveNotes(storage, track, notes) {
  try { storage?.setItem(`${NOTES_PREFIX}${track}`, JSON.stringify(notes.slice(0, MAX_NOTES))); return true; } catch { return false; }
}

// Pinning the same item twice does nothing; a full board refuses new items (returns the list unchanged).
export function pinItem(notes, { source, id, title, text }, now = Date.now()) {
  const key = `pin:${source}:${id}`;
  if (notes.some((n) => n.id === key) || notes.length >= MAX_NOTES) { return notes; }
  return [{ id: key, kind: 'pin', source: clip(source, 20), title: clip(title, 80), text: clip(text, MAX_NOTE_TEXT), at: now }, ...notes];
}

export function addFreeNote(notes, text, now = Date.now()) {
  const clean = clip(text, MAX_NOTE_TEXT);
  if (clean === '' || notes.length >= MAX_NOTES) { return notes; }
  return [{ id: `note:${now}:${notes.length}`, kind: 'note', source: 'note', title: 'Note', text: clean, at: now }, ...notes];
}

export const removeNote = (notes, id) => notes.filter((n) => n.id !== id);
export const isPinned = (notes, source, id) => notes.some((n) => n.id === `pin:${source}:${id}`);

// ---- search ----------------------------------------------------------------------------------------------
// Splits text around the query tokens so the UI can wrap matches in <mark> (no HTML strings involved).
export function highlightParts(text, query) {
  const tokens = String(query).toLowerCase().split(/\s+/).filter((t) => t.length >= 2).slice(0, 4);
  const source = String(text);
  if (tokens.length === 0) { return [{ text: source, hit: false }]; }
  const lower = source.toLowerCase();
  const marks = new Array(source.length).fill(false);
  for (const token of tokens) {
    for (let at = lower.indexOf(token); at !== -1; at = lower.indexOf(token, at + token.length)) {
      for (let i = at; i < at + token.length; i += 1) { marks[i] = true; }
    }
  }
  const parts = [];
  for (let i = 0; i < source.length; i += 1) {
    const last = parts.at(-1);
    if (last && last.hit === marks[i]) { last.text += source[i]; } else { parts.push({ text: source[i], hit: marks[i] }); }
  }
  return parts;
}

export const SOURCE_TAB = { feed: 'feed', cast: 'feed', pages: 'web', docs: 'web', pastes: 'web', registry: 'registry', photos: 'photos', map: 'map' };
export const SOURCE_LABEL = {
  feed: 'Feed', cast: 'Profile', pages: 'Web page', docs: 'Document', pastes: 'Paste', registry: 'Registry', photos: 'Photo', map: 'Map',
};

// The next open question to suggest, skipping locked and solved ones.
export function nextOpenQuestion(questions) {
  const open = questions.find((q) => !q.solved && !q.locked);
  return open ? `${open.final ? 'the final question' : `question ${open.n}`}: ${open.title}` : null;
}
