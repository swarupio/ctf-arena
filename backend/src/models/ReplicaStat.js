import mongoose from 'mongoose';

// One document per backend replica (its hostname) with the number of /api requests it served.
// The source of truth lives here, not in process memory, so replicas stay stateless.
const replicaStatSchema = new mongoose.Schema({
  replica: { type: String, required: true, unique: true },
  requests: { type: Number, default: 0 },
}, { timestamps: { createdAt: false, updatedAt: true } });

// Replicas that have not served a request for 30 days (old container ids) drop off the dashboard.
replicaStatSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model('ReplicaStat', replicaStatSchema);
