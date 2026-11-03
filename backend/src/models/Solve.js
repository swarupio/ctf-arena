import mongoose from 'mongoose';

const solveSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  challengeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Challenge', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  points: { type: Number, required: true },
  firstBlood: { type: Boolean, default: false },
  solvedAt: { type: Date, default: Date.now },
});

// Blocks double solves, including double clicks handled by different replicas.
solveSchema.index({ teamId: 1, challengeId: 1 }, { unique: true });
solveSchema.index({ solvedAt: 1 });

export default mongoose.model('Solve', solveSchema);
