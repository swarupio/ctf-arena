import mongoose from 'mongoose';

// One row per hint a team opened in Crackme Arcade (docs/CRACKME_ARCADE.md). Hints cost nothing; this is an admin audit log.
const crackmeHintSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  levelId: { type: String, required: true },
  index: { type: Number, required: true, min: 0 },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

// Opening the same hint twice (double click, two replicas) writes one row.
crackmeHintSchema.index({ teamId: 1, levelId: 1, index: 1 }, { unique: true });
crackmeHintSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model('CrackmeHint', crackmeHintSchema);
