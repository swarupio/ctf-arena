import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 3, maxlength: 24 },
  inviteCode: { type: String, required: true, unique: true, match: /^[A-HJ-NP-Z2-9]{6}$/ },
  captainId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  memberIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    validate: { validator: (members) => members.length <= 3, message: 'Teams have at most 3 members.' },
  },
  banned: { type: Boolean, default: false },
}, { timestamps: { createdAt: true, updatedAt: false } });

teamSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export default mongoose.model('Team', teamSchema);
