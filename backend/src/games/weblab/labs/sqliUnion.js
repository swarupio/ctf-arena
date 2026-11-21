// Lab (hard): UNION-based extraction through a product-style search, over hardcoded tables and the mini evaluator.
import { LIMITS } from '../limits.js';
import { json, notFound, strField } from '../http.js';
import { SqlError, runQuery } from '../miniSql.js';

const PATIENT_NAMES = ['Ada Byte', 'Ben Cache', 'Cleo Stack', 'Dev Heap', 'Eve Queue', 'Finn Mutex', 'Gus Lambda'];
const WARDS = ['North', 'South', 'East', 'West'];

function world(ctx) {
  const secretTable = `internal_${ctx.key('table').slice(0, 5)}`;
  const patients = PATIENT_NAMES.map((name, index) => ({
    id: 100 + index, name, ward: ctx.pick(`ward:${index}`, WARDS), public: index === 6 ? 0 : 1,
  }));
  const tables = {
    patients: { columns: ['id', 'name', 'ward', 'public'], rows: patients },
    'information_schema.tables': { columns: ['table_name'], rows: [{ table_name: 'patients' }, { table_name: secretTable }] },
    'information_schema.columns': {
      columns: ['table_name', 'column_name'],
      rows: [
        ...['id', 'name', 'ward', 'public'].map((column_name) => ({ table_name: 'patients', column_name })),
        { table_name: secretTable, column_name: 'id' }, { table_name: secretTable, column_name: 'note' },
      ],
    },
    [secretTable]: { columns: ['id', 'note'], rows: [{ id: 1, note: 'Cafeteria menu rotation' }, { id: 2, note: `Records master key: ${ctx.flag}` }] },
  };
  return { tables };
}

export default {
  id: 'sqli-union',
  title: 'Patient Lookup',
  summary: 'A search box that returns three columns. Could it return somebody else\'s?',
  story: 'Mercy General\'s patient portal lets staff search by name. IT left a table with sensitive notes next to it.',
  objective: 'Use the search to read the sensitive note that holds the records master key.',
  hints: [
    'Add a quote to the search. The error message shows the query. How many columns does it select?',
    'UNION SELECT lets you append rows from another table, if the column counts match. ORDER BY 1, 2, 3 helps you count.',
    'information_schema.tables lists table names, information_schema.columns lists their columns. Find the odd one out and select from it.',
  ],
  points: 150,
  severity: 'critical',
  bountyUsd: 3000,
  site: { name: 'Mercy General Patient Portal', theme: 'hospital', path: 'portal.mercy.health/search' },
  form: { fields: [{ name: 'q', label: 'Patient name', type: 'text', in: 'query', default: 'Ada' }], submit: { method: 'GET', path: '/search', label: 'Search', encoding: 'query' } },
  template: () => ({ method: 'GET', path: '/search?q=Ada', headers: {}, cookies: {}, body: '' }),
  handle(ctx, req) {
    if (req.method !== 'GET' || req.pathname !== '/search') { return notFound(); }
    const { tables } = world(ctx);
    const q = strField(req.query.q, LIMITS.FIELD);
    // The bug: the search term is concatenated into the query.
    const sql = `SELECT id, name, ward FROM patients WHERE name LIKE '%${q}%' AND public = 1`;
    let result;
    try { result = runQuery(sql, tables); } catch (error) {
      if (!(error instanceof SqlError)) { throw error; }
      return json(500, { error: error.message, query: sql });
    }
    const rows = result.rows.map((row) => ({ id: row[0], name: row[1], ward: row[2] }));
    return json(200, { count: rows.length, results: rows }, rows.some((row) => String(row.name).includes(ctx.flag) || String(row.ward).includes(ctx.flag) || String(row.id).includes(ctx.flag)) ? { exploited: true } : {});
  },
};
