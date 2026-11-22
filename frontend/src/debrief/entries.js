// Debrief content, keyed by the level keys of skills/levelSkills.js ("category:track:level").
// Three files by group; adding an entry is editing one of them (docs/DEBRIEF.md).
import terminalChallengesCipherlab from './content/terminal-challenges-cipherlab.js';
import weblabForensics from './content/weblab-forensics.js';
import crackmeOsint from './content/crackme-osint.js';

export { validateEntry, entryLeaks, LIMITS } from './validate.js';

export const SOURCES = Object.freeze({
  'terminal-challenges-cipherlab': terminalChallengesCipherlab,
  'weblab-forensics': weblabForensics,
  'crackme-osint': crackmeOsint,
});

const ENTRIES = new Map(Object.values(SOURCES).flatMap((source) => Object.entries(source ?? {})));

export const getDebrief = (key) => ENTRIES.get(key) ?? null;
export const hasDebrief = (key) => ENTRIES.has(key);

export { keyById, skillsOfLevel, levelTitle, levelKeys } from './levels.js';
