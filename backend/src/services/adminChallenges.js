// Admin challenge operations beyond plain CRUD: duplicate, per-challenge stats, export and import of definitions.
// Exports and responses never contain flags, hashes or salts; terminal challenges are seeded, not exported or imported.
import { z } from 'zod';
import Challenge from '../models/Challenge.js';
import Solve from '../models/Solve.js';
import Submission from '../models/Submission.js';
import Team from '../models/Team.js';
import { AppError } from '../utils/AppError.js';
import { boolText, iso, listQuery, searchRegex } from './adminCommon.js';
import { CODE_DEFINED_TYPES, adminView, fields, importItemSchema, isCodeDefined } from './adminChallengeSchema.js';

export const challengesQuery = listQuery(['createdAt', 'title', 'points', 'solveCount'], 'createdAt', {
  category: z.enum(['web', 'crypto', 'forensics', 'misc', 'pwn', 'terminal']).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  type: z.enum(['static', 'docker', 'terminal']).optional(),
  visible: boolText.optional(),
});
export const visibilityBody = z.object({ visible: z.boolean() }).strict();
export const duplicateBody = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).optional(),
  title: z.string().trim().min(1).max(100).optional(),
}).strict();
export const resetBody = z.object({ confirm: z.literal(true), clearSubmissions: z.boolean().default(false) }).strict();
export const importBody = z.object({
  challenges: z.array(z.unknown()).min(1).max(100),
  mode: z.enum(['skip', 'update']).default('skip'),
  dryRun: z.boolean().default(false),
}).strict();

export function challengeFilter(query) {
  const filter = {};
  if (query.q) { filter.$or = [{ title: searchRegex(query.q) }, { slug: searchRegex(query.q) }]; }
  for (const key of ['category', 'difficulty', 'type']) { if (query[key]) { filter[key] = query[key]; } }
  if (query.visible !== undefined) { filter.visible = query.visible ? { $ne: false } : false; }
  return filter;
}

const conflictOnDuplicate = (error) => {
  if (error.code === 11000) { throw new AppError(409, 'CONFLICT', 'A challenge with this slug already exists.'); }
  throw error;
};

export async function setVisible(id, visible) {
  const before = await Challenge.findOneAndUpdate({ _id: id }, { $set: { visible } }, { new: false }).lean();
  if (!before) { throw new AppError(404, 'NOT_FOUND', 'Challenge not found.'); }
  return { id: String(before._id), slug: before.slug, before: before.visible !== false, visible };
}

export async function duplicateChallenge(id, { slug, title }) {
  const source = await Challenge.findById(id).lean();
  if (!source) { throw new AppError(404, 'NOT_FOUND', 'Challenge not found.'); }
  if (source.type === 'terminal' || isCodeDefined(source.type)) {
    throw new AppError(400, 'VALIDATION_ERROR', `type: ${source.type} challenges cannot be duplicated`);
  }
  const copy = {
    slug: slug ?? `${source.slug}-copy`,
    title: (title ?? `${source.title} (copy)`).slice(0, 100),
    description: source.description,
    category: source.category,
    difficulty: source.difficulty,
    points: source.points,
    type: source.type,
    image: source.image,
    internalPort: source.internalPort,
    // Static flag material is copied inside the database only; it is never part of a response.
    flagHash: source.flagHash,
    flagSalt: source.flagSalt,
    attachments: source.attachments ?? [],
    // A copy starts hidden so it can be reviewed before players see it.
    visible: false,
  };
  try {
    return adminView(await Challenge.create(copy));
  } catch (error) { return conflictOnDuplicate(error); }
}

