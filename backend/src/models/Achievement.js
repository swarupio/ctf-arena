import mongoose from 'mongoose';

// Cosmetic badges (docs/ACHIEVEMENTS.md). One row per user and badge; they never affect points or ranking.
const achievementSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true },
  awardedAt: { type: Date, default: Date.now },
});

// Makes awarding idempotent across replicas: the second insert of the same badge is a no-op upsert.
achievementSchema.index({ userId: 1, key: 1 }, { unique: true });
// Newest-first reads for the public activity feed.
achievementSchema.index({ awardedAt: -1 });

export default mongoose.model('Achievement', achievementSchema);
