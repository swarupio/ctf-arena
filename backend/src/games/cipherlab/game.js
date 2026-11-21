// Puzzle assembly and answer checking for Cipher Lab. Pure: no database, no state between calls.
import { createHash, timingSafeEqual } from 'node:crypto';
import { expectedFlagFor } from '../../services/flagService.js';
import { LEVELS, normalizeAnswer } from './levels.js';
import { Rng } from './rng.js';

export const ADMIN_PREVIEW_TEAM = 'admin-preview';
export const slugOf = (level) => `cipherlab-${level.id}`;

const digest = (value) => createHash('sha256').update(value).digest();

export function buildPuzzle(level, { secret, teamId }) {
  return level.build(new Rng(secret, String(teamId), level.id));
}

export const hintTexts = (level, built) => level.hints.map((hint) => (typeof hint === 'function' ? hint(built) : hint));

// Compares fixed-length digests, so neither the length nor the content of the answer leaks through timing.
export function answerMatches(built, submitted) {
  return timingSafeEqual(digest(normalizeAnswer(built.answer)), digest(normalizeAnswer(submitted)));
}

// Everything the browser may see about a puzzle. The answer is not part of it.
export const publicPuzzle = (built) => ({ ciphertext: built.ciphertext, params: built.params });

export const flagFor = (challenge, { secret, teamId }) => expectedFlagFor(challenge, { secret, teamId });

// Pairs each level with its Challenge row. Levels without a visible row are switched off (not seeded or hidden).
export const levelsForDocs = (docs) => {
  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  return LEVELS.filter((level) => bySlug.has(slugOf(level))).map((level) => ({ level, doc: bySlug.get(slugOf(level)) }));
};
