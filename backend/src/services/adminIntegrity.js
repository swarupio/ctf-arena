// Fair-play review for the admin dashboard: filtered, paginated list on top of integrityService.listRisk, summary
// counts, and resolve (dismiss with a note, recorded in the audit log). Evidence only: nothing here bans anyone.
import { z } from 'zod';
import CheatSignal from '../models/CheatSignal.js';
import { AppError } from '../utils/AppError.js';
import { envelope, iso, listQuery, paginate } from './adminCommon.js';
import { SEVERITY, integrityService } from './integrityService.js';

const SIGNAL_KINDS = Object.keys(SEVERITY);

export const HIGH_RISK = 10;
const REVIEW_SCAN = 200;

export const reviewQuery = listQuery(['risk', 'lastSignalAt'], '-risk', {
  kind: z.enum(SIGNAL_KINDS).optional(),
  minRisk: z.coerce.number().int().min(0).max(1000).optional(),
});
export const resolveBody = z.object({
  note: z.string().trim().min(3).max(500),
}).strict();

// `q` matches display name or team name. `kind` keeps users with at least one signal of that kind.
export async function reviewUsers(query) {
  const entries = await integrityService.listRisk({ limit: REVIEW_SCAN });
  const needle = query.q?.toLowerCase();
  let rows = entries.map((entry) => ({
    ...entry,
    lastSignalAt: iso(entry.signals.reduce((latest, signal) => (new Date(signal.lastAt) > latest ? new Date(signal.lastAt) : latest), new Date(0))),
  }));
  if (needle) {
    rows = rows.filter((row) => row.displayName.toLowerCase().includes(needle) || (row.teamName ?? '').toLowerCase().includes(needle));
  }
  if (query.kind) { rows = rows.filter((row) => row.signals.some((signal) => signal.kind === query.kind)); }
  if (query.minRisk !== undefined) { rows = rows.filter((row) => row.risk >= query.minRisk); }
  const field = query.sort.replace(/^-/, '');
  const direction = query.sort.startsWith('-') ? -1 : 1;
  rows.sort((a, b) => ((a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * direction) || String(a.userId).localeCompare(String(b.userId)));
  return envelope(paginate(rows, query), query, rows.length);
}

export async function integritySummary({ now = new Date() } = {}) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [kinds, users, recent] = await Promise.all([
    CheatSignal.aggregate([
      { $group: { _id: '$kind', rows: { $sum: 1 }, events: { $sum: '$count' }, lastAt: { $max: '$lastAt' } } },
    ]),
    CheatSignal.aggregate([{ $match: { userId: { $ne: null } } }, { $group: { _id: '$userId' } }, { $count: 'users' }]),
    CheatSignal.countDocuments({ lastAt: { $gte: since } }),
  ]);
  const byKind = new Map(kinds.map((row) => [row._id, row]));
  return {
    flaggedUsers: users[0]?.users ?? 0,
    signalRows: kinds.reduce((sum, row) => sum + row.rows, 0),
    signalEvents: kinds.reduce((sum, row) => sum + row.events, 0),
    activeLast24h: recent,
    highRiskThreshold: HIGH_RISK,
    byKind: SIGNAL_KINDS.map((kind) => ({
      kind, rows: byKind.get(kind)?.rows ?? 0, events: byKind.get(kind)?.events ?? 0, lastAt: iso(byKind.get(kind)?.lastAt),
    })),
  };
}

// Resolve = dismiss this user's signals; the returned summary (kinds and counts only) goes into the audit entry.
export async function resolveUser(userId) {
  const rows = await CheatSignal.find({ subjectKey: String(userId).toLowerCase() }, 'kind severity count').lean();
  if (rows.length === 0) { throw new AppError(404, 'NOT_FOUND', 'No open signals for this user.'); }
  await integrityService.dismiss(userId);
  const kinds = {};
  for (const row of rows) { kinds[row.kind] = (kinds[row.kind] ?? 0) + row.count; }
  return { signals: rows.length, events: rows.reduce((sum, row) => sum + row.count, 0), kinds };
}
