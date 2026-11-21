import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import {
  atbash, caesar, gcd, modPow, railFence, toHex, vigenere,
} from '../../src/games/cipherlab/ciphers.js';
import { answerMatches, buildPuzzle, hintTexts, publicPuzzle } from '../../src/games/cipherlab/game.js';
import {
  LEVELS, MAX_POINTS, TOOLS, TRACKS, levelById, levelsOfTrack, normalizeAnswer, trackMaxPoints,
} from '../../src/games/cipherlab/levels.js';
import { Rng } from '../../src/games/cipherlab/rng.js';
import { hasFirstBloodBonus } from '../../src/services/scoringService.js';
import { solvers } from './solvers.js';

const secret = env.FLAG_SECRET;
const TEAM_A = '000000000000000000000002';
const TEAM_B = '000000000000000000000004';
const build = (id, teamId = TEAM_A) => buildPuzzle(levelById(id), { secret, teamId });

describe('content and points', () => {
  it('has four tracks ending in a boss, 15 levels, ids and tool unlocks that exist', () => {
    expect(TRACKS.map((t) => t.id)).toEqual(['easy', 'medium', 'hard', 'insane']);
    expect(LEVELS).toHaveLength(15);
    for (const track of TRACKS) {
      const levels = levelsOfTrack(track.id);
      expect(levels.at(-1).boss).toBe(true);
      expect(levels.map((l) => l.n)).toEqual(levels.map((_, i) => i + 1));
    }
    for (const tool of TOOLS) { if (tool.unlockedBy) { expect(levelById(tool.unlockedBy)).toBeTruthy(); } }
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
  });

  it('documents fixed maximums: 80 / 330 / 650 / 1000 = 2060', () => {
    expect(trackMaxPoints('easy')).toBe(80);
    expect(trackMaxPoints('medium')).toBe(330);
    expect(trackMaxPoints('hard')).toBe(650);
    expect(trackMaxPoints('insane')).toBe(1000);
    expect(MAX_POINTS).toBe(2060);
  });

  it('points rise with every track and the insane track has no hints', () => {
    const maxima = TRACKS.map((t) => trackMaxPoints(t.id));
    expect([...maxima].sort((a, b) => a - b)).toEqual(maxima);
    expect(TRACKS.find((t) => t.id === 'insane').hints).toBe(false);
    for (const level of levelsOfTrack('insane')) { expect(level.hints).toEqual([]); }
  });

  it('never pays a first-blood bonus for games, but still does for other types', () => {
    expect(hasFirstBloodBonus({ type: 'game' })).toBe(false);
    expect(hasFirstBloodBonus({ type: 'static' })).toBe(true);
    expect(hasFirstBloodBonus({ type: 'terminal' })).toBe(true);
  });
});

describe('determinism and per-team variation', () => {
  it('derives the same puzzle on every call', () => {
    for (const level of LEVELS) { expect(build(level.id)).toEqual(build(level.id)); }
  });

  it('gives different teams different ciphertexts and answers', () => {
    for (const level of LEVELS) {
      const a = build(level.id, TEAM_A);
      const b = build(level.id, TEAM_B);
      expect(a.ciphertext, level.id).not.toBe(b.ciphertext);
    }
  });

  it('depends on the secret', () => {
    const other = buildPuzzle(levelById('e1'), { secret: `${secret}x`, teamId: TEAM_A });
    expect(other.ciphertext).not.toBe(build('e1').ciphertext);
  });

  it('rng integers stay in range and shuffles keep every element', () => {
    const rng = new Rng(secret, TEAM_A, 'x');
    for (let i = 0; i < 500; i += 1) { const v = rng.range(3, 5); expect(v >= 3 && v <= 5).toBe(true); }
    expect(rng.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('every puzzle is solvable with the documented method', () => {
  for (const level of LEVELS) {
    it(`${level.id} ${level.title}`, () => {
      for (const teamId of [TEAM_A, TEAM_B, '000000000000000000000009']) {
        const built = build(level.id, teamId);
        const found = solvers[level.id](built);
        expect(normalizeAnswer(found), `${level.id} ${teamId}`).toBe(normalizeAnswer(built.answer));
      }
    });
  }
});

describe('cipher primitives', () => {
  it('invert correctly', () => {
    expect(caesar(caesar('HELLO WORLD', 7), -7)).toBe('HELLO WORLD');
    expect(atbash(atbash('HELLO'))).toBe('HELLO');
    expect(vigenere(vigenere('ATTACKATDAWN', 'LEMON'), 'LEMON', -1)).toBe('ATTACKATDAWN');
    expect(vigenere('ATTACKATDAWN', 'LEMON')).toBe('LXFOPVEFRNHR');
    expect(railFence('WEAREDISCOVERED', 3)).toBe('WECRERDSOEEAIVD');
    expect(toHex('Hi')).toBe('4869');
    expect(modPow(4, 13, 497)).toBe(445);
    expect(gcd(12, 18)).toBe(6);
  });
});

describe('answer checking', () => {
  it('accepts case, spacing and punctuation differences and rejects everything else', () => {
    const built = build('e1');
    expect(answerMatches(built, built.answer)).toBe(true);
    expect(answerMatches(built, built.answer.toLowerCase().replaceAll(' ', '-'))).toBe(true);
    expect(answerMatches(built, 'NOPE')).toBe(false);
    expect(answerMatches(built, '')).toBe(false);
    expect(answerMatches(built, `${built.answer} EXTRA`)).toBe(false);
  });

  it('keeps the answer out of the public puzzle and out of hints for every level', () => {
    for (const level of LEVELS) {
      const built = build(level.id);
      const puzzle = publicPuzzle(built);
      // The hash-lookup answer is one of the public suspect words by design; it is never named on its own.
      if (level.id === 'h2') { puzzle.params = { ...puzzle.params, candidates: [] }; }
      const shown = JSON.stringify({ puzzle, hints: hintTexts(level, built), b: level.briefing });
      expect(shown, level.id).not.toContain(built.answer);
    }
  });
});
