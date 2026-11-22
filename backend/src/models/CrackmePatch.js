import mongoose from 'mongoose';

// One row per cabinet whose Patch Bay a team has beaten (docs/CRACKME_ARCADE.md). Purely cosmetic: a badge, no points.
const crackmePatchSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  levelId: { type: String, required: true },
  edits: { type: Number, required: true, min: 1 },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

// A team earns each badge once, even with two replicas or a double click.
crackmePatchSchema.index({ teamId: 1, levelId: 1 }, { unique: true });

export default mongoose.model('CrackmePatch', crackmePatchSchema);
