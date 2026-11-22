import { describe, expect, it } from 'vitest';
import { MAX_PINS, boardProblem, chainProgress, evidenceIndex, evidenceOf, linkCap, linkKey, nudge, progressLevel } from '../../src/osint/board.js';
import { TRACK_IDS } from '../../src/osint/cases.js';
import { EVIDENCE_ID, RELATION_IDS } from '../../src/osint/evidence.js';
import { CHAIN_SOLVERS, caseFor } from './solvers.js';

const TEAMS = Array.from({ length: 12 }, (_, i) => `board-team-${i}`);
const sortedKeys = (chain) => chain.map(([a, b, rel]) => linkKey(a, b, rel)).sort();
const asLinks = (chain) => chain.map(([a, b, rel]) => ({ a, b, rel }));
const pinsFor = (links) => [...new Set(links.flatMap((l) => [l.a, l.b]))].map((id, i) => ({ id, x: i, y: i }));

describe('the hidden chain', () => {
  it.each(TRACK_IDS)('is re-derived from public data alone for %s, for many teams', (track) => {
    for (const team of TEAMS) {
      const { world, pub, chain } = caseFor(track, team);
      expect(sortedKeys(CHAIN_SOLVERS[track](world, pub))).toEqual(sortedKeys(chain));
    }
  });

  it('has 4 to 6 links, all on real evidence, all with a known relation, none repeated', () => {
    for (const track of TRACK_IDS) {
      for (const team of TEAMS) {
        const { world, chain } = caseFor(track, team);
        const index = evidenceIndex(world);
        expect(chain.length).toBeGreaterThanOrEqual(4);
        expect(chain.length).toBeLessThanOrEqual(6);
        for (const [a, b, rel] of chain) {
          expect(index.has(a) && index.has(b)).toBe(true);
          expect(a).not.toBe(b);
          expect(RELATION_IDS).toContain(rel);
        }
        expect(new Set(sortedKeys(chain)).size).toBe(chain.length);
      }
    }
  });

  it('differs between teams (a copied board never fits another team)', () => {
    for (const track of TRACK_IDS) {
      const seen = new Set(TEAMS.map((team) => JSON.stringify(caseFor(track, team).chain)));
      expect(seen.size).toBeGreaterThan(TEAMS.length - 2);
    }
  });
});

describe('evidence ids', () => {
  it('all look like the documented pattern and are unique, with public labels only', () => {
    for (const track of TRACK_IDS) {
      const { world, ans } = caseFor(track, 'board-team-0');
      const items = evidenceOf(world);
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
      expect(items.length).toBeLessThan(400);
      for (const item of items) {
        expect(item.id).toMatch(EVIDENCE_ID);
        expect(item.label.length).toBeLessThanOrEqual(140);
      }
      // a label is a title of public material: no answer of the case appears as a whole label
      const labels = items.map((i) => i.label.toLowerCase());
      for (const answer of Object.values(ans)) { expect(labels).not.toContain(String(answer).toLowerCase()); }
    }
  });
});

