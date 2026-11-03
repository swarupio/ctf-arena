import mongoose from 'mongoose';

const submissionSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  challengeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Challenge', required: true },
  correct: { type: Boolean, required: true },
  // SHA-256 only: raw wrong flags are never stored.
  submittedHash: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

submissionSchema.index({ teamId: 1, challengeId: 1, createdAt: -1 });
submissionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model('Submission', submissionSchema);
