import mongoose from 'mongoose';

const challengeSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  category: { type: String, required: true, enum: ['web', 'crypto', 'forensics', 'misc', 'pwn'] },
  difficulty: { type: String, required: true, enum: ['easy', 'medium', 'hard'] },
  points: { type: Number, required: true, min: 1 },
  type: { type: String, required: true, enum: ['static', 'docker'] },
  image: { type: String },
  internalPort: { type: Number, min: 1, max: 65535 },
  // Static challenges only. Never include these fields in any API response.
  flagHash: { type: String },
  flagSalt: { type: String },
  attachments: { type: [{ _id: false, name: String, url: String }], default: [] },
  visible: { type: Boolean, default: true },
  solveCount: { type: Number, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.model('Challenge', challengeSchema);