describe('chain progress', () => {
  const { chain } = caseFor('easy', 'team-a');
  it('counts links whatever their direction, and only with the right relation', () => {
    const links = asLinks(chain);
    expect(chainProgress(chain, links)).toEqual({ found: chain.length, total: chain.length });
    const flipped = links.map((l) => ({ a: l.b, b: l.a, rel: l.rel }));
    expect(chainProgress(chain, flipped).found).toBe(chain.length);
    const wrongRelation = links.map((l) => ({ ...l, rel: l.rel === 'linked' ? 'owns' : 'linked' }));
    expect(chainProgress(chain, wrongRelation).found).toBe(0);
    expect(chainProgress(chain, links.slice(0, 2))).toEqual({ found: 2, total: chain.length });
    expect(chainProgress(chain, [])).toEqual({ found: 0, total: chain.length });
  });

  it('gives a generic nudge that mentions no evidence', () => {
    for (const state of [{ found: 0, total: 4 }, { found: 2, total: 4 }, { found: 4, total: 4, unlocked: true }]) {
      expect(nudge(state)).not.toMatch(/\b(feed|cast|pastes|registry|map|docs):/);
    }
    expect(nudge({ found: 1, total: 4 })).toBe(nudge({ found: 3, total: 4 }));
    expect(nudge({ found: 0, total: 4 })).toBe(nudge({ found: 3, total: 4 })); // zero is not told apart from partial
  });

  it('maps the count to a coarse level: none below half, started from half, close at total - 1, complete when unlocked', () => {
    const levels = (total) => Array.from({ length: total + 1 }, (_, found) => progressLevel({ found, total }));
    expect(levels(4)).toEqual(['none', 'none', 'started', 'close', 'complete']);
    expect(levels(5)).toEqual(['none', 'none', 'none', 'started', 'close', 'complete']);
    expect(levels(6)).toEqual(['none', 'none', 'none', 'started', 'started', 'close', 'complete']);
    expect(progressLevel({ found: 0, total: 4, unlocked: true })).toBe('complete'); // sticky unlock
    // one link never changes the level of an empty board, so none -> started is not an "any link holds" test
    for (const total of [4, 5, 6]) { expect(progressLevel({ found: 1, total })).toBe('none'); }
  });
});

describe('caps and structure', () => {
  const { world, chain } = caseFor('medium', 'team-a');
  const index = evidenceIndex(world);
  const ids = [...index.keys()];
  const check = (pins, links) => boardProblem({ index, pins, links, required: chain.length });

  it('defines the link cap as twice the chain length', () => {
    expect(linkCap(5)).toBe(10);
    expect(linkCap(chain.length)).toBe(chain.length * 2);
  });

  it('accepts the valid chain and rejects anything over the caps', () => {
    const links = asLinks(chain);
    expect(check(pinsFor(links), links)).toBeNull();
    const tooMany = Array.from({ length: linkCap(chain.length) + 1 }, (_, i) => ({ a: ids[i], b: ids[i + 1], rel: 'linked' }));
    expect(check(pinsFor(tooMany), tooMany)).toMatchObject({ code: 'BOARD_LIMIT' });
    const pins = ids.slice(0, MAX_PINS + 1).map((id, i) => ({ id, x: i, y: i }));
    expect(check(pins, [])).toMatchObject({ code: 'BOARD_LIMIT' });
  });

  it('rejects invented ids, unpinned endpoints, self links and duplicates', () => {
    const [a, b] = ids;
    const pins = [{ id: a, x: 1, y: 1 }, { id: b, x: 2, y: 2 }];
    expect(check([{ id: 'feed:p999', x: 1, y: 1 }], [])).toMatchObject({ code: 'BAD_EVIDENCE' });
    expect(check([pins[0], pins[0]], [])).toMatchObject({ code: 'BAD_BOARD' });
    expect(check(pins, [{ a, b: ids[5], rel: 'linked' }])).toMatchObject({ code: 'BAD_BOARD' });
    expect(check(pins, [{ a, b: a, rel: 'linked' }])).toMatchObject({ code: 'BAD_BOARD' });
    expect(check(pins, [{ a, b, rel: 'linked' }, { a: b, b: a, rel: 'linked' }])).toMatchObject({ code: 'BAD_BOARD' });
    expect(check(pins, [{ a, b, rel: 'sibling' }])).toMatchObject({ code: 'BAD_BOARD' });
    expect(check(pins, [{ a, b, rel: 'linked' }, { a, b, rel: 'mentions' }])).toBeNull();
  });

  it('cannot be unlocked by guessing: every pair of a pinned set, within the cap, finds only a few links', () => {
    // Even a board of the 40 first items with the cap's worth of arbitrary links does not contain the whole chain.
    for (const track of TRACK_IDS) {
      const { world: w, chain: c } = caseFor(track, 'team-a');
      const all = [...evidenceIndex(w).keys()];
      const links = [];
      for (let i = 0; links.length < linkCap(c.length); i += 1) { links.push({ a: all[i], b: all[i + 1], rel: RELATION_IDS[i % RELATION_IDS.length] }); }
      expect(chainProgress(c, links).found).toBeLessThan(c.length);
    }
  });
});
