import { describe, expect, it } from 'vitest';
import { diskPlan } from '../../src/forensics/files.js';
import {
  FORENSICS_MAX_POINTS, TRACKS, TRACK_IDS, answerOf, artefactData, normalizeAnswer, suspectsFor,
} from '../../src/forensics/tracks.js';
import {
  SECRET, allLog, allPackets, ctxFor, decodeStego, readDeleted, solveExif, solveHex, solveLog, solvePackets,
} from './helpers.js';
import { buildScenario, trackSeed } from '../../src/forensics/core.js';

const TEAMS = ['team-a', 'team-b', 'team-c'];
const json = (value) => JSON.stringify(value);

describe('determinism and per-team variation', () => {
  it('gives the same artefacts for the same team and track, on every call', () => {
    for (const id of TRACK_IDS) {
      const a = ctxFor(id);
      const b = ctxFor(id);
      for (const artefact of a.track.artefacts) {
        const query = { offset: 120, limit: 40, image: 1 };
        expect(json(artefactData(a, artefact.id, query))).toBe(json(artefactData(b, artefact.id, query)));
      }
      a.track.stages.forEach((stage) => expect(answerOf(a, stage.n)).toBe(answerOf(b, stage.n)));
    }
  });

  it('gives different teams, tracks and secrets different data and answers', () => {
    const answers = (ctx) => ctx.track.stages.slice(0, 4).map((s) => answerOf(ctx, s.n)).join('|');
    const seen = new Set(TEAMS.map((team) => answers(ctxFor('hard', team))));
    expect(seen.size).toBe(TEAMS.length);
    expect(trackSeed(SECRET, 'team-a', 'easy')).not.toBe(trackSeed(SECRET, 'team-a', 'hard'));
    expect(trackSeed(SECRET, 'team-a', 'easy')).not.toBe(trackSeed('g'.repeat(40), 'team-a', 'easy'));
    expect(json(artefactData(ctxFor('easy', 'team-a'), 'log', { offset: 0, limit: 50 })))
      .not.toBe(json(artefactData(ctxFor('easy', 'team-b'), 'log', { offset: 0, limit: 50 })));
  });

  it('is independent of the page size and of the page order', () => {
    const ctx = ctxFor('easy');
    const whole = artefactData(ctx, 'log', { offset: 0, limit: 500 }).lines;
    const second = artefactData(ctx, 'log', { offset: 250, limit: 100 }).lines;
    expect(second).toEqual(whole.slice(250, 350));
    const packets = artefactData(ctxFor('medium'), 'capture', { offset: 0, limit: 250 }).packets;
    expect(artefactData(ctxFor('medium'), 'capture', { offset: 100, limit: 20 }).packets).toEqual(packets.slice(100, 120));
  });
});

describe('every stage can be solved from the artefacts alone', () => {
  it.each(TEAMS)('easy (log detective) for %s', (team) => {
    const ctx = ctxFor('easy', team);
    const s = solveLog(ctx);
    expect([s.ip, s.user, s.time, s.exfil]).toEqual([1, 2, 3, 4].map((n) => answerOf(ctx, n)));
    expect(allLog(ctx)).toHaveLength(1500);
  });

  it.each(TEAMS)('medium (packet hunt) for %s', (team) => {
    const ctx = ctxFor('medium', team);
    const s = solvePackets(ctx);
    expect([s.host, s.domain, String(s.interval), s.codename]).toEqual([1, 2, 3, 4].map((n) => answerOf(ctx, n)));
    expect(allPackets(ctx)).toHaveLength(2400);
  });

  it.each(TEAMS)('hard (artefact lab) for %s', (team) => {
    const ctx = ctxFor('hard', team);
    const keys = decodeStego(artefactData(ctx, 'stego', { image: 1 }));
    expect(keys).toHaveLength(1);
    expect(keys[0].slice(4)).toBe(answerOf(ctx, 3));
    expect([solveHex(ctx), solveExif(ctx), readDeleted(ctx, () => true).token]).toEqual([answerOf(ctx, 1), answerOf(ctx, 2), answerOf(ctx, 4)]);
  });

  it.each(TEAMS)('insane (the long night) needs logs, then packets, then disk, then the right picture, for %s', (team) => {
    const ctx = ctxFor('insane', team);
    const log = solveLog(ctx);
    expect(log.backdoor).toBe(answerOf(ctx, 1));
    // Several servers beacon; only the one the log named as the attacker counts.
    const packets = solvePackets(ctx, log.ip);
    expect(new Set(packets.intervals).size).toBeGreaterThan(1);
    expect(String(packets.interval)).toBe(answerOf(ctx, 2));
    // The deleted file named in the tasking is the right one, not the newest.
    const note = readDeleted(ctx, (e) => e.name === `_${packets.task.slice(1)}`);
    expect(note.token).toBe(answerOf(ctx, 3));
    // Only the picture the note points to holds a KEY.
    const images = [1, 2, 3, 4].map((image) => decodeStego(artefactData(ctx, 'stego', { image }))[0]);
    expect(images.filter((m) => m.startsWith('KEY='))).toHaveLength(1);
    expect(images[Number(note.img) - 1].slice(4)).toBe(answerOf(ctx, 4));
  });

  it('has decoys on the insane track that the simple heuristics fall for', () => {
    const ctx = ctxFor('insane');
    const lines = allLog(ctx);
    expect(lines.filter((l) => l.includes(ctx.scn.decoyIp2) && l.includes('Failed password')).length).toBeGreaterThan(10);
    expect(lines.some((l) => l.includes(`Accepted password for ${ctx.scn.vpnUser} from ${ctx.scn.decoyIp}`))).toBe(true);
    const deleted = artefactData(ctx, 'disk', {}).entries.filter((e) => e.deleted);
    expect(deleted.length).toBeGreaterThanOrEqual(9);
  });

  it('keeps the deleted answer unique across many teams', () => {
    for (let i = 0; i < 60; i += 1) {
      const ctx = ctxFor('insane', `t${i}`);
      const plan = diskPlan(ctx.seed, ctx.scn, 'insane');
      expect(plan.entries.filter((e) => e.name === plan.goodName)).toHaveLength(1);
      const hard = ctxFor('hard', `t${i}`);
      const names = diskPlan(hard.seed, hard.scn, 'hard').entries.filter((e) => e.deleted).sort((a, b) => b.mtime.localeCompare(a.mtime));
      expect(names[0].mtime).not.toBe(names[1].mtime);
    }
  });
});

