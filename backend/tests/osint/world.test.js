import { describe, expect, it } from 'vitest';
import {
  OSINT_MAX_POINTS, TRACKS, TRACK_IDS, answerMatches, buildCase, normalizeAnswer,
} from '../../src/osint/cases.js';
import { SOURCES, listSource, searchCorpus } from '../../src/osint/sources.js';
import { hasFirstBloodBonus } from '../../src/services/scoringService.js';
import { SECRET, SOLVERS, allOf, caseFor } from './solvers.js';

const TEAMS = ['team-a', 'team-b', 'team-c', 'team-d', 'team-e', 'team-f'];

describe('determinism and per-team variation', () => {
  it('builds the same world and answers for the same secret, team and case', () => {
    for (const id of TRACK_IDS) {
      const a = caseFor(id);
      const b = caseFor(id);
      expect(JSON.stringify(b.world)).toBe(JSON.stringify(a.world));
      expect(b.ans).toEqual(a.ans);
      expect(b.pub).toEqual(a.pub);
    }
  });

  it('gives each team its own world and each secret its own answers', () => {
    for (const id of TRACK_IDS) {
      const answers = new Set(TEAMS.map((team) => JSON.stringify(caseFor(id, team).ans)));
      expect(answers.size).toBe(TEAMS.length);
      expect(JSON.stringify(buildCase('0'.repeat(40), 'team-a', id).ans)).not.toBe(JSON.stringify(caseFor(id).ans));
    }
  });

  it('keeps the cast between 10 and 14 characters and the corpus bounded', () => {
    for (const id of TRACK_IDS) {
      const { world } = caseFor(id);
      expect(world.cast.length).toBeGreaterThanOrEqual(10);
      expect(world.cast.length).toBeLessThanOrEqual(14);
      expect(world.posts.length).toBeLessThan(200);
      expect(world.photos.length).toBeLessThan(40);
    }
  });
});

describe('points', () => {
  it('documents fixed maximums and never grants a first-blood bonus', () => {
    expect(TRACK_IDS.map((id) => TRACKS[id].maxPoints)).toEqual([150, 300, 650, 1200]);
    expect(OSINT_MAX_POINTS).toBe(2300);
    expect(hasFirstBloodBonus({ type: 'osint' })).toBe(false);
    for (const id of TRACK_IDS) {
      const stages = TRACKS[id].stages;
      expect(stages.filter((s) => s.final)).toHaveLength(1);
      expect(stages.at(-1).final).toBe(true);
      expect(stages.length - 1).toBeGreaterThanOrEqual(4);
      expect(stages.length - 1).toBeLessThanOrEqual(5);
    }
  });

  it('only gives hints to easy and medium', () => {
    expect(TRACKS.easy.hintsAllowed && TRACKS.medium.hintsAllowed).toBe(true);
    expect(TRACKS.hard.hintsAllowed || TRACKS.insane.hintsAllowed).toBe(false);
    for (const id of ['hard', 'insane']) { expect(TRACKS[id].stages.every((s) => s.hints.length === 0)).toBe(true); }
    for (const id of ['easy', 'medium']) { expect(TRACKS[id].stages.filter((s) => !s.final).every((s) => s.hints.length > 0)).toBe(true); }
  });
});

describe('every question is answerable from the served corpus only', () => {
  for (const id of TRACK_IDS) {
    it(`${id}: an independent solver finds every answer, for several teams`, () => {
      for (const team of TEAMS) {
        const { world, pub, ans } = caseFor(id, team);
        const found = SOLVERS[id](world, pub);
        for (const stage of TRACKS[id].stages) {
          expect(String(found[stage.n]), `${id} ${team} question ${stage.n}`).toBe(String(ans[stage.n]));
          expect(answerMatches(stage.kind, found[stage.n], ans[stage.n])).toBe(true);
        }
      }
    });
  }
});

describe('solvability sweep', () => {
  it('keeps every answer unique and findable across many teams (decoys never collide)', () => {
    for (const id of TRACK_IDS) {
      for (let i = 0; i < 60; i += 1) {
        const { world, pub, ans } = caseFor(id, `sweep-${i}`);
        const found = SOLVERS[id](world, pub);
        for (const stage of TRACKS[id].stages) { expect(String(found[stage.n]), `${id} sweep-${i} q${stage.n}`).toBe(String(ans[stage.n])); }
      }
    }
  });

  it('never shows a real name for an alias account and hides unsolved facts from the story', () => {
    const { world, pub } = caseFor('insane');
    const aliases = world.cast.filter((c) => c.alias);
    expect(aliases).toHaveLength(2);
    const served = JSON.stringify(allOf(world, 'cast'));
    for (const c of world.cast.filter((x) => !x.alias)) { expect(served).not.toContain(c.name); }
    expect(JSON.stringify(TRACKS.insane.story(pub))).not.toMatch(/Night Jar|nightjar_74/);
  });
});

