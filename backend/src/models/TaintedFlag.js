import mongoose from 'mongoose';

// Decoy flags handed out by honeypots and canary replies. Only the SHA-256 is stored (like submissions), so a
// database dump reveals nothing. A wrong submission whose hash is found here proves the flag was copied.
export const TAINT_TTL_SECONDS = 90 * 24 * 60 * 60;

const taintedFlagSchema = new mongoose.Schema({
  hash: { type: String, required: true },
  // Who the decoy was issued to: a user id or `ip:<salted sha256>`.
  subjectKey: { type: String, required: true },
  slug: { type: String, required: true },
  issuedAt: { type: Date, required: true },
}, { versionKey: false });

taintedFlagSchema.index({ hash: 1 }, { unique: true });
taintedFlagSchema.index({ issuedAt: 1 }, { expireAfterSeconds: TAINT_TTL_SECONDS });

export default mongoose.model('TaintedFlag', taintedFlagSchema);
