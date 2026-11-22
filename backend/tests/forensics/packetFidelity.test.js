import { describe, expect, it } from 'vitest';
import { macFor } from '../../src/forensics/packets.js';
import { allPackets, ctxFor } from './helpers.js';

const MAC = /^02(?::[0-9a-f]{2}){5}$/;
const TEAMS = ['team-a', 'team-b', 'team-c', 'team-d'];

describe('packet capture fidelity (conversations and hardware addresses)', () => {
  it('derives the same locally administered MAC for the same address, a different one for another', () => {
    expect(macFor('10.0.1.21')).toMatch(MAC);
    expect(macFor('10.0.1.21')).toBe(macFor('10.0.1.21'));
    expect(macFor('10.0.1.21')).not.toBe(macFor('10.0.1.22'));
    expect(macFor('185.1.2.3')).toMatch(MAC);
  });

  it('gives every packet sm and dm, one MAC per address across the whole capture', () => {
    for (const track of ['medium', 'insane']) {
      const packets = allPackets(ctxFor(track));
      const seen = new Map();
      for (const p of packets) {
        expect(p.sm).toMatch(MAC);
        expect(p.dm).toMatch(MAC);
        for (const [ip, mac] of [[p.src, p.sm], [p.dst, p.dm]]) {
          expect(mac).toBe(macFor(ip));
          if (seen.has(ip)) { expect(seen.get(ip)).toBe(mac); } else { seen.set(ip, mac); }
        }
      }
    }
  });

  it('sends the DNS reply back to the port of the query, so both are one conversation', () => {
    for (const track of ['medium', 'insane']) {
      for (const team of TEAMS) {
        const ctx = ctxFor(track, team);
        const packets = allPackets(ctx);
        const query = packets.find((p) => p.info === `Standard query 0x1a2b A ${ctx.scn.c2Domain}`);
        const reply = packets.find((p) => p.info.startsWith(`Standard query response 0x1a2b A ${ctx.scn.c2Domain} `));
        expect(query.n).toBeLessThan(reply.n);
        expect([reply.src, reply.sp, reply.dst, reply.dp]).toEqual([query.dst, query.dp, query.src, query.sp]);
        expect(reply.dp).toBeGreaterThanOrEqual(40000);
        expect(reply.dp).toBeLessThanOrEqual(60000);
        expect(reply.hex.slice(0, 4)).toBe(query.hex.slice(0, 4));
      }
    }
  });

  it('leaves the clock-skew clue in place: the skewed reply is stamped before its request, in capture order after it', () => {
    const ctx = ctxFor('medium');
    const packets = allPackets(ctx);
    const { skew } = ctx.packet();
    const request = packets[skew.skewed.request];
    const reply = packets[skew.skewed.reply];
    expect(request.n).toBeLessThan(reply.n);
    expect(Number(reply.t)).toBeLessThan(Number(request.t));
    const fine = packets[skew.consistent.request];
    expect(Number(packets[skew.consistent.reply].t)).toBeGreaterThan(Number(fine.t));
  });
});
