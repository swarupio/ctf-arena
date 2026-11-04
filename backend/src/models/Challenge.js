import mongoose from 'mongoose';

export const TERMINAL_MODES = ['easy', 'medium', 'hard'];

// Terminal game codes only (docs/TERMINAL_GAME.md section 9): which mode and which code of that mode.
const terminalSchema = new mongoose.Schema({
  mode: { type: String, required: true, enum: TERMINAL_MODES },
  code: { type: Number, required: true, min: 1 },
}, { _id: false });

const challengeSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  category: { type: String, required: true, enum: ['web', 'crypto', 'forensics', 'misc', 'pwn', 'terminal'] },
  difficulty: { type: String, required: true, enum: ['easy', 'medium', 'hard'] },
  points: { type: Number, required: true, min: 1 },
  type: { type: String, required: true, enum: ['static', 'docker', 'terminal'] },
  image: { type: String },
  internalPort: { type: Number, min: 1, max: 65535 },
  // Static challenges only. Never include these fields in any API response.
  flagHash: { type: String },
  flagSalt: { type: String },
  // Terminal challenges only. Their flag is dynamic per team (like docker): nothing is stored.
  terminal: {
    type: terminalSchema,
    required: [function terminalRequired() { return this.type === 'terminal'; }, 'terminal is required for terminal challenges'],
  },
  attachments: { type: [{ _id: false, name: String, url: String }], default: [] },
  visible: { type: Boolean, default: true },
  solveCount: { type: Number, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });

challengeSchema.index({ type: 1, 'terminal.mode': 1 });

export default mongoose.model('Challenge', challengeSchema);