export async function getChallengeStats(id) {
  const challenge = await Challenge.findById(id, 'slug title points type solveCount').lean();
  if (!challenge) { throw new AppError(404, 'NOT_FOUND', 'Challenge not found.'); }
  const [attempts, solves, first, teams] = await Promise.all([
    Submission.aggregate([
      { $match: { challengeId: challenge._id } },
      { $group: { _id: null, submissions: { $sum: 1 }, wrong: { $sum: { $cond: ['$correct', 0, 1] } }, teams: { $addToSet: '$teamId' } } },
    ]),
    Solve.countDocuments({ challengeId: challenge._id, adjustment: { $ne: true } }),
    Solve.findOne({ challengeId: challenge._id, firstBlood: true }, 'teamId solvedAt').lean(),
    Team.countDocuments({}),
  ]);
  const row = attempts[0] ?? { submissions: 0, wrong: 0, teams: [] };
  const firstTeam = first ? await Team.findById(first.teamId, 'name').lean() : null;
  return {
    id: String(challenge._id),
    slug: challenge.slug,
    title: challenge.title,
    type: challenge.type,
    // Submissions expire after 30 days, so attempt numbers cover that window; solves are permanent.
    solves,
    solveRate: teams === 0 ? 0 : Number((solves / teams).toFixed(4)),
    submissions: row.submissions,
    wrongSubmissions: row.wrong,
    correctSubmissions: row.submissions - row.wrong,
    wrongRate: row.submissions === 0 ? 0 : Number((row.wrong / row.submissions).toFixed(4)),
    teamsAttempted: row.teams.length,
    firstBlood: first ? { teamId: String(first.teamId), teamName: firstTeam?.name ?? null, at: iso(first.solvedAt) } : null,
  };
}

const EXPORT_FIELDS = ['slug', 'title', 'category', 'difficulty', 'points', 'description', 'type', 'image', 'internalPort', 'attachments', 'visible'];

export async function exportChallenges() {
  const docs = await Challenge.find({ type: { $nin: ['terminal', ...CODE_DEFINED_TYPES] } }).sort({ createdAt: 1 }).lean();
  const challenges = docs.map((doc) => {
    const out = {};
    for (const key of EXPORT_FIELDS) {
      if (doc[key] !== undefined && doc[key] !== null) { out[key] = key === 'attachments' ? doc[key].map(({ name, url }) => ({ name, url })) : doc[key]; }
    }
    return out;
  });
  return { version: 1, exportedAt: new Date().toISOString(), challenges };
}

function toUpdate(doc) {
  const $set = {};
  const $unset = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined) { $unset[key] = ''; } else { $set[key] = value; }
  }
  return { $set, ...(Object.keys($unset).length ? { $unset } : {}) };
}

// One bad item never blocks the others: every item reports `created`, `updated`, `skipped` or an error.
export async function importChallenges({ challenges, mode, dryRun }) {
  const result = { dryRun, created: [], updated: [], skipped: [], needsFlag: [], errors: [] };
  for (const [index, item] of challenges.entries()) {
    const parsed = importItemSchema.safeParse(item);
    if (!parsed.success) {
      result.errors.push({
        index,
        slug: typeof item?.slug === 'string' ? item.slug.slice(0, 80) : null,
        message: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'item'}: ${issue.message}`).join('; '),
      });
      continue;
    }
    const data = parsed.data;
    const existing = await Challenge.findOne({ slug: data.slug }, 'type flagHash').lean();
    try {
      if (existing) {
        if (mode === 'skip') { result.skipped.push(data.slug); continue; }
        if (existing.type === 'terminal' || isCodeDefined(existing.type)) {
          throw new AppError(400, 'VALIDATION_ERROR', `${existing.type} challenges cannot be imported`);
        }
        const noFlag = data.type === 'static' && !data.flag && !existing.flagHash;
        if (noFlag) { result.needsFlag.push(data.slug); }
        if (!dryRun) {
          await Challenge.findOneAndUpdate({ _id: existing._id }, toUpdate(fields(noFlag ? { ...data, visible: false } : data)), { runValidators: true });
        }
        result.updated.push(data.slug);
      } else {
        const noFlag = data.type === 'static' && !data.flag;
        if (noFlag) { result.needsFlag.push(data.slug); }
        if (!dryRun) { await Challenge.create(fields(noFlag ? { ...data, visible: false } : data)); }
        result.created.push(data.slug);
      }
    } catch (error) {
      result.errors.push({ index, slug: data.slug, message: error instanceof AppError ? error.message : 'could not be saved' });
    }
  }
  return result;
}
