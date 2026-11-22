import { describe, expect, it } from 'vitest';
import { artefactData } from '../../src/forensics/tracks.js';
import { findContradictions, logPin, packetPin } from '../../../frontend/src/forensics/timeline.js';
import { allLog, allPackets, ctxFor } from './helpers.js';

const TEAMS = Array.from({ length: 12 }, (_, i) => `team-${i}`);
const pinsOf = (all, wanted, make, every) => all.map((item, i) => [i, item])
  .filter(([i]) => wanted.has(i) || i % every === 0).map(([i, item]) => make(item, i));

describe('timeline board: generated evidence', () => {
  it('log: only the planted session-overlap pair is a contradiction, on every seed and log track', () => {
    for (const track of ['easy', 'insane']) {
      for (const team of TEAMS) {
        const ctx = ctxFor(track, team);
        const plan = ctx.log();
        const lines = allLog(ctx);
        const pins = pinsOf(lines, new Set(plan.events.keys()), (text, i) => logPin({ n: i + 1, text }), 25);
        const { skewed, consistent } = plan.sessions;
        expect(pins.some((p) => p.n === consistent.login + 1)).toBe(true);
        const found = findContradictions(pins);
        expect(found.map((f) => [f.rule, f.a, f.b]), `${track} ${team}`).toEqual([
          ['login-before-session', `log:${skewed.login + 1}`, `log:${skewed.open + 1}`],
        ]);
        expect(found[0].message).toContain(skewed.user);
      }
    }
  });

  it('log: the planted lines are on one clock and hold no answer', () => {
    const ctx = ctxFor('easy', 'team-a');
    const { sessions } = ctx.log();
    const lines = allLog(ctx);
    const text = [sessions.skewed, sessions.consistent].flatMap((s) => [s.open, s.login, s.close].map((i) => lines[i])).join('\n');
    for (const secret of [ctx.scn.attackerIp, ctx.scn.victim, ctx.scn.backdoor, ctx.scn.exfilFile]) { expect(text).not.toContain(secret); }
    expect(sessions.skewed.login).toBeLessThan(sessions.skewed.open);
    expect(sessions.consistent.open).toBeLessThan(sessions.consistent.login);
    expect(sessions.consistent.login).toBeLessThan(sessions.consistent.close);
  });

  it('capture: only the planted reply-before-request pair is a contradiction, on every seed and capture track', () => {
    for (const track of ['medium', 'insane']) {
      for (const team of TEAMS) {
        const ctx = ctxFor(track, team);
        const plan = ctx.packet();
        const packets = allPackets(ctx);
        const pins = pinsOf(packets, new Set(plan.slots.keys()), (p) => packetPin(p), 20);
        const { skewed, consistent } = plan.skew;
        expect(pins.some((p) => p.n === consistent.reply + 1)).toBe(true);
        const found = findContradictions(pins);
        expect(found.map((f) => [f.rule, f.a, f.b]), `${track} ${team}`).toEqual([
          ['reply-before-request', `packet:${skewed.request + 1}`, `packet:${skewed.reply + 1}`],
        ]);
      }
    }
  });

  it('capture: the clue does not touch the beacon rhythm or the exfil stream', () => {
    for (const track of ['medium', 'insane']) {
      const ctx = ctxFor(track, 'team-a');
      const packets = allPackets(ctx);
      const times = packets.filter((p) => p.info === 'POST /beacon HTTP/1.1' && p.dst === ctx.scn.attackerIp).map((p) => Number(p.t));
      expect(times.length).toBeGreaterThan(5);
      for (let i = 1; i < times.length; i += 1) { expect(Math.round(times[i] - times[i - 1])).toBe(ctx.scn.interval); }
      const stream = packets.filter((p) => p.dp === 9001 && p.hex).map((p) => Buffer.from(p.hex, 'hex').toString('latin1')).join('');
      expect(Buffer.from(stream, 'base64').toString()).toContain(ctx.scn.codename.toUpperCase());
    }
  });

  it('uses no hidden data: the checker only sees what the artefact pages return', () => {
    const ctx = ctxFor('easy', 'team-a');
    const page = artefactData(ctx, 'log', { offset: 0, limit: 5 });
    expect(Object.keys(page).sort()).toEqual(['lines', 'offset', 'total']);
  });
});
