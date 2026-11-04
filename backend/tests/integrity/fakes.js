// In-memory stand-ins for the three fair-play collections, shared by the integrity tests. They follow the contract the
// service relies on (upsert semantics, unique hash, update pipelines) so rules can be tested end to end without MongoDB.
import mongoose from 'mongoose';
import { vi } from 'vitest';

export const state = { signals: [], tainted: [], activity: [] };

// ---- a tiny evaluator for the aggregation operators the activity pipeline uses -----------------------------------
const nullish = (value) => value === null || value === undefined;
const toNumber = (value) => (value instanceof Date ? value.getTime() : value);

function evaluate(expression, doc) {
  if (expression instanceof Date) { return expression; }
  if (typeof expression === 'string') { return expression.startsWith('$') ? doc[expression.slice(1)] : expression; }
  if (typeof expression !== 'object' || expression === null) { return expression; }
  const [[operator, args]] = Object.entries(expression);
  const arg = (index) => evaluate(args[index], doc);
  switch (operator) {
    case '$eq': return arg(0) === arg(1);
    case '$type': {
      const value = evaluate(args, doc);
      if (value === undefined) { return 'missing'; }
      if (value === null) { return 'null'; }
      return value instanceof Date ? 'date' : typeof value === 'number' ? 'double' : typeof value;
    }
    case '$subtract': {
      const [a, b] = [arg(0), arg(1)];
      return nullish(a) || nullish(b) ? null : toNumber(a) - toNumber(b);
    }
    case '$lt': {
      const [a, b] = [arg(0), arg(1)];
      return nullish(a) ? !nullish(b) : toNumber(a) < toNumber(b); // BSON order: null sorts before numbers
    }
    case '$and': return args.every((item) => Boolean(evaluate(item, doc))); // short-circuits like MongoDB
    case '$ifNull': return arg(0) ?? arg(1);
    case '$cond': return evaluate(args[0], doc) ? arg(1) : arg(2);
    case '$add': {
      const values = args.map((item) => evaluate(item, doc));
      return values.some(nullish) ? null : values.reduce((sum, value) => sum + toNumber(value), 0);
    }
    case '$multiply': {
      const values = args.map((item) => evaluate(item, doc));
      return values.some(nullish) ? null : values.reduce((product, value) => product * toNumber(value), 1);
    }
    default: throw new Error(`fake pipeline: unsupported operator ${operator}`);
  }
}

function applyPipeline(doc, pipeline) {
  for (const stage of pipeline) {
    if (!stage.$set) { throw new Error('fake pipeline: only $set stages are supported'); }
    const computed = Object.fromEntries(Object.entries(stage.$set).map(([field, expression]) => [field, evaluate(expression, doc)]));
    Object.assign(doc, computed); // every field is computed from the document as it was before the stage
  }
}

const duplicateError = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000, writeErrors: [{ code: 11000 }] });
const query = (value) => {
  const chain = { sort: () => chain, limit: () => chain, lean: async () => value };
  return chain;
};

export const CheatSignalFake = { updateOne: vi.fn(), find: vi.fn(), deleteMany: vi.fn() };
export const TaintedFlagFake = { insertMany: vi.fn(), findOne: vi.fn() };
export const TerminalActivityFake = { findOneAndUpdate: vi.fn() };

// Call in beforeEach: empties the stores and (re)installs the behaviour, which also clears any mockRejectedValue.
export function installFakes() {
  state.signals = [];
  state.tainted = [];
  state.activity = [];

  CheatSignalFake.updateOne.mockReset().mockImplementation(async (filter, update, options) => {
    let row = state.signals.find((item) => ['subjectKey', 'kind', 'detail'].every((key) => item[key] === filter[key]));
    if (!row) {
      if (!options?.upsert) { return { matchedCount: 0 }; }
      row = { ...filter, ...update.$setOnInsert, count: 0 };
      state.signals.push(row);
    }
    row.count += update.$inc.count;
    Object.assign(row, update.$set);
    return { matchedCount: 1 };
  });
  CheatSignalFake.find.mockReset().mockImplementation(() => query(
    [...state.signals].sort((a, b) => b.lastAt - a.lastAt).map((row) => ({ ...row })),
  ));
  CheatSignalFake.deleteMany.mockReset().mockImplementation(async (filter) => {
    const before = state.signals.length;
    state.signals = state.signals.filter((row) => row.subjectKey !== filter.subjectKey);
    return { deletedCount: before - state.signals.length };
  });

  TaintedFlagFake.insertMany.mockReset().mockImplementation(async (documents) => {
    let duplicate = false;
    for (const document of documents) {
      if (state.tainted.some((row) => row.hash === document.hash)) { duplicate = true; } else { state.tainted.push({ ...document }); }
    }
    if (duplicate) { throw duplicateError(); } // like an unordered bulk insert: the new ones are in, the old ones error
    return documents;
  });
  TaintedFlagFake.findOne.mockReset().mockImplementation((filter) => query(
    state.tainted.find((row) => row.hash === filter.hash) ?? null,
  ));

  TerminalActivityFake.findOneAndUpdate.mockReset().mockImplementation(async (filter, update, options) => {
    const existing = state.activity.find((row) => String(row.userId) === String(filter.userId) && row.bucket.getTime() === filter.bucket.getTime());
    const before = existing ? { ...existing } : null;
    const doc = existing ?? { userId: String(filter.userId), bucket: filter.bucket };
    if (!existing) { state.activity.push(doc); }
    applyPipeline(doc, update);
    return options.returnDocument === 'before' ? before : { ...doc };
  });
}

// The service does nothing without a live connection (so unit tests never buffer commands); tests switch it on.
export const goLive = () => Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
export const goOffline = () => { delete mongoose.connection.readyState; };
