// Challenge definition schemas shared by the admin routes (create, update, import). Moved out of
// routes/admin/challenges.js unchanged so the import endpoint validates exactly like POST /admin/challenges.
import { z } from 'zod';
import { AppError } from '../utils/AppError.js';
import { hashStaticFlag } from './flagService.js';

export const base = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase letters, digits and dashes'),
  title: z.string().trim().min(1).max(100),
  category: z.enum(['web', 'crypto', 'forensics', 'misc', 'pwn', 'terminal']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  points: z.number().int().min(1).max(10000),
  description: z.string().max(20000).default(''),
  // 'terminal' is only accepted when updating an existing terminal challenge (see notCreatable below).
  type: z.enum(['static', 'docker', 'terminal']),
  // Only images from our own ctf/ namespace may ever be started.
  image: z.string().trim().regex(/^ctf\/[a-z0-9][a-z0-9._-]*(?::[A-Za-z0-9._-]+)?$/).optional(),
  internalPort: z.number().int().min(1).max(65535).optional(),
  flag: z.string().trim().min(1).max(200).optional(),
  attachments: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    // Rendered as a link for players: only same-site paths and http(s) URLs, never javascript:, data: or //host.
    url: z.string().trim().min(1).max(500).regex(/^(?:\/(?!\/)|https?:\/\/)[^\s\u0000-\u001f\u007f]*$/, 'must be a /path or an http(s) URL'),
  }).strict()).max(10).default([]),
  visible: z.boolean().default(true),
}).strict();

export const dockerNeedsImage = (value, context) => {
  if (value.type === 'docker' && (!value.image || !value.internalPort)) {
    context.addIssue({ code: 'custom', path: ['image'], message: 'docker challenges need image and internalPort' });
  }
};
// Terminal challenges are created by `npm run seed:terminal`, never through this API.
export const notCreatable = (value, context) => {
  if (value.type === 'terminal' || value.category === 'terminal') {
    context.addIssue({ code: 'custom', path: ['type'], message: 'terminal challenges are created by npm run seed:terminal' });
  }
};
// Existing terminal challenges may be edited (points, visible, ...): category and type go together and
// there is no stored flag (it is derived per team).
export const terminalRules = (value, context) => {
  if ((value.type === 'terminal') !== (value.category === 'terminal')) {
    context.addIssue({ code: 'custom', path: ['category'], message: 'terminal challenges use category terminal and type terminal' });
  }
  if (value.type === 'terminal' && value.flag) {
    context.addIssue({ code: 'custom', path: ['flag'], message: 'terminal challenges have no stored flag' });
  }
};
export const createSchema = base.superRefine(notCreatable).superRefine(dockerNeedsImage).superRefine((value, context) => {
  if (value.type === 'static' && !value.flag) {
    context.addIssue({ code: 'custom', path: ['flag'], message: 'static challenges need a flag' });
  }
});
// PUT may omit the flag to keep the stored hash.
export const updateSchema = base.superRefine(terminalRules).superRefine(dockerNeedsImage);
// Import: like create, but a static challenge may come without a flag (exports never contain one).
export const importItemSchema = base.superRefine(notCreatable).superRefine(dockerNeedsImage);

// Game challenges (type 'game', for example Cipher Lab levels) define their own points, flags and mechanics in code.
// An admin may only change what players read or whether it is listed: title, description and visible. The other
// definition fields may be echoed back unchanged (a form that sends the whole object still works); a different
// value, a flag or any unknown key is rejected, and so is an empty update.
const GAME_EDITABLE = ['title', 'description', 'visible'];
const GAME_ECHO = ['slug', 'category', 'difficulty', 'points', 'type', 'image', 'internalPort', 'attachments'];
export const gameUpdateSchema = z.object({
  title: base.shape.title.optional(),
  description: z.string().max(20000).optional(),
  visible: z.boolean().optional(),
  ...Object.fromEntries(GAME_ECHO.map((key) => [key, z.unknown().optional()])),
}).strict().superRefine((value, context) => {
  if (!GAME_EDITABLE.some((key) => value[key] !== undefined)) {
    context.addIssue({ code: 'custom', path: [], message: 'send at least one of title, description, visible' });
  }
});

// Returns the $set for a game challenge, or throws 400 naming the field that may not change.
export function gameChanges(existing, input) {
  const stored = (key) => (key === 'attachments'
    ? (existing.attachments ?? []).map(({ name, url }) => ({ name, url }))
    : existing[key]);
  for (const key of GAME_ECHO) {
    // null (as adminView prints a missing image or port) means the same as absent.
    if (input[key] === undefined || (input[key] === null && (stored(key) ?? null) === null)) { continue; }
    if (JSON.stringify(input[key]) !== JSON.stringify(stored(key) ?? undefined)) {
      throw new AppError(400, 'VALIDATION_ERROR', `${key}: cannot be changed for game challenges (only title, description and visible)`);
    }
  }
  return Object.fromEntries(GAME_EDITABLE.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

// Admin responses also omit flag material: nothing ever echoes a flag or hash back.
export function adminView(challenge) {
  return {
    id: String(challenge._id),
    slug: challenge.slug,
    title: challenge.title,
    category: challenge.category,
    difficulty: challenge.difficulty,
    points: challenge.points,
    description: challenge.description,
    type: challenge.type,
    image: challenge.image ?? null,
    internalPort: challenge.internalPort ?? null,
    hasFlag: Boolean(challenge.flagHash),
    terminal: challenge.terminal ? { mode: challenge.terminal.mode, code: challenge.terminal.code } : null,
    attachments: (challenge.attachments ?? []).map(({ name, url }) => ({ name, url })),
    visible: challenge.visible,
    solveCount: challenge.solveCount ?? 0,
    createdAt: challenge.createdAt,
  };
}

export function fields(data) {
  const { flag, ...rest } = data;
  const doc = { ...rest };
  if (data.type === 'static') {
    doc.image = undefined;
    doc.internalPort = undefined;
    if (flag) { Object.assign(doc, hashStaticFlag(flag)); }
  } else {
    // Docker and terminal flags are generated per team; never store a shared one.
    doc.flagHash = undefined;
    doc.flagSalt = undefined;
    if (data.type === 'terminal') {
      doc.image = undefined;
      doc.internalPort = undefined;
    }
  }
  return doc;
}
