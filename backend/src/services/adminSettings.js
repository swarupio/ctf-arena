// Platform settings (registration, read-only mode, announcement banner): one MongoDB document, read on demand so every
// replica (and every serverless invocation) sees the same value.
import { z } from 'zod';
import AppSetting, { ANNOUNCEMENT_LEVELS } from '../models/AppSetting.js';
import { AppError } from '../utils/AppError.js';
import { dbOffline, iso } from './adminCommon.js';
import { EVENT_NAME_MAX, eventPhase, normalizeEvent, submissionBlock, validateSchedule } from './eventPhase.js';

const KEY = 'platform';
export const DEFAULT_SETTINGS = Object.freeze({
  registrationOpen: true,
  submissionsFrozen: false,
  announcement: Object.freeze({ text: '', level: 'info' }),
});

// An instant with an explicit zone (the admin page sends UTC ISO strings), within a sane range.
const instant = z.string().datetime({ offset: true }).transform((text) => new Date(text))
  .refine((date) => date.getUTCFullYear() >= 2000 && date.getUTCFullYear() <= 2100, { message: 'must be a date between 2000 and 2100' });

// The whole event is replaced at once (like the announcement); `null` clears it. Start and end are required together.
export const eventSchema = z.object({
  name: z.string().trim().max(EVENT_NAME_MAX).default(''),
  startsAt: instant,
  endsAt: instant,
  freezeAt: instant.nullable().default(null),
}).strict().superRefine((value, ctx) => {
  for (const [field, message] of Object.entries(validateSchedule(value))) {
    ctx.addIssue({ code: 'custom', path: [field], message });
  }
});

export const settingsBody = z.object({
  registrationOpen: z.boolean().optional(),
  submissionsFrozen: z.boolean().optional(),
  announcement: z.object({
    text: z.string().trim().max(500),
    level: z.enum(ANNOUNCEMENT_LEVELS).default('info'),
  }).strict().optional(),
  event: eventSchema.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'send at least one setting' });

// Admin view of the stored event: the schedule plus the phase right now. null when no usable event is stored.
export function eventSettingsView(raw, now = new Date()) {
  const event = normalizeEvent(raw);
  if (!event) { return null; }
  return {
    name: event.name,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    freezeAt: event.freezeAt ? event.freezeAt.toISOString() : null,
    phase: eventPhase(event, now),
  };
}

export function settingsView(doc, now = new Date()) {
  return {
    registrationOpen: doc?.registrationOpen ?? DEFAULT_SETTINGS.registrationOpen,
    submissionsFrozen: doc?.submissionsFrozen ?? DEFAULT_SETTINGS.submissionsFrozen,
    announcement: {
      text: doc?.announcement?.text ?? '',
      level: doc?.announcement?.level ?? 'info',
    },
    event: eventSettingsView(doc?.event, now),
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
  const update = { $set, $setOnInsert: { key: KEY } };
  if (patch.event) { $set.event = patch.event; }
  if (patch.event === null) { update.$unset = { event: 1 }; }
  const doc = await AppSetting.findOneAndUpdate(
    { key: KEY }, update, { upsert: true, new: true, runValidators: true },
  ).lean();
  return settingsView(doc);
}

// Public, tiny: only what the site needs to render the banner and the sign-up page.
export async function getPublicStatus() {
  const { announcement, registrationOpen, submissionsFrozen } = await getSettings();
  return { announcement, registrationOpen, submissionsFrozen };
}

// Bounded read of some platform fields. Without a live connection (unit tests, boot) it resolves null instead of
// letting Mongoose buffer for 10 s. `failOpen` (default) also resolves null on a read error or timeout; with
// failOpen: false errors propagate (used where failing open would expose data, e.g. the frozen scoreboard).
export const SETTINGS_TIMEOUT_MS = 2000;

async function readPlatform(fields, { failOpen = true } = {}) {
  if (dbOffline()) { return null; }
  if (!failOpen) { return AppSetting.findOne({ key: KEY }, fields).lean(); }
  let timer;
  const read = Promise.resolve(AppSetting.findOne({ key: KEY }, fields).lean()).catch(() => null);
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SETTINGS_TIMEOUT_MS); timer.unref?.(); });
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
}

// Bounded read that fails CLOSED: a read error or a timeout is a retryable 503 SETTINGS_UNAVAILABLE instead of null.
// Used by the submit guard, where "could not check the freeze/event state" must never mean "allowed".
async function readPlatformStrict(fields) {
  if (dbOffline()) { return null; }
  const unavailable = () => new AppError(503, 'SETTINGS_UNAVAILABLE', 'Submissions are temporarily unavailable because the platform settings could not be read. Please retry in a few seconds.');
  let timer;
  const read = Promise.resolve().then(() => AppSetting.findOne({ key: KEY }, fields).lean()).catch(() => { throw unavailable(); });
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(unavailable()), SETTINGS_TIMEOUT_MS); timer.unref?.(); });
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
}

// The configured event (normalised, Dates) or null when there is none. Read on demand, never cached in a process.
export async function getEventConfig({ failOpen = false } = {}) {
  const doc = await readPlatform('event', { failOpen });
  return normalizeEvent(doc?.event);
}

// Guard for the flag-submit routes: 423 SUBMISSIONS_FROZEN when an admin froze submissions, and, only when an event is
// configured, 423 EVENT_NOT_STARTED before the start and EVENT_ENDED after the end (live and frozen accept flags).
// All of those routes are player-only, so admins never reach this guard (their preview is unaffected).
// The read is bounded (SETTINGS_TIMEOUT_MS) and fails CLOSED: if the settings cannot be read in time (or the read
// errors) the submission is refused with a retryable 503 SETTINGS_UNAVAILABLE, so a settings outage can never be used
// to submit during a freeze or after the end. Without a live connection at all (unit tests, boot) there is no read.
export async function assertSubmissionsOpen({ now = new Date() } = {}) {
  const doc = await readPlatformStrict('submissionsFrozen event');
  if (doc?.submissionsFrozen) {
    throw new AppError(423, 'SUBMISSIONS_FROZEN', 'Submissions are frozen by the organisers.');
  }
  const block = doc?.event ? submissionBlock(doc.event, now) : null;
  if (block) { throw new AppError(423, block.code, block.message); }
}
