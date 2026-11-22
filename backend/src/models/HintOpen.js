import mongoose from 'mongoose';

// Ledger of hints a team opened, for the categories that charge through it (docs/HINTS.md "Hint costs"). `scope` is the
// category id ('weblab', 'forensics', 'terminal'), `key` the level within it. Cipher Lab, Crackme and OSINT keep their own
// older collections (CipherHint, CrackmeHint, OsintHint), which services/hintLedger.js reads too.
const hintOpenSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  scope: { type: String, required: true },
  key: { type: String, required: true },
  index: { type: Number, required: true, min: 0 },
  // Price fixed when the hint was opened (docs/HINTS.md 'Hint costs'): percent of the level's base charged by this open and the cap in force then. Absent on older rows.
  percent: { type: Number, min: 0 },
  capPercent: { type: Number, min: 0 },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

// One row per (team, hint): a repeated open (double click, two replicas) never costs twice.
hintOpenSchema.index({ teamId: 1, scope: 1, key: 1, index: 1 }, { unique: true });
hintOpenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

export default mongoose.model('HintOpen', hintOpenSchema);
