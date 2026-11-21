import mongoose from 'mongoose';

// One row per hint a team opened in OSINT Trail (docs/OSINT_TRAIL.md). Hints cost nothing; this is an admin audit log.
const osintHintSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true }, // "<track>:<question number>", for example "easy:2"
  index: { type: Number, required: true, min: 0 },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

// Opening the same hint twice (double click, two replicas) writes one row.
osintHintSchema.index({ teamId: 1, key: 1, index: 1 }, { unique: true });
osintHintSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model('OsintHint', osintHintSchema);
