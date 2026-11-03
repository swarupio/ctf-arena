import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import Challenge from '../../models/Challenge.js';
import { AppError } from '../../utils/AppError.js';
import { hashStaticFlag } from '../../services/flagService.js';
import { instanceService } from '../../services/instanceService.js';
import { objectId, validate } from '../challenges.js';

const router = Router();

const base = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase letters, digits and dashes'),
  title: z.string().trim().min(1).max(100),
  category: z.enum(['web', 'crypto', 'forensics', 'misc', 'pwn']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  points: z.number().int().min(1).max(10000),
  description: z.string().max(20000).default(''),
  type: z.enum(['static', 'docker']),
  // Only images from our own ctf/ namespace may ever be started.
  image: z.string().trim().regex(/^ctf\/[a-z0-9][a-z0-9._-]*(?::[A-Za-z0-9._-]+)?$/).optional(),
  internalPort: z.number().int().min(1).max(65535).optional(),
  flag: z.string().trim().min(1).max(200).optional(),
  attachments: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    url: z.string().trim().min(1).max(500),
  }).strict()).max(10).default([]),
  visible: z.boolean().default(true),
}).strict();

const dockerNeedsImage = (value, context) => {
  if (value.type === 'docker' && (!value.image || !value.internalPort)) {
    context.addIssue({ code: 'custom', path: ['image'], message: 'docker challenges need image and internalPort' });
  }
};
const createSchema = base.superRefine(dockerNeedsImage).superRefine((value, context) => {
  if (value.type === 'static' && !value.flag) {
    context.addIssue({ code: 'custom', path: ['flag'], message: 'static challenges need a flag' });
  }
});
// PUT may omit the flag to keep the stored hash.
const updateSchema = base.superRefine(dockerNeedsImage);

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
    attachments: (challenge.attachments ?? []).map(({ name, url }) => ({ name, url })),
    visible: challenge.visible,
    solveCount: challenge.solveCount ?? 0,
    createdAt: challenge.createdAt,
  };
}

function fields(data) {
  const { flag, ...rest } = data;
  const doc = { ...rest };
  if (data.type === 'docker') {
    // Docker flags are generated per team; never store a shared one.
    doc.flagHash = undefined;
    doc.flagSalt = undefined;
  } else {
    doc.image = undefined;
    doc.internalPort = undefined;
    if (flag) { Object.assign(doc, hashStaticFlag(flag)); }
  }
  return doc;
}

function conflictOnDuplicate(error) {
  if (error.code === 11000) { throw new AppError(409, 'CONFLICT', 'A challenge with this slug already exists.'); }
  throw error;
}

router.use(auth, requireRole('admin'));

router.get('/', async (req, res) => {
  const challenges = await Challenge.find({}).sort({ createdAt: 1 });
  res.json(challenges.map(adminView));
});

router.post('/', async (req, res) => {
  const data = validate(createSchema, req.body);
  try {
    const challenge = await Challenge.create(fields(data));
    res.status(201).json(adminView(challenge));
  } catch (error) { conflictOnDuplicate(error); }
});

router.put('/:id', async (req, res) => {
  const id = objectId(req.params.id);
  const data = validate(updateSchema, req.body);
  const existing = await Challenge.findById(id);
  if (!existing) { throw new AppError(404, 'NOT_FOUND', 'Challenge not found.'); }
  if (data.type === 'static' && !data.flag && !existing.flagHash) {
    throw new AppError(400, 'VALIDATION_ERROR', 'flag: static challenges need a flag');
  }
  const doc = fields(data);
  const $set = {};
  const $unset = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined) { $unset[key] = ''; } else { $set[key] = value; }
  }
  try {
    const challenge = await Challenge.findOneAndUpdate(
      { _id: id }, { $set, ...(Object.keys($unset).length ? { $unset } : {}) },
      { new: true, runValidators: true },
    );
    res.json(adminView(challenge));
  } catch (error) { conflictOnDuplicate(error); }
});

router.delete('/:id', async (req, res) => {
  const id = objectId(req.params.id);
  const challenge = await Challenge.findById(id);
  if (!challenge) { throw new AppError(404, 'NOT_FOUND', 'Challenge not found.'); }
  await instanceService.stopChallengeInstances(challenge._id);
  await Challenge.deleteOne({ _id: challenge._id });
  res.sendStatus(204);
});

export default router;
