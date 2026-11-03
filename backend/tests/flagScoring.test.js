import { beforeEach, describe, expect, it, vi } from 'vitest';
import Challenge from '../src/models/Challenge.js';
import Solve from '../src/models/Solve.js';
import {
  dynamicFlag, hashStaticFlag, hashSubmission, verifyFlag,
} from '../src/services/flagService.js';
import { awardFor, firstBloodBonus, recordSolve } from '../src/services/scoringService.js';

vi.mock('../src/models/Challenge.js', () => ({ default: { findOneAndUpdate: vi.fn() } }));
vi.mock('../src/models/Solve.js', () => ({
  default: { create: vi.fn(), updateOne: vi.fn(), aggregate: vi.fn() },
}));

const secret = 'x'.repeat(40);

describe('flagService', () => {
  const docker = { _id: 'c1', slug: 'cookie-monster', type: 'docker' };

  it('gives two teams different flags for the same docker challenge', () => {
    const a = dynamicFlag({ secret, slug: docker.slug, teamId: 'team-a', challengeId: 'c1' });
    const b = dynamicFlag({ secret, slug: docker.slug, teamId: 'team-b', challengeId: 'c1' });
    expect(a).toMatch(/^CTF\{cookie_monster_[0-9a-f]{12}\}$/);
    expect(a).not.toBe(b);
    expect(dynamicFlag({ secret, slug: docker.slug, teamId: 'team-a', challengeId: 'c1' })).toBe(a);
  });

  it('accepts only the submitting team\'s own docker flag', () => {
    const own = dynamicFlag({ secret, slug: docker.slug, teamId: 'team-a', challengeId: 'c1' });
    const other = dynamicFlag({ secret, slug: docker.slug, teamId: 'team-b', challengeId: 'c1' });
    expect(verifyFlag(docker, { secret, teamId: 'team-a', submitted: ` ${own} ` })).toBe(true);
    expect(verifyFlag(docker, { secret, teamId: 'team-a', submitted: other })).toBe(false);
    expect(verifyFlag(docker, { secret, teamId: 'team-a', submitted: 'CTF{guess}' })).toBe(false);
  });

  it('verifies static flags against a salted hash and never stores the flag', () => {
    const stored = hashStaticFlag('CTF{welcome_to_the_arena}');
    expect(JSON.stringify(stored)).not.toContain('welcome');
    const challenge = { type: 'static', ...stored };
    expect(verifyFlag(challenge, { secret, teamId: 't', submitted: 'CTF{welcome_to_the_arena}' })).toBe(true);
    expect(verifyFlag(challenge, { secret, teamId: 't', submitted: 'CTF{welcome_to_the_arena!}' })).toBe(false);
    expect(verifyFlag({ type: 'static' }, { secret, teamId: 't', submitted: 'x' })).toBe(false);
  });

  it('salts differ per challenge and the stored submission hash hides the raw flag', () => {
    expect(hashStaticFlag('a').flagSalt).not.toBe(hashStaticFlag('a').flagSalt);
    expect(hashSubmission('CTF{x}')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSubmission('CTF{x}')).not.toContain('CTF');
  });
});

describe('scoringService', () => {
  beforeEach(() => vi.resetAllMocks());
  const challenge = { _id: 'c1', points: 100 };

  it('adds a 10% bonus only for first blood', () => {
    expect(firstBloodBonus(100)).toBe(10);
    expect(firstBloodBonus(25)).toBe(2);
    expect(awardFor(100, true)).toBe(110);
    expect(awardFor(100, false)).toBe(100);
  });

  it('awards first blood to the first solver and updates their score', async () => {
    Solve.create.mockResolvedValue({});
    Challenge.findOneAndUpdate.mockResolvedValue({ solveCount: 1 });
    Solve.aggregate.mockResolvedValue([{ score: 110 }]);
    const result = await recordSolve({ challenge, teamId: 't1', userId: 'u1' });
    expect(result).toEqual({ points: 110, firstBlood: true, score: 110 });
    expect(Solve.updateOne).toHaveBeenCalledWith(
      { teamId: 't1', challengeId: 'c1' }, { $set: { points: 110, firstBlood: true } },
    );
    expect(Challenge.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'c1' }, { $inc: { solveCount: 1 } }, { new: true });
  });

  it('awards plain points to a later solver', async () => {
    Solve.create.mockResolvedValue({});
    Challenge.findOneAndUpdate.mockResolvedValue({ solveCount: 2 });
    Solve.aggregate.mockResolvedValue([{ score: 100 }]);
    expect(await recordSolve({ challenge, teamId: 't2', userId: 'u2' })).toEqual({ points: 100, firstBlood: false, score: 100 });
    expect(Solve.updateOne).not.toHaveBeenCalled();
  });

  it('returns null for a duplicate solve without touching the counter', async () => {
    Solve.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    expect(await recordSolve({ challenge, teamId: 't1', userId: 'u1' })).toBeNull();
    expect(Challenge.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
