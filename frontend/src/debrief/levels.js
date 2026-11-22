// The light half of the debrief data: level lookups only (no debrief text), so play screens can use it without
// pulling the ~90 KB of content into their chunk. entries.js re-exports everything here.
import { flattenCatalogue } from '../skills/coverage.js';
import { SKILL_BY_ID, skillLabel } from '../skills/taxonomy.js';

const LEVELS = new Map(flattenCatalogue().map((level) => [level.key, level]));

/** Level key of a flag whose id is unique inside its category (Cipher Lab, Crackme, Web Exploit Lab). */
export function keyById(category, id) {
  for (const level of LEVELS.values()) {
    if (level.category === category && level.id === id) { return level.key; }
  }
  return null;
}

/** The skills of a level as [{ id, label, code }], in catalogue order; unknown ids are dropped. */
export function skillsOfLevel(key) {
  return (LEVELS.get(key)?.skills ?? [])
    .map((id) => SKILL_BY_ID.get(id))
    .filter(Boolean)
    .map((skill) => ({ id: skill.id, label: skillLabel(skill), code: skill.code }));
}

export const levelTitle = (key) => LEVELS.get(key)?.title ?? '';
export const levelKeys = () => [...LEVELS.keys()];
export const hasLevel = (key) => LEVELS.has(key);
