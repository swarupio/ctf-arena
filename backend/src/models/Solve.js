import mongoose from 'mongoose';

const solveSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  challengeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Challenge', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  points: { type: Number, required: true },
  firstBlood: { type: Boolean, default: false },
  solvedAt: { type: Date, default: Date.now },
  // Manual score adjustment by an admin: a Solve-like row (random challengeId, signed points) that the leaderboard sums.
  adjustment: { type: Boolean, default: false },
  reason: { type: String, maxlength: 200 },
});

// Blocks double solves, including double clicks handled by different replicas.
solveSchema.index({ teamId: 1, challengeId: 1 }, { unique: true });
solveSchema.index({ solvedAt: 1 });
// Covers the leaderboard $group (points, solves counter, lastSolveAt) and teamScore: scanned from the index alone, without fetching solve documents.
solveSchema.index({ teamId: 1, points: 1, solvedAt: 1, adjustment: 1 });

export default mongoose.model('Solve', solveSchema);
