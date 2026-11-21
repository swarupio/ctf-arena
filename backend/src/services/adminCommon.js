// Shared helpers of the admin API v2 (docs/API_SPEC.md "Admin API v2"): list queries, the paging envelope, id and
// regex handling, CSV cells. Pure functions; nothing here touches the database.
import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env.js';

// Side-effect writers that older route tests exercise with hand-made model doubles (audit log, settings guard) skip
// themselves in the test environment when no database connection exists, instead of buffering for 10 s.
// Production always attempts the write.
export const dbOffline = () => env.NODE_ENV === 'test' && mongoose.connection?.readyState !== 1;

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 25;
export const ID_PATTERN = /^[a-f\d]{24}$/i;

export const idString = z.string().regex(ID_PATTERN, 'must be a 24 character hex id');
export const boolText = z.enum(['true', 'false']).transform((value) => value === 'true');
export const dateText = z.coerce.date();

// Query parameters of every paginated list: page, limit, q, sort (`field` or `-field`), plus resource filters.
export function listQuery(sortFields, defaultSort, filters = {}) {
  const sorts = sortFields.flatMap((field) => [field, `-${field}`]);
  return z.object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    q: z.string().trim().min(1).max(100).optional(),
    sort: z.enum(sorts).default(defaultSort),
    ...filters,
  }).strict();
}

export const skipOf = ({ page, limit }) => (page - 1) * limit;

// `-createdAt` -> { createdAt: -1, _id: -1 }. The id tie-break keeps pages stable.
export function sortSpec(sort) {
  const direction = sort.startsWith('-') ? -1 : 1;
  const field = sort.replace(/^-/, '');
  return { [field]: direction, _id: direction };
}

export const envelope = (items, { page, limit }, total) => ({ items, page, limit, total });

export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const searchRegex = (q) => new RegExp(escapeRegex(q), 'i');

export const toId = (value) => new mongoose.Types.ObjectId(String(value));

// Legacy list routes (teams, challenges, instances) return a bare array unless the caller sends any query parameter.
export const isPaged = (query) => Object.keys(query ?? {}).length > 0;

export const iso = (value) => (value ? new Date(value).toISOString() : null);
export const idOf = (value) => (value ? String(value) : null);

// Slice of an in-memory list for resources that are sorted after aggregation (teams by score).
export function paginate(list, { page, limit }) {
  const start = skipOf({ page, limit });
  return list.slice(start, start + limit);
}

// Loads the documents for a set of ids in one query and returns Map(idString -> lean doc). Dangling ids are just absent.
export async function loadMap(model, values, fields) {
  const unique = [...new Set(values.filter(Boolean).map(String))];
  if (unique.length === 0) { return new Map(); }
  const docs = await model.find({ _id: { $in: unique } }, fields).lean();
  return new Map(docs.map((doc) => [String(doc._id), doc]));
}

// ---- CSV -----------------------------------------------------------------------------------------------------------
// A cell starting with = + - @ tab or CR is executed as a formula by Excel and Sheets: prefix it with a quote so it is
// read as text. Numbers and booleans are never prefixed (a negative score stays a number).
const FORMULA_START = /^[=+\-@\t\r]/;
export function csvCell(value) {
  if (value === null || value === undefined) { return ''; }
  if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) { text = `'${text}`; }
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const csvRow = (cells) => cells.map(csvCell).join(',');
export const toCsv = (header, rows) => `${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}\r\n`;
