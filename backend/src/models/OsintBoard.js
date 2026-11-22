import mongoose from 'mongoose';

// The shared case board of OSINT Trail (docs/OSINT_TRAIL.md "Case board"): one document per (team, case). Pins and links
// hold only evidence ids, relation types and board coordinates; `version` is the optimistic-concurrency counter and
// `unlocked` is set (and never cleared) when the links contained the whole hidden chain at save time.
const pinSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 70 }, // "<source>:<id>", for example "feed:p012"
  x: { type: Number, required: true, min: 0, max: 1000 },
  y: { type: Number, required: true, min: 0, max: 1000 },
}, { _id: false });

const linkSchema = new mongoose.Schema({
  a: { type: String, required: true, maxlength: 70 },
  b: { type: String, required: true, maxlength: 70 },
  rel: { type: String, required: true, maxlength: 12 },
}, { _id: false });

const osintBoardSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  track: { type: String, required: true, maxlength: 20 },
  version: { type: Number, required: true, default: 0, min: 0 },
  pins: { type: [pinSchema], default: [] },
  links: { type: [linkSchema], default: [] },
  unlocked: { type: Boolean, default: false },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

// One board per team and case. The same index makes a racing first save lose with a duplicate key, which is a 409.
osintBoardSchema.index({ teamId: 1, track: 1 }, { unique: true });

export default mongoose.model('OsintBoard', osintBoardSchema);
