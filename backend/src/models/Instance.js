import mongoose from 'mongoose';

export const ACTIVE_STATUSES = ['starting', 'running', 'stopping'];

const instanceSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  challengeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Challenge', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  containerId: { type: String },
  port: { type: Number, required: true },
  status: { type: String, enum: ['starting', 'running', 'stopping', 'stopped', 'failed'], default: 'starting' },
  expiresAt: { type: Date, required: true },
  extended: { type: Boolean, default: false },
  stoppedAt: { type: Date },
}, { timestamps: { createdAt: true, updatedAt: false } });

const active = { status: { $in: ACTIVE_STATUSES } };
// Atomic port claim across replicas, and one live instance per team per challenge.
instanceSchema.index({ port: 1 }, { unique: true, partialFilterExpression: active });
instanceSchema.index({ teamId: 1, challengeId: 1 }, { unique: true, partialFilterExpression: active });
instanceSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.model('Instance', instanceSchema);
