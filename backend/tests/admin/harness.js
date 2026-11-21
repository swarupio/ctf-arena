// Mock models for the admin API v2 tests: every model method is a vi.fn that returns a chainable, awaitable query.
import { vi } from 'vitest';

// A Mongoose-like query: sort/skip/limit/lean/select return itself, awaiting it yields `value`.
export function chain(value) {
  const query = {
    sort: () => query, skip: () => query, limit: () => query, lean: () => query, select: () => query,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
    catch: (reject) => Promise.resolve(value).catch(reject),
    finally: (done) => Promise.resolve(value).finally(done),
  };
  return query;
}

export const MODEL_NAMES = [
  'User', 'Team', 'Challenge', 'Instance', 'Solve', 'Submission', 'ReplicaStat', 'CheatSignal', 'TaintedFlag',
  'TerminalActivity', 'AttemptCounter', 'AuditLog', 'AppSetting',
];
const METHODS = [
  'find', 'findOne', 'findById', 'findOneAndUpdate', 'findOneAndDelete', 'updateOne', 'updateMany', 'deleteMany',
  'deleteOne', 'countDocuments', 'aggregate', 'create', 'exists',
];

export const models = Object.fromEntries(MODEL_NAMES.map((name) => [name, Object.fromEntries(METHODS.map((method) => [method, vi.fn()]))]));

// Defaults: empty results, zero counts.
export function resetModels() {
  for (const model of Object.values(models)) {
    for (const [method, fn] of Object.entries(model)) {
      fn.mockReset();
      if (['find', 'findOne', 'findById', 'findOneAndUpdate', 'findOneAndDelete'].includes(method)) {
        fn.mockImplementation(() => chain(method === 'find' ? [] : null));
      } else if (method === 'countDocuments') {
        fn.mockResolvedValue(0);
      } else if (method === 'aggregate') {
        fn.mockResolvedValue([]);
      } else if (method === 'exists') {
        fn.mockResolvedValue(null);
      } else {
        fn.mockResolvedValue({});
      }
    }
  }
}

export const mockModel = (name, extra = {}) => ({ default: models[name], ...extra });

export const instanceMock = { stop: vi.fn(), stopTeamInstances: vi.fn(), stopChallengeInstances: vi.fn(), stopTeamChallenge: vi.fn() };
export const instanceModule = () => ({
  instanceService: instanceMock,
  serializeInstance: (instance) => ({ id: String(instance._id), url: `http://arena.test:${instance.port}` }),
});

export const oid = (n) => String(n).padStart(24, '0');
