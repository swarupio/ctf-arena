// A small in-memory stand-in for the Mongoose models, used by the security tests only.
//
// Unlike the vi.fn() doubles in the older tests, this one really evaluates filters and updates ($in, $ne, $exists,
// $inc, $push, dotted paths, update pipelines, partial unique indexes ...). That matters for access-control tests:
// "team B cannot touch team A's instance" is only proven if the route's own query really excludes the row, and a
// NoSQL operator injected through a request body really behaves like an operator here (an unsupported operator
// throws, which surfaces as a 500 and fails the test).
//
// It implements exactly the subset of the Mongoose API the backend uses. Ids are 24-character hex strings.
import { vi } from 'vitest';

export const ACTIVE = ['starting', 'running', 'stopping'];

const clone = (value) => (value === undefined ? value : structuredClone(value));
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
const hasOperator = (value) => isPlainObject(value) && Object.keys(value).some((key) => key.startsWith('$'));

let sequence = 0;
export const nextId = () => (++sequence).toString(16).padStart(24, '0');

function sameValue(a, b) {
  if (a instanceof Date || b instanceof Date) { return new Date(a).getTime() === new Date(b).getTime(); }
  if (a === null || a === undefined) { return b === null || b === undefined; }
  if (b === null || b === undefined) { return false; }
  return typeof a === typeof b && String(a) === String(b);
}

// All values a dotted path resolves to (arrays are walked, like MongoDB does).
function valuesAt(doc, path) {
  let current = [doc];
  for (const part of path.split('.')) {
    const next = [];
    for (const item of current) {
      if (Array.isArray(item)) {
        if (/^\d+$/.test(part)) { next.push(item[Number(part)]); } else { for (const el of item) { next.push(el?.[part]); } }
      } else if (item !== null && item !== undefined && typeof item === 'object') {
        next.push(item[part]);
      } else {
        next.push(undefined);
      }
    }
    current = next;
  }
  return current;
}

const equalsAny = (values, target) => {
  if (target === null || target === undefined) { return values.length === 0 || values.some((v) => v === null || v === undefined); }
  return values.some((v) => (Array.isArray(v) ? v.some((el) => sameValue(el, target)) : sameValue(v, target)));
};

function compare(a, b) {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? new Date(b).getTime() : b;
  if (left < right) { return -1; }
  return left > right ? 1 : 0;
}

function applyOperator(values, operator, argument) {
  switch (operator) {
    case '$eq': return equalsAny(values, argument);
    case '$ne': return !equalsAny(values, argument);
    case '$in': return argument.some((item) => equalsAny(values, item));
    case '$nin': return !argument.some((item) => equalsAny(values, item));
    case '$exists': return argument ? values.some((v) => v !== undefined) : values.every((v) => v === undefined);
    case '$gt': return values.some((v) => v != null && compare(v, argument) > 0);
    case '$gte': return values.some((v) => v != null && compare(v, argument) >= 0);
    case '$lt': return values.some((v) => v != null && compare(v, argument) < 0);
    case '$lte': return values.some((v) => v != null && compare(v, argument) <= 0);
    default: throw new Error(`fakeDb: unsupported query operator ${operator}`);
  }
}

export function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') { return condition.some((part) => matches(doc, part)); }
    if (key === '$and') { return condition.every((part) => matches(doc, part)); }
    if (key.startsWith('$')) { throw new Error(`fakeDb: unsupported top-level operator ${key}`); }
    const values = valuesAt(doc, key);
    if (hasOperator(condition)) {
      return Object.entries(condition).every(([operator, argument]) => applyOperator(values, operator, argument));
    }
    return equalsAny(values, condition);
  });
}

function setPath(doc, path, value) {
  const parts = path.split('.');
  let target = doc;
  for (const part of parts.slice(0, -1)) {
    target[part] ??= {};
    target = target[part];
  }
  target[parts.at(-1)] = value;
}
const getFirst = (doc, path) => valuesAt(doc, path)[0];

