import mongoose from 'mongoose';

// One row per hint a team opened in OSINT Trail (docs/OSINT_TRAIL.md). Admin audit log, and the ledger of hint costs (the price is stored on each row).
const osintHintSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true }, // "<track>:<question number>", for example "easy:2"
  index: { type: Number, required: true, min: 0 },
  // Price fixed when the hint was opened (docs/HINTS.md 'Hint costs'): percent of the level's base charged by this open and the cap in force then. Absent on older rows.
  percent: { type: Number, min: 0 },
  capPercent: { type: Number, min: 0 },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

// Opening the same hint twice (double click, two replicas) writes one row.
osintHintSchema.index({ teamId: 1, key: 1, index: 1 }, { unique: true });
osintHintSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model('OsintHint', osintHintSchema);
