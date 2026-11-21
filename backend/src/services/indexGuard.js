// Index guard. Mongoose autoIndex is off on Vercel (config/db.js), and correctness depends on a few unique indexes:
// without them a fresh database silently allows double solves, duplicate team names and a broken attempt limiter.
// This only READS the index lists of the critical collections, once per process (cached for TTL_MS, re-checked lazily
// on the next call after that), so normal routes pay nothing. It never creates indexes: `npm run db:indexes` does.
import mongoose from 'mongoose';

export const INDEX_TTL_MS = 5 * 60 * 1000;
export const INDEX_TIMEOUT_MS = 1500;
export const FIX_HINT = 'run `npm run db:indexes` in backend/ against this database';

// What must exist. `partial` means the index must carry a partialFilterExpression.
export const CRITICAL_INDEXES = Object.freeze([
  { model: 'Solve', key: { teamId: 1, challengeId: 1 } },
  { model: 'Team', key: { name: 1 } },
  { model: 'Team', key: { inviteCode: 1 } },
  { model: 'User', key: { cognitoSub: 1 } },
  { model: 'AttemptCounter', key: { key: 1 } },
  { model: 'TaintedFlag', key: { hash: 1 } },
  { model: 'CheatSignal', key: { subjectKey: 1, kind: 1, detail: 1 } },
  { model: 'Instance', key: { port: 1 }, partial: true },
]);

const label = ({ model, key }) => `${model}(${Object.keys(key).join(',')})`;
const sameKey = (a, b) => JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));

// models: { [modelName]: { collection: { indexes(): Promise<object[]> } } }. Returns the labels of missing indexes.
export async function findMissingIndexes(models, required = CRITICAL_INDEXES) {
  const missing = [];
  const cache = new Map();
  for (const spec of required) {
    if (!cache.has(spec.model)) {
      let list;
      try {
        list = await models[spec.model].collection.indexes();
      } catch (error) {
        // 26 = NamespaceNotFound: the collection does not exist yet, so none of its indexes do either.
        if (error?.code !== 26 && error?.codeName !== 'NamespaceNotFound') { throw error; }
        list = [];
      }
      cache.set(spec.model, list);
    }
    const found = cache.get(spec.model).some((index) => sameKey(index.key ?? {}, spec.key)
      && index.unique === true && (!spec.partial || Boolean(index.partialFilterExpression)));
    if (!found) { missing.push(label(spec)); }
  }
  return missing;
}

async function realModels() {
  const names = [...new Set(CRITICAL_INDEXES.map(({ model }) => model))];
  const loaded = await Promise.all(names.map(async (name) => [name, (await import(`../models/${name}.js`)).default]));
  return Object.fromEntries(loaded);
}

const state = { at: 0, missing: null, inflight: null };

export function resetIndexGuard() {
  state.at = 0;
  state.missing = null;
  state.inflight = null;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); timer.unref?.(); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Resolves to the array of missing index labels, or null when unknown (no connection, error, timeout). Never throws.
// A timed-out check keeps running in the background and fills the cache for the next caller.
export async function checkIndexes({ now = Date.now(), loadModels = realModels, timeoutMs = INDEX_TIMEOUT_MS } = {}) {
  if (state.missing && now - state.at < INDEX_TTL_MS) { return state.missing; }
  if (mongoose.connection?.readyState !== 1) { return null; }
  state.inflight ??= (async () => {
    try {
      const missing = await findMissingIndexes(await loadModels());
      state.missing = missing;
      state.at = now;
      return missing;
    } catch {
      return null;
    } finally {
      state.inflight = null;
    }
  })();
  return withTimeout(state.inflight, timeoutMs);
}

// Public, label-free summary for /api/health: 'ok' | 'missing', or null when it could not be determined.
export async function indexStatus(options) {
  const missing = await checkIndexes(options);
  if (missing === null) { return null; }
  return missing.length === 0 ? 'ok' : 'missing';
}

export const missingMessage = (missing) =>
  `[indexes] WARNING: missing critical unique indexes (${missing.join(', ')}). Double solves, duplicate teams and a broken attempt limiter are possible. Fix: ${FIX_HINT}.\n`;

// Called once after the first connect. Silent in tests and when everything is in place; never throws.
let warned = false;
export async function warnIfIndexesMissing(options) {
  if (warned || process.env.NODE_ENV === 'test') { return; }
  warned = true;
  try {
    const missing = await checkIndexes(options);
    if (missing && missing.length > 0) { process.stdout.write(missingMessage(missing)); }
  } catch {
    // Diagnostics only.
  }
}

export function resetIndexWarning() { warned = false; }