function evaluate(expression, doc) {
  if (typeof expression === 'string' && expression.startsWith('$')) { return getFirst(doc, expression.slice(1)); }
  if (Array.isArray(expression)) { return expression.map((item) => evaluate(item, doc)); }
  if (isPlainObject(expression)) {
    const [operator] = Object.keys(expression);
    if (operator === '$dateAdd') {
      const { startDate, unit, amount } = expression.$dateAdd;
      if (unit !== 'minute') { throw new Error('fakeDb: $dateAdd supports minutes only'); }
      return new Date(new Date(evaluate(startDate, doc)).getTime() + amount * 60_000);
    }
    if (operator === '$literal') { return expression.$literal; }
    throw new Error(`fakeDb: unsupported expression ${operator}`);
  }
  return expression;
}

function applyUpdate(doc, update, { inserting = false } = {}) {
  if (Array.isArray(update)) {
    const before = clone(doc);
    for (const stage of update) {
      if (!stage.$set) { throw new Error('fakeDb: update pipelines support $set only'); }
      for (const [path, expression] of Object.entries(stage.$set)) { setPath(doc, path, evaluate(expression, before)); }
    }
    return;
  }
  for (const [operator, spec] of Object.entries(update)) {
    if (operator === '$set') {
      for (const [path, value] of Object.entries(spec)) { setPath(doc, path, clone(value)); }
    } else if (operator === '$setOnInsert') {
      if (inserting) { for (const [path, value] of Object.entries(spec)) { setPath(doc, path, clone(value)); } }
    } else if (operator === '$unset') {
      for (const path of Object.keys(spec)) { delete doc[path]; }
    } else if (operator === '$inc') {
      for (const [path, amount] of Object.entries(spec)) { setPath(doc, path, (getFirst(doc, path) ?? 0) + amount); }
    } else if (operator === '$push') {
      for (const [path, value] of Object.entries(spec)) {
        if (!Array.isArray(getFirst(doc, path))) { setPath(doc, path, []); }
        getFirst(doc, path).push(clone(value));
      }
    } else {
      throw new Error(`fakeDb: unsupported update operator ${operator}`);
    }
  }
}

// Equality fields of a filter become the fields of an upserted document (what MongoDB does).
function seedFromFilter(filter) {
  const doc = {};
  for (const [key, condition] of Object.entries(filter)) {
    if (key.startsWith('$') || hasOperator(condition)) { continue; }
    if (condition !== undefined) { setPath(doc, key, clone(condition)); }
  }
  return doc;
}

function project(doc, projection) {
  if (!projection || (isPlainObject(projection) && Object.keys(projection).length === 0)) { return doc; }
  const fields = typeof projection === 'string' ? projection.split(/\s+/).filter(Boolean) : Object.keys(projection);
  if (fields.some((field) => field.startsWith('-'))) { return doc; }
  const out = { _id: doc._id };
  for (const field of fields) {
    const value = getFirst(doc, field);
    if (value !== undefined) { setPath(out, field, clone(value)); }
  }
  return out;
}

function sortDocs(docs, spec) {
  if (!spec) { return docs; }
  const entries = Object.entries(spec);
  return [...docs].sort((a, b) => {
    for (const [path, direction] of entries) {
      const result = compare(getFirst(a, path) ?? 0, getFirst(b, path) ?? 0);
      if (result !== 0) { return result * direction; }
    }
    return 0;
  });
}

// With interleave on, every query yields to the event loop first, so parallel requests really overlap between a
// check and the write that follows it (without it each request would run to completion alone and hide races).
export const behaviour = { interleave: false };

const nextTurn = () => (behaviour.interleave ? new Promise((resolve) => { setImmediate(resolve); }) : Promise.resolve());

class Query {
  constructor(run) { this.run = run; this.sortSpec = null; this.limitCount = null; }
  sort(spec) { this.sortSpec = spec; return this; }
  limit(count) { this.limitCount = count; return this; }
  lean() { return this; }
  select() { return this; }
  exec() {
    return nextTurn().then(() => this.run(this));
  }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }
}

