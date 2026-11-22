// Pure maths for the Skills map: flatten the catalogue, count coverage per skill, filter and group rows.
// Nothing here touches the network or React, so tests run it with plain fixtures.
import { CATALOGUE } from './levelSkills.js';
import { SKILLS, FRAMEWORKS } from './taxonomy.js';

const list = (value) => (Array.isArray(value) ? value : []);

export const levelKey = (category, track, level) => `${category}:${track}:${level}`;

/** One entry per flag: { key, category, categoryTitle, track, trackTitle, id, title, skills }. */
export function flattenCatalogue(catalogue = CATALOGUE) {
  return list(catalogue).flatMap((category) => list(category.tracks).flatMap((track) => list(track.levels).map((level) => ({
    key: levelKey(category.id, track.id, level.id),
    category: category.id,
    categoryTitle: category.title,
    track: track.id,
    trackTitle: track.title,
    id: level.id,
    title: level.title,
    skills: list(level.skills),
  }))));
}

/**
 * The route that opens a flag. Cipher Lab, Crackme and the Web Exploit Lab have one page per level; the other
 * categories open the case or mode that holds the flag. `challengeIds` maps a challenge slug to its database id.
 */
export function levelPath(entry, challengeIds = {}) {
  switch (entry.category) {
    case 'terminal': return `/terminal/${encodeURIComponent(entry.track)}`;
    case 'cipherlab': return `/cipherlab/${encodeURIComponent(entry.id)}`;
    case 'weblab': return `/weblab/weblab-${encodeURIComponent(entry.id)}`;
    case 'forensics': return `/forensics/${encodeURIComponent(entry.track)}`;
    case 'crackme': return `/reversing/${encodeURIComponent(entry.id)}`;
    case 'osint': return `/osint/${encodeURIComponent(entry.track)}`;
    case 'challenges': return challengeIds[entry.id] ? `/challenges/${encodeURIComponent(challengeIds[entry.id])}` : '/challenges';
    default: return '/range';
  }
}

const percentOf = (part, whole) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

/**
 * Coverage per skill. `captured` is a Set of level keys, or null when there is no progress to show (admins,
 * signed-out visitors). `failed` lists categories whose progress could not be loaded: their flags still count as
 * taught but are neither captured nor open (state 'unknown'). Result rows keep the order of `skills`.
 */
export function computeCoverage({ entries, skills = SKILLS, captured = null, failed = [] }) {
  const done = captured instanceof Set ? captured : null;
  const broken = new Set(list(failed));
  const bySkill = new Map(skills.map((skill) => [skill.id, []]));
  for (const entry of list(entries)) {
    for (const id of new Set(entry.skills)) {
      bySkill.get(id)?.push(entry);
    }
  }
  return skills.map((skill) => {
    const taught = bySkill.get(skill.id).map((entry) => ({
      ...entry,
      state: done === null || broken.has(entry.category) ? 'unknown' : done.has(entry.key) ? 'captured' : 'open',
    }));
    const count = taught.filter((entry) => entry.state === 'captured').length;
    return {
      skill,
      total: taught.length,
      captured: done === null ? null : count,
      percent: done === null ? 0 : percentOf(count, taught.length),
      unknown: taught.filter((entry) => entry.state === 'unknown').length,
      entries: taught,
    };
  });
}

/** Rows of one framework ('all' keeps everything); `show` is all | taught | shown | gaps. */
export function filterRows(rows, { framework = 'all', show = 'all' } = {}) {
  return list(rows).filter((row) => {
    if (framework !== 'all' && row.skill.framework !== framework) return false;
    if (show === 'taught') return row.total > 0;
    if (show === 'shown') return (row.captured ?? 0) > 0;
    if (show === 'gaps') return row.total === 0;
    return true;
  });
}

/** [{ framework, rows }] in framework order, frameworks with no rows left out. */
export function groupByFramework(rows, frameworks = FRAMEWORKS) {
  return frameworks
    .map((framework) => ({ framework, rows: list(rows).filter((row) => row.skill.framework === framework.id) }))
    .filter((group) => group.rows.length > 0);
}

/** The readable CTF skill areas come first; the public frameworks (ATT&CK, NICE, OWASP) go under "Advanced frameworks". */
export const ADVANCED_NOTE = 'These map flags onto public industry frameworks. Useful for a CV or a course, not needed to play.';
export function splitAdvanced(groups) {
  const all = list(groups);
  return { primary: all.filter((group) => group.framework.id === 'area'), advanced: all.filter((group) => group.framework.id !== 'area') };
}

/** Totals for the header line: how many skills the catalogue teaches and how many the player has shown. */
export function summarize(rows) {
  const taught = list(rows).filter((row) => row.total > 0);
  return {
    skills: list(rows).length,
    taught: taught.length,
    shown: taught.filter((row) => (row.captured ?? 0) > 0).length,
    flags: new Set(taught.flatMap((row) => row.entries.map((entry) => entry.key))).size,
  };
}

/** One summary per framework: how many of its taught skills the team has shown. null while progress is unavailable. */
export function frameworkSummary(rows) {
  const taught = list(rows).filter((row) => row.total > 0);
  if (taught.length === 0 || taught.some((row) => row.captured === null)) return null;
  const shown = taught.filter((row) => row.captured > 0).length;
  return { shown, taught: taught.length, percent: percentOf(shown, taught.length) };
}

/** The portfolio is only complete when every category loaded. Returns { complete, note } (note is '' when complete). */
export function portfolioStatus(failed) {
  const count = list(failed).length;
  return { complete: count === 0, note: count === 0 ? '' : `Progress incomplete: ${count} ${count === 1 ? 'category' : 'categories'} failed to load` };
}
