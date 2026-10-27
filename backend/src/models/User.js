import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  cognitoSub: { type: String, required: true, unique: true },
  email: { type: String, required: true },
  displayName: {
    type: String,
    default: function () { return this.email?.split('@')[0]; },
  },
  role: { type: String, enum: ['player', 'admin'], required: true },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
}, { timestamps: true });

export default mongoose.model('User', userSchema);
