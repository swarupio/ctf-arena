import mongoose from 'mongoose';

// Evidence for admins, never an automatic ban. One document per (subject, kind, detail): repeats only bump
// `count` and `lastAt`, so a scraper that hits a decoy 10,000 times still costs a single row.
export const SIGNAL_KINDS = Object.freeze([
  'honeypot-endpoint',
  'tainted-flag',
  'terminal-canary',
  'terminal-velocity',
  'terminal-cadence',
  'automation-ua',
]);

export const SIGNAL_TTL_SECONDS = 90 * 24 * 60 * 60;

const cheatSignalSchema = new mongoose.Schema({
  // A user id (24 hex) or `ip:<salted sha256>` for callers without a known account. Never a raw IP.
  subjectKey: { type: String, required: true },
  // Set for signals of a known user, null for anonymous (ip-keyed) ones.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  kind: { type: String, required: true, enum: SIGNAL_KINDS },
  severity: { type: Number, required: true, min: 1, max: 3 },
  // Short, bounded context (a decoy path, a user-agent family, the first 60 chars of a command). At most 120 chars.
  detail: { type: String, default: '', maxlength: 120 },
  count: { type: Number, default: 1 },
  firstAt: { type: Date, required: true },
  lastAt: { type: Date, required: true },
}, { versionKey: false });

cheatSignalSchema.index({ subjectKey: 1, kind: 1, detail: 1 }, { unique: true });
cheatSignalSchema.index({ userId: 1 });
// Active offenders keep refreshing `lastAt`; quiet ones disappear after 90 days.
cheatSignalSchema.index({ lastAt: 1 }, { expireAfterSeconds: SIGNAL_TTL_SECONDS });

export default mongoose.model('CheatSignal', cheatSignalSchema);
