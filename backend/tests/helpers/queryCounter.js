// Counts MongoDB round trips per request on top of the in-memory fake database (tests/security/helpers/fakeDb.js).
// Every model call that reaches the fake counts as one query (a find, a count, an aggregate, an upsert, a create ...).
// This is the unit used in docs/QUERY_PERFORMANCE.md. The request counter's own flush is excluded by the fake itself.
import { database } from '../security/helpers/fakeDb.js';

let log = null;
const originalTouch = database.touch.bind(database);
database.touch = (name) => {
  originalTouch(name);
  if (log) { log.push(name); }
};

// Runs `work` and resolves { result, count, byModel } for the queries it issued.
export async function countQueries(work) {
  log = [];
  try {
    const result = await work();
    const byModel = {};
    for (const name of log) { byModel[name] = (byModel[name] ?? 0) + 1; }
    return { result, count: log.length, byModel };
  } finally {
    log = null;
  }
}
