// Registry of the Web Exploit Lab (docs/WEB_EXPLOIT_LAB.md). Pure data and pure functions: nothing here touches
// MongoDB, the network or the real filesystem. All "targets" are simulations built from hardcoded data.
import sqliLogin from './labs/sqliLogin.js';
import cookieTamper from './labs/cookieTamper.js';
import idorStatements from './labs/idorStatements.js';
import pathTraversal from './labs/pathTraversal.js';
import xssFilter from './labs/xssFilter.js';
import jwtNone from './labs/jwtNone.js';
import sqliUnion from './labs/sqliUnion.js';
import jwtWeakSecret from './labs/jwtWeakSecret.js';
import raceRefill from './labs/raceRefill.js';
import chainVault from './labs/chainVault.js';
import { LIMITS, clip } from './limits.js';
import { dict, parseTarget } from './http.js';
import { makeContext } from './seed.js';

export const TRACKS = Object.freeze([
  {
    id: 'easy', title: 'Easy', difficulty: 'easy', theme: 'retro-bank',
    company: { name: 'RetroBank', tagline: 'Banking like it is 1989', brief: 'A pixel-perfect retro bank hired you as a bug bounty hunter. Their security team is very confident.' },
    labs: [sqliLogin, cookieTamper, idorStatements],
  },
  {
    id: 'medium', title: 'Medium', difficulty: 'medium', theme: 'pizza',
    company: { name: 'Slice of Life Pizza', tagline: 'Hot, fast and slightly vulnerable', brief: 'The pizza chain went online last week. Its developers are fast, the pizza is faster, the code review was skipped.' },
    labs: [pathTraversal, xssFilter, jwtNone],
  },
  {
    id: 'hard', title: 'Hard', difficulty: 'hard', theme: 'hospital',
    company: { name: 'Mercy General Hospital', tagline: 'Care you can trust (mostly)', brief: 'A hospital portal with real stakes (all pretend). The bounties are bigger and the mistakes are subtler.' },
    labs: [sqliUnion, jwtWeakSecret, raceRefill],
  },
  {
    id: 'insane', title: 'Insane', difficulty: 'insane', theme: 'vault',
    company: { name: 'NovaCorp Cloud', tagline: 'Zero trust, zero hints', brief: 'One target. No hints. Chain small bugs into one big one.' },
    labs: [chainVault],
  },
]);

export const LABS = Object.freeze(TRACKS.flatMap((track) => track.labs.map((lab) => Object.freeze({ ...lab, track: track.id }))));

const BY_ID = new Map(LABS.map((lab) => [lab.id, lab]));
export const labSlug = (id) => `weblab-${id}`;
export const labBySlug = (slug) => LABS.find((lab) => labSlug(lab.id) === slug) ?? null;
export const labById = (id) => BY_ID.get(id) ?? null;

export const trackMax = (trackId) => LABS.filter((lab) => lab.track === trackId).reduce((sum, lab) => sum + lab.points, 0);
export const TRACK_MAX = Object.freeze(Object.fromEntries(TRACKS.map((track) => [track.id, trackMax(track.id)])));
// The most a team can ever earn from this game: fixed points per lab, once per lab, no first-blood bonus.
export const WEBLAB_MAX_POINTS = LABS.reduce((sum, lab) => sum + lab.points, 0);

// The request inspector gains convenience tools as labs are cleared. Cosmetic: no lab depends on them.
export const INSPECTOR_FEATURES = Object.freeze([
  { id: 'edit', at: 0, label: 'Raw editor', blurb: 'Edit method, path, headers, cookies and body.' },
  { id: 'decode', at: 1, label: 'Decoder', blurb: 'Base64 and URL encode / decode helper.' },
  { id: 'history', at: 3, label: 'History', blurb: 'Replay any earlier request of this lab.' },
  { id: 'diff', at: 5, label: 'Diff', blurb: 'See what changed between the last two responses.' },
  { id: 'curl', at: 7, label: 'Copy as curl', blurb: 'Copy the request as a curl command.' },
]);

export function inspectorFor(solvedCount) {
  const unlocked = INSPECTOR_FEATURES.filter((feature) => solvedCount >= feature.at);
  const next = INSPECTOR_FEATURES.find((feature) => solvedCount < feature.at) ?? null;
  return {
    level: unlocked.length,
    unlocked: unlocked.map((feature) => feature.id),
    features: INSPECTOR_FEATURES.map((feature) => ({ ...feature, unlocked: solvedCount >= feature.at })),
    next: next ? { id: next.id, label: next.label, solvesNeeded: next.at - solvedCount } : null,
  };
}

// Why a lab is closed for a team: a boss needs its track mates cleared, the insane lab needs the hard boss.
export function lockedReason(lab, solvedIds) {
  const missing = (lab.requires ?? [])
    .filter((id) => !solvedIds.has(id))
    .map((id) => labById(id)?.title ?? id);
  return missing.length ? `Clear first: ${missing.join(', ')}` : null;
}

export function normaliseRequest(input) {
  const headers = dict();
  for (const [name, value] of Object.entries(input.headers ?? {}).slice(0, LIMITS.HEADER_COUNT)) {
    const key = clip(name, LIMITS.HEADER_NAME).toLowerCase();
    if (key && key !== '__proto__') { headers[key] = clip(value, LIMITS.HEADER_VALUE); }
  }
  const cookies = dict();
  for (const [name, value] of Object.entries(input.cookies ?? {}).slice(0, LIMITS.COOKIE_COUNT)) {
    const key = clip(name, LIMITS.COOKIE_NAME);
    if (key && key !== '__proto__') { cookies[key] = clip(value, LIMITS.COOKIE_VALUE); }
  }
  const target = parseTarget(clip(input.path, LIMITS.PATH));
  return {
    method: String(input.method ?? 'GET').toUpperCase(),
    pathname: target.pathname,
    query: target.query,
    headers,
    cookies,
    body: clip(input.body, LIMITS.BODY),
  };
}

const flagSafe = (value) => (typeof value === 'string' ? value : '');

// Runs one simulated request. Returns only allow-listed fields. A lab crash becomes a generic 500 (no details).
export function runLab(lab, { secret, teamId, flag, request }) {
  const ctx = makeContext({ secret, teamId, labId: lab.id, flag });
  let result;
  try {
    result = lab.handle(ctx, normaliseRequest(request));
  } catch {
    result = { status: 500, contentType: 'text/plain', body: 'Internal Server Error' };
  }
  const setCookies = (result.setCookies ?? []).slice(0, 5)
    .map((cookie) => ({ name: clip(cookie.name, LIMITS.COOKIE_NAME), value: clip(cookie.value, LIMITS.COOKIE_VALUE) }));
  return {
    status: Number.isInteger(result.status) ? result.status : 500,
    contentType: flagSafe(result.contentType) || 'text/plain',
    body: clip(result.body, LIMITS.OUTPUT),
    setCookies,
    page: result.page ?? null,
    exploited: result.exploited === true,
  };
}

export function labTemplate(lab, { secret, teamId }) {
  const ctx = makeContext({ secret, teamId, labId: lab.id, flag: '' });
  return lab.template(ctx);
}
