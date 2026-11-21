// Audit trail of admin actions. Every mutating admin route calls `recordAudit` after it succeeded; the entry says who
// (actor id + email), what (action), on what (target), a before/after summary, an optional note and the caller's address.
import { z } from 'zod';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import {
  dateText, dbOffline, envelope, idOf, idString, iso, listQuery, searchRegex, skipOf, sortSpec,
} from './adminCommon.js';

// Keys that must never be stored, whatever a caller passes.
const SECRET_KEY = /flag|hash|salt|secret|token|password|inviteCode|containerId/i;
const MAX_TEXT = 200;
const MAX_KEYS = 20;

// Reduces a value to a small JSON-safe summary: primitives, short strings, a little nesting, no secret keys.
export function summarize(value, depth = 0) {
  if (value === null || value === undefined) { return null; }
  if (typeof value === 'string') { return value.slice(0, MAX_TEXT); }
  if (typeof value === 'number' || typeof value === 'boolean') { return value; }
  if (value instanceof Date) { return value.toISOString(); }
  if (Array.isArray(value)) {
    return depth > 1 ? `[${value.length} items]` : value.slice(0, MAX_KEYS).map((item) => summarize(item, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth > 1) { return '[object]'; }
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_KEYS)) {
      if (!SECRET_KEY.test(key)) { out[key] = summarize(item, depth + 1); }
    }
    return out;
  }
  return null;
}

// Raw address of the admin (staff only, unlike players: see docs/FAIR_PLAY.md for the player privacy rules).
function addressOf(req) {
  const forwarded = req.get?.('x-forwarded-for');
  if (typeof forwarded === 'string' && forwarded.trim()) { return forwarded.slice(0, 400).split(',').at(-1).trim(); }
  return req.socket?.remoteAddress ?? '';
}

// The admin's own User row (created by GET /api/me). Cached on the request only.
export async function actorOf(req) {
  if (req.adminActor === undefined) {
    req.adminActor = await User.findOne({ cognitoSub: req.user.cognitoSub }, '_id').lean();
  }
  return req.adminActor;
}

export async function actorIdOrFail(req) {
  const actor = await actorOf(req);
  if (!actor) { throw new AppError(409, 'ACTOR_NOT_FOUND', 'Open the app once with this admin account first (GET /api/me).'); }
  return actor._id;
}

export async function recordAudit(req, {
  action, targetType, targetId = null, before = null, after = null, note = '',
}) {
  if (dbOffline()) { return; }
  const actor = await actorOf(req);
  await AuditLog.create({
    actorId: actor?._id ?? null,
    actorEmail: req.user.email,
    action,
    targetType,
    targetId: targetId === null ? null : String(targetId),
    before: summarize(before),
    after: summarize(after),
    note: String(note ?? '').slice(0, 500),
    ip: addressOf(req),
  });
}

export const auditQuery = listQuery(['createdAt'], '-createdAt', {
  action: z.string().trim().min(1).max(60).optional(),
  actorId: idString.optional(),
  targetType: z.string().trim().min(1).max(40).optional(),
  targetId: z.string().trim().min(1).max(60).optional(),
  from: dateText.optional(),
  to: dateText.optional(),
});

export const auditView = (entry) => ({
  id: String(entry._id),
  createdAt: iso(entry.createdAt),
  actor: { id: idOf(entry.actorId), email: entry.actorEmail },
  action: entry.action,
  targetType: entry.targetType,
  targetId: entry.targetId ?? null,
  before: entry.before ?? null,
  after: entry.after ?? null,
  note: entry.note ?? '',
  ip: entry.ip ?? '',
});

export async function listAudit(query) {
  const filter = {};
  if (query.action) { filter.action = query.action; }
  if (query.actorId) { filter.actorId = query.actorId; }
  if (query.targetType) { filter.targetType = query.targetType; }
  if (query.targetId) { filter.targetId = query.targetId; }
  if (query.q) { filter.$or = [{ actorEmail: searchRegex(query.q) }, { action: searchRegex(query.q) }, { note: searchRegex(query.q) }]; }
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) { filter.createdAt.$gte = query.from; }
    if (query.to) { filter.createdAt.$lte = query.to; }
  }
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort(sortSpec(query.sort)).skip(skipOf(query)).limit(query.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return envelope(rows.map(auditView), query, total);
}
