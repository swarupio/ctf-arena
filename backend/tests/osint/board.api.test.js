import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { getCognitoVerifier } from '../../src/config/cognito.js';
import AttemptCounter from '../../src/models/AttemptCounter.js';
import Challenge from '../../src/models/Challenge.js';
import OsintBoard from '../../src/models/OsintBoard.js';
import OsintHint from '../../src/models/OsintHint.js';
import Solve from '../../src/models/Solve.js';
import Submission from '../../src/models/Submission.js';
import Team from '../../src/models/Team.js';
import User from '../../src/models/User.js';
import { osintDefinitions } from '../../src/scripts/seedOsint.js';
import { achievementService } from '../../src/services/achievementService.js';
import { MAX_PINS, evidenceOf, linkCap } from '../../src/osint/board.js';
import { TRACKS, TRACK_IDS, buildCase } from '../../src/osint/cases.js';
import { RELATION_IDS } from '../../src/osint/evidence.js';

vi.mock('../../src/config/cognito.js', () => ({ getCognitoVerifier: vi.fn() }));
vi.mock('../../src/models/User.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../src/models/Team.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../../src/models/Challenge.js', () => ({ default: { find: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../../src/models/Solve.js', () => ({ default: { find: vi.fn(), create: vi.fn(), aggregate: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../../src/models/Submission.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../../src/models/AttemptCounter.js', () => ({ default: { findOneAndUpdate: vi.fn(), create: vi.fn() } }));
vi.mock('../../src/models/OsintHint.js', () => ({ default: { find: vi.fn(), countDocuments: vi.fn(), updateOne: vi.fn() } }));
vi.mock('../../src/models/OsintBoard.js', () => ({ default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../../src/services/achievementService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, achievementService: { ...actual.achievementService, safeEvaluate: vi.fn() } };
});

const oid = (n) => String(n).padStart(24, '0');
const TEAM_A = oid(2);
const TEAM_B = oid(4);
const users = { player: { _id: oid(1), teamId: TEAM_A }, player2: { _id: oid(3), teamId: TEAM_B }, loner: { _id: oid(5), teamId: null }, admin: { _id: oid(9), teamId: null } };
let rows;
let solves;
let counters;
let boards;

const api = (method, path, sub = 'player', body) => {
  const call = request(app)[method](`/api/osint${path}`).set('Authorization', `Bearer ${sub}`);
  return body === undefined ? call : call.send(body);
};
const getBoard = (track, sub = 'player') => api('get', `/cases/${track}/board`, sub);
const putBoard = (track, body, sub = 'player') => api('put', `/cases/${track}/board`, sub, body);
const caseOf = (track, teamId = TEAM_A) => buildCase(env.FLAG_SECRET, teamId, track);
const asLinks = (chain) => chain.map(([a, b, rel]) => ({ a, b, rel }));
const pinsFor = (links) => [...new Set(links.flatMap((l) => [l.a, l.b]))].map((id, i) => ({ id, x: 20 + i * 5, y: 40 + i * 5 }));
const validBoard = (track, teamId = TEAM_A, version = 0) => {
  const links = asLinks(caseOf(track, teamId).chain);
  return { version, pins: pinsFor(links), links };
};
const nonFinal = (track) => TRACKS[track].stages.filter((s) => !s.final).map((s) => s.n);
const finalOf = (track) => TRACKS[track].stages.find((s) => s.final).n;
const answerOf = (track, n) => api('post', `/cases/${track}/questions/${n}/answer`, 'player', { answer: caseOf(track).ans[n] });

beforeEach(() => {
  vi.resetAllMocks();
  achievementService.safeEvaluate.mockResolvedValue([]);
  getCognitoVerifier.mockReturnValue({
    verify: vi.fn(async (sub) => ({ sub, email: `${sub}@example.com`, 'cognito:groups': [sub === 'admin' ? 'admin' : 'player'] })),
  });
  rows = osintDefinitions().map((d, i) => ({ ...d, _id: oid(7000 + i), visible: true, solveCount: 0 }));
  solves = [];
  counters = new Map();
  boards = [];
  OsintHint.find.mockImplementation(() => ({ lean: async () => [] }));
  User.findOne.mockImplementation(async ({ cognitoSub }) => users[cognitoSub] ?? null);
  Team.findById.mockImplementation(async (id) => ({ _id: String(id), name: 'T', banned: false }));
  Challenge.find.mockImplementation((filter) => ({
    lean: async () => rows.filter((r) => r.type === filter.type && r.visible === filter.visible
      && (filter['osint.track'] === undefined || r.osint.track === filter['osint.track'])),
  }));
  Challenge.findOneAndUpdate.mockImplementation(async ({ _id }, update) => {
    const row = rows.find((r) => r._id === _id);
    row.solveCount += update.$inc.solveCount;
    return { ...row };
  });
  Solve.find.mockImplementation((filter) => ({
    lean: async () => solves.filter((s) => s.teamId === String(filter.teamId) && filter.challengeId.$in.includes(s.challengeId)),
  }));
  Solve.create.mockImplementation(async (doc) => { solves.push({ ...doc, teamId: String(doc.teamId) }); return doc; });
  Solve.updateOne.mockResolvedValue({});
  Solve.aggregate.mockImplementation(async () => [{ score: 0 }]);
  Submission.create.mockResolvedValue({});
  AttemptCounter.findOneAndUpdate.mockImplementation(async (filter, update) => {
    const doc = counters.get(filter.key);
    if (!doc) { return null; }
    const now = new Date();
    if (filter.expiresAt.$gt && doc.expiresAt > now) { doc.count += update.$inc.count; return { ...doc }; }
    if (filter.expiresAt.$lte && doc.expiresAt <= now) { Object.assign(doc, update.$set); return { ...doc }; }
    return null;
  });
  AttemptCounter.create.mockImplementation(async (doc) => { counters.set(doc.key, { ...doc }); return doc; });

  // An in-memory emulation of the two MongoDB behaviours the board relies on: single-document atomic updates and the
  // unique (teamId, track) index (a filter that misses an existing document tries to insert and hits a duplicate key).
  OsintBoard.findOne.mockImplementation((filter) => ({
    lean: async () => {
      const doc = boards.find((b) => b.teamId === String(filter.teamId) && b.track === filter.track && (filter.unlocked === undefined || b.unlocked === filter.unlocked));
      return doc ? structuredClone(doc) : null;
    },
  }));
  OsintBoard.findOneAndUpdate.mockImplementation(async (filter, update, options) => {
    const existing = boards.find((b) => b.teamId === String(filter.teamId) && b.track === filter.track);
    if (existing && existing.version === filter.version) {
      Object.assign(existing, update.$set, { version: existing.version + update.$inc.version });
      return structuredClone(existing);
    }
    if (existing) { throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 }); }
    if (!options.upsert) { return null; }
    const doc = { teamId: String(filter.teamId), track: filter.track, unlocked: false, ...update.$set, version: filter.version + update.$inc.version };
    boards.push(doc);
    return structuredClone(doc);
  });
});

describe('reading the board', () => {
  it.each(TRACK_IDS)('starts empty for %s with the meter, the limits and the relation list', async (track) => {
    const { body } = await getBoard(track).expect(200);
    const required = caseOf(track).chain.length;
    expect(body).toMatchObject({
      version: 0, pins: [], links: [], unlocked: false, readOnly: false,
      progress: { level: 'none', total: required }, limits: { pins: MAX_PINS, links: linkCap(required) },
    });
    expect(body.relations.map((r) => r.id)).toEqual(RELATION_IDS);
    expect(typeof body.nudge).toBe('string');
    expect(body.progress).not.toHaveProperty('found'); // never an exact count outside the explicit check
  });

  it('marks a banned team read-only', async () => {
    Team.findById.mockImplementation(async (id) => ({ _id: String(id), name: 'T', banned: true }));
    expect((await getBoard('easy').expect(200)).body.readOnly).toBe(true);
    expect((await putBoard('easy', { version: 0, pins: [], links: [] }).expect(403)).body.error.code).toBe('TEAM_BANNED');
  });

  it('marks admins and teamless players read-only and a normal team writable', async () => {
    expect((await getBoard('easy', 'admin').expect(200)).body.readOnly).toBe(true);
    expect((await getBoard('easy', 'loner').expect(200)).body.readOnly).toBe(true);
    expect((await getBoard('easy').expect(200)).body.readOnly).toBe(false);
  });

  it('answers 404 for an unknown case and refuses bad query fields on the evidence list', async () => {
    await api('get', '/cases/nope/board').expect(404);
    await api('get', '/cases/easy/board/evidence?bogus=1').expect(400);
    await api('get', '/cases/easy/board/evidence?source=nope').expect(400);
  });

  it('lets an admin preview the board read-only and never save it', async () => {
    const view = (await getBoard('easy', 'admin').expect(200)).body;
    expect(view).toMatchObject({ readOnly: true, pins: [], links: [], unlocked: false });
    await putBoard('easy', validBoard('easy'), 'admin').expect(403);
    expect(boards).toHaveLength(0);
    expect((await api('get', '/cases/easy/board/evidence?limit=5', 'admin').expect(200)).body.items).toHaveLength(5);
  });

  it('shows a player without a team a read-only empty board and refuses to save', async () => {
    expect((await getBoard('easy', 'loner').expect(200)).body.readOnly).toBe(true);
    expect((await putBoard('easy', validBoard('easy'), 'loner').expect(404)).body.error.code).toBe('NO_TEAM');
  });
});

describe('the evidence list', () => {
  it('pages through the evidence of the team world, filters by source and text, and carries labels only', async () => {
    const all = evidenceOf(caseOf('easy').world);
    const first = (await api('get', '/cases/easy/board/evidence?limit=50').expect(200)).body;
    expect(first.total).toBe(all.length);
    expect(first.items).toHaveLength(Math.min(50, all.length));
    expect(Object.keys(first.items[0]).sort()).toEqual(['id', 'kind', 'label']);
    const maps = (await api('get', '/cases/easy/board/evidence?source=map&limit=50').expect(200)).body;
    expect(maps.items.every((i) => i.kind === 'map')).toBe(true);
    const rest = (await api('get', '/cases/easy/board/evidence?offset=50&limit=50').expect(200)).body;
    expect(rest.items[0]?.id).toBe(all[50]?.id);
    const term = all.find((i) => i.kind === 'registry').id.split(':')[1];
    const hit = (await api('get', `/cases/easy/board/evidence?q=${term}`).expect(200)).body;
    expect(hit.items.map((i) => i.id)).toContain(`registry:${term}`);
  });

  it('is generated from the caller team: two teams see different evidence', async () => {
    const a = (await api('get', '/cases/medium/board/evidence?source=registry&limit=50').expect(200)).body;
    const b = (await api('get', '/cases/medium/board/evidence?source=registry&limit=50', 'player2').expect(200)).body;
    expect(a.items.map((i) => i.id)).not.toEqual(b.items.map((i) => i.id));
  });
});

describe('saving the board', () => {
  it.each(TRACK_IDS)('unlocks the final of %s when the board holds the whole chain', async (track) => {
    const required = caseOf(track).chain.length;
    for (const n of nonFinal(track)) { await answerOf(track, n).expect(200); }
    const last = finalOf(track);
    expect((await answerOf(track, last).expect(403)).body.error.code).toBe('BOARD_LOCKED');
    const saved = (await putBoard(track, validBoard(track)).expect(200)).body;
    expect(saved).toMatchObject({ version: 1, unlocked: true, progress: { level: 'complete', total: required } });
    expect(saved.progress).not.toHaveProperty('found');
    const view = (await api('get', `/cases/${track}`).expect(200)).body;
    expect(view.questions.at(-1).locked).toBe(false);
    expect(view.board).toEqual({ required, unlocked: true });
    expect((await answerOf(track, last).expect(200)).body).toMatchObject({ correct: true, caseClosed: true });
  });

  // Was 'reports "N of M" for a partial board': that exact count after every save made a save a count oracle.
  it('reports only a coarse level for a partial board (never N of M) and keeps the final locked', async () => {
    const full = validBoard('hard');
    const some = asLinks(caseOf('hard').chain).slice(0, 2);
    const partial = (await putBoard('hard', { version: 0, pins: pinsFor(some), links: some }).expect(200)).body;
    expect(partial).toMatchObject({ unlocked: false, progress: { level: 'none', total: full.links.length } });
    expect(JSON.stringify(partial.progress)).not.toContain('found');
    const view = (await api('get', '/cases/hard').expect(200)).body;
    expect(view.board.unlocked).toBe(false);
    expect(view.questions.at(-1).locked).toBe(true);
  });

  it('does not unlock for a spam board: consecutive pairs of the first pins, up to the cap', async () => {
    for (const track of TRACK_IDS) {
      const required = caseOf(track).chain.length;
      const ids = evidenceOf(caseOf(track).world).slice(0, MAX_PINS).map((i) => i.id);
      const links = [];
      for (let i = 0; links.length < linkCap(required); i += 1) { links.push({ a: ids[i], b: ids[i + 1], rel: RELATION_IDS[i % RELATION_IDS.length] }); }
      const res = (await putBoard(track, { version: 0, pins: ids.map((id, i) => ({ id, x: i, y: i })), links }).expect(200)).body;
      expect(res.unlocked).toBe(false);
      expect(['none', 'started']).toContain(res.progress.level);
      expect(res.progress).not.toHaveProperty('found');
      boards = [];
    }
  });

  it('rejects boards over the caps with 422 and stores nothing', async () => {
    const required = caseOf('easy').chain.length;
    const ids = evidenceOf(caseOf('easy').world).map((i) => i.id);
    const links = Array.from({ length: linkCap(required) + 1 }, (_, i) => ({ a: ids[i], b: ids[i + 1], rel: 'linked' }));
    const tooManyLinks = await putBoard('easy', { version: 0, pins: pinsFor(links), links }).expect(422);
    expect(tooManyLinks.body.error.code).toBe('BOARD_LIMIT');
    const tooManyPins = await putBoard('easy', { version: 0, pins: ids.slice(0, MAX_PINS + 1).map((id, i) => ({ id, x: i, y: i })), links: [] }).expect(422);
    expect(tooManyPins.body.error.code).toBe('BOARD_LIMIT');
    // the whole chain padded with filler up to one over the cap is refused too, so padding cannot hide a guess
    const padded = [...asLinks(caseOf('easy').chain), ...links].slice(0, linkCap(required) + 1);
    await putBoard('easy', { version: 0, pins: pinsFor(padded), links: padded }).expect(422);
    expect(boards).toHaveLength(0);
  });

  it('rejects invented evidence, unpinned endpoints, duplicates and malformed bodies', async () => {
    const [a, b] = evidenceOf(caseOf('easy').world).map((i) => i.id);
    const pins = [{ id: a, x: 1, y: 1 }, { id: b, x: 2, y: 2 }];
    expect((await putBoard('easy', { version: 0, pins: [{ id: 'feed:p999', x: 1, y: 1 }], links: [] }).expect(400)).body.error.code).toBe('BAD_EVIDENCE');
    expect((await putBoard('easy', { version: 0, pins, links: [{ a, b: 'feed:p998', rel: 'linked' }] }).expect(400)).body.error.code).toBe('BAD_BOARD');
    expect((await putBoard('easy', { version: 0, pins, links: [{ a, b, rel: 'linked' }, { a: b, b: a, rel: 'linked' }] }).expect(400)).body.error.code).toBe('BAD_BOARD');
    await putBoard('easy', { version: 0, pins, links: [{ a, b, rel: 'friends' }] }).expect(400);
    await putBoard('easy', { version: 0, pins: [{ id: 'not an id', x: 1, y: 1 }], links: [] }).expect(400);
    await putBoard('easy', { version: 0, pins: [{ id: a, x: 1.5, y: 1 }], links: [] }).expect(400);
    await putBoard('easy', { version: 0, pins: [{ id: a, x: 2000, y: 1 }], links: [] }).expect(400);
    await putBoard('easy', { version: 0, pins: [{ id: a, x: 1, y: 1, note: 'x' }], links: [] }).expect(400);
    await putBoard('easy', { version: 0, pins: [], links: [], unlocked: true }).expect(400);
    await putBoard('easy', { pins: [], links: [] }).expect(400);
    await putBoard('easy', { version: -1, pins: [], links: [] }).expect(400);
    expect(boards).toHaveLength(0);
  });

  it('keeps the unlock once earned, even if the board is edited afterwards', async () => {
    await putBoard('easy', validBoard('easy')).expect(200);
    const emptied = (await putBoard('easy', { version: 1, pins: [], links: [] }).expect(200)).body;
    expect(emptied).toMatchObject({ version: 2, unlocked: true, links: [] });
  });

  // Was 60 a minute: tightened to 30 a minute and 200 an hour together with the removal of the exact count.
  it('budgets saves per team and case: 30 a minute, then 429', async () => {
    let version = 0;
    for (let i = 0; i < 30; i += 1) { version = (await putBoard('easy', { version, pins: [], links: [] }).expect(200)).body.version; }
    expect((await putBoard('easy', { version, pins: [], links: [] }).expect(429)).body.error.code).toBe('RATE_LIMITED');
    await putBoard('medium', { version: 0, pins: [], links: [] }).expect(200);
  });
});

describe('sharing and conflicts', () => {
  it('returns 409 for a stale version and changes nothing', async () => {
    const first = (await putBoard('easy', { version: 0, pins: [], links: [] }).expect(200)).body;
    expect(first.version).toBe(1);
    const pin = { id: evidenceOf(caseOf('easy').world)[0].id, x: 1, y: 1 };
    const stale = await putBoard('easy', { version: 0, pins: [pin], links: [] }).expect(409);
    expect(stale.body.error.code).toBe('BOARD_CONFLICT');
    expect(boards[0].pins).toEqual([]);
    expect((await putBoard('easy', { version: 7, pins: [], links: [] }).expect(409)).body.error.code).toBe('BOARD_CONFLICT');
  });

  it('lets exactly one of two concurrent saves with the same version win', async () => {
    await putBoard('easy', { version: 0, pins: [], links: [] }).expect(200);
    const ids = evidenceOf(caseOf('easy').world).map((i) => i.id);
    const save = (id) => putBoard('easy', { version: 1, pins: [{ id, x: 10, y: 10 }], links: [] });
    const [one, two] = await Promise.all([save(ids[0]), save(ids[1])]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect(boards[0].version).toBe(2);
    expect(boards[0].pins).toHaveLength(1);
  });

  it('shares one board between teammates and a first-save race ends in a 409', async () => {
    const [first, second] = await Promise.all([
      putBoard('easy', { version: 0, pins: [], links: [] }), putBoard('easy', { version: 0, pins: [], links: [] }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(boards).toHaveLength(1);
    expect((await getBoard('easy').expect(200)).body.version).toBe(1);
  });

  it('isolates boards by team: a copied board does not fit another team and nothing is visible across teams', async () => {
    await putBoard('easy', validBoard('easy', TEAM_A)).expect(200);
    expect((await getBoard('easy', 'player2').expect(200)).body).toMatchObject({ version: 0, pins: [], unlocked: false });
    // Positional ids (post p012, profile c03) can exist in both worlds, so a copied board may be accepted; it never unlocks.
    const copied = await putBoard('easy', validBoard('easy', TEAM_A), 'player2');
    expect(copied.status === 400 || (copied.status === 200 && copied.body.unlocked === false)).toBe(true);
    boards = boards.filter((b) => b.teamId !== TEAM_B);
    expect((await api('get', '/cases/easy', 'player2').expect(200)).body.board.unlocked).toBe(false);
    const own = (await putBoard('easy', validBoard('easy', TEAM_B), 'player2').expect(200)).body;
    expect(own.unlocked).toBe(true);
    expect(boards.map((b) => b.teamId).sort()).toEqual([TEAM_A, TEAM_B]);
    // a board of one case never opens the final of another case
    expect((await api('get', '/cases/medium', 'player2').expect(200)).body.board.unlocked).toBe(false);
  });
});

describe('no leaks', () => {
  it('never puts answers, flags, hashes or the chain in any board response', async () => {
    const { ans, chain } = caseOf('insane');
    const partial = asLinks(chain).slice(0, 2);
    const ids = evidenceOf(caseOf('insane').world).map((i) => i.id);
    const spam = Array.from({ length: linkCap(chain.length) + 1 }, (_, i) => ({ a: ids[i], b: ids[i + 1], rel: 'linked' }));
    const responses = [
      (await getBoard('insane').expect(200)).text,
      (await putBoard('insane', { version: 0, pins: pinsFor(partial), links: partial }).expect(200)).text,
      (await getBoard('insane').expect(200)).text,
      (await putBoard('insane', { version: 0, pins: [], links: [] }).expect(409)).text,
      (await putBoard('insane', { version: 1, pins: pinsFor(spam), links: spam }).expect(422)).text,
      (await api('get', '/cases/insane/board/evidence?limit=50').expect(200)).text,
    ];
    const pinned = new Set(pinsFor(partial).map((p) => p.id));
    const missing = chain.flatMap(([a, b]) => [a, b]).filter((id) => !pinned.has(id));
    for (const text of responses) {
      // short answers (a time like 02:40, a cell) also occur in public timestamps, so only distinctive answers are searched
      // (the evidence list is the public catalogue of names, domains and places, so answers legitimately occur in it)
      if (text !== responses.at(-1)) { for (const answer of Object.values(ans).map(String).filter((a) => a.length >= 8)) { expect(text).not.toContain(answer); } }
      expect(text).not.toMatch(/flag\{|"flag"|"confirmed"|"chain"|"required"|"hash"/);
    }
    // the board view repeats only what the team pinned itself; ids of links it has not found never appear in it
    for (const id of missing) { expect(responses[1]).not.toContain(`"${id}"`); expect(responses[2]).not.toContain(`"${id}"`); }
  });

  it('gives the same generic nudge for any progress below the unlock, with no evidence named', async () => {
    const chain = asLinks(caseOf('hard').chain);
    const one = (await putBoard('hard', { version: 0, pins: pinsFor(chain.slice(0, 1)), links: chain.slice(0, 1) }).expect(200)).body;
    const three = (await putBoard('hard', { version: 1, pins: pinsFor(chain.slice(0, 3)), links: chain.slice(0, 3) }).expect(200)).body;
    expect(one.nudge).toBe(three.nudge);
    expect(one.nudge).not.toMatch(/:/);
  });
});

// The exact count lives behind an explicit, strictly budgeted action: POST .../board/check.
describe('checking the saved board', () => {
  const check = (track, sub = 'player', body = {}) => api('post', `/cases/${track}/board/check`, sub, body);
  const save = (track, count, version = 0) => {
    const links = asLinks(caseOf(track).chain).slice(0, count);
    return putBoard(track, { version, pins: pinsFor(links), links });
  };
  const newMinute = () => { for (const [key, row] of counters) { if (key.endsWith(':0')) { row.expiresAt = new Date(Date.now() - 1); } } };

  it('returns the exact N of M for the SAVED board, from 0 up to the whole chain', async () => {
    const required = caseOf('insane').chain.length;
    expect((await check('insane').expect(200)).body).toMatchObject({ found: 0, total: required, readOnly: false });
    await save('insane', 3).expect(200);
    expect((await check('insane').expect(200)).body).toMatchObject({ found: 3, total: required });
    await save('insane', 5, 1).expect(200);
    newMinute();
    expect((await check('insane').expect(200)).body).toMatchObject({ found: 5, total: required });
  });

  it('counts the saved board, not a draft: nothing changes until a save', async () => {
    await save('easy', 2).expect(200);
    expect((await check('easy').expect(200)).body.found).toBe(2);
    expect((await check('easy').expect(200)).body.found).toBe(2);
  });

  it('has no side effects: it never writes the board, unlocks, or records a submission', async () => {
    await save('easy', 3).expect(200);
    OsintBoard.findOneAndUpdate.mockClear();
    const before = structuredClone(boards);
    await check('easy').expect(200);
    expect(OsintBoard.findOneAndUpdate).not.toHaveBeenCalled();
    expect(boards).toEqual(before);
    expect(Submission.create).not.toHaveBeenCalled();
    expect(Solve.create).not.toHaveBeenCalled();
  });

  it('reports the whole chain once the board is unlocked, even after links were removed', async () => {
    await putBoard('easy', validBoard('easy')).expect(200);
    await putBoard('easy', { version: 1, pins: [], links: [] }).expect(200);
    const { body } = await check('easy').expect(200);
    expect(body.found).toBe(body.total);
  });

  it('allows 3 checks a minute and then answers 429 with a generic message, per team and case', async () => {
    const left = [];
    for (let i = 0; i < 3; i += 1) { left.push((await check('easy').expect(200)).body.checksLeft); }
    expect(left).toEqual([2, 1, 0]);
    const limited = await check('easy').expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.body.error.message).toMatch(/3 times a minute and 10 times an hour/);
    expect(JSON.stringify(limited.body)).not.toMatch(/found/);
    await check('medium').expect(200); // another case has its own budget
    await check('easy', 'player2').expect(200); // another team has its own budget
    expect([...counters.keys()].some((key) => key.startsWith(`osint-board-check:${TEAM_A}:easy`))).toBe(true);
  });

  it('allows 10 checks an hour even when the minute window is renewed', async () => {
    for (let i = 0; i < 10; i += 1) { newMinute(); await check('easy').expect(200); }
    newMinute();
    expect((await check('easy').expect(429)).body.error.code).toBe('RATE_LIMITED');
  });

  it('gives admins and teamless players an empty read-only result and uses no budget', async () => {
    const required = caseOf('easy').chain.length;
    for (const sub of ['admin', 'loner']) {
      for (let i = 0; i < 6; i += 1) {
        expect((await check('easy', sub).expect(200)).body).toEqual({ found: 0, total: required, checksLeft: 0, readOnly: true });
      }
    }
    expect(counters.size).toBe(0);
  });

  it('gives a banned team the empty read-only result too', async () => {
    Team.findById.mockImplementation(async (id) => ({ _id: String(id), name: 'T', banned: true }));
    expect((await check('easy').expect(200)).body).toMatchObject({ found: 0, readOnly: true });
  });

  it('validates strictly: unknown case 404, a body with fields 400, unauthenticated 401', async () => {
    await check('nope').expect(404);
    await check('easy', 'player', { found: 4 }).expect(400);
    await request(app).post('/api/osint/cases/easy/board/check').send({}).expect(401);
    expect(counters.size).toBe(0);
  });

  it('never leaks the chain, an answer or an evidence id', async () => {
    const { ans, chain } = caseOf('hard');
    await save('hard', 2).expect(200);
    const text = (await check('hard').expect(200)).text;
    for (const id of chain.flatMap(([a, b]) => [a, b])) { expect(text).not.toContain(id); }
    for (const answer of Object.values(ans).map(String).filter((a) => a.length >= 8)) { expect(text).not.toContain(answer); }
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['checksLeft', 'found', 'readOnly', 'total']);
  });
});

describe('the save response is no count oracle', () => {
  it('gives identical bodies for boards that hold different numbers of links within the same level', async () => {
    const chain = asLinks(caseOf('insane').chain); // 6 required: none below 3, started at 3 and 4, close at 5
    let version = 0;
    const shape = async (count) => {
      const res = await putBoard('insane', { version, pins: pinsFor(chain.slice(0, count)), links: chain.slice(0, count) }).expect(200);
      version = res.body.version;
      const { version: _v, pins: _p, links: _l, ...rest } = res.body;
      return rest;
    };
    const [c0, c1, c2] = [await shape(0), await shape(1), await shape(2)];
    expect(c0).toEqual(c1);
    expect(c1).toEqual(c2);
    expect(await shape(3)).toEqual(await shape(4));
    expect((await shape(3)).progress.level).toBe('started');
    expect((await shape(5)).progress.level).toBe('close');
    expect((await shape(6)).progress.level).toBe('complete');
  });
});