describe('the whodunit', () => {
  it.each(TRACK_IDS)('%s has exactly one suspect matching every clue and strict subsets for the rest', (id) => {
    const ctx = ctxFor(id, 'team-z');
    const { suspects, culprit } = suspectsFor(ctx);
    const truth = ctx.track.clues.map(([, n]) => answerOf(ctx, n));
    const score = (s) => s.facts.filter((f, k) => f.value === truth[k]).length;
    expect(suspects).toHaveLength(8);
    expect(suspects.filter((s) => score(s) === truth.length)).toEqual([culprit]);
    expect(Math.max(...suspects.filter((s) => s !== culprit).map(score))).toBeGreaterThanOrEqual(2);
    expect(new Set(suspects.map((s) => s.name)).size).toBe(8);
    expect(answerOf(ctx, 5)).toBe(culprit.name);
  });
});

describe('points and limits', () => {
  it('documents increasing difficulty and a fixed maximum per track', () => {
    const max = Object.fromEntries(TRACK_IDS.map((id) => [id, TRACKS[id].maxPoints]));
    expect(max).toEqual({ easy: 160, medium: 350, hard: 600, insane: 1200 });
    expect(FORENSICS_MAX_POINTS).toBe(2310);
    for (const id of TRACK_IDS) { expect(TRACKS[id].stages).toHaveLength(5); }
    expect(TRACKS.easy.stages.every((s) => s.hint)).toBe(false);
    expect(TRACKS.insane.stages.some((s) => s.hint)).toBe(false);
    expect(TRACKS.hard.stages.some((s) => s.hint)).toBe(false);
    expect(TRACKS.easy.stages.slice(0, 4).every((s) => s.hint)).toBe(true);
  });

  it('normalises answers the same way for both sides', () => {
    expect(normalizeAnswer('time', ' at 2:13:07 ')).toBe('02:13:07');
    expect(normalizeAnswer('int', '45 seconds')).toBe('45');
    expect(normalizeAnswer('ip', '  "203.0.113.9" ')).toBe('203.0.113.9');
    expect(normalizeAnswer('name', 'Maya   OKAFOR')).toBe('maya okafor');
  });

  it('builds the scenario from the seed only', () => {
    const seed = trackSeed(SECRET, 'x', 'easy');
    expect(buildScenario(seed)).toEqual(buildScenario(seed));
  });
});

describe('response size and generation cost', () => {
  it('keeps every page small', () => {
    const log = json(artefactData(ctxFor('insane'), 'log', { offset: 4000, limit: 9999 }));
    expect(artefactData(ctxFor('insane'), 'log', { offset: 4000, limit: 9999 }).lines).toHaveLength(500);
    expect(log.length).toBeLessThan(110_000);
    const packets = artefactData(ctxFor('insane'), 'capture', { offset: 0, limit: 9999 });
    expect(packets.packets).toHaveLength(250);
    expect(json(packets).length).toBeLessThan(110_000);
    expect(json(artefactData(ctxFor('insane'), 'stego', { image: 2 })).length).toBeLessThan(8000);
    expect(json(artefactData(ctxFor('insane'), 'disk', {})).length).toBeLessThan(8000);
    expect(json(artefactData(ctxFor('hard'), 'hexfile', { offset: 0, limit: 9999 })).length).toBeLessThan(4000);
    expect(artefactData(ctxFor('insane'), 'disk', { cluster: 250, count: 99 }).clusters.length).toBeLessThanOrEqual(6);
  });

  it('generates a full page in well under a second', () => {
    const started = performance.now();
    artefactData(ctxFor('insane'), 'log', { offset: 2000, limit: 500 });
    artefactData(ctxFor('insane'), 'capture', { offset: 2000, limit: 250 });
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('returns null for artefacts a track does not have', () => {
    expect(artefactData(ctxFor('easy'), 'capture', { offset: 0, limit: 5 })).toBeNull();
    expect(artefactData(ctxFor('hard'), 'log', { offset: 0, limit: 5 })).toBeNull();
    expect(artefactData(ctxFor('insane'), 'hexfile', { offset: 0, limit: 5 })).toBeNull();
  });
});
