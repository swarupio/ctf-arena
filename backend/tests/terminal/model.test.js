import { describe, expect, it } from 'vitest';
import Challenge from '../../src/models/Challenge.js';
import {
  expectedFlagFor, hashStaticFlag, matchDynamicFlag, verifyFlag,
} from '../../src/services/flagService.js';

const base = {
  slug: 'terminal-easy-1', title: 'Terminal Easy #1', category: 'terminal', difficulty: 'easy', points: 40, type: 'terminal',
  terminal: { mode: 'easy', code: 1 },
};
const errorsOf = (fields) => Object.keys(new Challenge({ ...base, ...fields }).validateSync()?.errors ?? {});

describe('Challenge model: terminal type', () => {
  it('accepts type and category terminal with a terminal sub-document without an _id', () => {
    const challenge = new Challenge(base);
    expect(challenge.validateSync()).toBeUndefined();
    expect(challenge.toObject().terminal).toEqual({ mode: 'easy', code: 1 });
    expect(challenge.visible).toBe(true);
    expect(challenge.solveCount).toBe(0);
  });

  it('requires the terminal sub-document for terminal challenges only', () => {
    expect(errorsOf({ terminal: undefined })).toContain('terminal');
    const { terminal, ...rest } = base;
    const staticChallenge = new Challenge({ ...rest, category: 'misc', type: 'static' });
    expect(staticChallenge.validateSync()).toBeUndefined();
    expect(staticChallenge.terminal).toBeUndefined();
  });

  it('validates mode and code', () => {
    expect(errorsOf({ terminal: { mode: 'nightmare', code: 1 } })).toContain('terminal.mode');
    expect(errorsOf({ terminal: { mode: 'easy', code: 0 } })).toContain('terminal.code');
    expect(errorsOf({ terminal: { mode: 'easy' } })).toContain('terminal.code');
    for (const mode of ['easy', 'medium', 'hard']) {
      expect(errorsOf({ terminal: { mode, code: 6 } })).toEqual([]);
    }
  });

  it('still rejects unknown types and categories', () => {
    expect(errorsOf({ type: 'ssh' })).toContain('type');
    expect(errorsOf({ category: 'nope' })).toContain('category');
    expect(errorsOf({ type: 'docker', category: 'web', terminal: undefined })).toEqual([]);
  });

  it('indexes type and terminal.mode', () => {
    const indexes = Challenge.schema.indexes().map(([fields]) => fields);
    expect(indexes).toContainEqual({ type: 1, 'terminal.mode': 1 });
    expect(indexes).toContainEqual({ slug: 1 });
  });
});

describe('flagService: terminal flags', () => {
  const secret = 'x'.repeat(40);
  const challenge = (n) => ({ _id: `c${n}`, slug: `terminal-easy-${n}`, type: 'terminal' });
  const flag = (n, teamId) => expectedFlagFor(challenge(n), { secret, teamId });

  it('verifyFlag treats terminal like docker: dynamic, per team, nothing stored', () => {
    expect(flag(1, 'team-a')).toMatch(/^CTF\{terminal_easy_1_[0-9a-f]{12}\}$/);
    expect(verifyFlag(challenge(1), { secret, teamId: 'team-a', submitted: ` ${flag(1, 'team-a')} ` })).toBe(true);
    expect(verifyFlag(challenge(1), { secret, teamId: 'team-a', submitted: flag(1, 'team-b') })).toBe(false);
    expect(verifyFlag(challenge(1), { secret, teamId: 'team-a', submitted: flag(2, 'team-a') })).toBe(false);
    // Even a stray static hash on a terminal row is never consulted.
    const stored = hashStaticFlag('CTF{static}');
    expect(verifyFlag({ ...challenge(1), ...stored }, { secret, teamId: 'team-a', submitted: 'CTF{static}' })).toBe(false);
  });

  it('matchDynamicFlag returns the challenge whose flag was submitted, or null', () => {
    const list = [1, 2, 3].map(challenge);
    expect(matchDynamicFlag(list, { secret, teamId: 'team-a', submitted: flag(2, 'team-a') })).toBe(list[1]);
    expect(matchDynamicFlag(list, { secret, teamId: 'team-a', submitted: `\n${flag(3, 'team-a')}  ` })).toBe(list[2]);
    expect(matchDynamicFlag(list, { secret, teamId: 'team-a', submitted: flag(2, 'team-b') })).toBeNull();
    expect(matchDynamicFlag(list, { secret, teamId: 'team-a', submitted: flag(4, 'team-a') })).toBeNull();
    expect(matchDynamicFlag(list, { secret, teamId: 'team-a', submitted: '' })).toBeNull();
    expect(matchDynamicFlag([], { secret, teamId: 'team-a', submitted: flag(1, 'team-a') })).toBeNull();
  });

  it('matchDynamicFlag compares every candidate, so timing does not show which one matched', () => {
    const reads = [];
    const spy = (n) => ({ _id: `c${n}`, type: 'terminal', get slug() { reads.push(n); return `terminal-easy-${n}`; } });
    const list = [spy(1), spy(2), spy(3)];
    expect(matchDynamicFlag(list, { secret, teamId: 'team-a', submitted: flag(1, 'team-a') })).toBe(list[0]);
    expect(reads).toEqual([1, 2, 3]);
  });

  it('matchDynamicFlag accepts an ObjectId-like team id the same way as its string', () => {
    const teamId = { toString: () => 'team-a' };
    expect(matchDynamicFlag([challenge(1)], { secret, teamId, submitted: flag(1, 'team-a') })).toEqual(challenge(1));
  });
});
