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
  // Optional scheduled Arena event (services/eventPhase.js). Absent = no event. The phase is derived from these
  // timestamps and the clock on every request; nothing is stored about the current phase.
  event: {
    // No defaults here on purpose: upserts add defaults with $setOnInsert, which would conflict with $set/$unset of `event`.
    name: { type: String, maxlength: 80 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    freezeAt: { type: Date },
  },
  // Hint costs (services/hintCost.js): percentages of a level's base points. Absent = defaults. No defaults here either
  // (same $set/$unset reason as `event`); services/hintCost.js normalizeCosts fills them on read.
  hintCosts: {
    enabled: { type: Boolean },
    nudge: { type: Number, min: 0, max: 100 },
    approach: { type: Number, min: 0, max: 100 },
    walkthrough: { type: Number, min: 0, max: 100 },
    maxPercent: { type: Number, min: 0, max: 100 },
  },
  updatedBy: { type: String, default: '' },
}, { versionKey: false, timestamps: { createdAt: false, updatedAt: true } });

export default mongoose.model('AppSetting', appSettingSchema);
