// Pure helpers for first-run onboarding. Nothing here talks to the network or the browser.
// Input is the raw overview answer of each Range category (the same GET the hub already makes);
// output is the "Capture your first flag" checklist. To change which level a step points at, edit
// `FIRST_STEPS` (see docs/ONBOARDING.md).

import { normalizeModes } from '../terminal/adapters.js';
import { difficultyRank, sumTracks } from '../games/progress.js';

// One entry per category, in the order shown. `minutes` is a rough guess for a first-timer.
export const FIRST_STEPS = [
  { id: 'terminal', title: 'Arena Terminal', minutes: 4, objective: 'Look around a friendly Unix box and find the hidden flag.' },
  { id: 'cipherlab', title: 'Cipher Lab', minutes: 5, objective: 'Decode a short coded message and submit the plaintext.' },
  { id: 'weblab', title: 'Web Exploit Lab', minutes: 6, objective: 'Inspect a request and exploit a simple flaw in a simulated site.' },
  { id: 'forensics', title: 'Forensics Desk', minutes: 6, objective: 'Read the evidence and answer the first question of an easy case.' },
  { id: 'crackme', title: 'Crackme Arcade', minutes: 6, objective: 'Read a tiny program and work out the key it accepts.' },
  { id: 'osint', title: 'OSINT Trail', minutes: 6, objective: 'Answer the first question of an easy case from public records.' },
];

// The category the welcome card sends a brand-new player to: a guest shell is the gentlest start.
export const RECOMMENDED_FIRST = 'terminal';

const list = (value) => (Array.isArray(value) ? value : []);
const tracksOf = (raw) => (Array.isArray(raw) ? raw : list(raw?.tracks));
const enc = encodeURIComponent;

// Easiest track first (by difficulty word, then original order), so "the easy track" wins when it exists.
const easiestFirst = (items) => items
  .map((item, index) => ({ item, index }))
  .sort((a, b) => difficultyRank(a.item?.difficulty) - difficultyRank(b.item?.difficulty) || a.index - b.index)
  .map(({ item }) => item);

// Cipher Lab and Crackme Arcade: tracks[].levels[] with status solved / open / locked.
function fromLevels(tracks, path) {
  for (const track of easiestFirst(tracks)) {
    const level = list(track?.levels).find((item) => item && item.id != null && item.status === 'open');
    if (level) return { href: `${path}/${enc(level.id)}`, target: String(level.title || level.id), track: String(track.title || track.id || '') };
  }
  return null;
}

// Web Exploit Lab: tracks[].labs[]; a lab is startable when it is not solved, not locked and seeded.
function fromLabs(tracks) {
  for (const track of easiestFirst(tracks)) {
    const lab = list(track?.labs).find((item) => item && item.slug && !item.solved && !item.locked && item.available !== false);
    if (lab) return { href: `/weblab/${enc(lab.slug)}`, target: String(lab.title || lab.slug), track: String(track.title || track.id || '') };
  }
  return null;
}

// Forensics Desk and OSINT Trail: one entry per case. The stage list is not in the overview, so the link opens the case.
function fromCases(cases, path, countKey) {
  for (const item of easiestFirst(cases)) {
    if (!item || item.id == null || item.seeded === false) continue;
    const total = Number(item[countKey]);
    if (!(total > 0) || Number(item.solved) >= total) continue;
    return { href: `${path}/${enc(item.id)}`, target: String(item.caseTitle || item.title || item.id), track: String(item.title || '') };
  }
  return null;
}

// Arena Terminal: modes[] with codes and solved counts; the first mode with codes left (easy is first).
function fromModes(raw) {
  const modes = easiestFirst(normalizeModes(raw));
  const mode = modes.find((item) => item.codes > 0 && item.solved < item.codes);
  return mode ? { href: `/terminal/${enc(mode.mode)}`, target: mode.title, track: '' } : null;
}

/**
 * Where should a new player start in this category? Returns { href, target, track } for the first open level of
 * the easiest track, or null when there is nothing playable (unseeded, empty, everything solved, garbage input).
 */
export function pickFirstLevel(categoryId, raw) {
  const tracks = tracksOf(raw);
  switch (categoryId) {
    case 'terminal': return fromModes(raw);
    case 'cipherlab': return fromLevels(tracks, '/cipherlab');
    case 'crackme': return fromLevels(tracks, '/reversing');
    case 'weblab': return fromLabs(tracks);
    case 'forensics': return fromCases(tracks, '/forensics', 'stages');
    case 'osint': return fromCases(tracks, '/osint', 'questions');
    default: return null;
  }
}

/**
 * Build the checklist.
 *   inputs: { [categoryId]: { raw } | { error } | undefined }  (undefined = still loading)
 *   games:  the registry (id, title, path, summarize), used to count captured flags the same way the hub does
 * Each step: { id, title, minutes, objective, status, href, target, track }
 *   status: 'captured' | 'open' | 'unavailable' | 'loading'
 * One failing or unseeded category never blocks the others.
 */
export function buildChecklist(inputs, games) {
  const byId = new Map(list(games).map((game) => [game.id, game]));
  return FIRST_STEPS.map((step) => {
    const game = byId.get(step.id);
    const state = inputs?.[step.id];
    const base = { ...step, title: game?.title || step.title, href: game?.path || '', target: '', track: '', failed: false };
    if (!game) return { ...base, status: 'unavailable' };
    if (!state) return { ...base, status: 'loading' };
    if (state.error) return { ...base, status: 'unavailable', failed: true };
    let captured = 0;
    try { captured = sumTracks(game.summarize(state.raw)?.tracks).solved; } catch { /* odd payload: treat as nothing captured */ }
    if (captured > 0) return { ...base, status: 'captured' };
    const pick = pickFirstLevel(step.id, state.raw);
    return pick ? { ...base, status: 'open', ...pick } : { ...base, status: 'unavailable' };
  });
}

/** { done, total, loaded, failed, text } for the meter. `text` is the accessible equivalent. */
export function checklistProgress(steps) {
  const all = list(steps);
  const done = all.filter((step) => step.status === 'captured').length;
  const total = all.length;
  return {
    done,
    total,
    loaded: all.every((step) => step.status !== 'loading'),
    failed: all.filter((step) => step.failed).length,
    text: `${done} of ${total} first flags captured`,
  };
}

/** The step the player should do next: the first open one, in checklist order. */
export const nextStep = (steps) => list(steps).find((step) => step.status === 'open') ?? null;

/** Where the welcome card's primary button goes: the recommended category when playable, else the first open step. */
export function recommendedStep(steps) {
  const all = list(steps);
  return all.find((step) => step.id === RECOMMENDED_FIRST && step.status === 'open') ?? nextStep(all);
}
