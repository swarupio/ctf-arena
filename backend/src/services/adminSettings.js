// Platform settings (registration, read-only mode, announcement banner): one MongoDB document, read on demand so every
// replica (and every serverless invocation) sees the same value.
import { z } from 'zod';
import AppSetting, { ANNOUNCEMENT_LEVELS } from '../models/AppSetting.js';
import { AppError } from '../utils/AppError.js';
import { dbOffline, iso } from './adminCommon.js';

const KEY = 'platform';
export const DEFAULT_SETTINGS = Object.freeze({
  registrationOpen: true,
  submissionsFrozen: false,
  announcement: Object.freeze({ text: '', level: 'info' }),
});

export const settingsBody = z.object({
  registrationOpen: z.boolean().optional(),
  submissionsFrozen: z.boolean().optional(),
  announcement: z.object({
    text: z.string().trim().max(500),
    level: z.enum(ANNOUNCEMENT_LEVELS).default('info'),
  }).strict().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'send at least one setting' });

export function settingsView(doc) {
  return {
    registrationOpen: doc?.registrationOpen ?? DEFAULT_SETTINGS.registrationOpen,
    submissionsFrozen: doc?.submissionsFrozen ?? DEFAULT_SETTINGS.submissionsFrozen,
    announcement: {
      text: doc?.announcement?.text ?? '',
      level: doc?.announcement?.level ?? 'info',
    },
    updatedAt: iso(doc?.updatedAt),
  };
}

export async function getSettings() {
  return settingsView(await AppSetting.findOne({ key: KEY }).lean());
}

export async function updateSettings(patch, actorEmail) {
  const $set = { updatedBy: actorEmail };
  if (patch.registrationOpen !== undefined) { $set.registrationOpen = patch.registrationOpen; }
  if (patch.submissionsFrozen !== undefined) { $set.submissionsFrozen = patch.submissionsFrozen; }
  if (patch.announcement) { $set.announcement = patch.announcement; }
  const doc = await AppSetting.findOneAndUpdate(
    { key: KEY }, { $set, $setOnInsert: { key: KEY } }, { upsert: true, new: true, runValidators: true },
  ).lean();
  return settingsView(doc);
}

// Public, tiny: only what the site needs to render the banner and the sign-up page.
export async function getPublicStatus() {
  const { announcement, registrationOpen, submissionsFrozen } = await getSettings();
  return { announcement, registrationOpen, submissionsFrozen };
}

// Guard for the flag-submit routes. Without a live connection (unit tests, boot) it allows the request instead of
// letting Mongoose buffer for 10 s; with one, a frozen platform answers 423 SUBMISSIONS_FROZEN.
// The read is bounded (SETTINGS_TIMEOUT_MS) and fails open: if the settings cannot be read in time the submission
// continues, and the rest of the request needs the same database anyway.
export const SETTINGS_TIMEOUT_MS = 2000;

export async function assertSubmissionsOpen() {
  if (dbOffline()) { return; }
  let timer;
  const read = Promise.resolve(AppSetting.findOne({ key: KEY }, 'submissionsFrozen').lean()).catch(() => null);
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SETTINGS_TIMEOUT_MS); timer.unref?.(); });
  const doc = await Promise.race([read, timeout]).finally(() => clearTimeout(timer));
  if (doc?.submissionsFrozen) {
    throw new AppError(423, 'SUBMISSIONS_FROZEN', 'Submissions are frozen by the organisers.');
  }
}
