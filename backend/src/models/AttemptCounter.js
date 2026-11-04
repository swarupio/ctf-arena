import mongoose from 'mongoose';

// Fixed-window attempt counters shared by all backend replicas (see services/attemptLimiter.js).
// One document per limiter key, for example "join:<cognito sub>". MongoDB removes the document once its window ended.
const attemptCounterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true },
}, { versionKey: false });

attemptCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('AttemptCounter', attemptCounterSchema);
