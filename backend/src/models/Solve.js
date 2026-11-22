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
// Time-ordered reads: the activity feed (newest first, filters out adjustments on the index key), the frozen leaderboard
// ($match solvedAt <= freeze, then the $group by team) and the admin per-day series. The extra keys make the last two
// covered queries (no solve document is fetched). It replaces the older { solvedAt: 1 } index, which is now a prefix of
// this one: drop solvedAt_1 in Atlas once this index exists (docs/QUERY_PERFORMANCE.md).
solveSchema.index({ solvedAt: 1, adjustment: 1, teamId: 1, points: 1 });
// Covers teamScore and getTeamScore ($match teamId, then the sums): scanned from the index alone, without fetching solve
// documents. The unfiltered live leaderboard $group does NOT use it (MongoDB chooses a collection scan for a pipeline
// without a predicate; measured in docs/QUERY_PERFORMANCE.md), which is fine because that result is memoised for 5 s.
solveSchema.index({ teamId: 1, points: 1, solvedAt: 1, adjustment: 1 });

// Admin lists and per-user views: a player's solves newest first, and a challenge's solves in order (first-blood promotion).
solveSchema.index({ userId: 1, solvedAt: -1 });
solveSchema.index({ challengeId: 1, solvedAt: 1 });

export default mongoose.model('Solve', solveSchema);
