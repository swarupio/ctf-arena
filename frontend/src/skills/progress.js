// Progress for the Skills map: which flags the signed-in player's team has captured, per category.
// Reuses the category overview endpoints named in the registry (src/games/registry.js). Cipher Lab, Crackme and
// the Web Exploit Lab list every level in their overview; Forensics, OSINT and the Terminal list only counts there,
// so those three also read a per-case or per-mode answer, and only for cases or modes that have captured flags.
// `get(path)` is injected (apiGet in the page, a stub in tests). Each category fails on its own.
import { GAMES } from '../games/registry.js';
import { levelKey } from './coverage.js';

const list = (value) => (Array.isArray(value) ? value : []);
const tracksOf = (data) => (Array.isArray(data) ? data : list(data?.tracks));
const overviewOf = (id) => GAMES.find((game) => game.id === id)?.overview;
const hasSolved = (item) => Number(item?.solved) > 0;

// Cipher Lab and Crackme: tracks[].levels[] with status 'solved' | 'open' | 'locked'.
const byStatus = (category) => async (get) => {
  const data = await get(overviewOf(category));
  const captured = new Set();
  for (const track of tracksOf(data)) {
    for (const level of list(track?.levels)) {
      if (level?.status === 'solved') captured.add(levelKey(category, track.id, level.id));
    }
  }
  return { captured };
};

async function weblab(get) {
  const data = await get(overviewOf('weblab'));
  const captured = new Set();
  for (const track of tracksOf(data)) {
    for (const lab of list(track?.labs)) {
      if (lab?.solved) captured.add(levelKey('weblab', track.id, lab.id));
    }
  }
  return { captured };
}

// Forensics and OSINT: the overview gives counts per case; the case itself lists its stages or questions.
const byCase = (category, detailPath, field) => async (get) => {
  const cases = tracksOf(await get(overviewOf(category)));
  const captured = new Set();
  await Promise.all(cases.filter(hasSolved).map(async (item) => {
    const detail = await get(detailPath(item.id));
    for (const stage of list(detail?.[field])) {
      if (stage?.solved) captured.add(levelKey(category, item.id, stage.n));
    }
  }));
  return { captured };
};

async function terminal(get) {
  const data = await get(overviewOf('terminal'));
  const modes = (Array.isArray(data) ? data : list(data?.modes)).filter((mode) => mode && typeof mode.mode === 'string');
  const captured = new Set();
  await Promise.all(modes.filter(hasSolved).map(async (mode) => {
    const detail = await get(`/terminal/${encodeURIComponent(mode.mode)}/progress`);
    for (const code of list(detail?.solved)) {
      if (code && Number.isFinite(Number(code.n))) captured.add(levelKey('terminal', mode.mode, Number(code.n)));
    }
  }));
  return { captured };
}

// Static and Docker challenges: the list carries the slug, the id (for the link) and whether the team solved it.
async function challenges(get) {
  const data = await get('/challenges');
  const captured = new Set();
  const challengeIds = {};
  for (const item of list(data)) {
    if (item?.type !== 'static' && item?.type !== 'docker') continue;
    challengeIds[item.slug] = item.id;
    if (item.solvedByMyTeam) captured.add(levelKey('challenges', item.type, item.slug));
  }
  return { captured, challengeIds };
}

export const LOADERS = {
  terminal,
  cipherlab: byStatus('cipherlab'),
  weblab,
  forensics: byCase('forensics', (id) => `/forensics/tracks/${encodeURIComponent(id)}`, 'stages'),
  crackme: byStatus('crackme'),
  osint: byCase('osint', (id) => `/osint/cases/${encodeURIComponent(id)}`, 'questions'),
  challenges,
};

export const CATEGORY_IDS = Object.keys(LOADERS);

/** Loads one category: { id, captured, challengeIds? } or { id, error }. Never throws. */
export async function loadCategory(id, get) {
  try {
    return { id, challengeIds: {}, ...(await LOADERS[id](get)) };
  } catch (error) {
    return { id, error: error?.message || 'failed' };
  }
}

/** Merges per-category results: all captured keys, the slug -> id map and the categories that failed. */
export function mergeProgress(results) {
  const captured = new Set();
  const challengeIds = {};
  const failed = [];
  for (const result of list(results)) {
    if (!result) continue;
    if (result.error) { failed.push(result.id); continue; }
    result.captured.forEach((key) => captured.add(key));
    Object.assign(challengeIds, result.challengeIds);
  }
  return { captured, challengeIds, failed };
}
