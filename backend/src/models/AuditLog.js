import mongoose from 'mongoose';

// Append-only record of every mutating admin action (docs/DATABASE_SCHEMA.md "auditlogs").
// Entries expire after one year (TTL on createdAt), so the collection stays bounded without a cron job.
export const AUDIT_TTL_SECONDS = 365 * 24 * 60 * 60;

const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorEmail: { type: String, required: true },
  // Dotted verb, for example `team.ban`, `solve.delete`, `settings.update`.
  action: { type: String, required: true },
  targetType: { type: String, required: true },
  targetId: { type: String, default: null },
  // Small, secret-free summaries (see services/adminAudit.js `summarize`): never flags, hashes, invite codes or container ids.
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  note: { type: String, default: '', maxlength: 500 },
  ip: { type: String, default: '' },
}, { versionKey: false, timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: AUDIT_TTL_SECONDS });

export default mongoose.model('AuditLog', auditLogSchema);
