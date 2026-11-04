import mongoose from 'mongoose';

// Per user and minute: how many terminal commands ran and the spacing between them. Written with ONE atomic
// findOneAndUpdate (an update pipeline) per exec request, so every replica sees the same numbers.
export const ACTIVITY_TTL_SECONDS = 2 * 24 * 60 * 60;

const terminalActivitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Start of the UTC minute this document covers.
  bucket: { type: Date, required: true },
  // Commands executed in this minute (requests rejected by the 300 ms floor are not counted).
  count: { type: Number },
  // Gaps in ms between consecutive commands inside the minute: how many, their sum and the sum of squares.
  gapN: { type: Number },
  gapSum: { type: Number },
  gapSumSq: { type: Number },
  lastAt: { type: Date },
}, { versionKey: false });

terminalActivitySchema.index({ userId: 1, bucket: 1 }, { unique: true });
terminalActivitySchema.index({ bucket: 1 }, { expireAfterSeconds: ACTIVITY_TTL_SECONDS });

export default mongoose.model('TerminalActivity', terminalActivitySchema);
