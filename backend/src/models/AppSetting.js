import mongoose from 'mongoose';

// Platform settings: ONE document with key `platform` (services/adminSettings.js). Replicas read it on demand,
// nothing is cached in a process.
export const ANNOUNCEMENT_LEVELS = ['info', 'warning', 'critical'];

const appSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  registrationOpen: { type: Boolean, default: true },
  submissionsFrozen: { type: Boolean, default: false },
  announcement: {
    text: { type: String, default: '', maxlength: 500 },
    level: { type: String, enum: ANNOUNCEMENT_LEVELS, default: 'info' },
  },
  updatedBy: { type: String, default: '' },
}, { versionKey: false, timestamps: { createdAt: false, updatedAt: true } });

export default mongoose.model('AppSetting', appSettingSchema);
