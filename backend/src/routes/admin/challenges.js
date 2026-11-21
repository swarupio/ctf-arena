import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import Challenge from '../../models/Challenge.js';
import { AppError } from '../../utils/AppError.js';
import { recordAudit } from '../../services/adminAudit.js';
import {
  adminView, createSchema, fields, updateSchema,
} from '../../services/adminChallengeSchema.js';
import {
  challengeFilter, challengesQuery, duplicateBody, exportChallenges, getChallengeStats, importBody, importChallenges,
  resetBody, setVisible, visibilityBody, duplicateChallenge,
} from '../../services/adminChallenges.js';
import { envelope, isPaged, skipOf, sortSpec } from '../../services/adminCommon.js';
import { resetChallengeSolves } from '../../services/adminSolves.js';
import { instanceService } from '../../services/instanceService.js';
import { objectId, validate } from '../challenges.js';

export { adminView };

const router = Router();

function conflictOnDuplicate(error) {
  if (error.code === 11000) { throw new AppError(409, 'CONFLICT', 'A challenge with this slug already exists.'); }
  throw error;
}

router.use(auth, requireRole('admin'));

// Without query parameters: the legacy bare array (oldest first). With any of page, limit, q, sort, category,
// difficulty, type, visible: the paginated envelope.
router.get('/', async (req, res) => {
  const query = isPaged(req.query) ? validate(challengesQuery, req.query) : null;
  if (!query) {
    const challenges = await Challenge.find({}).sort({ createdAt: 1 });
    return res.json(challenges.map(adminView));
  }
  const filter = challengeFilter(query);
  const [rows, total] = await Promise.all([
    Challenge.find(filter).sort(sortSpec(query.sort)).skip(skipOf(query)).limit(query.limit).lean(),
    Challenge.countDocuments(filter),
  ]);
  return res.json(envelope(rows.map(adminView), query, total));
});

// Definitions without flags, flag hashes or salts, ready for POST /admin/challenges/import. Terminal challenges are
// seeded by npm run seed:terminal and are not part of the file.
router.get('/export', async (req, res) => {
  res.set('Content-Disposition', 'attachment; filename="challenges.json"');
  res.json(await exportChallenges());
});

router.post('/import', async (req, res) => {
  const body = validate(importBody, req.body);
  const result = await importChallenges(body);
  if (!body.dryRun) {
    await recordAudit(req, {
      action: 'challenge.import', targetType: 'challenge',
      after: { created: result.created.length, updated: result.updated.length, skipped: result.skipped.length, errors: result.errors.length },
      note: body.mode,
    });
  }
  res.json(result);
});

router.post('/', async (req, res) => {
  const data = validate(createSchema, req.body);
  try {
    const challenge = await Challenge.create(fields(data));
    await recordAudit(req, { action: 'challenge.create', targetType: 'challenge', targetId: challenge._id, after: adminView(challenge) });
    res.status(201).json(adminView(challenge));
  } catch (error) { conflictOnDuplicate(error); }
});

router.put('/:id', async (req, res) => {
  const id = objectId(req.params.id);
  const data = validate(updateSchema, req.body);
  const existing = await Challenge.findById(id);
  if (!existing) { throw new AppError(404, 'NOT_FOUND', 'Challenge not found.'); }
  // A terminal challenge is tied to its mode, code and slug (its flag derives from the slug): those stay fixed.
  const wasTerminal = existing.type === 'terminal';
  if (wasTerminal !== (data.type === 'terminal')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'type: a challenge cannot be converted to or from a terminal challenge');
  }
  if (wasTerminal && data.slug !== existing.slug) {
    throw new AppError(400, 'VALIDATION_ERROR', 'slug: cannot be changed for terminal challenges');
  }
  if (data.type === 'static' && !data.flag && !existing.flagHash) {
    throw new AppError(400, 'VALIDATION_ERROR', 'flag: static challenges need a flag');
  }
  const before = adminView(existing);
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
    await recordAudit(req, {
      action: 'challenge.update', targetType: 'challenge', targetId: id, before, after: adminView(challenge),
      note: data.flag ? 'flag replaced' : '',
    });
    res.json(adminView(challenge));
  } catch (error) { conflictOnDuplicate(error); }
});

// Publish / hide: hidden challenges disappear from players' lists and are rejected on submit.
router.patch('/:id/visibility', async (req, res) => {
  const id = objectId(req.params.id);
  const { visible } = validate(visibilityBody, req.body);
  const result = await setVisible(id, visible);
  await recordAudit(req, {
    action: visible ? 'challenge.publish' : 'challenge.hide', targetType: 'challenge', targetId: id,
    before: { visible: result.before }, after: { visible },
  });
  res.json({ id: result.id, slug: result.slug, visible });
});

router.post('/:id/duplicate', async (req, res) => {
  const id = objectId(req.params.id);
  const body = validate(duplicateBody, req.body ?? {});
  const copy = await duplicateChallenge(id, body);
  await recordAudit(req, { action: 'challenge.duplicate', targetType: 'challenge', targetId: copy.id, before: { sourceId: id }, after: copy });
  res.status(201).json(copy);
});

router.get('/:id/stats', async (req, res) => {
  res.json(await getChallengeStats(objectId(req.params.id)));
});

// Guarded: needs { "confirm": true }. Deletes every solve of the challenge (scores drop with them) and zeroes solveCount.
router.post('/:id/reset-solves', async (req, res) => {
  const id = objectId(req.params.id);
  const { clearSubmissions } = validate(resetBody, req.body);
  const challenge = await Challenge.findById(id, 'slug solveCount').lean();
  if (!challenge) { throw new AppError(404, 'NOT_FOUND', 'Challenge not found.'); }
  const result = await resetChallengeSolves(challenge._id, { clearSubmissions });
  await recordAudit(req, {
    action: 'challenge.reset-solves', targetType: 'challenge', targetId: id,
    before: { slug: challenge.slug, solveCount: challenge.solveCount ?? 0 }, after: result,
  });
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const id = objectId(req.params.id);
  const challenge = await Challenge.findById(id);
  if (!challenge) { throw new AppError(404, 'NOT_FOUND', 'Challenge not found.'); }
  await instanceService.stopChallengeInstances(challenge._id);
  await Challenge.deleteOne({ _id: challenge._id });
  await recordAudit(req, { action: 'challenge.delete', targetType: 'challenge', targetId: id, before: adminView(challenge) });
  res.sendStatus(204);
});

export default router;