describe('fictional data guard', () => {
  const FILE_EXT = new Set(['jpg', 'png', 'pdf', 'txt', 'csv', 'doc', 'docx', 'xls', 'md', 'zip', 'log']);
  const ALLOWED_TLD = new Set(['example', 'invalid', 'test']);
  const HOST = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\b/gi;
  const IP = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
  const everything = (id, team) => {
    const { world, pub } = caseFor(id, team);
    const parts = SOURCES.map((s) => JSON.stringify(allOf(world, s.id)));
    parts.push(JSON.stringify(pub), JSON.stringify(TRACKS[id].stages.map((s) => s.prompt(pub))), JSON.stringify(TRACKS[id].story(pub)));
    // Document author fields are user names (first.last), not host names.
    // E-mail local parts (first.last) are not host names either; their domains are still checked.
    return parts.join('\n').replace(/"(author|lastModifiedBy)":"[a-z.]+"/g, '').replace(/[a-z0-9._-]+@/gi, '@');
  };

  it('uses only .example, .invalid and .test hostnames', () => {
    for (const id of TRACK_IDS) {
      for (const team of TEAMS) {
        const text = everything(id, team);
        for (const token of text.match(HOST) ?? []) {
          const tld = token.toLowerCase().split('.').at(-1);
          const numeric = /^\d+$/.test(tld);
          expect(ALLOWED_TLD.has(tld) || FILE_EXT.has(tld) || numeric, `${id}: ${token}`).toBe(true);
        }
      }
    }
  });

  it('uses only reserved documentation IP ranges and 555-01xx phone numbers', () => {
    const allowed = [/^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];
    for (const id of TRACK_IDS) {
      for (const team of TEAMS) {
        const text = everything(id, team);
        // GPS and timestamps are not dotted quads; match full 4-part numbers only.
        for (const ip of text.match(IP) ?? []) { expect(allowed.some((re) => re.test(ip)), `${id}: ${ip}`).toBe(true); }
        for (const phone of text.match(/\b\d{3}-\d{4}\b/g) ?? []) { expect(phone, `${id}: ${phone}`).toMatch(/^555-01\d\d$/); }
      }
    }
  });

  it('writes every e-mail address on a fictional domain', () => {
    for (const id of TRACK_IDS) {
      const text = everything(id, 'team-a');
      for (const m of text.matchAll(/@([a-z0-9.-]+\.[a-z]+)\b/gi)) {
        expect(ALLOWED_TLD.has(m[1].split('.').at(-1)), `${id}: ${m[0]}`).toBe(true);
      }
    }
  });

  it('makes no network lookups and ships no URLs to real sites', () => {
    for (const id of TRACK_IDS) { expect(everything(id, 'team-a')).not.toMatch(/https?:\/\//); }
  });
});

describe('bounded responses', () => {
  it('keeps every page of every source small, and search pages bounded', () => {
    for (const id of TRACK_IDS) {
      const { world } = caseFor(id);
      for (const spec of SOURCES) {
        const page = listSource(world, spec.id, { offset: 0, limit: 50 });
        expect(page.items.length).toBeLessThanOrEqual(spec.max);
        expect(JSON.stringify(page).length, `${id}/${spec.id}`).toBeLessThan(90_000);
      }
      const hits = searchCorpus(world, 'an', { limit: 20 });
      expect(hits.results.length).toBeLessThanOrEqual(20);
      expect(JSON.stringify(hits).length).toBeLessThan(10_000);
      expect(hits.results.every((r) => r.snippet.length <= 196)).toBe(true);
    }
  });

  it('pages stay consistent and search finds fictional text', () => {
    const { world } = caseFor('hard');
    const first = listSource(world, 'feed', { offset: 0, limit: 10 });
    const second = listSource(world, 'feed', { offset: 10, limit: 10 });
    expect(first.items[0].id).not.toBe(second.items[0].id);
    expect(first.total).toBe(world.posts.length);
    const hit = searchCorpus(world, world.meta.company.domain);
    expect(hit.results.length).toBeGreaterThan(0);
    expect(searchCorpus(world, 'zzzzqqqq').results).toEqual([]);
  });
});

describe('answer matching', () => {
  it('normalises names, dates, times, cells, domains and coordinates', () => {
    expect(answerMatches('name', 'DOVIK, maren', 'Maren Dovik')).toBe(true);
    expect(answerMatches('name', 'Dr. Maren  Dovik', 'Maren Dovik')).toBe(true);
    expect(answerMatches('name', 'Maren', 'Maren Dovik')).toBe(false);
    expect(answerMatches('date', '14 March 2031', '2031-03-14')).toBe(true);
    expect(answerMatches('date', 'March 14th, 2031', '2031-03-14')).toBe(true);
    expect(answerMatches('date', '2031/3/14', '2031-03-14')).toBe(true);
    expect(answerMatches('date', '2031-03-15', '2031-03-14')).toBe(false);
    expect(answerMatches('time', '9:05', '09:05')).toBe(true);
    expect(answerMatches('time', '09:05 UTC', '09:05')).toBe(true);
    expect(answerMatches('time', '09:06', '09:05')).toBe(false);
    expect(answerMatches('cell', 'c-4', 'C4')).toBe(true);
    expect(answerMatches('cell', 'C5', 'C4')).toBe(false);
    expect(answerMatches('domain', 'https://www.Kitepine.example/about', 'kitepine.example')).toBe(true);
    expect(answerMatches('landmark', 'the saltgrass pier', 'Saltgrass Pier')).toBe(true);
    expect(answerMatches('email', 'MAILTO:A.B@x.example', 'a.b@x.example')).toBe(true);
  });

  it('accepts coordinates inside the tolerance only', () => {
    expect(answerMatches('point', '500,500', '500,500')).toBe(true);
    expect(answerMatches('point', '(540, 530)', '500,500')).toBe(true);
    expect(answerMatches('point', '500 569', '500,500')).toBe(true);
    expect(answerMatches('point', '500,580', '500,500')).toBe(false);
    expect(answerMatches('point', 'nowhere', '500,500')).toBe(false);
    expect(normalizeAnswer('point', '999999,1', '500,500')).toBe('invalid');
  });

  it('does not accept decoys of the generated cases', () => {
    const { world, ans } = caseFor('insane');
    expect(answerMatches('ip', '203.0.113.1', ans[2])).toBe(false);
    expect(answerMatches('landmark', world.map.landmarks[0].name === ans[4] ? world.map.landmarks[1].name : world.map.landmarks[0].name, ans[4])).toBe(false);
    void SECRET;
  });
});
