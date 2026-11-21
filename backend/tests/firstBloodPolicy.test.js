import { describe, expect, it } from 'vitest';
import { hasFirstBloodBonus } from '../src/services/scoringService.js';

describe('first-blood policy', () => {
  it('pays the bonus only for classic static and docker challenges', () => {
    expect(hasFirstBloodBonus({ type: 'static' })).toBe(true);
    expect(hasFirstBloodBonus({ type: 'docker' })).toBe(true);
  });

  it('never pays it for terminal, game or any other (future) type, so documented maximums hold', () => {
    for (const type of ['terminal', 'game', 'weblab', 'forensics', 'unknown', undefined]) {
      expect(hasFirstBloodBonus({ type })).toBe(false);
    }
    expect(hasFirstBloodBonus(null)).toBe(false);
  });
});
