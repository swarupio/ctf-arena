// Hint ledger (docs/HINTS.md "Hint costs"): which hints a team opened, and what that costs a level.
//
// Two sources are unioned, every index counted once:
//   - the HintOpen collection (scopes without an older collection: weblab, forensics, terminal, ...), and
//   - the older per-category collections of Cipher Lab (CipherHint), Crackme (CrackmeHint) and OSINT (OsintHint).
// Replicas keep nothing in memory: every call reads MongoDB, the ledger write is one idempotent upsert.
import CipherHint from '../models/CipherHint.js';
import CrackmeHint from '../models/CrackmeHint.js';
import HintOpen from '../models/HintOpen.js';
import OsintHint from '../models/OsintHint.js';
import { getHintCosts } from './adminSettings.js';
import { allPriced, marginalPercent, spentFor, tierOf } from './hintCost.js';

// scope -> { legacy?: async ({ teamId, key }) => [{ index, percent?, capPercent? }] (opened rows), ledger: boolean }.
const scopes = new Map();

// Extension point. A category that already stores opens elsewhere passes `legacy` (and, by default, is then NOT read from
// HintOpen); a category that wants the shared ledger registers nothing (unknown scopes use HintOpen). Pass
// `ledger: true` together with `legacy` to read both.
export function registerHintScope(scope, { legacy, ledger = !legacy } = {}) {
  scopes.set(scope, { legacy, ledger });
}

// Older collections write index = count of existing rows, so a team's opened hints are always 0..count-1. Their rows carry
// the price fixed at open time (`percent`, `capPercent`) when they were written by this version; older rows have none.
const rowsOf = (rows) => rows.map((row) => ({ index: row.index, percent: row.percent, capPercent: row.capPercent }));
registerHintScope('cipherlab', { legacy: async ({ teamId, key }) => rowsOf(await CipherHint.find({ teamId, levelId: key }, 'index percent capPercent').lean()) });
registerHintScope('crackme', { legacy: async ({ teamId, key }) => rowsOf(await CrackmeHint.find({ teamId, levelId: key }, 'index percent capPercent').lean()) });
registerHintScope('osint', { legacy: async ({ teamId, key }) => rowsOf(await OsintHint.find({ teamId, key }, 'index percent capPercent').lean()) });

// Rows the team opened for one level, sorted by index: [{ index, percent, capPercent }] (price fields absent on older rows).
export async function openedEntries({ teamId, scope, key }) {
  const source = scopes.get(scope) ?? { ledger: true };
  const byIndex = new Map();
  const take = (item) => {
    const row = Number.isInteger(item) ? { index: item } : item;
    const known = byIndex.get(row.index);
    if (!known || !Number.isFinite(known.percent)) { byIndex.set(row.index, { index: row.index, percent: row.percent, capPercent: row.capPercent }); }
  };
  if (source.legacy) { for (const row of await source.legacy({ teamId, key })) { take(row); } }
  if (source.ledger) {
    for (const row of await HintOpen.find({ teamId, scope, key }, 'index percent capPercent').lean()) { take(row); }
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

// Sorted, distinct 0-based indexes the team opened for one level.
export async function openedIndexes(where) {
  return (await openedEntries(where)).map((entry) => entry.index);
}

// Records one opened hint, once per (team, scope, key, index), PRICED AT OPEN TIME: the row stores the percent this open
// charged (cumulative tiers: the cheaper tiers below that nothing opened yet are included) and the cap in force. `costs` are
// the platform costs at this moment (read here when the caller has none). A repeated open writes nothing and returns the
// stored price; a concurrent duplicate (E11000) is the same open. Returns { created, percent, tier, costs }.
export async function recordHintOpen({ teamId, userId, scope, key, index, costs }) {
  const current = costs ?? await getHintCosts();
  const existing = await openedEntries({ teamId, scope, key });
  const same = existing.find((entry) => entry.index === index);
  if (same && Number.isFinite(same.percent)) {
    return { created: false, percent: same.percent, tier: tierOf(index), costs: current };
  }
  const percent = marginalPercent(index, existing.filter((entry) => entry.index !== index), current);
  // Lost a race (another replica wrote the row first): answer with the price that row stores, not the one computed here.
  const storedPrice = async () => {
    const row = (await openedEntries({ teamId, scope, key })).find((entry) => entry.index === index);
    return Number.isFinite(row?.percent) ? row.percent : percent;
  };
  try {
    const result = await HintOpen.updateOne(
      { teamId, scope, key, index }, { $setOnInsert: { userId, percent, capPercent: current.enabled ? current.maxPercent : 0 } }, { upsert: true },
    );
    if (result?.upsertedCount) { return { created: true, percent, tier: tierOf(index), costs: current }; }
    return { created: false, percent: await storedPrice(), tier: tierOf(index), costs: current };
  } catch (error) {
    if (error.code === 11000) { return { created: false, percent: await storedPrice(), tier: tierOf(index), costs: current }; }
    throw error;
  }
}

// { spent, openedCount, costs } for one level. The platform costs are read ONLY when a row has no stored price (older rows);
// when every opened hint carries its price, nothing is read, so a settings failure at solve time cannot change what was
// agreed. `costs` is null when none were read.
export async function spentForLevel({ teamId, scope, key, base }) {
  const opened = await openedEntries({ teamId, scope, key });
  if (opened.length === 0) { return { spent: 0, openedCount: 0, costs: null }; }
  const costs = allPriced(opened) ? null : await getHintCosts();
  return { spent: spentFor(base, opened, costs), openedCount: opened.length, costs };
}