function duplicateError(fields) {
  return Object.assign(new Error(`E11000 duplicate key ${fields.join(',')}`), {
    code: 11000, keyPattern: Object.fromEntries(fields.map((field) => [field, 1])),
  });
}

export class FakeDatabase {
  constructor() {
    this.collections = new Map();
    this.failure = null;
    this.operations = 0;
    this.queue = Promise.resolve();
    this.db = { transaction: (work) => this.transaction(work) };
  }

  collection(name) {
    if (!this.collections.has(name)) { this.collections.set(name, new FakeCollection(this, name)); }
    return this.collections.get(name);
  }

  // Every model call counts, so tests can prove that a rejected request never touched data.
  // The request counter flushes on its own 5 s timer and swallows errors, so it is neither counted nor failed.
  touch(name) {
    if (name === 'ReplicaStat') { return; }
    this.operations += 1;
    if (this.failure) { throw this.failure; }
  }

  // Ids restart from 1, so reseeding the same world gives the same ids (tests may build paths at collection time).
  reset() {
    sequence = 0;
    for (const collection of this.collections.values()) { collection.docs = new Map(); }
    this.failure = null;
    this.operations = 0;
  }

  // Transactions run one at a time; a throw restores every collection (the real ones roll back).
  transaction(work) {
    const task = this.queue.then(async () => {
      const snapshot = new Map([...this.collections].map(([name, collection]) => [name, clone(collection.docs)]));
      try {
        return await work({ fake: 'session' });
      } catch (error) {
        for (const [name, docs] of snapshot) { this.collections.get(name).docs = docs; }
        throw error;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
}

export class FakeCollection {
  constructor(database, name, { defaults = () => ({}), unique = [], createdAt = false, mongoName = name.toLowerCase() + 's' } = {}) {
    this.database = database;
    this.name = name;
    this.docs = new Map();
    this.defaults = defaults;
    this.uniqueSpecs = unique;
    this.createdAt = createdAt;
    this.mongoName = mongoName;
    this.db = database.db;
  }

  configure({ unique = [], ...rest }) {
    Object.assign(this, rest);
    this.uniqueSpecs = unique;
    return this;
  }

  all() { return [...this.docs.values()]; }
  insertRaw(fields) {
    const doc = { _id: nextId(), ...this.defaults(), ...clone(fields) };
    if (this.createdAt && !doc.createdAt) { doc.createdAt = new Date(); }
    this.docs.set(doc._id, doc);
    return clone(doc);
  }

  checkUnique(doc, ignoreId) {
    for (const spec of this.uniqueSpecs) {
      if (spec.partial && !spec.partial(doc)) { continue; }
      const clash = this.all().find((other) => other._id !== ignoreId && (!spec.partial || spec.partial(other))
        && spec.fields.every((field) => (spec.ignoreCase
          ? String(getFirst(other, field)).toLowerCase() === String(getFirst(doc, field)).toLowerCase()
          : sameValue(getFirst(other, field), getFirst(doc, field)))));
      if (clash) { throw duplicateError(spec.fields); }
    }
  }

  init() { return Promise.resolve(); }

  find(filter = {}, projection) {
    return new Query((query) => {
      this.database.touch(this.name);
      let found = this.all().filter((doc) => matches(doc, filter));
      found = sortDocs(found, query.sortSpec);
      if (query.limitCount) { found = found.slice(0, query.limitCount); }
      return found.map((doc) => clone(project(doc, projection)));
    });
  }

  findOne(filter = {}, projection) {
    return new Query(() => {
      this.database.touch(this.name);
      const found = this.all().find((doc) => matches(doc, filter));
      return found ? clone(project(found, projection)) : null;
    });
  }

  findById(id, projection) { return this.findOne({ _id: id }, projection); }

  exists(filter = {}) {
    return new Query(() => {
      this.database.touch(this.name);
      const found = this.all().find((doc) => matches(doc, filter));
      return found ? { _id: found._id } : null;
    });
  }

  countDocuments(filter = {}) {
    return new Query(() => {
      this.database.touch(this.name);
      return this.all().filter((doc) => matches(doc, filter)).length;
    });
  }

  async create(input) {
    await nextTurn();
    this.database.touch(this.name);
    const many = Array.isArray(input);
    const created = [];
    for (const fields of many ? input : [input]) {
      const doc = { _id: nextId(), ...this.defaults(), ...clone(fields) };
      if (this.createdAt && !doc.createdAt) { doc.createdAt = new Date(); }
      this.checkUnique(doc);
      this.docs.set(doc._id, doc);
      created.push(clone(doc));
    }
    return many ? created : created[0];
  }

  findOneAndUpdate(filter, update, options = {}) {
    return new Query(() => {
      this.database.touch(this.name);
      let doc = this.all().find((candidate) => matches(candidate, filter));
      const before = clone(doc);
      if (!doc) {
        if (!options.upsert) { return null; }
        doc = { _id: nextId(), ...this.defaults(), ...seedFromFilter(filter) };
        if (this.createdAt) { doc.createdAt = new Date(); }
        applyUpdate(doc, update, { inserting: true });
        this.checkUnique(doc);
        this.docs.set(doc._id, doc);
        return options.new || options.returnDocument === 'after' ? clone(doc) : null;
      }
      const draft = clone(doc);
      applyUpdate(draft, update);
      this.checkUnique(draft, doc._id);
      this.docs.set(doc._id, draft);
      return options.new || options.returnDocument === 'after' ? clone(draft) : before;
    });
  }

  updateOne(filter, update, options = {}) {
    return new Query(() => {
      this.database.touch(this.name);
      const doc = this.all().find((candidate) => matches(candidate, filter));
      if (!doc) {
        if (!options.upsert) { return { matchedCount: 0, modifiedCount: 0 }; }
        const fresh = { _id: nextId(), ...this.defaults(), ...seedFromFilter(filter) };
        applyUpdate(fresh, update, { inserting: true });
        this.checkUnique(fresh);
        this.docs.set(fresh._id, fresh);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      const draft = clone(doc);
      applyUpdate(draft, update);
      this.checkUnique(draft, doc._id);
      this.docs.set(doc._id, draft);
      return { matchedCount: 1, modifiedCount: 1 };
    });
  }

  deleteOne(filter) {
    return new Query(() => {
      this.database.touch(this.name);
      const doc = this.all().find((candidate) => matches(candidate, filter));
      if (doc) { this.docs.delete(doc._id); }
      return { deletedCount: doc ? 1 : 0 };
    });
  }

  deleteMany(filter) {
    return new Query(() => {
      this.database.touch(this.name);
      const victims = this.all().filter((doc) => matches(doc, filter));
      for (const doc of victims) { this.docs.delete(doc._id); }
      return { deletedCount: victims.length };
    });
  }

  insertMany(documents) { return this.create(documents); }

  // Only the pipeline shapes the backend uses: $match, $group, $sort, $lookup, $unwind, $project.
  async aggregate(pipeline) {
    await nextTurn();
    this.database.touch(this.name);
    let rows = this.all().map(clone);
    for (const stage of pipeline) {
      const [[name, spec]] = Object.entries(stage);
      if (name === '$match') {
        rows = rows.filter((row) => matches(row, spec));
      } else if (name === '$group') {
        const groups = new Map();
        for (const row of rows) {
          const id = evaluate(spec._id, row) ?? null;
          const keyText = String(id);
          if (!groups.has(keyText)) { groups.set(keyText, { _id: id }); }
          const group = groups.get(keyText);
          for (const [field, accumulator] of Object.entries(spec)) {
            if (field === '_id') { continue; }
            const [[op, operand]] = Object.entries(accumulator);
            const value = evaluate(operand, row);
            if (op === '$sum') { group[field] = (group[field] ?? 0) + (typeof value === 'number' ? value : 0); }
            else if (op === '$max') { group[field] = group[field] === undefined || compare(value, group[field]) > 0 ? value : group[field]; }
            else { throw new Error(`fakeDb: unsupported accumulator ${op}`); }
          }
        }
        rows = [...groups.values()];
      } else if (name === '$sort') {
        rows = sortDocs(rows, spec);
      } else if (name === '$lookup') {
        const foreign = this.database.collection(Object.keys(NAMES).find((model) => NAMES[model].mongoName === spec.from));
        rows = rows.map((row) => ({
          ...row,
          [spec.as]: foreign.all().filter((doc) => sameValue(getFirst(doc, spec.foreignField), getFirst(row, spec.localField))).map(clone),
        }));
      } else if (name === '$unwind') {
        const field = spec.slice(1);
        rows = rows.flatMap((row) => (row[field] ?? []).map((item) => ({ ...row, [field]: item })));
      } else if (name === '$project') {
        rows = rows.map((row) => {
          const out = { _id: row._id };
          for (const [field, rule] of Object.entries(spec)) {
            out[field] = rule === 1 ? row[field] : evaluate(rule, row);
          }
          return out;
        });
      } else {
        throw new Error(`fakeDb: unsupported pipeline stage ${name}`);
      }
    }
    return rows;
  }
}

// ---- the world ------------------------------------------------------------------------------------------------
export const database = new FakeDatabase();

// Mongoose schema defaults and unique indexes that the routes rely on.
const NAMES = {
  User: { mongoName: 'users', defaults: () => ({ teamId: null }), unique: [{ fields: ['cognitoSub'] }] },
  Team: {
    mongoName: 'teams', createdAt: true, defaults: () => ({ banned: false }),
    unique: [{ fields: ['name'], ignoreCase: true }, { fields: ['inviteCode'] }],
  },
  Challenge: {
    mongoName: 'challenges', createdAt: true,
    defaults: () => ({ visible: true, solveCount: 0, description: '', attachments: [] }),
    unique: [{ fields: ['slug'] }],
  },
  Instance: {
    mongoName: 'instances', createdAt: true, defaults: () => ({ status: 'starting', extended: false }),
    unique: [
      { fields: ['port'], partial: (doc) => ACTIVE.includes(doc.status) },
      { fields: ['teamId', 'challengeId'], partial: (doc) => ACTIVE.includes(doc.status) },
    ],
  },
  Solve: {
    mongoName: 'solves', defaults: () => ({ firstBlood: false, solvedAt: new Date() }),
    unique: [{ fields: ['teamId', 'challengeId'] }],
  },
  Submission: { mongoName: 'submissions', createdAt: true },
  AttemptCounter: { mongoName: 'attemptcounters', defaults: () => ({ count: 0 }), unique: [{ fields: ['key'] }] },
  ReplicaStat: { mongoName: 'replicastats', defaults: () => ({ requests: 0 }), unique: [{ fields: ['replica'] }] },
  CheatSignal: { mongoName: 'cheatsignals' },
  TaintedFlag: { mongoName: 'taintedflags', unique: [{ fields: ['hash'] }] },
  TerminalActivity: { mongoName: 'terminalactivities' },
};

for (const [name, options] of Object.entries(NAMES)) { database.collection(name).configure(options); }

export const models = Object.fromEntries(Object.keys(NAMES).map((name) => [name, database.collection(name)]));

// What a vi.mock factory returns for ../../src/models/<name>.js
export function modelModule(name) {
  const model = models[name];
  if (!model) { throw new Error(`fakeDb: no model ${name}`); }
  return name === 'Instance' ? { default: model, ACTIVE_STATUSES: ACTIVE } : { default: model };
}

// Fake Docker daemon behind dockerService: records calls, never talks to a socket.
export function fakeDockerModule() {
  let counter = 0;
  const dockerService = {
    ensureNetwork: vi.fn(async () => {}),
    createInstance: vi.fn(async () => `container-${++counter}`),
    stopInstance: vi.fn(async () => {}),
    listManagedContainers: vi.fn(async () => []),
  };
  return { dockerService, CHALLENGE_NETWORK: 'ctf-challenges', MANAGED_LABEL: 'ctf.managed', createDockerService: () => dockerService };
}
